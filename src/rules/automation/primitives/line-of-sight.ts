import type { Position } from '../../types.js';

/**
 * F1 — shared line-of-sight / line-of-effect kernel (ICON p.92, p.95, p.96,
 * p.109). Framework-independent: the reducer `EncounterState` and the rule
 * runtime `RuleRuntimeState` both satisfy `SpatialLineView`, so command gates
 * and the generic VM consume the same deterministic rules instead of two
 * samplers.
 *
 * Source contract:
 *
 * - Line of sight (p.92): "If there's any ambiguity about line of sight, draw
 *   a straight line from the any edge of your character's space to the edge of
 *   another character's space. If the line does not intersect with impassable
 *   terrain or an effect that explicitly blocks line of sight, then you have
 *   line of sight." By default objects, characters, and all terrain other than
 *   impassable do not block. The conservative center-to-edge super-sampling
 *   below is the reviewed reducer behavior, preserved byte-for-byte.
 *
 * - Line of effect (p.109): "your ability has to be able to trace a clear path
 *   to your target. For example, if you can see a character through a
 *   transparent magical forcefield or a window, that forcefield or window
 *   still blocks your line of effect, so they can't be targeted." LoE is a
 *   distinct gate: it is blocked only by effects that explicitly block it, so
 *   sight without effect remains possible. Nothing in the current catalog
 *   creates such an effect, so `hasLineOfEffect` defaults to true.
 *
 * - Burst X (p.95): "Affects a targeted space or character in range, and all
 *   spaces in range X and line of sight from that space." Cell inclusion is
 *   LoS-filtered from the burst center (`lineOfSightCells`).
 *
 * - AoEs (p.96): "Area of effect abilities always count cover and line of
 *   sight and count it from the origin point of the abilities." The origin-LoS
 *   inclusion callers need is the same `lineOfSightCells` helper against the
 *   ability owner.
 */

/** The minimal spatial view both the reducer and the rule runtime satisfy. */
export interface SpatialLineView {
  grid: { width: number; height: number; terrain?: readonly { position: Position; type: string }[] };
  /** Per-cell union of base terrain and overlay effects, matching the
   * movement planner's view. Absent → only `grid.terrain` is consulted. */
  terrainAt?: (position: Position) => ReadonlySet<string>;
  /** Overlay effect types that explicitly block line of sight (p.92 smog and
   * poison clouds). Closed by default: nothing in the current catalog creates
   * such an effect, so the kernel's LoS matches the reviewed reducer exactly
   * (grid impassable only). A future effect type can only block LoS by being
   * registered here — never by prose inference. */
  lineOfSightBlockingEffectTypes?: ReadonlySet<string>;
  /** Overlay effect types that block line of effect (p.109 transparent
   * forcefields and windows). Empty today; the seam exists so a future
   * object/effect source has a closed authority point. */
  lineOfEffectBlockingEffectTypes?: ReadonlySet<string>;
}

const sameCell = (first: Position, second: Position) => first.x === second.x && first.y === second.y;

function blocksLineOfSight(view: SpatialLineView, position: Position): boolean {
  const terrain = view.grid.terrain;
  if (terrain?.some((cell) => sameCell(cell.position, position) && cell.type === 'impassable')) return true;
  const blockers = view.lineOfSightBlockingEffectTypes;
  if (!blockers || blockers.size === 0) return false;
  const types = view.terrainAt?.(position);
  if (!types) return false;
  for (const type of types) if (blockers.has(type)) return true;
  return false;
}

function blocksLineOfEffect(view: SpatialLineView, position: Position): boolean {
  const blockers = view.lineOfEffectBlockingEffectTypes;
  if (!blockers || blockers.size === 0) return false;
  const types = view.terrainAt?.(position);
  if (!types) return false;
  for (const type of types) if (blockers.has(type)) return true;
  return false;
}

/** Super-sample the straight segment between two space centers and return
 * true when no sampled intermediate cell blocks the line. `steps <= 1`
 * (adjacent or same space) is always clear. */
function traceClear(view: SpatialLineView, from: Position, to: Position, blocker: (view: SpatialLineView, position: Position) => boolean): boolean {
  if (sameCell(from, to)) return true;
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * 4;
  if (steps <= 1) return true;
  for (let step = 1; step < steps; step += 1) {
    const ratio = step / steps;
    const position = {
      x: Math.floor(from.x + 0.5 + (to.x - from.x) * ratio),
      y: Math.floor(from.y + 0.5 + (to.y - from.y) * ratio),
    };
    if (sameCell(position, from) || sameCell(position, to)) continue;
    if (blocker(view, position)) return false;
  }
  return true;
}

/** ICON p.92 line of sight: the straight segment between the two spaces does
 * not intersect impassable terrain or an explicitly LoS-blocking effect. */
export function hasLineOfSight(view: SpatialLineView, from: Position, to: Position): boolean {
  return traceClear(view, from, to, blocksLineOfSight);
}

/** ICON p.109 line of effect: the ability can trace a clear path to the
 * target. A distinct gate from line of sight — blocked only by effects that
 * explicitly block LoE (forcefields, windows). Defaults to clear. */
export function hasLineOfEffect(view: SpatialLineView, from: Position, to: Position): boolean {
  return traceClear(view, from, to, blocksLineOfEffect);
}

/** Every cell within Chebyshev `radius` of `from` that has line of sight back
 * to `from` (p.95 Burst X "in range X and line of sight from that space";
 * p.96 AoE origin LoS). Unclipped — the caller decides grid bounds, matching
 * the `squareArea` convention. */
export function lineOfSightCells(view: SpatialLineView, from: Position, radius: number): Position[] {
  const cells: Position[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const cell = { x: from.x + dx, y: from.y + dy };
      if (hasLineOfSight(view, from, cell)) cells.push(cell);
    }
  }
  return cells;
}
