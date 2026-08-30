import { costContextFromRuntime, effectiveRuleCosts, evaluateCosts, ruleCostMutations } from './cost-payment.js';
import { applyOrdering } from '../primitives/ordering.js';
import { consumeTraitAttackModifiers, consumedTraitModifier } from './attack-modifiers.js';
import { resolveAuthoritativeAttack } from './attack-resolution.js';
import { resolveCureMutations } from '../primitives/status-saves.js';
import { resolveSaveWindow, type SaveWindowKind, type SaveWindowModifiers } from '../primitives/save-window.js';
import { RuleProgramViolation } from './violations.js';
// The U5 VALUE algebra (`evaluateNumber`) and its selector read surface
// (`selectActors`) plus the U6 PREDICATE algebra (`evaluatePredicate`) live
// in their semantic modules; this barrel re-exports them for the migration
// duration (the split plan's "runtime.ts stays a compatibility barrel").
import { actor, evaluateNumber, integer, selectActors } from './evaluate-value.js';
import { evaluatePredicate } from './evaluate-predicate.js';
import type {
  RuleAction,
  RuleEffect,
  RuleExecutionContext,
  RuleExecutionResult,
  RuleMutation,
  RuleProgram,
  RuleResolverRegistry,
  RuleStep,
} from '../primitives/types.js';
import type { Position } from '../../types.js';

export { RuleProgramViolation };

export * from './evaluate-value.js';
export { evaluatePredicate } from './evaluate-predicate.js';

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
        // The origin and maxRange are source-declared on the effect as ONE
        // creation-spatial contract (origin/range are a paired invariant — a
        // range without an origin is unrepresentable and rejected here even
        // if it were supplied); evaluated at command time and carried through
        // to the reducer for authoritative replay-safe enforcement.
        // Fail-closed: a declared origin selector must resolve to EXACTLY ONE
        // actor with a valid battlefield position. Zero actors, more than one
        // actor, or an actor without a valid on-board position mean the source
        // rule cannot determine where to create — the engine must reject, not
        // silently skip LoS/range enforcement.
        let creationSpatial: { origin: Position; originSize: number; maxRange?: number } | undefined;
        if (effect.spatial) {
          if (!effect.spatial.origin) {
            throw new RuleProgramViolation('entity.origin-required', 'Entity creation declares a maximum range but no origin; creation origin/range must travel as a pair.');
          }
          const originActors = selectActors(effect.spatial.origin, context);
          if (originActors.length !== 1 || !originActors[0].position) {
            throw new RuleProgramViolation('entity.origin-invalid', `Entity creation origin selector resolved to ${originActors.length} actor(s); expected exactly one with a valid position.`);
          }
          creationSpatial = {
            origin: originActors[0].position,
            originSize: effect.spatial.originSize ? integer(effect.spatial.originSize, context) : originActors[0].size,
            ...(effect.spatial.maxRange !== undefined ? { maxRange: effect.spatial.maxRange } : {}),
          };
        }
        for (const owner of owners) output.push({ kind: 'entity', sourceId: context.sourceId, operation: effect.operation, entityType: effect.entityType, ownerId: owner.id, positions: positions.slice(0, count), count, state: effect.state ?? {}, ...(effect.duration ? { duration: effect.duration } : {}), ...(creationSpatial ? { creationSpatial } : {}) });
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
 * The ordering is the U17 `source-order` policy applied against the
 * ability's step listing (`primitives/ordering.ts`) — the ONE ordering
 * authority, never a bespoke sort.
 */
export function orderedSelectedSteps(action: RuleAction, selectedSteps: RuleStep[]): RuleStep[] {
  const result = applyOrdering(
    { kind: 'source-order' },
    selectedSteps.map((step) => ({ id: step.id })),
    { sourceOrder: action.steps.map((step) => step.id) },
  );
  // FAIL CLOSED: every selected step must be named by the action's step
  // listing (a selected step the source listing does not know is a malformed
  // action — reject, never an accidental array-order tie-break).
  if (!result.ok) {
    throw new RuleProgramViolation('program.step-order', `Cannot order steps: ${result.problem === 'unknown-candidate' ? 'a selected step is not in the ability step listing.' : 'the ability step listing is unavailable.'}`);
  }
  const byId = new Map(selectedSteps.map((step) => [step.id, step]));
  return result.ordered
    .map((candidate) => byId.get(candidate.id))
    .filter((step): step is RuleStep => step !== undefined);
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
