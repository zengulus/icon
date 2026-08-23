import type { EncounterState, Position } from '../../types.js';
import { lineCells, sameCell, squareArea } from '../../area-geometry.js';
import { hasLineOfSight, type SpatialLineView } from './line-of-sight.js';

// ── Footprint (Size) ─────────────────────────────────────────────────────────

/** ICON p.92: "Size: How many spaces square you take up on the battlefield".
 * A Size-N actor occupies an N×N square whose top-left corner is its position
 * cell (ICON has no facing/orientation concept; the grid is square and the
 * anchor is deterministic). Size 1 is the single position cell. */
export function footprintCells(position: Position, size: number): Position[] {
  const cells: Position[] = [];
  // Row-major (top row first, left to right) — the grid's natural reading
  // order, deterministic across platforms.
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      cells.push({ x: position.x + dx, y: position.y + dy });
    }
  }
  return cells;
}

/** ICON p.92: "To be in range, a target must have at least 1 space of its
 * area within the listed range" — and range is measured "from the edge of the
 * origin space (or character)". This is the L∞ (Chebyshev) distance between
 * two axis-aligned footprints: 0 when they touch or overlap, otherwise the
 * minimum space gap. For two Size-1 actors it is exactly the point-cell
 * Chebyshev distance the reducer historically used. */
export function footprintDistance(
  first: { position: Position; size?: number },
  second: { position: Position; size?: number },
): number {
  const firstSize = Math.max(1, first.size ?? 1);
  const secondSize = Math.max(1, second.size ?? 1);
  const firstMaxX = first.position.x + firstSize - 1;
  const firstMaxY = first.position.y + firstSize - 1;
  const secondMaxX = second.position.x + secondSize - 1;
  const secondMaxY = second.position.y + secondSize - 1;
  const dx = Math.max(0, first.position.x - secondMaxX, second.position.x - firstMaxX);
  const dy = Math.max(0, first.position.y - secondMaxY, second.position.y - firstMaxY);
  return Math.max(dx, dy);
}

/** ICON p.290 large foes: "count as being `inside' any [area]" when one of
 * their spaces is hit. True when any footprint cell of the actor lies in the
 * area's cells. Size 1 degenerates to the plain position-cell check. */
export function footprintIntersectsCells(
  actor: { position: Position; size?: number },
  cells: readonly Position[],
): boolean {
  const size = Math.max(1, actor.size ?? 1);
  const footprint = size === 1 ? [actor.position] : footprintCells(actor.position, size);
  return footprint.some((cell) => cells.some((areaCell) => sameCell(areaCell, cell)));
}

/**
 * F1 — the shared spatial gateway (ICON pp.87–92, 94, 107).
 *
 * One `SpatialIntent` is a validated destination request: who moves, who
 * caused it, from where to where, and which spatial authority applies. Every
 * destination-writing VM path (place, teleport, and explicit fly/rush/swap
 * positions) builds an intent and routes it through `validateSpatialIntent` /
 * `applySpatialIntent` here, so bounds, occupancy, impassable terrain, and
 * Rampart (p.104) are decided once instead of being re-implemented per
 * resolver. The durable record of an applied intent is the `RuleMutation`
 * (kind `move`) the event log serializes; this module is the shared pure
 * kernel both command construction and replay consume.
 *
 * Condition-derived authority stays with the encounter adapter: `immobile`
 * denial, and the fortify/rampart/slip/unstoppable projection that decides
 * whether a destination is rampart-obstructed for the mover. The kernel folds
 * that decision in as `rampartObstructed` so all destination problems share
 * one validation result.
 */

export type SpatialKind = 'place' | 'teleport' | 'move';

export type SpatialProblem = 'unavailable' | 'out-of-bounds' | 'occupied' | 'impassable-terrain' | 'rampart' | 'range';

export interface SpatialIntent {
  kind: SpatialKind;
  actorId: string;
  sourceActorId: string;
  sourceRuleId: string;
  /** The cell the actor moves from; null when off the battlefield (placement
   * can return an actor, e.g. Heroic Intervention p.122). */
  from: Position | null;
  to: Position;
  /** Actors that move within the same mutation batch — their current cells are
   * not obstructions (paired swaps, multi-target repositioning). */
  coMovedActorIds?: readonly string[];
  /** Rampart (p.104) blocks dashing, flying, and teleporting. The caller
   * computes this from the fortify/rampart/slip/unstoppable projection: a
   * teleport is denied when entering or leaving rampart differs; a fly/rush
   * destination is denied when rampart-obstructed for the mover. */
  rampartObstructed: boolean;
}

export interface SpatialValidation {
  legal: boolean;
  problem: SpatialProblem | null;
}

/** Validate one destination request — the single authority for bounds,
 * occupancy, impassable terrain, and rampart. Pure: no state is mutated. */
export function validateSpatialIntent(state: EncounterState, intent: SpatialIntent): SpatialValidation {
  const actor = state.actors[intent.actorId];
  if (!actor || actor.defeated) return { legal: false, problem: 'unavailable' };
  const { width, height, terrain } = state.grid;
  const { to } = intent;
  if (to.x < 0 || to.y < 0 || to.x >= width || to.y >= height) return { legal: false, problem: 'out-of-bounds' };
  if (terrain.some((cell) => sameCell(cell.position, to) && cell.type === 'impassable')) return { legal: false, problem: 'impassable-terrain' };
  const occupied = Object.values(state.actors).some((candidate) =>
    candidate.id !== intent.actorId
    && candidate.onBattlefield && !candidate.defeated && candidate.position !== null
    && sameCell(candidate.position, to)
    && !(intent.coMovedActorIds?.includes(candidate.id)));
  if (occupied) return { legal: false, problem: 'occupied' };
  if (intent.rampartObstructed) return { legal: false, problem: 'rampart' };
  return { legal: true, problem: null };
}

/** Validate and apply one destination request. The actor is only moved when
 * the intent is legal; returns whether it actually changed position. */
export function applySpatialIntent(state: EncounterState, intent: SpatialIntent): SpatialValidation & { moved: boolean } {
  const actor = state.actors[intent.actorId];
  if (!actor || actor.defeated) return { legal: false, problem: 'unavailable', moved: false };
  const validation = validateSpatialIntent(state, intent);
  if (!validation.legal) return { ...validation, moved: false };
  const before = actor.position;
  actor.position = { ...intent.to };
  actor.onBattlefield = true;
  return { ...validation, moved: before === null || !sameCell(before, actor.position) };
}

// ── Areas (burst/line) ───────────────────────────────────────────────────────

export type AreaShape = 'burst' | 'line';

/** One validated area request: shape, center, reach, and center legality.
 * The area cells come from the shared deterministic geometry (p.95 AoE
 * patterns); the gateway decides whether the center itself is legal, so
 * every area-using resolver stops re-implementing center/range/occupancy
 * checks inline. */
export interface SpatialAreaIntent {
  kind: 'area';
  sourceActorId: string;
  sourceRuleId: string;
  shape: AreaShape;
  /** Burst center or line origin. */
  center: Position;
  radius: number;
  /** Required for line areas (dominant-axis direction). */
  direction?: Position;
  /** The center must be within this Chebyshev range of the source. */
  maximumRangeFromSource?: number;
  /** The center cell must be inside the grid (character-centered areas are
   * always; a chosen free space may be rejected when out of bounds). */
  requireCenterInBounds: boolean;
  /** The center cell must be unoccupied and passable — for areas centered on
   * a chosen space rather than a character. */
  requireFreeCenter?: boolean;
  /** ICON p.95 Burst X: "all spaces in range X and line of sight from that
   * space" — filter the derived cells to those with line of sight from the
   * burst center. Applies to the burst shape only; Blast templates have no
   * from-center LoS clause (the origin-side LoS on p.96 is a caller
   * concern). */
  cellsRequireLineOfSightFromCenter?: boolean;
  /** LoS-blocking overlay effect types for the burst center filter (p.92
   * smog/poison clouds). Passed through to the shared line-of-sight kernel. */
  lineOfSightBlockingEffectTypes?: ReadonlySet<string>;
}

export interface SpatialAreaResult {
  legal: boolean;
  problem: SpatialProblem | null;
  /** Deterministic area cells (p.95), unclipped — the same set the manual
   * squareArea/lineCells calls produced, so routing never changes behavior. */
  cells: Position[];
  /** On-battlefield, living actors whose cell is in the area (inclusion). */
  includedActorIds: string[];
}

/** The minimal spatial view both the reducer (`EncounterState`) and the rule
 * runtime (`RuleRuntimeState`) satisfy, so one kernel serves both. Terrain
 * arrives as `grid.terrain` (reducer) or `terrainAt` (resolver view). */
export interface SpatialAreaStateView {
  grid: { width: number; height: number; terrain?: readonly { position: Position; type: string }[] };
  actors: Readonly<Record<string, { id: string; position: Position | null; onBattlefield?: boolean; defeated: boolean; size?: number }>>;
  terrainAt?: (position: Position) => ReadonlySet<string>;
}

/** Compute one area: validate the center, derive the cells, and resolve
 * inclusion. Pure — no state is mutated. */
export function computeSpatialArea(state: SpatialAreaStateView, intent: SpatialAreaIntent): SpatialAreaResult {
  const source = state.actors[intent.sourceActorId];
  if (!source || source.defeated) return { legal: false, problem: 'unavailable', cells: [], includedActorIds: [] };
  const { width, height } = state.grid;
  const { center } = intent;
  if (intent.requireCenterInBounds && (center.x < 0 || center.y < 0 || center.x >= width || center.y >= height)) {
    return { legal: false, problem: 'out-of-bounds', cells: [], includedActorIds: [] };
  }
  if (intent.maximumRangeFromSource !== undefined && source.position) {
    // F1: p.92 range is measured "from the edge of the origin space (or
    // character)" — footprint-aware even for an area center, which is a
    // one-cell target.
    const distance = footprintDistance({ position: source.position, size: source.size }, { position: center });
    if (distance > intent.maximumRangeFromSource) return { legal: false, problem: 'range', cells: [], includedActorIds: [] };
  }
  if (intent.requireFreeCenter) {
    const gridTerrain = state.grid.terrain;
    const impassable = gridTerrain
      ? gridTerrain.some((cell) => sameCell(cell.position, center) && cell.type === 'impassable')
      : (state.terrainAt?.(center).has('impassable') ?? false);
    if (impassable) return { legal: false, problem: 'impassable-terrain', cells: [], includedActorIds: [] };
    const occupied = Object.values(state.actors).some((candidate) => candidate.onBattlefield && !candidate.defeated && candidate.position !== null && sameCell(candidate.position, center));
    if (occupied) return { legal: false, problem: 'occupied', cells: [], includedActorIds: [] };
  }
  const cells = intent.shape === 'line'
    ? lineCells(center, intent.direction ?? { x: 1, y: 0 }, intent.radius)
    : squareArea(center, intent.radius);
  // ICON p.95 Burst X includes only spaces with line of sight from the burst
  // center. The filter uses the shared line-of-sight kernel so the VM and the
  // reducer agree on exactly what an impassable blocker hides.
  const areaCells = intent.shape === 'burst' && intent.cellsRequireLineOfSightFromCenter
    ? cells.filter((cell) => hasLineOfSight({ grid: state.grid, terrainAt: state.terrainAt, lineOfSightBlockingEffectTypes: intent.lineOfSightBlockingEffectTypes }, center, cell))
    : cells;
  // `onBattlefield` is absent on the resolver view; absent means on-field.
  // ICON p.290: a large foe counts as inside the area when any of its
  // footprint spaces is hit, not only its position cell.
  const includedActorIds: string[] = [];
  for (const candidate of Object.values(state.actors)) {
    if (candidate.onBattlefield === false || candidate.defeated || candidate.position === null) continue;
    if (footprintIntersectsCells({ position: candidate.position, size: candidate.size }, areaCells)) includedActorIds.push(candidate.id);
  }
  return { legal: true, problem: null, cells: areaCells, includedActorIds };
}
