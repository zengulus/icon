/**
 * evaluate-query.ts — the U3 QUERY evaluation kernel (actor + position
 * domains).
 *
 * ACTOR DOMAIN: the extended actor-query evaluator behind the
 * RuleSelector→views authority (`selectActors`, kernels/runtime.ts). Base
 * eligibility (relation / defeated / on-battlefield / range-from-anchor)
 * delegates to `kernels/candidate.ts` `evaluateActorCandidates` — ONE
 * eligibility machinery — and this module adds the domain operators the
 * selector vocabulary needs: condition, mark, summon, adjacency,
 * within-origin, and inside-area.
 *
 * POSITION DOMAIN: the position-candidate operators the placement/teleport
 * resolvers use (`evaluatePositions`, `validatePositionLegality`) and the
 * nearest-ordering operator (`nearestCandidates`), composed from the shared
 * `primitives/job-kit.ts` predicates (withinGrid / occupied / point
 * distance), so resolvers stop re-implementing the same free-cell scans and
 * teleport legality. Occupancy is an EXPLICIT query policy, never built into
 * the definition of a position candidate: `evaluatePositions` can represent
 * occupied OR unoccupied spaces (`space` policy), and deterministic ordering
 * is applied only when the caller requests it (`ordering` policy).
 * `rushTowardFoes` (the directional-movement default the movement resolvers
 * use) lives here too — it is a nearest-foe read and must answer through the
 * same min-distance selection; it fails closed when several foes are
 * equidistant rather than inventing a tie-break.
 *
 * `origins` are PRE-RESOLVED actor views: the caller (the selector
 * authority) resolves origin selectors recursively, because an origin may
 * itself be a selector result.
 *
 * No source IDs: `sourceId` is only read for the `marked` selector's default
 * mark key (the source unit that owns the query), exactly as the selector
 * authority has always read it.
 */
import type { RuleActorView, RuleExecutionContext } from '../primitives/types.js';
import type { Position } from '../../types.js';
import { footprintDistance, footprintIntersectsCells } from '../primitives/spatial-intent.js';
import { axisDirection, distance, occupied, sameCell, squareArea, withinGrid } from '../primitives/job-kit.js';
import { evaluateActorCandidates, type ActorCandidateQuery } from './candidate.js';
import { RuleProgramViolation } from './violations.js';

/** An actor query with the selector vocabulary's domain operators on top of
 * the base CandidateSet eligibility. */
export interface ActorQuery extends ActorCandidateQuery {
  /** Present → only actors carrying this condition (selector `condition`). */
  conditionId?: string;
  /** Present → only actors carrying this mark; absent `markId` = the source
   * unit id (selector `marked`). */
  mark?: { markId?: string };
  /** Present → only summon/companion actors of the owner/type (selector
   * `summons`). */
  summon?: { owner: 'self' | 'any'; summonType?: string };
  /** Pre-resolved origin actor views for the adjacency/within filters. */
  origins?: readonly RuleActorView[];
  /** When `origins` is present: maximum footprint distance from ANY origin
   * (1 = adjacency). A resolved scalar, like `range`. */
  originDistance?: number;
  /** Present → only actors whose footprint intersects these area cells
   * (p.95 area inclusion; p.290 a large actor counts when any footprint
   * space is hit). The cells come from the spatial gateway
   * (`computeSpatialArea`); the query owns which ACTORS qualify, so the
   * base eligibility (defeated/off-battlefield/relation) applies here too. */
  insideArea?: { cells: readonly Position[] };
}

/** Evaluate an actor CandidateSet for a selector-shaped query. Pure — no
 * state is mutated, no RNG is consumed. */
export function evaluateActorQuery(query: ActorQuery, context: RuleExecutionContext): RuleActorView[] {
  // Base eligibility: relation / defeated / on-battlefield / range from the
  // anchor. When origins are present the range filter is the origins filter
  // — the base anchor range would measure from the wrong frame.
  const base = evaluateActorCandidates({
    relation: query.relation,
    range: query.origins !== undefined ? undefined : query.range,
    rangeOrigin: query.rangeOrigin,
    includeDefeated: query.includeDefeated,
    includeOffBattlefield: query.includeOffBattlefield,
  }, context);

  let candidates = base;

  // Adjacency / within-origin: within `originDistance` of ANY origin.
  if (query.origins !== undefined && query.originDistance !== undefined) {
    const maxDistance = query.originDistance;
    candidates = candidates.filter((candidate) =>
      query.origins!.some((origin) => originDistance(origin, candidate) <= maxDistance));
  }

  // Area inclusion: footprint intersection with the gateway's cells.
  if (query.insideArea !== undefined) {
    const cells = query.insideArea.cells;
    candidates = candidates.filter((candidate) =>
      candidate.position !== null
      && footprintIntersectsCells({ position: candidate.position, size: candidate.size }, cells));
  }

  // Condition membership.
  if (query.conditionId !== undefined) {
    const conditionId = query.conditionId;
    candidates = candidates.filter((candidate) => candidate.conditions.has(conditionId));
  }

  // Mark presence on the target (default mark key = the source unit id).
  if (query.mark !== undefined) {
    const markId = query.mark.markId ?? context.sourceId;
    candidates = candidates.filter((candidate) => Boolean(candidate.state[`mark:${markId}`]));
  }

  // Summon/companion membership: entities owned by the queried owner (and
  // type) resolve to their actor ids. A dangling entity→actor reference is a
  // malformed state and fails closed, exactly as the selector authority has
  // always behaved.
  if (query.summon !== undefined) {
    const ownerId = query.summon.owner === 'self' ? context.actorId : null;
    const ids = Object.values(context.state.entities)
      .filter((entity) => entity.ownerId
        && (ownerId === null || entity.ownerId === ownerId)
        && (!query.summon!.summonType || entity.type === query.summon!.summonType))
      .map(({ state }) => (typeof state.actorId === 'string' ? state.actorId : ''))
      .filter(Boolean);
    for (const id of ids) {
      if (!context.state.actors[id]) {
        throw new RuleProgramViolation('selector.actor-missing', `Rule target ${id} does not exist.`);
      }
    }
    const summonIds = new Set(ids);
    candidates = candidates.filter((candidate) => summonIds.has(candidate.id));
  }

  return candidates;
}

/** Canonical p.92 footprint distance between two actor views. Returns
 * `Number.POSITIVE_INFINITY` if either lacks a position. */
function originDistance(origin: RuleActorView, target: RuleActorView): number {
  if (!origin.position || !target.position) return Number.POSITIVE_INFINITY;
  return footprintDistance(
    { position: origin.position, size: origin.size },
    { position: target.position, size: target.size },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Position domain (U3 position slice)
// ─────────────────────────────────────────────────────────────────────────────

/** The SPACE POLICY for a position query — what makes a cell a candidate.
 * `unoccupied` is the FREE/PLACEMENT reading: no OBSTRUCTING character or
 * object footprint (ICON p.95: summons are intangible and do not cause
 * obstruction, so a cell holding only an intangible summon is free). `any`
 * represents every in-grid space regardless of contents — ICON p.92 "Space:
 * Any space in range, and any characters or objects occupying it" means
 * generic position querying must be able to represent occupied spaces too.
 * A cell being "unavailable for a particular placement" (object stacking,
 * teleport unoccupied, bomb-can't-share-with-bombs) is a SPECIALIST rule
 * layered on top by the domain authority, never this policy. */
export type PositionSpacePolicy =
  | { kind: 'any' }
  | { kind: 'unoccupied'; excludeActorId?: string };

/** Optional deterministic ordering. The default (`none`) returns candidates
 * in no guaranteed order; a caller that needs a source-defined or
 * caller-requested order (the placement resolvers' "first available by
 * distance" scan) requests it explicitly. */
export type PositionOrderingPolicy = { kind: 'none' } | { kind: 'distance-from-origin' };

/** A position-domain candidate query. */
export interface PositionQuery {
  /** The center the radius is measured from. */
  origin: Position;
  /** Chebyshev radius. */
  radius: number;
  /** Whether the origin cell itself is a candidate. Default false — the
   * placement helpers exclude the center (a free cell adjacent to it). */
  includeOrigin?: boolean;
  /** The space policy (see `PositionSpacePolicy`). */
  space: PositionSpacePolicy;
  /** Optional deterministic ordering policy. Default `none`. */
  ordering?: PositionOrderingPolicy;
}

/** Evaluate a position CandidateSet: every in-grid cell within Chebyshev
 * `radius` of `origin` that passes the query's explicit SPACE POLICY,
 * ordered only when the caller requests an ORDERING policy. The bounds /
 * obstruction predicates are the shared primitives
 * (`primitives/job-kit.ts` `withinGrid`/`occupied`); this operator owns the
 * CANDIDATE semantics so placement resolvers stop re-implementing the same
 * cell scans (the historical `freeCellsInRange` helper). */
export function evaluatePositions(query: PositionQuery, context: RuleExecutionContext): Position[] {
  const cells: Position[] = [];
  for (const cell of squareArea(query.origin, query.radius)) {
    if (!withinGrid(cell, context)) continue;
    if (!query.includeOrigin && sameCell(cell, query.origin)) continue;
    if (query.space.kind === 'unoccupied' && occupied(cell, context, query.space.excludeActorId ?? '')) continue;
    cells.push(cell);
  }
  if (query.ordering?.kind === 'distance-from-origin') {
    cells.sort((a, b) => distance(query.origin, a) - distance(query.origin, b) || a.x - b.x || a.y - b.y);
  }
  return cells;
}

/** The TELEPORT/placement legality specialist: in-grid, within point-cell
 * `range` of `origin`, and unoccupied (the teleport reading of free space —
 * no obstructing character/object; ICON p.104 "instantly move to unoccupied
 * space within range X"). Structured so the teleport kernel maps each
 * problem onto its existing violation codes instead of re-implementing the
 * same checks. This is a DOMAIN rule, not the generic position query: the
 * in-grid → range → unoccupied order is teleport's own contract. */
export interface PositionLegalityQuery {
  origin: Position;
  range: number;
  /** The mover whose own footprint is not an obstruction. */
  excludeActorId?: string;
}

export type PositionLegalityProblem = 'out-of-bounds' | 'range' | 'occupied';

export function validatePositionLegality(
  query: PositionLegalityQuery,
  position: Position,
  context: RuleExecutionContext,
): { legal: boolean; problem: PositionLegalityProblem | null } {
  if (!withinGrid(position, context)) return { legal: false, problem: 'out-of-bounds' };
  if (distance(query.origin, position) > query.range) return { legal: false, problem: 'range' };
  if (occupied(position, context, query.excludeActorId ?? '')) return { legal: false, problem: 'occupied' };
  return { legal: true, problem: null };
}

/** The complete minimum-distance CandidateSet: every actor in `candidates`
 * (already evaluated — the query owns eligibility) at the minimum point-cell
 * distance from `position`, in the input's own order. NO tie-break is
 * invented here: when the source grants a choice among equidistant
 * candidates (ICON p.143 Dark Knight: "If multiple foes are equidistant,
 * you may choose"), the caller routes that choice through U4 CHOOSE; when
 * the source defines no ordering at all, the caller must not assume one. */
export function nearestCandidates<T extends { position: Position | null }>(candidates: readonly T[], position: Position): T[] {
  const positioned = candidates.filter((actor) => actor.position !== null);
  if (positioned.length === 0) return [];
  const minimum = Math.min(...positioned.map((actor) => distance(actor.position!, position)));
  return positioned.filter((actor) => distance(actor.position!, position) === minimum);
}

/** Dominant-axis direction toward the nearest foe (context.actorId), else +x.
 * The closest-foe set is the shared min-distance selection
 * (`nearestCandidates`) — no invented actor-id or array-order tie-break.
 * When several foes are EQUIDISTANT the direction is genuinely ambiguous (a
 * player/GM choice the engine cannot make here, U4), so the helper fails
 * closed instead of picking one; the +x default applies only to the
 * degenerate no-foe case. */
export function rushTowardFoes(context: RuleExecutionContext, position: Position): Position {
  const selfView = context.state.actors[context.actorId];
  const foes = Object.values(context.state.actors)
    .filter((candidate) => selfView && candidate.side !== selfView.side && candidate.position);
  const nearest = nearestCandidates(foes, position);
  if (nearest.length === 0) return { x: 1, y: 0 };
  if (nearest.length === 1) return axisDirection(position, nearest[0].position!);
  throw new RuleProgramViolation(
    'choice.direction-ambiguous',
    'Several foes are equidistant; the movement direction requires a choice.',
  );
}
