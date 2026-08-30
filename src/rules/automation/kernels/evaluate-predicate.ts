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
 * The T2 contract deliberately EXCLUDES the `effect-still-exists` predicate:
 * it reads U10 facts/instances and completes U6 in T4 (the plan's staged
 * DAG). `used-this-scope` reads the U16 ledger and lands with the U16 core
 * in T3. This module is NOT described as complete before those declared
 * dependencies exist.
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
import { selectActors, evaluateNumber } from './evaluate-value.js';
import { auraDefinitionFor, auraRuntimeView, isInAura } from './aura.js';
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
    // p.94/p.104: bloodied is at or under 50% of the wounds-adjusted maximum
    // (RuleActorView.maxHp is already wounds-adjusted); "at 25% hp or lower"
    // is the exact quarter mark. Both are the canonical HP-threshold
    // predicates (`kernels/hp-threshold.ts`) evaluated through the shared
    // `stat max-hp` read — the p.107 "% HEALTH" BASE-max semantics
    // (`percent-base-max`) deliberately do NOT apply to state thresholds.
    case 'bloodied': return selectActors(predicate.target, context).every((target) => target.hp <= target.maxHp / 2);
    case 'quarter': return selectActors(predicate.target, context).every((target) => target.hp <= target.maxHp / 4);
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
    case 'trigger': return context.triggers?.has(predicate.trigger) ?? false;
    case 'state': return selectActors(predicate.target, context).every((target) => predicate.equals === undefined ? target.state[predicate.key] !== undefined : target.state[predicate.key] === predicate.equals);
    case 'target-state': return selectActors(predicate.target, context).every((target) => predicate.equals === undefined ? target.state[predicate.key] !== undefined : target.state[predicate.key] === predicate.equals);
  }
}
