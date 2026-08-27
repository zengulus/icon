import { costContextFromRuntime, effectiveRuleCosts, evaluateCosts, ruleCostMutations } from './cost-payment.js';
import { consumeTraitAttackModifiers, consumedTraitModifier, effectiveDamageDie } from './attack-modifiers.js';
import { resolveAuthoritativeAttack } from './attack-resolution.js';
import { footprintDistance } from '../primitives/spatial-intent.js';
import { rollDamageDice } from '../primitives/job-kit.js';
import { recipientBonusDamageDice } from './bonus-damage.js';
import { resolveCureMutations } from '../primitives/status-saves.js';
import { resolveSaveWindow, type SaveWindowKind, type SaveWindowModifiers } from '../primitives/save-window.js';
import { eligibleTargets, isEligibleTarget } from '../primitives/targeting.js';
import type {
  RuleAction,
  RuleActorView,
  RuleEffect,
  RuleExecutionContext,
  RuleExecutionResult,
  RuleMutation,
  RuleNumber,
  RulePredicate,
  RuleProgram,
  RuleResolverRegistry,
  RuleSelector,
  RuleStep,
} from '../primitives/types.js';

export class RuleProgramViolation extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RuleProgramViolation';
  }
}

const distance = (a: RuleActorView, b: RuleActorView) => {
  if (!a.position || !b.position) return Number.POSITIVE_INFINITY;
  // The canonical p.92 footprint metric (L∞ between occupied footprints) —
  // the same distance the targeting gates, auras, and the attack modifiers
  // use, so a Size-2 edge that is within range is never measured by its
  // anchor cells.
  return footprintDistance({ position: a.position, size: a.size }, { position: b.position, size: b.size });
};

function actor(context: RuleExecutionContext, id: string) {
  const value = context.state.actors[id];
  if (!value) throw new RuleProgramViolation('selector.actor-missing', `Rule target ${id} does not exist.`);
  return value;
}

export function selectActors(selector: RuleSelector, context: RuleExecutionContext): RuleActorView[] {
  const source = actor(context, context.actorId);
  let selected: RuleActorView[];
  switch (selector.kind) {
    case 'self': selected = [source]; break;
    case 'attack-target': {
      const target = context.attackTargetId ? actor(context, context.attackTargetId) : undefined;
      selected = target && isEligibleTarget(source, target, { relation: 'any' }) ? [target] : [];
      break;
    }
    case 'trigger-source': selected = context.triggerSourceId ? [actor(context, context.triggerSourceId)] : []; break;
    case 'trigger-targets': selected = (context.triggerTargetIds ?? []).map((id) => actor(context, id)); break;
    case 'input': {
      selected = (context.input.actorIds?.[selector.key] ?? []).map((id) => actor(context, id));
      // p.92: `ally` means another ally; generic input selectors also reject
      // defeated/off-board actors before a resolver can mutate them.
      selected = eligibleTargets(source, selected, { relation: selector.relation ?? 'any' });
      const minimum = selector.minimum ?? 0;
      const maximum = selector.maximum ?? Number.POSITIVE_INFINITY;
      if (selected.length < minimum || selected.length > maximum) throw new RuleProgramViolation('choice.actor-count', `${selector.key} requires ${minimum}–${maximum} actor targets.`);
      if (selector.range) {
        const maximumRange = evaluateNumber(selector.range, context);
        if (selected.some((target) => distance(source, target) > maximumRange)) throw new RuleProgramViolation('choice.actor-range', `${selector.key} contains a target outside range ${maximumRange}.`);
      }
      break;
    }
    case 'all': selected = eligibleTargets(source, Object.values(context.state.actors), { relation: selector.relation }); break;
    case 'adjacent': {
      const origins = selectActors(selector.origin, context);
      selected = eligibleTargets(source, Object.values(context.state.actors), { relation: selector.relation })
        .filter((target) => origins.some((origin) => distance(origin, target) <= 1));
      break;
    }
    case 'within': {
      const origins = selectActors(selector.origin, context);
      const maximumRange = evaluateNumber(selector.range, context);
      selected = eligibleTargets(source, Object.values(context.state.actors), { relation: selector.relation })
        .filter((target) => origins.some((origin) => distance(origin, target) <= maximumRange));
      break;
    }
    case 'condition': selected = eligibleTargets(source, Object.values(context.state.actors), { relation: selector.relation })
      .filter((target) => target.conditions.has(selector.conditionId)); break;
    case 'marked': selected = eligibleTargets(source, Object.values(context.state.actors), { relation: 'any' })
      .filter((target) => Boolean(target.state[`mark:${selector.markId ?? context.sourceId}`])); break;
    case 'summons': {
      const ownerId = selector.owner === 'self' ? source.id : null;
      const ids = Object.values(context.state.entities)
        .filter((entity) => entity.ownerId && (!ownerId || entity.ownerId === ownerId) && (!selector.summonType || entity.type === selector.summonType))
        .map(({ state }) => typeof state.actorId === 'string' ? state.actorId : '')
        .filter(Boolean);
      selected = eligibleTargets(source, ids.map((id) => actor(context, id)), { relation: 'any' });
      break;
    }
  }
  // TODO(ICON-rules, pp.87–92, 94, 107): selection eligibility is shared
  // here, but line of sight/effect, Blind, Stealth, areas, footprint distance,
  // and movement destinations must move into the planned TargetQuery gateway.
  return [...new Map(selected.map((target) => [target.id, target])).values()];
}

function oneActor(selector: RuleSelector, context: RuleExecutionContext) {
  const selected = selectActors(selector, context);
  if (selected.length !== 1) throw new RuleProgramViolation('selector.single', `Expected one actor, received ${selected.length}.`);
  return selected[0];
}

export function evaluateNumber(expression: RuleNumber, context: RuleExecutionContext): number {
  switch (expression.kind) {
    case 'constant': return expression.value;
    case 'round': return context.state.round;
    case 'input': {
      const value = context.input.numbers?.[expression.key];
      if (!Number.isFinite(value)) throw new RuleProgramViolation('choice.number-required', `${expression.key} requires a numeric choice.`);
      if (expression.minimum !== undefined && value! < expression.minimum) throw new RuleProgramViolation('choice.number-minimum', `${expression.key} must be at least ${expression.minimum}.`);
      if (expression.maximum !== undefined && value! > expression.maximum) throw new RuleProgramViolation('choice.number-maximum', `${expression.key} must be at most ${expression.maximum}.`);
      return value!;
    }
    case 'stat': {
      const target = oneActor(expression.actor, context);
      const stats = {
        hp: target.hp,
        'max-hp': target.maxHp,
        vitality: target.vitality,
        vigor: target.vigor,
        defense: target.defense,
        armor: target.armor,
        speed: target.speed,
        dash: target.dash,
        fray: target.fray,
        actions: target.actions,
        size: target.size,
      } as const;
      return stats[expression.stat];
    }
    case 'resource': return oneActor(expression.actor, context).resources[expression.resourceId] ?? 0;
    case 'count': return selectActors(expression.selector, context).length;
    case 'distance': return distance(oneActor(expression.from, context), oneActor(expression.to, context));
    case 'die': {
      const count = expression.count ? Math.max(0, Math.floor(evaluateNumber(expression.count, context))) : 1;
      return Array.from({ length: count }, () => context.dice.die(expression.sides)).reduce((total, roll) => total + roll, 0);
    }
    case 'damage-die': {
      const target = oneActor(expression.actor, context);
      const count = Math.max(0, Math.floor(evaluateNumber(expression.count, context)));
      return Array.from({ length: count }, () => context.dice.die(effectiveDamageDie(target))).reduce((total, roll) => total + roll, 0);
    }
    case 'damage-roll': {
      const target = oneActor(expression.actor, context);
      const dice = Math.max(0, Math.floor(evaluateNumber(expression.dice, context)));
      // Recipient-scoped bonus-damage grants (Finesse p.116 / Vagabond Gambit
      // p.145, content/jobs/bonus-damage-recipes.ts) are evaluated against the
      // ACTUAL damage recipient at the roll query point — the VM threads the
      // per-target recipient (`damageRecipientId`) through the damage effect,
      // so a bloodied recipient gets its own bonus die and a healthy one does
      // not, regardless of the primary attack target's state.
      const recipientDice = context.damageRecipientId && context.encounterState
        ? recipientBonusDamageDice(context.encounterState, context.actorId, context.sourceId, context.damageRecipientId)
        : 0;
      // F6a bonus-damage grants (content/jobs/bonus-damage-recipes.ts) fold
      // their dice at the USE_ABILITY boundary into abilityUseModifiers, so
      // this roll carries exactly what the command decided. The roll itself
      // stays the shared keep-highest bonus-dice semantics (ICON p.102).
      const bonusDice = (expression.bonusDice ? Math.max(0, Math.floor(evaluateNumber(expression.bonusDice, context))) : 0) + recipientDice + Math.max(0, target.resources['bonus-damage'] ?? 0) + Math.max(0, context.abilityUseModifiers?.bonusDamageDice ?? 0);
      // F6 Hissatsu: an armed next attack rolls its damage die as a d10.
      const die = effectiveDamageDie(target);
      return rollDamageDice(context.dice, die, dice, bonusDice) + (expression.flat ? evaluateNumber(expression.flat, context) : 0);
    }
    case 'if': return evaluateNumber(evaluatePredicate(expression.predicate, context) ? expression.then : expression.otherwise, context);
    case 'percent': {
      const value = evaluateNumber(expression.value, context) * expression.percent / 100;
      return expression.rounding === 'up' ? Math.ceil(value) : expression.rounding === 'down' ? Math.floor(value) : Math.round(value);
    }
    case 'add': return expression.values.reduce((total, value) => total + evaluateNumber(value, context), 0);
    case 'multiply': return expression.values.reduce((total, value) => total * evaluateNumber(value, context), 1);
    case 'minimum': return Math.min(...expression.values.map((value) => evaluateNumber(value, context)));
    case 'maximum': return Math.max(...expression.values.map((value) => evaluateNumber(value, context)));
    case 'clamp': {
      const value = evaluateNumber(expression.value, context);
      const minimum = expression.minimum ? evaluateNumber(expression.minimum, context) : Number.NEGATIVE_INFINITY;
      const maximum = expression.maximum ? evaluateNumber(expression.maximum, context) : Number.POSITIVE_INFINITY;
      return Math.min(maximum, Math.max(minimum, value));
    }
  }
}

export function evaluatePredicate(predicate: RulePredicate, context: RuleExecutionContext): boolean {
  switch (predicate.kind) {
    case 'always': return true;
    case 'not': return !evaluatePredicate(predicate.predicate, context);
    case 'all': return predicate.predicates.every((entry) => evaluatePredicate(entry, context));
    case 'any': return predicate.predicates.some((entry) => evaluatePredicate(entry, context));
    case 'compare': {
      const left = evaluateNumber(predicate.left, context);
      const right = evaluateNumber(predicate.right, context);
      if (predicate.operator === '<') return left < right;
      if (predicate.operator === '<=') return left <= right;
      if (predicate.operator === '=') return left === right;
      if (predicate.operator === '>=') return left >= right;
      return left > right;
    }
    case 'has-condition': return selectActors(predicate.target, context).every((target) => target.conditions.has(predicate.conditionId));
    // p.94/p.104: bloodied is at or under 50% of the wounds-adjusted maximum
    // (RuleActorView.maxHp is already wounds-adjusted); "at 25% hp or lower"
    // is the exact quarter mark. Both are the canonical HP-threshold
    // predicates (`kernels/hp-threshold.ts`).
    case 'bloodied': return selectActors(predicate.target, context).every((target) => target.hp <= target.maxHp / 2);
    case 'quarter': return selectActors(predicate.target, context).every((target) => target.hp <= target.maxHp / 4);
    case 'defeated': return selectActors(predicate.target, context).every((target) => target.defeated);
    case 'in-terrain': return selectActors(predicate.target, context).every((target) => target.position && context.state.terrainAt(target.position).has(predicate.terrain));
    case 'trigger': return context.triggers?.has(predicate.trigger) ?? false;
    case 'state': return selectActors(predicate.target, context).every((target) => predicate.equals === undefined ? target.state[predicate.key] !== undefined : target.state[predicate.key] === predicate.equals);
    case 'target-state': return selectActors(predicate.target, context).every((target) => predicate.equals === undefined ? target.state[predicate.key] !== undefined : target.state[predicate.key] === predicate.equals);
  }
}

export function integer(expression: RuleNumber, context: RuleExecutionContext) {
  return Math.max(0, Math.floor(evaluateNumber(expression, context)));
}

function effectsToMutations(effects: RuleEffect[], context: RuleExecutionContext, output: RuleMutation[]) {
  for (const effect of effects) {
    const targets = 'target' in effect ? selectActors(effect.target, context) : [];
    switch (effect.kind) {
      case 'resolution-targets': {
        const ids = effect.outcome === 'attack-targets'
          ? (context.attackTargetId ? [context.attackTargetId] : [])
          : effect.outcome === 'collided'
            ? (context.resolutionFacts?.collidedActorIds ?? [])
            : (context.resolutionFacts?.slainActorIds ?? []);
        const continuationContext = { ...context, triggerTargetIds: [...ids] };
        for (const id of ids) effectsToMutations(effect.effects, continuationContext, output);
        break;
      }
      case 'attack': {
        const source = actor(context, context.actorId);
        for (const target of targets) {
          // The unified ordinary-attack authority folds the F6 trait
          // modifiers (armed one-shot Hissatsu/Demon Edge, elevation
          // Pulverize, target-threshold Blood Hunger, exact-range
          // Trigrammaton through the canonical p.92 footprint distance),
          // the aura attacker boons/curses plus the target's defensive aura
          // curse, the F10 ability-use modifiers (Blessing of War / Rebirth)
          // for this ability only, and unerring — the same seam every named
          // resolver and foe recipe attack uses.
          const attack = resolveAuthoritativeAttack(context, source, target, {
            boons: effect.boons ? Math.trunc(evaluateNumber(effect.boons, context)) : 0,
            trueStrike: effect.trueStrike ?? false,
            autoHit: effect.autoHit ?? false,
          });
          const { d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit } = attack;
          output.push(attack.attackMutation);
          const triggers = new Set(context.triggers);
          triggers.add(hit ? 'hit' : 'miss');
          if (critical) triggers.add('critical-hit');
          if (attack.attackMutation.kind === 'attack' && attack.attackMutation.exceed === true) triggers.add('exceed');
          const branchContext = {
            ...context,
            attackTargetId: target.id,
            triggerTargetIds: [target.id],
            triggers,
            delivery: hit ? 'hit' as const : 'miss' as const,
            // p.89/p.104/p.105 exceptions belong only to this resolved
            // attack's direct target, not collateral area or later effect
            // damage.
            attackDamageProvenance: { targetId: target.id, ...attack.damageProvenance },
          };
          effectsToMutations(hit ? effect.onHit : effect.onMiss, branchContext, output);
          if (critical) effectsToMutations(effect.onCritical ?? [], branchContext, output);
          // One-shot armed modifiers belong to the first attack roll only: a
          // multi-target ability's later rolls read the (consumed) view.
          if (consumedTraitModifier(attack.traitModifier)) consumeTraitAttackModifiers(source.state);
        }
        break;
      }
      case 'damage': {
        const instances = effect.instances ? integer(effect.instances, context) : 1;
        for (const target of targets) for (let instance = 1; instance <= instances; instance += 1) {
          const attackDamage = context.attackDamageProvenance?.targetId === target.id ? context.attackDamageProvenance : undefined;
          const unerring = Boolean(context.actionTags?.has('unerring') || attackDamage?.ignoreAetherwall || attackDamage?.ignoreCover);
          const ignoreCover = Boolean(effect.ignoreCover || context.actionTags?.has('unerring') || attackDamage?.ignoreCover);
          // F10 ability-use pierce (Blessing of Rebirth): route the damage
          // through the existing piercing damage path instead of re-deriving
          // armor/vigor handling locally.
          const damageType = context.abilityUseModifiers?.pierce && effect.damageType === 'normal' ? 'piercing' : effect.damageType;
          // The amount expression evaluates per target with the RECIPIENT
          // threaded, so recipient-scoped bonus-damage rolls (Finesse, p.116)
          // distinguish each target's live state at the roll query point.
          const recipientContext = { ...context, damageRecipientId: target.id };
          output.push({
            kind: 'damage', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id,
            // The attack's direct-target damage instance also carries trait flat
            // bonus damage (Pulverize +2), scoped by the recorded provenance.
            amount: integer(effect.amount, recipientContext) + (attackDamage?.bonusFlat ?? 0), damageType, instance,
            delivery: effect.delivery ?? context.delivery ?? 'effect', ignoreCover,
            ...(attackDamage?.ignoreDodge ? { ignoreDodge: true } : {}),
            ...(unerring ? { ignoreAetherwall: true } : {}),
          });
        }
        break;
      }
      case 'heal': for (const target of targets) output.push({ kind: 'heal', sourceId: context.sourceId, actorId: target.id, amount: integer(effect.amount, context), maximum: effect.maximum ? integer(effect.maximum, context) : null }); break;
      case 'vigor': for (const target of targets) output.push({ kind: 'vigor', sourceId: context.sourceId, actorId: target.id, amount: integer(effect.amount, context), uncapped: effect.uncapped ?? false }); break;
      case 'condition': for (const target of targets) output.push({ kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, conditionId: effect.conditionId, operation: effect.operation, potency: effect.potency ?? 'normal', ...(effect.duration ? { duration: effect.duration } : {}) }); break;
      case 'cure': for (const target of targets) output.push(...resolveCureMutations(context, target, effect.all ?? false)); break;
      case 'move': {
        const positions = effect.positionInput ? [...(context.input.positions?.[effect.positionInput] ?? [])] : [];
        const direction = effect.directionInput ? context.input.directions?.[effect.directionInput] ?? null : null;
        for (const target of targets) output.push({ kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, movement: effect.movement, distance: effect.distance ? integer(effect.distance, context) : null, positions, direction, phasing: effect.phasing ?? false });
        break;
      }
      case 'resource': for (const target of targets) output.push({ kind: 'resource', sourceId: context.sourceId, actorId: target.id, resourceId: effect.resourceId, operation: effect.operation, amount: integer(effect.amount, context), minimum: effect.minimum ?? null, maximum: effect.maximum ?? null }); break;
      case 'actions': for (const target of targets) output.push({ kind: 'actions', sourceId: context.sourceId, actorId: target.id, operation: effect.operation, amount: integer(effect.amount, context) }); break;
      case 'terrain': {
        const positions = effect.positionInput === 'target-position' && context.attackTargetId
          ? [actor(context, context.attackTargetId).position].filter((position): position is NonNullable<typeof position> => position !== null)
          : [...(context.input.positions?.[effect.positionInput] ?? [])];
        const count = effect.count ? integer(effect.count, context) : positions.length;
        if (positions.length < count) throw new RuleProgramViolation('choice.position-count', `${effect.positionInput} requires ${count} positions.`);
        output.push({ kind: 'terrain', sourceId: context.sourceId, sourceActorId: context.actorId, operation: effect.operation, terrain: effect.terrain, positions: positions.slice(0, count), height: effect.height ? integer(effect.height, context) : null, ...(effect.duration ? { duration: effect.duration } : {}) });
        break;
      }
      case 'entity': {
        const owners = selectActors(effect.owner, context);
        const positions = effect.positionInput ? [...(context.input.positions?.[effect.positionInput] ?? [])] : [];
        const count = effect.count ? integer(effect.count, context) : Math.max(1, positions.length);
        // ICON general rule: creation requires free, unobstructed, and LoS.
        // The origin and maxRange are source-declared on the effect; evaluated
        // at command time and carried through to the reducer for authoritative
        // replay-safe enforcement.
        const originActor = effect.origin ? selectActors(effect.origin, context)[0] : undefined;
        const creationOrigin = originActor?.position ?? undefined;
        const creationMaxRange = effect.maxRange;
        for (const owner of owners) output.push({ kind: 'entity', sourceId: context.sourceId, operation: effect.operation, entityType: effect.entityType, ownerId: owner.id, positions: positions.slice(0, count), count, state: effect.state ?? {}, ...(effect.duration ? { duration: effect.duration } : {}), ...(creationOrigin ? { creationOrigin } : {}), ...(creationMaxRange !== undefined ? { creationMaxRange } : {}) });
        break;
      }
      case 'mark': for (const target of targets) output.push({ kind: 'mark', sourceId: context.sourceId, ownerId: context.actorId, operation: effect.operation, actorId: target.id, markId: effect.markId, ...(effect.duration ? { duration: effect.duration } : {}), state: effect.state ?? {} }); break;
      case 'stance': for (const target of targets) output.push({ kind: 'stance', sourceId: context.sourceId, sourceActorId: context.actorId, operation: effect.operation, actorId: target.id, stanceId: effect.stanceId, state: effect.state ?? {} }); break;
      case 'persistent': for (const target of targets) output.push({ kind: 'persistent', sourceId: context.sourceId, ownerId: context.actorId, operation: effect.operation, actorId: target.id, effectId: effect.effectId, duration: effect.duration, modifiers: effect.modifiers ?? [], triggers: effect.triggers ?? [], state: effect.state ?? {} }); break;
      case 'modifier': for (const target of targets) output.push({ kind: 'modifier', sourceId: context.sourceId, ownerId: context.actorId, actorId: target.id, modifier: effect.modifier, duration: effect.duration }); break;
      case 'save': {
        for (const target of targets) {
          const sourceModifier = effect.boon ? Math.trunc(evaluateNumber(effect.boon, context)) : 0;
          const ordinal = output.filter((mutation) => mutation.kind === 'save').length + 1;
          const save = resolveSaveWindow(context, target, {
            id: `${context.sourceId}:${context.actionId}:effect-save:${ordinal}:${target.id}`,
            kind: 'effect',
            sourceId: context.sourceId,
            actorId: context.actorId,
            sourceModifier,
            // The save effect's continuation rides the record as a branch so a
            // save-reroll interrupt (Sucker Punch, p.143) can regenerate either
            // outcome; the resolver fills in the evaluated `boon`/`threshold`.
            branch: { onSuccess: effect.onSuccess, onFailure: effect.onFailure },
          }).mutation;
          output.push(save);
          effectsToMutations(save.success ? effect.onSuccess : effect.onFailure, { ...context, triggerTargetIds: [target.id], delivery: save.success ? 'save-success' : 'effect' }, output);
        }
        break;
      }
      case 'if': effectsToMutations(evaluatePredicate(effect.predicate, context) ? effect.then : effect.otherwise ?? [], context, output); break;
      case 'repeat': for (let iteration = 0; iteration < integer(effect.times, context); iteration += 1) effectsToMutations(effect.effects, context, output); break;
      case 'defeat': for (const target of targets) output.push({ kind: 'defeat', sourceId: context.sourceId, actorId: target.id }); break;
      case 'phase': for (const target of targets) output.push({ kind: 'phase', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, phaseId: effect.phaseId }); break;
      case 'end-turn': for (const target of targets) output.push({ kind: 'end-turn', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id }); break;
      case 'state': for (const target of targets) output.push({ kind: 'state', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, key: effect.key, operation: effect.operation, ...(effect.value !== undefined ? { value: effect.value } : {}) }); break;
    }
  }
}

/**
 * ICON p.85 ("Effects resolve in the order they are listed") and p.107 §4
 * ("The effects of abilities resolve in the order they are listed") define
 * the deterministic order of an ability's trigger steps: there is no global
 * trigger priority — simultaneously-derived triggers share the ability's
 * source-listing order. This returns the selected steps in that canonical
 * order so execution never depends on Set iteration or author discipline.
 */
export function orderedSelectedSteps(action: RuleAction, selectedSteps: RuleStep[]): RuleStep[] {
  const sourceOrder = new Map(action.steps.map((step, index) => [step.id, index]));
  return [...selectedSteps].sort((first, second) => (sourceOrder.get(first.id) ?? Number.MAX_SAFE_INTEGER) - (sourceOrder.get(second.id) ?? Number.MAX_SAFE_INTEGER));
}

/** ICON p.143 — regenerate a save and its outcome branch for a re-roll
 * (Sucker Punch: "the enemy must re-roll the save, keeping the second
 * result"). The roll and its rolled boon/curse are supplied by the caller
 * (the command layer, which owns the dice and re-rolls the modifier); the
 * branch for the new result is generated from the held save's continuation
 * AST with the triggering ability's provenance, so the regenerated mutations
 * are replay-exact and carry the same durable SaveWindow record
 * (`windowKind`, `windowId`, `modifiers`, `threshold`) as the original. */
export function rerollSaveMutations(
  save: {
    targetId: string;
    sourceId: string;
    sourceActorId: string;
    windowKind?: SaveWindowKind;
    windowId?: string;
    statusId?: string;
    modifiers?: SaveWindowModifiers;
    threshold?: number;
    onSuccess: RuleEffect[];
    onFailure: RuleEffect[];
  },
  context: RuleExecutionContext,
  roll: number,
  boon: number,
): RuleMutation[] {
  const threshold = save.threshold ?? 10;
  const total = roll + boon;
  const success = total >= threshold;
  const output: RuleMutation[] = [{
    kind: 'save',
    sourceId: save.sourceId,
    actorId: save.targetId,
    ...(save.windowKind ? { windowKind: save.windowKind } : {}),
    ...(save.windowId ? { windowId: save.windowId } : {}),
    ...(save.statusId ? { statusId: save.statusId } : {}),
    ...(save.modifiers ? { modifiers: save.modifiers } : {}),
    threshold,
    roll,
    boon,
    total,
    success,
    branch: { boon: save.modifiers ? save.modifiers.sourceModifier + save.modifiers.saveBoon - save.modifiers.saveCurse + (save.modifiers.blessing ? 1 : 0) : 0, threshold, onSuccess: save.onSuccess, onFailure: save.onFailure },
  }];
  effectsToMutations(success ? save.onSuccess : save.onFailure, {
    ...context,
    actorId: save.sourceActorId,
    sourceId: save.sourceId,
    input: {},
    triggerTargetIds: [save.targetId],
    delivery: success ? 'save-success' : 'effect',
  }, output);
  return output;
}

export function executeRuleProgram(
  program: RuleProgram,
  context: RuleExecutionContext,
  resolvers: RuleResolverRegistry = {},
  options: { onlyTriggers?: ReadonlySet<string> } = {},
): RuleExecutionResult {
  if (program.sourceId !== context.sourceId) throw new RuleProgramViolation('program.source', 'The execution context does not match this source program.');
  const action = program.actions.find(({ id, timing }) => id === context.actionId && timing === context.timing);
  if (!action) throw new RuleProgramViolation('program.action', `${context.actionId} is not available at ${context.timing}.`);
  const appendOnly = options.onlyTriggers !== undefined;
  const selectedSteps = orderedSelectedSteps(action, action.steps.filter(({ timing, trigger, condition }) => timing === context.timing
    && (!trigger || context.triggers?.has(trigger))
    && (!appendOnly || (trigger !== undefined && options.onlyTriggers!.has(trigger)))
    && (!condition || evaluatePredicate(condition, context))));
  const mutations: RuleMutation[] = [];
  // Costs and the named resolver are paid once, on the primary execution pass;
  // an append-only pass re-resolves only the newly-qualifying trigger steps.
  // Payments ride the shared cost-payment transaction kernel: the effective
  // costs (after any registered cost modifiers) are validated at the command
  // boundary and emitted here through the same mutation builders, so the
  // amount validated and the amount paid never drift.
  if (!appendOnly && (context.timing === 'use' || context.timing === 'interrupt')) {
    const costContext = costContextFromRuntime(context.state, context.actorId, context.sourceId, program.name);
    const effective = effectiveRuleCosts(action.costs, costContext);
    const evaluated = evaluateCosts(effective, (amount) => integer(amount, context));
    mutations.push(...ruleCostMutations(costContext, evaluated));
  }
  if (!appendOnly && action.resolverId) {
    const resolver = resolvers[action.resolverId];
    if (!resolver) throw new RuleProgramViolation('program.resolver', `Named resolver ${action.resolverId} is not registered.`);
    mutations.push(...resolver(context, action));
  }
  const actionContext = { ...context, actionTags: new Set(action.tags) };
  for (const step of selectedSteps) effectsToMutations(step.effects, actionContext, mutations);
  return { mutations, selectedAction: action, selectedSteps };
}
