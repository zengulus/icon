/**
 * evaluate-predicate.ts — the U6 PREDICATE / CONDITION evaluation kernel
 * (CORE form, Phase T2).
 *
 * "Is this rule clause applicable now?" — boolean expressions composed from
 * QUERY + VALUE + REFERENCE: `bloodied(source)`, `count(foesInArea) == 1`
 * (compare over a `count-query` value), `distance(source,target) >= 3`
 * (compare over a `distance` value), `hasStatus(target, weakened)`,
 * `markExists(owner,target)`, `isSlowTurn(source)`, `round >= 4`,
 * `terrainAt(target) contains pit`. The algebra consumes the U1/U3/U5/U8
 * authorities (references, queries, values, the clock) and composes them
 * with always/not/all/any/compare.
 *
 * T3 added `used-scope` (U16 ledger). T4 completed U6 with
 * `effect-still-exists`, reading through the U10 fact/instance seam
 * (`effectExistsLive`) against the target's LIVE effect surfaces — the
 * general active-effect state authority stays in its domain (conditions/
 * statuses/stance/marks/active-effects on the actor view); U6 only reads
 * through the generic reference/fact seam and FAILS CLOSED when the required
 * instance identity cannot be represented. With the U10 dependency present,
 * this module's declared dependencies (U6 needs U10 for effect-still-exists)
 * are now satisfied.
 *
 * Replay semantics: predicates evaluate replay state deterministically —
 * the same state produces the same boolean; no ambient flags, no second
 * decision path. A predicate whose semantics the substrate cannot evaluate
 * (an unregistered aura provenance, an unresolvable reference) FAILS CLOSED
 * rather than guessing.
 *
 * The evaluator carries no source IDs: `sourceId` is provenance only
 * (the `marked` default mark key and the `inside-aura` provenance lookup).
 */
import type { RuleExecutionContext, RulePredicate } from '../primitives/types.js';
import { percentOfMaximum, baseMaximumHp, selectActors, evaluateNumber } from './evaluate-value.js';
import { auraDefinitionFor, auraRuntimeView, isInAura } from './aura.js';
import { usageCount, usageKey } from '../primitives/usage.js';
import { effectExistsLive, type EffectInstanceIdentity } from '../primitives/facts.js';
import { RuleProgramViolation } from './violations.js';

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
    // p.81 (primary HP/Wound rule): bloodied is at or below 50% of the BASE
    // maximum; "at 25% hp or lower" (Rot p.186) is the exact quarter mark of
    // the same base bar (adjudication icon-1.5:combat:bloodied-base-max —
    // wounds shrink the live maxHp but NEVER move these thresholds). Both are
    // the canonical HP-threshold predicates (the same authority
    // `kernels/hp-threshold.ts` answers on the raw reducer surface) consuming
    // the SINGLE U5 percentage-of-BASE-maximum scalar (`percentOfMaximum` —
    // the `percent-base-max` value family) with `rounding: 'down'`, which
    // reproduces the exact `hp * 100 <= baseMaxHp * percent` comparison: a
    // character at exactly the threshold is inside and one point above is
    // not. A view that cannot project the durable base maximum FAILS CLOSED
    // (`value.base-max-missing`) — never a silent read of the wounds-
    // adjusted bar.
    case 'bloodied': return selectActors(predicate.target, context).every((target) => target.hp <= percentOfMaximum(baseMaximumHp(target), 50, 'down'));
    case 'quarter': return selectActors(predicate.target, context).every((target) => target.hp <= percentOfMaximum(baseMaximumHp(target), 25, 'down'));
    case 'defeated': return selectActors(predicate.target, context).every((target) => target.defeated);
    case 'in-terrain': return selectActors(predicate.target, context).every((target) => target.position && context.state.terrainAt(target.position).has(predicate.terrain));
    // p.94: a mark is a durable marker the target carries; absent `markId`
    // the source unit id is the default, mirroring the `marked` query
    // filter's default key.
    case 'mark-exists': {
      const markId = predicate.markId ?? context.sourceId;
      return selectActors(predicate.target, context).every((target) => Boolean(target.state[`mark:${markId}`]));
    }
    // Stance gate: the target currently holds the stance (the stance the
    // aura kernel and stance-gated resolvers read — only the id is
    // projected).
    case 'in-stance': return selectActors(predicate.target, context).every((target) => target.stance?.stanceId === predicate.stanceId);
    // Inside-aura: membership is DERIVED through the shared aura kernel's
    // `isInAura` over the runtime view — never a parallel geometry read.
    // The aura is named by its provenance (the owning source unit); an
    // unregistered provenance means the predicate is unrepresentable and
    // FAILS CLOSED rather than guessing.
    case 'inside-aura': {
      const provenance = predicate.sourceId ?? context.sourceId;
      const definition = auraDefinitionFor(provenance);
      if (!definition) {
        throw new RuleProgramViolation('predicate.aura-unknown', `No registered aura with provenance ${provenance}; the inside-aura predicate cannot be evaluated.`);
      }
      const view = auraRuntimeView(context.state);
      return selectActors(predicate.target, context).every((target) => isInAura(view, definition, target.id));
    }
    // p.129 Special: the target has already acted this round. Reads the VM
    // view's durable act state (attack-made-this-turn projection); a fuller
    // "any action" ledger is a later scope.
    case 'acted-this-round': return selectActors(predicate.target, context).every((target) => target.attacked);
    // Used-scope (U16, T3): the target's durable usage ledger counts how many
    // times `sourceId` was used within the scope (once-per-turn/round/combat
    // gates, N-per-scope counts). Reads the SAME key the command boundary
    // consumes and the lifecycle recipes reset — never a parallel counter.
    case 'used-scope': return selectActors(predicate.target, context).every((target) => {
      const key = usageKey({ sourceId: predicate.sourceId, ownerId: target.id, scope: predicate.scope });
      return usageCount({ ruleState: target.state }, key) >= (predicate.atLeast ?? 1);
    });
    // U6 completed (T4) via U10: does the SPECIFIC live effect instance still
    // exist on the target? The identity is read through the U10 fact/instance
    // seam (`effectExistsLive`) against the target's LIVE effect surfaces —
    // the general active-effect state authority stays in its domain; U6 only
    // reads through the generic seam. An instance identity the projected view
    // cannot represent (a specific coexisting mark/persistent instance, no
    // `anyInstance`) FAILS CLOSED — the predicate rejects rather than guess.
    case 'effect-still-exists': return selectActors(predicate.target, context).every((target) => {
      const identity: EffectInstanceIdentity = {
        kind: predicate.effectKind,
        sourceId: predicate.sourceId ?? context.sourceId,
        targetId: target.id,
        effectId: predicate.effectId,
        ...(predicate.ownerId !== undefined ? { ownerId: predicate.ownerId } : {}),
        ...(predicate.instanceId !== undefined ? { instanceId: predicate.instanceId } : {}),
        ...(predicate.ownerSensitive === true ? { ownerSensitive: true } : {}),
      };
      const result = effectExistsLive(target, identity);
      if (!result.ok) {
        throw new RuleProgramViolation('effect-still-exists.unrepresentable', `A ${predicate.effectKind} instance on ${target.id} cannot be disambiguated on the projected live view; the effect-still-exists predicate cannot be answered.`);
      }
      return result.exists;
    });
    case 'trigger': return context.triggers?.has(predicate.trigger) ?? false;
    case 'state': return selectActors(predicate.target, context).every((target) => predicate.equals === undefined ? target.state[predicate.key] !== undefined : target.state[predicate.key] === predicate.equals);
    case 'target-state': return selectActors(predicate.target, context).every((target) => predicate.equals === undefined ? target.state[predicate.key] !== undefined : target.state[predicate.key] === predicate.equals);
  }
}
