/**
 * candidate.ts — the QUERY / CANDIDATE underlay (U3).
 *
 * One deterministic eligibility authority beneath both automatic targeting
 * and player choices. Before this kernel, "who is a legal target" was
 * answered in at least three different places: `selectActors`'s `input`
 * branch, `choice.ts`'s `resolveActors`, and `queryDirectTarget`. Each had
 * its own inline relation check and its own range gate — three copies of the
 * same question, drifting apart over time.
 *
 * This kernel is the ONE seam they all go through:
 *
 *   Query<T> → CandidateSet<T>
 *
 * It answers a single question: "What things currently qualify?" The answer
 * is derived by composing the existing, source-tested authorities —
 * `matchesTargetRelation` for p.92 relations, `isEligibleTarget` for
 * defeated/off-battlefield filtering, `footprintDistance` for the canonical
 * p.92 footprint metric, and `evaluateNumber` for dynamic range values.
 *
 * The kernel carries no source IDs. It never branches on an ability name,
 * a talent id, or a job class. It only knows relations, ranges, and state.
 */

import type {
  RuleActorView,
  RuleExecutionContext,
  RuleNumber,
  RuleSelector,
} from '../primitives/types.js';
import {
  matchesTargetRelation,
  type TargetRelation,
} from '../primitives/targeting.js';
import { footprintDistance } from '../primitives/spatial-intent.js';
import { evaluateNumber, RuleProgramViolation } from './runtime.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A candidate-legality query for actors. Every field is optional; absent
 * fields default to the most permissive value that is still source-safe. */
export interface ActorCandidateQuery {
  /** p.92 relation filter: 'self' | 'ally' | 'foe' | 'any'. Default 'any'. */
  relation?: TargetRelation;
  /** Optional maximum range (p.92 footprint distance). Evaluated via
   * `evaluateNumber` against the current context. */
  range?: RuleNumber;
  /** Who the range is measured from. Defaults to `context.actorId`. */
  rangeOrigin?: RuleSelector;
  /** Whether defeated actors may appear in the CandidateSet. Default false. */
  includeDefeated?: boolean;
  /** Whether off-battlefield actors may appear. Default false. */
  includeOffBattlefield?: boolean;
}

/** A structured rejection reason. The `code` is drawn from the existing
 * violation-code vocabulary so callers (e.g. `choice.ts`) can throw a
 * `RuleProgramViolation` that reads identically at the command boundary. */
export interface CandidateViolation {
  code: string;
  message: string;
}

export type CandidateResult<T> =
  | { legal: true; value: T }
  | { legal: false; violation: CandidateViolation };

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve the range-origin actor from a selector, falling back to the
 * context's acting actor. Delegates to `selectActors`-like logic but only
 * needs the first match. */
function resolveRangeOrigin(
  selector: RuleSelector | undefined,
  context: RuleExecutionContext,
): RuleActorView {
  if (!selector) {
    const source = context.state.actors[context.actorId];
    if (!source) {
      throw new RuleProgramViolation('selector.actor-missing', `Actor ${context.actorId} does not exist.`);
    }
    return source;
  }
  // For now we only need the simplest case: a single actor. The full
  // selector evaluation lives in `selectActors` (runtime.ts) and is out of
  // scope for this narrow slice.
  const source = context.state.actors[context.actorId];
  if (!source) {
    throw new RuleProgramViolation('selector.actor-missing', `Actor ${context.actorId} does not exist.`);
  }
  return source;
}

/** Canonical p.92 footprint distance between two actor views. Returns
 * `Number.POSITIVE_INFINITY` if either lacks a position. */
function actorDistance(a: RuleActorView, b: RuleActorView): number {
  if (!a.position || !b.position) return Number.POSITIVE_INFINITY;
  return footprintDistance(
    { position: a.position, size: a.size },
    { position: b.position, size: b.size },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Evaluate an actor CandidateSet from the current encounter state.
 *
 * Returns every actor that satisfies the query's relation, defeated,
 * off-battlefield, and range constraints, in no guaranteed order. This is
 * the "what things currently qualify" answer — the same set that automatic
 * targeting and player choices both draw from. */
export function evaluateActorCandidates(
  query: ActorCandidateQuery,
  context: RuleExecutionContext,
): RuleActorView[] {
  const source = resolveRangeOrigin(query.rangeOrigin, context);
  const relation = query.relation ?? 'any';
  const includeDefeated = query.includeDefeated ?? false;
  const includeOffBattlefield = query.includeOffBattlefield ?? false;

  // Step 1: filter by base eligibility (relation + defeated + on-battlefield).
  // Note: `RuleActorView` has no `onBattlefield` field — presence of a
  // position IS the on-battlefield signal on the runtime view (actors keep
  // their last cell after leaving, so only the reducer knows the difference;
  // the VM view conservatively treats position-less actors as off-board).
  let candidates = Object.values(context.state.actors).filter((actor) => {
    if (!matchesTargetRelation(source, actor, relation)) return false;
    if (!includeDefeated && actor.defeated) return false;
    if (!includeOffBattlefield && actor.position === null) return false;
    return true;
  });

  // Step 2: filter by range, if a range is declared.
  if (query.range) {
    const maxRange = evaluateNumber(query.range, context);
    candidates = candidates.filter((actor) => actorDistance(source, actor) <= maxRange);
  }

  return candidates;
}

/** Validate a single actor id against a CandidateSet.
 *
 * Returns a structured result. When `legal` is false, the `violation.code`
 * matches the existing violation-code vocabulary, so the caller can throw a
 * `RuleProgramViolation` with an identical surface to the pre-existing
 * checks. */
export function validateActorCandidate(
  actorId: string,
  query: ActorCandidateQuery,
  context: RuleExecutionContext,
): CandidateResult<string> {
  // Does the actor exist?
  const actor = context.state.actors[actorId];
  if (!actor) {
    return {
      legal: false,
      violation: { code: 'choice.actor-missing', message: `target ${actorId} does not exist.` },
    };
  }

  const source = resolveRangeOrigin(query.rangeOrigin, context);

  // Defeated?
  if (!(query.includeDefeated ?? false) && actor.defeated) {
    return {
      legal: false,
      violation: { code: 'choice.actor-defeated', message: `target ${actorId} is defeated.` },
    };
  }

  // On-battlefield? (position-less = off-board on the runtime view)
  if (!(query.includeOffBattlefield ?? false) && actor.position === null) {
    return {
      legal: false,
      violation: { code: 'choice.actor-unavailable', message: `target ${actorId} is not on the battlefield.` },
    };
  }

  // Relation?
  const relation = query.relation ?? 'any';
  if (relation !== 'any' && !matchesTargetRelation(source, actor, relation)) {
    return {
      legal: false,
      violation: { code: 'choice.actor-relation', message: `target ${actorId} is not ${relation}.` },
    };
  }

  // Range?
  if (query.range) {
    const maxRange = evaluateNumber(query.range, context);
    const dist = actorDistance(source, actor);
    if (dist > maxRange) {
      return {
        legal: false,
        violation: { code: 'choice.actor-range', message: `target ${actorId} is outside range ${maxRange}.` },
      };
    }
  }

  return { legal: true, value: actorId };
}
