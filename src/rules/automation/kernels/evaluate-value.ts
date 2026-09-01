/**
 * evaluate-value.ts — the U5 VALUE / EXPRESSION evaluation kernel.
 *
 * One typed scalar/value expression authority (`evaluateNumber`) evaluated
 * against current state: constant, stat, resource, round, input,
 * count(selector), count-query over the general U3 domains,
 * distance-between-endpoints (selector / U1 reference / U7 anchor),
 * die/damage-die/damage-roll, if, percent, percent-of-BASE-max,
 * add/multiply/minimum/maximum/clamp. This module also owns the
 * selector→views read surface (`selectActors`, the RuleSelector authority)
 * because the expression algebra resolves selector reads intrinsically —
 * splitting the two would put the value algebra's every actor read behind a
 * second module. `kernels/runtime.ts` remains the compatibility barrel and
 * re-exports both this module and `kernels/evaluate-predicate.ts` (U6).
 *
 * Replay semantics: expression evaluation is a pure function of state +
 * recorded input + recorded dice results — no second RNG path. The evaluator
 * FAILS CLOSED on expressions the substrate cannot represent exactly
 * (an unprojected base-max read, a non-spatial distance endpoint, an
 * unresolvable reference): it never guesses a value.
 *
 * The evaluator carries no source IDs. `sourceId` is read only for the
 * `marked` selector's default mark key (the source unit that owns the
 * query), exactly as the selector authority has always read it.
 */
import { footprintDistance } from '../primitives/spatial-intent.js';
import { rollDamageDice } from '../primitives/damage-roll.js';
import type { DistanceEndpoint, RuleActorView, RuleExecutionContext, RuleNumber, RuleSelector } from '../primitives/types.js';
import { liveActorSlot, resolveActorSelectorReference, resolveReference } from '../primitives/reference.js';
import type { SpatialOrigin } from '../primitives/anchor.js';
import { resolveSpatialAnchor } from './candidate.js';
import { evaluateActorQuery, evaluateValueQuery } from './evaluate-query.js';
import { effectiveDamageDie } from './attack-modifiers.js';
import { recipientBonusDamageDice } from './bonus-damage.js';
import { RuleProgramViolation } from './violations.js';
import { evaluatePredicate } from './evaluate-predicate.js';

const distance = (a: RuleActorView, b: RuleActorView) => {
  if (!a.position || !b.position) return Number.POSITIVE_INFINITY;
  // The canonical p.92 footprint metric (L∞ between occupied footprints) —
  // the same distance the targeting gates, auras, and the attack modifiers
  // use, so a Size-2 edge that is within range is never measured by its
  // anchor cells.
  return footprintDistance({ position: a.position, size: a.size }, { position: b.position, size: b.size });
};

export function actor(context: RuleExecutionContext, id: string) {
  const value = context.state.actors[id];
  if (!value) throw new RuleProgramViolation('selector.actor-missing', `Rule target ${id} does not exist.`);
  return value;
}

/** Resolve the reference-shaped selector subset through U1. U3/U4 policy is
 * deliberately applied by the caller after this identity/binding step. */
function referenceSelectorActors(selector: RuleSelector, context: RuleExecutionContext): RuleActorView[] {
  const resolution = resolveActorSelectorReference(selector, context);
  if (!resolution.ok) {
    if (resolution.problem === 'missing-slot'
      && (selector.kind === 'attack-target' || selector.kind === 'trigger-source')) return [];
    const code = selector.kind === 'bound' ? 'selector.bound' : 'selector.actor-missing';
    throw new RuleProgramViolation(code, `Actor reference selector "${selector.kind}" failed to resolve: ${resolution.problem}.`);
  }
  if (resolution.value.kind === 'actor') return [resolution.value.actor];
  if (resolution.value.kind === 'collection') {
    return resolution.value.items.flatMap((item) => item.kind === 'actor' ? [item.actor] : []);
  }
  throw new RuleProgramViolation('selector.actor-missing', `Actor reference selector "${selector.kind}" resolved to a non-actor value.`);
}

export function selectActors(selector: RuleSelector, context: RuleExecutionContext): RuleActorView[] {
  let selected: RuleActorView[];
  switch (selector.kind) {
    // Reference selectors — a named referent, not a candidate query. The
    // `attack-target` referent is still gated by the shared U3 eligibility
    // (alive + on-battlefield) so a defeated/removed target yields nothing.
    case 'self': selected = referenceSelectorActors(selector, context); break;
    case 'attack-target': {
      const target = referenceSelectorActors(selector, context)[0];
      if (!target) { selected = []; break; }
      const eligible = new Set(evaluateActorQuery({ relation: 'any' }, context).map((entry) => entry.id));
      selected = eligible.has(target.id) ? [target] : [];
      break;
    }
    case 'trigger-source': selected = referenceSelectorActors(selector, context); break;
    case 'trigger-targets': selected = referenceSelectorActors(selector, context); break;
    case 'input': {
      const supplied = referenceSelectorActors(selector, context);
      // p.92: `ally` means another ally; generic input selectors also reject
      // defeated/off-board actors before a resolver can mutate them — through
      // the same U3 eligibility authority automatic targeting uses.
      const relationQuery = { relation: selector.relation ?? 'any' };
      const eligible = new Set(evaluateActorQuery(relationQuery, context).map((entry) => entry.id));
      selected = supplied.filter((target) => eligible.has(target.id));
      const minimum = selector.minimum ?? 0;
      const maximum = selector.maximum ?? Number.POSITIVE_INFINITY;
      if (selected.length < minimum || selected.length > maximum) throw new RuleProgramViolation('choice.actor-count', `${selector.key} requires ${minimum}–${maximum} actor targets.`);
      // The input selector's legacy contract ENFORCES its declared range
      // (throws) rather than silently excluding — preserved verbatim, but
      // the legality question itself is the U3 candidate authority's answer:
      // the range filter is the SAME p.92 footprint query automatic targeting
      // uses, never a second actor-range algorithm in this adapter.
      if (selector.range) {
        const maximumRange = evaluateNumber(selector.range, context);
        const inRange = new Set(evaluateActorQuery({ ...relationQuery, range: maximumRange }, context).map((entry) => entry.id));
        if (selected.some((target) => !inRange.has(target.id))) throw new RuleProgramViolation('choice.actor-range', `${selector.key} contains a target outside range ${maximumRange}.`);
      }
      break;
    }
    // Query selectors — eligibility and every domain filter live in the
    // shared U3 authority; this adapter only maps selector → query.
    case 'all': selected = evaluateActorQuery({ relation: selector.relation }, context); break;
    case 'adjacent': {
      const origins = selectActors(selector.origin, context);
      selected = evaluateActorQuery({ relation: selector.relation, origins, originDistance: 1 }, context);
      break;
    }
    case 'within': {
      const origins = selectActors(selector.origin, context);
      const maximumRange = evaluateNumber(selector.range, context);
      selected = evaluateActorQuery({ relation: selector.relation, origins, originDistance: maximumRange }, context);
      break;
    }
    case 'condition': selected = evaluateActorQuery({ relation: selector.relation, conditionId: selector.conditionId }, context); break;
    case 'marked': selected = evaluateActorQuery({ mark: { markId: selector.markId } }, context); break;
    case 'summons': selected = evaluateActorQuery({ summon: { owner: selector.owner, summonType: selector.summonType } }, context); break;
    // U1 binding glue: resolve a reference BOUND by an earlier flow operation
    // (`for-each` items, `BIND … AS …`). Domain-checked — a bound name that
    // resolves to a non-actor reference rejects, never silently reinterprets.
    case 'bound': {
      selected = referenceSelectorActors(selector, context);
      break;
    }
  }
  // TODO(ICON-rules, pp.87–92, 94, 107): eligibility is now ONE shared
  // authority (kernels/candidate.ts + kernels/evaluate-query.ts); line of
  // sight/effect, Blind, Stealth, areas, and movement destinations still
  // await the planned TargetQuery gateway (U3 Phase T2) — line of sight /
  // effect are now query OPERATORS (`evaluateActorQuery` `lineOfSight`/
  // `lineOfEffect`), not yet wired into the selector vocabulary itself.
  return [...new Map(selected.map((target) => [target.id, target])).values()];
}

function oneActor(selector: RuleSelector, context: RuleExecutionContext) {
  const selected = selectActors(selector, context);
  if (selected.length !== 1) throw new RuleProgramViolation('selector.single', `Expected one actor, received ${selected.length}.`);
  return selected[0];
}

/** Resolve one `distance` endpoint to a concrete footprint (position +
 * size), or null when it is a position-less actor (the legacy contract:
 * a position-less endpoint measures as `Number.POSITIVE_INFINITY`). A
 * RuleSelector resolves through the selector authority (exactly one actor);
 * a U1 reference must resolve to a spatial domain (actor/entity/position) —
 * a non-spatial or unresolvable reference FAILS CLOSED (never guessed); a
 * U7 anchor resolves through the shared anchor authority. */
function resolveDistanceEndpoint(
  endpoint: DistanceEndpoint,
  context: RuleExecutionContext,
): SpatialOrigin | null {
  if ('ref' in endpoint) {
    const resolution = resolveReference(endpoint.ref, context);
    if (!resolution.ok) {
      throw new RuleProgramViolation('value.distance-ref', `Distance endpoint reference failed: ${resolution.problem}.`);
    }
    const value = resolution.value;
    if (value.kind === 'actor') return value.actor.position ? { position: value.actor.position, size: value.actor.size } : null;
    if (value.kind === 'entity') return value.entity.position ? { position: value.entity.position, size: 1 } : null;
    if (value.kind === 'position') return { position: value.position, size: 1 };
    throw new RuleProgramViolation('value.distance-ref', 'Distance endpoint resolved to a non-spatial reference.');
  }
  if ('anchor' in endpoint) {
    const anchor = resolveSpatialAnchor(endpoint.anchor, context);
    return { position: anchor.position, size: anchor.size };
  }
  const target = oneActor(endpoint, context);
  return target.position ? { position: target.position, size: target.size } : null;
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
    case 'count-query': return evaluateValueQuery(expression.query, context).length;
    case 'distance': {
      const from = resolveDistanceEndpoint(expression.from, context);
      const to = resolveDistanceEndpoint(expression.to, context);
      if (!from || !to) return Number.POSITIVE_INFINITY;
      return footprintDistance(from, to);
    }
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
      let recipientDice = 0;
      if (context.encounterState) {
        const recipient = resolveReference(liveActorSlot('damage-recipient'), context);
        if (recipient.ok && recipient.value.kind === 'actor') {
          recipientDice = recipientBonusDamageDice(context.encounterState, context.actorId, context.sourceId, recipient.value.actor.id);
        } else if (!recipient.ok && recipient.problem !== 'missing-slot') {
          throw new RuleProgramViolation('value.damage-recipient', `Damage-recipient reference failed to resolve: ${recipient.problem}.`);
        }
      }
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
    case 'percent-base-max': {
      // ICON p.107 "% HEALTH": percentage costs/damage use the BASE maximum,
      // never the wounds-adjusted bar. The view must project the durable base
      // max; a view without it FAILS CLOSED rather than silently reading the
      // wounds-adjusted maximum (which would change the meaning of "percent
      // of your maximum HP").
      const target = oneActor(expression.target, context);
      if (typeof target.baseMaxHp !== 'number' || !Number.isFinite(target.baseMaxHp)) {
        throw new RuleProgramViolation('value.base-max-missing', `The actor view does not project the base maximum HP (percent-base-max).`);
      }
      const value = target.baseMaxHp * expression.percent / 100;
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

export function integer(expression: RuleNumber, context: RuleExecutionContext) {
  return Math.max(0, Math.floor(evaluateNumber(expression, context)));
}
