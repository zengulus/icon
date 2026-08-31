/**
 * candidate.ts — the QUERY / CANDIDATE underlay (U3).
 *
 * One deterministic eligibility authority beneath both automatic targeting
 * and player choices, for the actor domain: Query<T> → CandidateSet<T>. It
 * answers a single question: "What actors currently qualify?" The answer is
 * derived by composing the existing, source-tested authorities —
 * `matchesTargetRelation` for p.92 relations, `footprintDistance` for the
 * canonical p.92 footprint metric — and the U7 ANCHOR vocabulary
 * (`primitives/anchor.ts`) for the frame a range is measured from.
 *
 * RANGE ORIGIN (U7): a query's `rangeOrigin` is a `SpatialAnchor` — either a
 * LIVE actor footprint (named by a reference-style RuleSelector; default the
 * acting actor) or a CAPTURED position (a chosen/bound space). The anchor is
 * resolved here (`resolveSpatialAnchor`) and is INDEPENDENT of the relation
 * source: relation ("ally of the user") is always read from the acting
 * actor, while range is measured from the anchor. The inert precursor that
 * ignored its selector and always fell back to `context.actorId` is gone —
 * a query measured from an ally's position now actually measures from that
 * ally, and a malformed anchor fails closed.
 *
 * RANGE VALUES (U5): `range` is a RESOLVED SCALAR. The caller evaluates a
 * dynamic `RuleNumber` through the U5 VALUE authority (`evaluateNumber`) at
 * the query point, so this kernel never re-implements value evaluation and
 * never imports the VM barrel (`kernels/runtime.ts`).
 *
 * The kernel carries no source IDs. It never branches on an ability name,
 * a talent id, or a job class. It only knows relations, ranges, anchors, and
 * state.
 */

import type {
  RuleActorView,
  RuleExecutionContext,
  RuleSelector,
} from '../primitives/types.js';
import type { ActorCandidateQuery } from '../primitives/query.js';
import {
  matchesTargetRelation,
} from '../primitives/targeting.js';
import { relationPerspectiveIdFromContext } from '../primitives/roles.js';
import { footprintDistance } from '../primitives/spatial-intent.js';
import {
  anchorFromActorSelector,
  type SpatialAnchor,
  type SpatialOrigin,
} from '../primitives/anchor.js';
import { RuleProgramViolation } from './violations.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

// The `ActorCandidateQuery` typed vocabulary lives in `primitives/query.ts`
// (U3 QUERY vocabulary, barrel re-exported); this kernel owns the evaluation.
// Kept re-exported here so the historical `candidate.ts` import surface stays
// stable for the migration duration.
export type { ActorCandidateQuery } from '../primitives/query.js';

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
// Anchor resolution (U7)
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve a SpatialAnchor to a concrete origin (position + footprint size)
 * against the current context. Fail-closed: a malformed anchor (a selector
 * kind that cannot name one origin, a selector resolving to zero or several
 * actors, or an actor without a battlefield position) rejects with a
 * `RuleProgramViolation` — it never silently degrades to the acting actor. */
export function resolveSpatialAnchor(
  anchor: SpatialAnchor,
  context: RuleExecutionContext,
): SpatialOrigin {
  switch (anchor.kind) {
    case 'captured-position':
      return { position: { ...anchor.position }, size: Math.max(1, Math.floor(anchor.size ?? 1)) };
    case 'entity': {
      // A LIVE entity footprint anchor (p.92: the origin space may be any
      // occupied space — an entity/object/summon is a size-1 cell).
      const entity = context.state.entities[anchor.entityId];
      if (!entity) {
        throw new RuleProgramViolation('selector.entity-missing', `Anchor entity ${anchor.entityId} does not exist.`);
      }
      if (!entity.position) {
        throw new RuleProgramViolation('selector.origin-invalid', `Anchor entity ${anchor.entityId} has no battlefield position.`);
      }
      return { position: { ...entity.position }, size: 1 };
    }
    case 'actor': {
      const ids = anchorSelectorIds(anchor.selector, context);
      if (ids.length !== 1) {
        throw new RuleProgramViolation('selector.origin-invalid', `SpatialAnchor resolved to ${ids.length} actor(s); expected exactly one.`);
      }
      const view = context.state.actors[ids[0]];
      if (!view) {
        throw new RuleProgramViolation('selector.actor-missing', `Anchor actor ${ids[0]} does not exist.`);
      }
      if (!view.position) {
        throw new RuleProgramViolation('selector.origin-invalid', `Anchor actor ${ids[0]} has no battlefield position.`);
      }
      return { position: view.position, size: view.size };
    }
  }
}

/** The actor ids a reference-style selector names. Query selectors (`all`,
 * `within`, `adjacent`, `condition`, `marked`, `summons`) cannot name a
 * single spatial origin and are rejected — the anchor vocabulary is
 * REFERENCE-shaped, not QUERY-shaped (U1 vs U3). */
function anchorSelectorIds(
  selector: RuleSelector | undefined,
  context: RuleExecutionContext,
): string[] {
  if (!selector) return [context.actorId];
  switch (selector.kind) {
    case 'self': return [context.actorId];
    case 'attack-target': return context.attackTargetId ? [context.attackTargetId] : [];
    case 'trigger-source': return context.triggerSourceId ? [context.triggerSourceId] : [];
    case 'trigger-targets': return [...(context.triggerTargetIds ?? [])];
    case 'input': return [...(context.input.actorIds?.[selector.key] ?? [])];
    default:
      throw new RuleProgramViolation('selector.origin-invalid', `Selector kind "${selector.kind}" cannot name a single spatial origin.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The acting actor — the relation source ("ally of the user"). Distinct
 * from the range origin: relation never moves with the anchor.
 *
 * U2: the RELATION PERSPECTIVE is the actor whose SIDE establishes the
 * self/ally/foe relation (p.92 "another living ally" is relative to the
 * source). It is derived through the durable role frame
 * (`relationPerspectiveIdFromContext` → the source role), never inferred
 * from an incidental actor id — an underivable perspective fails closed.
 */
function actingActor(context: RuleExecutionContext): RuleActorView {
  const perspectiveId = relationPerspectiveIdFromContext(context);
  if (perspectiveId === null) {
    throw new RuleProgramViolation('selector.actor-missing', 'The relation perspective cannot be derived from the durable role frame.');
  }
  const source = context.state.actors[perspectiveId];
  if (!source) {
    throw new RuleProgramViolation('selector.actor-missing', `Actor ${perspectiveId} does not exist.`);
  }
  return source;
}

/** Canonical p.92 footprint distance between a resolved origin and an actor
 * view. Returns `Number.POSITIVE_INFINITY` if the actor lacks a position. */
function distanceFrom(origin: SpatialOrigin, actor: RuleActorView): number {
  if (actor.position === null) return Number.POSITIVE_INFINITY;
  return footprintDistance(
    { position: origin.position, size: origin.size },
    { position: actor.position, size: actor.size },
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
 * targeting and player choices both draw from. Relation is always read from
 * the acting actor; range is measured from the query's `rangeOrigin` anchor
 * (default the acting actor). */
export function evaluateActorCandidates(
  query: ActorCandidateQuery,
  context: RuleExecutionContext,
): RuleActorView[] {
  const acting = actingActor(context);
  const origin = resolveSpatialAnchor(query.rangeOrigin ?? anchorFromActorSelector(), context);
  const relation = query.relation ?? 'any';
  const includeDefeated = query.includeDefeated ?? false;
  const includeOffBattlefield = query.includeOffBattlefield ?? false;

  // Step 1: filter by base eligibility (relation + defeated + on-battlefield).
  // Note: `RuleActorView` has no `onBattlefield` field — presence of a
  // position IS the on-battlefield signal on the runtime view (actors keep
  // their last cell after leaving, so only the reducer knows the difference;
  // the VM view conservatively treats position-less actors as off-board).
  let candidates = Object.values(context.state.actors).filter((actor) => {
    if (!matchesTargetRelation(acting, actor, relation)) return false;
    if (!includeDefeated && actor.defeated) return false;
    if (!includeOffBattlefield && actor.position === null) return false;
    return true;
  });

  // Step 2: filter by range from the anchor, if a range is declared.
  if (query.range !== undefined) {
    const maxRange = query.range;
    candidates = candidates.filter((actor) => distanceFrom(origin, actor) <= maxRange);
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

  // The relation source (acting actor) and the range origin (anchor) resolve
  // before any eligibility check — a malformed anchor fails closed.
  const acting = actingActor(context);
  const origin = resolveSpatialAnchor(query.rangeOrigin ?? anchorFromActorSelector(), context);

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
  if (relation !== 'any' && !matchesTargetRelation(acting, actor, relation)) {
    return {
      legal: false,
      violation: { code: 'choice.actor-relation', message: `target ${actorId} is not ${relation}.` },
    };
  }

  // Range from the anchor?
  if (query.range !== undefined) {
    const dist = distanceFrom(origin, actor);
    if (dist > query.range) {
      return {
        legal: false,
        violation: { code: 'choice.actor-range', message: `target ${actorId} is outside range ${query.range}.` },
      };
    }
  }

  return { legal: true, value: actorId };
}
