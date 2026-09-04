/**
 * evaluate-query.ts — the U3 QUERY evaluation kernel (actor, position,
 * entity, and terrain domains).
 *
 * ACTOR DOMAIN: the extended actor-query evaluator behind the
 * RuleSelector→views authority (`selectActors`, kernels/runtime.ts). Base
 * eligibility (relation / defeated / on-battlefield / range-from-anchor)
 * delegates to `kernels/candidate.ts` `evaluateActorCandidates` — ONE
 * eligibility machinery — and this module adds the domain operators the
 * selector vocabulary and the T2 query contract need: condition, mark,
 * summon/owned-by, adjacency, within-origin, inside-area, line of sight /
 * line of effect (from the query's anchor), occupying-position, and
 * terrain predicate. Set composition (union/intersection/difference) over
 * actor queries is `composeActorQueries`.
 *
 * ENTITY DOMAIN: `evaluateEntityQuery` is the generic entity/object/summon
 * candidate read (owner, type, range-from-anchor, at-position) that the
 * `entity-distance-selection` / `object-distance` blocker families and
 * `count(query)` draw from.
 *
 * TERRAIN DOMAIN: `evaluateTerrainCells` is the terrain-predicate cell read
 * (every in-grid cell within radius whose terrain union contains a type).
 *
 * POSITION DOMAIN: the position-candidate operators the placement/teleport
 * resolvers use (`evaluatePositions`, `validatePositionLegality`) and the
 * nearest-ordering operator (`nearestCandidates`), composed from the shared
 * `primitives/job-kit.ts` predicates (withinGrid / occupied / point
 * distance), so resolvers stop re-implementing the same free-cell scans and
 * teleport legality. Occupancy is an EXPLICIT query policy, never built into
 * the definition of a position candidate: `evaluatePositions` can represent
 * occupied OR unoccupied spaces (`space` policy), deterministic ordering is
 * applied only when the caller requests it (`ordering` policy), and line of
 * sight from a declared origin is an explicit policy too (p.108: \"you also
 * need line of sight\" for summoning/teleporting/creating objects).
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
import {
  footprintCells,
  footprintDistance,
  footprintIntersectsCells,
} from '../primitives/spatial-intent.js';
import {
  distance,
  finalSpaceOccupied,
  withinGrid,
} from '../primitives/battlefield.js';
import { axisDirection, sameCell, squareArea } from '../../area-geometry.js';
import { hasLineOfEffect, hasLineOfSightBetween } from '../primitives/line-of-sight.js';
import {
  defaultActorAnchor,
  type SpatialAnchor,
  type SpatialOrigin,
} from '../primitives/anchor.js';
import type {
  ActorQuery,
  ComposedActorQuery,
  EntityQuery,
  PositionLegalityProblem,
  PositionLegalityQuery,
  PositionCandidateProblem,
  PositionCandidateQuery,
  PositionQuery,
  TerrainQuery,
  ValueQuery,
} from '../primitives/query.js';
import { evaluateActorCandidates, resolveSpatialAnchor } from './candidate.js';
import { RuleProgramViolation } from './violations.js';
import { resolveActorSelectorReference } from '../primitives/reference.js';

function sourceActorReference(context: RuleExecutionContext): RuleActorView {
  const resolution = resolveActorSelectorReference({ kind: 'self' }, context);
  if (!resolution.ok || resolution.value.kind !== 'actor') {
    const problem = resolution.ok ? 'non-actor' : resolution.problem;
    throw new RuleProgramViolation('selector.actor-missing', `Source actor reference failed to resolve: ${problem}.`);
  }
  return resolution.value.actor;
}

// The query typed vocabulary lives in `primitives/query.ts` (U3 QUERY
// vocabulary, barrel re-exported); this kernel owns the evaluation. Kept
// re-exported here so the historical `evaluate-query.ts` import surface stays
// stable for the migration duration.
export type {
  ActorCandidateQuery,
  ActorQuery,
  ComposedActorQuery,
  EntityQuery,
  PositionLegalityProblem,
  PositionLegalityQuery,
  PositionCandidateProblem,
  PositionCandidateQuery,
  PositionOrderingPolicy,
  PositionQuery,
  PositionSpacePolicy,
  TerrainQuery,
  ValueQuery,
} from '../primitives/query.js';

/** The shared line-of-sight view over the VM state: the grid bounds plus the
 * live terrain union (`RuleRuntimeState.terrainAt`). The grid carries no
 * base `terrain` cells on the VM view, so `grid.terrain` is absent and only
 * the live union is consulted — exactly what the reducer's terrain union
 * produces for dynamic effects. */
function lineView(context: RuleExecutionContext) {
  return { grid: context.state.grid, terrainAt: context.state.terrainAt };
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

  // Line of sight / line of effect from the query's anchor (the same frame
  // as `range`, default the acting actor) — the p.92 sight gate composed as
  // a query operator, sharing the one line-of-sight kernel.
  if (query.lineOfSight === true || query.lineOfEffect === true) {
    const anchor = resolveSpatialAnchor(query.rangeOrigin ?? defaultActorAnchor(), context);
    const view = lineView(context);
    candidates = candidates.filter((candidate) => {
      if (candidate.position === null) return false;
      if (query.lineOfSight === true && !hasLineOfSightBetween(
        view,
        anchor,
        { position: candidate.position, size: candidate.size },
      )) return false;
      if (query.lineOfEffect === true && !hasLineOfEffect(view, anchor.position, candidate.position)) return false;
      return true;
    });
  }

  // Occupying-position: the candidate's footprint contains the space.
  if (query.occupying !== undefined) {
    const position = query.occupying.position;
    candidates = candidates.filter((candidate) =>
      candidate.position !== null
      && footprintIntersectsCells({ position: candidate.position, size: candidate.size }, [position]));
  }

  // Terrain predicate: the candidate stands on a cell whose terrain union
  // contains the type (p.104 Rampart-adjacent clauses, p.129 movement gates).
  if (query.onTerrain !== undefined) {
    const terrain = query.onTerrain;
    candidates = candidates.filter((candidate) =>
      candidate.position !== null && context.state.terrainAt(candidate.position).has(terrain));
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
    const ownerId = query.summon.owner === 'self'
      ? sourceActorReference(context).id
      : query.summon.owner === 'any'
        ? null
        : query.summon.owner.actorId;
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

/** Set composition over actor queries (U3 "union/intersection/difference").
 * Each query is evaluated independently through the one actor evaluator;
 * the results are combined BY IDENTITY (distinct-by-identity), so an actor
 * appearing under several member queries is never duplicated. The result
 * order follows the first query's result order — no ordering is invented
 * (source-defined first/last/nth ordering stays an explicit query policy
 * only where the source defines it). Pure: no state is mutated. */
export function composeActorQueries(
  composition: ComposedActorQuery,
  context: RuleExecutionContext,
): RuleActorView[] {
  const evaluated = composition.queries.map((query) => evaluateActorQuery(query, context));
  const byId = (actor: RuleActorView) => actor.id;
  switch (composition.operator) {
    case 'union': {
      const seen = new Set<string>();
      const out: RuleActorView[] = [];
      for (const set of evaluated) {
        for (const actor of set) {
          if (seen.has(actor.id)) continue;
          seen.add(actor.id);
          out.push(actor);
        }
      }
      return out;
    }
    case 'intersection': {
      if (evaluated.length === 0) return [];
      const [first, ...rest] = evaluated;
      const restSets = rest.map((set) => new Set(set.map(byId)));
      return first.filter((actor) => restSets.every((set) => set.has(actor.id)));
    }
    case 'difference': {
      if (evaluated.length === 0) return [];
      const [first, ...rest] = evaluated;
      const subtracted = new Set(rest.flatMap((set) => set.map(byId)));
      return first.filter((actor) => !subtracted.has(actor.id));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Position domain (U3 position slice)
// ─────────────────────────────────────────────────────────────────────────────

/** Evaluate a position CandidateSet: every in-grid cell within canonical
 * footprint `radius` of `origin` that passes the query's explicit SPACE POLICY (and
 * the optional p.108 line-of-sight policy), ordered only when the caller
 * requests an ORDERING policy. The bounds / obstruction predicates are the
 * shared primitives (`primitives/job-kit.ts` `withinGrid`/`occupied`); this
 * operator owns the CANDIDATE semantics so placement resolvers stop
 * re-implementing the same cell scans (the historical `freeCellsInRange`
 * helper). */
export function evaluatePositions(query: PositionQuery, context: RuleExecutionContext): Position[] {
  const cells: Position[] = [];
  const view = query.lineOfSightFrom ? lineView(context) : null;
  const originSize = Math.max(1, Math.floor(query.originSize ?? 1));
  const originCells = footprintCells(query.origin, originSize);
  const originCellKeys = new Set(originCells.map((cell) => `${cell.x},${cell.y}`));
  const seen = new Set<string>();
  const scanned = originCells
    .flatMap((originCell) => squareArea(originCell, query.radius))
    .filter((cell) => {
      const key = `${cell.x},${cell.y}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  for (const cell of scanned) {
    if (!validatePositionCandidate({ origin: query.origin, originSize, range: query.radius }, cell, context).legal) continue;
    if (!query.includeOrigin && originCellKeys.has(`${cell.x},${cell.y}`)) continue;
    if (query.space.kind === 'unoccupied' && finalSpaceOccupied(cell, context, query.space.excludeActorId ?? '')) continue;
    if (view && !hasLineOfSightBetween(view, query.lineOfSightFrom!, { position: cell, size: 1 })) continue;
    cells.push(cell);
  }
  if (query.ordering?.kind === 'distance-from-origin') {
    cells.sort((a, b) =>
      footprintDistance({ position: query.origin, size: originSize }, { position: a, size: 1 })
      - footprintDistance({ position: query.origin, size: originSize }, { position: b, size: 1 })
      || a.x - b.x || a.y - b.y);
  }
  return cells;
}

/** Shared U3 validation beneath automatic position queries and U4 choices. */
export function validatePositionCandidate(
  query: PositionCandidateQuery,
  position: Position,
  context: RuleExecutionContext,
): { legal: true; problem: null } | { legal: false; problem: PositionCandidateProblem } {
  if (!withinGrid(position, context)) return { legal: false, problem: 'out-of-bounds' };
  if (footprintDistance(
    { position: query.origin, size: Math.max(1, Math.floor(query.originSize ?? 1)) },
    { position, size: 1 },
  ) > query.range) return { legal: false, problem: 'range' };
  return { legal: true, problem: null };
}

/** The TELEPORT/placement legality specialist: in-grid, within the canonical
 * p.92 footprint `range` of the origin footprint, unoccupied (the teleport
 * reading of free space — no obstructing character/object; ICON p.104
 * "instantly move to unoccupied space within range X"), and — when
 * `lineOfSightFrom` is declared — with line of sight from that position
 * (ICON p.108: summoning/teleporting/creating objects also needs line of
 * sight). Structured so the teleport kernel maps each problem onto its
 * existing violation codes instead of re-implementing the same checks. This
 * is a DOMAIN rule, not the generic position query: the in-grid → range →
 * unoccupied → LoS order is placement's own contract. */
export function validatePositionLegality(
  query: PositionLegalityQuery,
  position: Position,
  context: RuleExecutionContext,
): { legal: boolean; problem: PositionLegalityProblem | null } {
  if (!withinGrid(position, context)) return { legal: false, problem: 'out-of-bounds' };
  const originFootprint = { position: query.origin, size: Math.max(1, Math.floor(query.originSize ?? 1)) };
  if (footprintDistance(originFootprint, { position, size: 1 }) > query.range) return { legal: false, problem: 'range' };
  if (finalSpaceOccupied(position, context, query.excludeActorId ?? '')) return { legal: false, problem: 'occupied' };
  if (query.lineOfSightFrom && !hasLineOfSightBetween(
    lineView(context),
    query.lineOfSightFrom,
    { position, size: 1 },
  )) {
    return { legal: false, problem: 'line-of-sight' };
  }
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
  const selfView = sourceActorReference(context);
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

// ─────────────────────────────────────────────────────────────────────────────
// Entity domain (U3)
// ─────────────────────────────────────────────────────────────────────────────

/** Evaluate an entity CandidateSet (objects + summons on the battlefield).
 * The only relation entities have is ownership, so the owner filter is the
 * domain's relation read (p.95: summons belong to their summoner; objects
 * may have a null owner). Range uses the canonical p.92 footprint metric
 * from the query's anchor; `atPosition` is the occupying-position read.
 * Deterministic, de-duplicated by identity. Pure — no state is mutated. */
export function evaluateEntityQuery(query: EntityQuery, context: RuleExecutionContext): Array<{ id: string; type: string; ownerId: string | null; positions: readonly Position[] }> {
  const anchor = query.rangeOrigin === undefined ? null : resolveSpatialAnchor(query.rangeOrigin, context);
  const maximumRange = query.range;
  const requiredPosition = query.atPosition;
  const candidates = Object.values(context.state.entities).filter((entity) => {
    if (query.owner !== undefined) {
      const ownerId = query.owner.kind === 'self'
        ? sourceActorReference(context).id
        : query.owner.kind === 'any'
          ? null
          : query.owner.actorId;
      if (ownerId === null ? entity.ownerId === null : entity.ownerId !== ownerId) return false;
    }
    if (query.entityType !== undefined && entity.type !== query.entityType) return false;
    if (maximumRange !== undefined && anchor !== null) {
      if (entity.positions.length === 0
        || entity.positions.every((position) => footprintDistance(anchor, { position, size: 1 }) > maximumRange)) return false;
    }
    if (requiredPosition !== undefined) {
      if (!entity.positions.some((position) => sameCell(position, requiredPosition))) return false;
    }
    return true;
  }).map((entity) => ({ id: entity.id, type: entity.type, ownerId: entity.ownerId, positions: entity.positions }));
  const seen = new Set<string>();
  return candidates.filter((entity) => {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Terrain domain (U3)
// ─────────────────────────────────────────────────────────────────────────────

/** Evaluate a terrain-cell CandidateSet: every in-grid cell within Chebyshev
 * `radius` of `origin` whose terrain union contains `terrain` (the terrain
 * predicate read). Deterministic only when an ORDERING policy is requested —
 * otherwise no order is guaranteed. Pure. */
export function evaluateTerrainCells(query: TerrainQuery, context: RuleExecutionContext): Position[] {
  const cells: Position[] = [];
  for (const cell of squareArea(query.origin, query.radius)) {
    if (!withinGrid(cell, context)) continue;
    if (!context.state.terrainAt(cell).has(query.terrain)) continue;
    cells.push(cell);
  }
  if (query.ordering?.kind === 'distance-from-origin') {
    cells.sort((a, b) => distance(query.origin, a) - distance(query.origin, b) || a.x - b.x || a.y - b.y);
  }
  return cells;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value-domain dispatch (U5 `count(query)`)
// ─────────────────────────────────────────────────────────────────────────────

/** Evaluate a domain-dispatched query spec to its candidate list. Used by
 * `RuleNumber.count-query` (U5) and the count comparisons composed on top of
 * it (U6). Each domain returns its candidate elements (actor views, entity
 * views, positions, terrain cells). Pure. */
export function evaluateValueQuery(query: ValueQuery, context: RuleExecutionContext): unknown[] {
  switch (query.domain) {
    case 'actors':
      return evaluateActorQuery(query.query, context);
    case 'entities':
      return evaluateEntityQuery(query.query, context);
    case 'positions':
      return evaluatePositions(query.query, context);
    case 'terrain-cells':
      return evaluateTerrainCells(query.query, context);
  }
}
