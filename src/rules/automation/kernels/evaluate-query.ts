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
 * resolvers use (`evaluatePositionCandidates`, `validatePositionLegality`)
 * and the source-defined nearest-ordering operator (`nearestCandidate`),
 * composed from the shared `primitives/job-kit.ts` predicates (withinGrid /
 * occupied / point distance), so resolvers stop re-implementing the same
 * free-cell scans and teleport legality.
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
import { distance, occupied, sameCell, squareArea, withinGrid } from '../primitives/job-kit.js';
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

/** A position-domain candidate query: every in-grid, unoccupied cell within
 * Chebyshev `radius` of `origin`, deterministically ordered (origin-distance,
 * then x, then y — the ordering the placement resolvers have always used).
 * The bounds/occupancy predicates are the shared primitives
 * (`primitives/job-kit.ts` `withinGrid`/`occupied`); this operator owns the
 * CANDIDATE semantics so placement resolvers stop re-implementing the same
 * free-cell scan (the historical `freeCellsInRange` helper). */
export interface PositionCandidateQuery {
  /** The center the radius is measured from. */
  origin: Position;
  /** Chebyshev radius. */
  radius: number;
  /** Whether the origin cell itself is a candidate. Default false — the
   * placement helpers exclude the center (a free cell adjacent to it). */
  includeOrigin?: boolean;
  /** An actor whose own footprint does not obstruct a candidate (the mover).
   * Default none. */
  excludeActorId?: string;
}

export function evaluatePositionCandidates(query: PositionCandidateQuery, context: RuleExecutionContext): Position[] {
  const cells: Position[] = [];
  for (const cell of squareArea(query.origin, query.radius)) {
    if (!withinGrid(cell, context)) continue;
    if (!query.includeOrigin && sameCell(cell, query.origin)) continue;
    if (occupied(cell, context, query.excludeActorId ?? '')) continue;
    cells.push(cell);
  }
  return cells.sort((a, b) => distance(query.origin, a) - distance(query.origin, b) || a.x - b.x || a.y - b.y);
}

/** Position-domain legality predicates: in-grid, within point-cell `range` of
 * `origin`, and unoccupied by another actor's footprint or an entity.
 * Structured so the teleport kernel maps each problem onto its existing
 * violation codes instead of re-implementing the same checks. */
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

/** The nearest actor to `position` from an already-evaluated CandidateSet,
 * under the source-defined deterministic ordering (point-cell distance, ties
 * by id). The query owns ELIGIBILITY — this only orders its answer, and
 * never invents an order the source did not define. */
export function nearestCandidate(candidates: readonly RuleActorView[], position: Position): RuleActorView | undefined {
  return [...candidates]
    .filter((actor) => actor.position !== null)
    .sort((a, b) => distance(a.position!, position) - distance(b.position!, position) || a.id.localeCompare(b.id))[0];
}
