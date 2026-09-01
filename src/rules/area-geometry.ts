import type { Position } from './types.js';

/**
 * Deterministic ICON area geometry (source p.95: "AoE patterns").
 *
 * - Line X: X orthogonal spaces, each strictly further from the origin.
 * - Blast/Burst X: all spaces within range X (square/Chebyshev distance) of
 *   the central space, in line of sight.
 *
 * These helpers are used by resolver programs for area effects and are also
 * exercised directly by golden fixtures so the VTT and the rules package share
 * one geometry instead of two.
 */

/** Dominant-axis direction from `from` toward `to`, matching shove defaults. */
export function axisDirection(from: Position, to: Position): Position {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
}

/** The X spaces of an orthogonal line drawn outward from `from` in `direction`. */
export function lineCells(from: Position, direction: Position, length: number): Position[] {
  const cells: Position[] = [];
  for (let step = 1; step <= length; step += 1) {
    cells.push({ x: from.x + direction.x * step, y: from.y + direction.y * step });
  }
  return cells;
}

/** Validate a player-chosen Line `X` path (ICON p.97): it must be exactly
 * `length` spaces, orthogonally contiguous (no diagonal step), drawn with each
 * successive space STRICTLY further away from the line's origin point than the
 * previous one (so no L-shaped turns or backtracking), and contain no
 * duplicate/self-overlapping spaces. When the ability has a range, the origin
 * point is the FIRST space of the line (the chosen path's first cell). Returns
 * the cells on success, or null when the chosen path is not a legal Line — a
 * chosen path is never approximated or auto-shaped. This is the single Line
 * geometry authority; resolvers must not implement a second Line validator. */
export function validateLine(path: readonly Position[], length: number): Position[] | null {
  if (length === 0 || path.length !== length) return null;
  if (length === 1) return [{ ...path[0] }];
  const seen = new Set<string>([cellKey(path[0])]);
  // The line origin point is its FIRST space (ICON p.97: the first space of
  // the line when the ability has a range). Each later space must be one
  // orthogonal step and strictly further (Chebyshev) from that origin.
  for (let i = 1; i < path.length; i += 1) {
    const key = cellKey(path[i]);
    if (seen.has(key)) return null; // duplicate / self-overlap
    const step = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
    if (step !== 1) return null; // must be orthogonally contiguous (no diagonal)
    const originDist = (cell: Position) => Math.max(Math.abs(cell.x - path[0].x), Math.abs(cell.y - path[0].y));
    if (originDist(path[i]) <= originDist(path[i - 1])) return null; // must be strictly further from origin
    seen.add(key);
  }
  return path.map((cell) => ({ ...cell }));
}

/** All spaces within square (Chebyshev) radius of a central space. */
export function squareArea(center: Position, radius: number): Position[] {
  const cells: Position[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      cells.push({ x: center.x + dx, y: center.y + dy });
    }
  }
  return cells;
}

/** The four orthogonal neighbors of a space. */
export function orthogonalNeighbors(center: Position): Position[] {
  return [
    { x: center.x + 1, y: center.y },
    { x: center.x - 1, y: center.y },
    { x: center.x, y: center.y + 1 },
    { x: center.x, y: center.y - 1 },
  ];
}

/** Eight neighboring cells clockwise from north. This is pure geometry; the
 * order is data returned to a caller, not U17 effect arbitration. */
export function ringAround(center: Position): Position[] {
  return [
    { x: center.x, y: center.y - 1 },
    { x: center.x + 1, y: center.y - 1 },
    { x: center.x + 1, y: center.y },
    { x: center.x + 1, y: center.y + 1 },
    { x: center.x, y: center.y + 1 },
    { x: center.x - 1, y: center.y + 1 },
    { x: center.x - 1, y: center.y },
    { x: center.x - 1, y: center.y - 1 },
  ];
}

/**
 * Validate and return the cells of an orthogonal arc path (ICON p.97:
 * "Arc X: X contiguous spaces, with its first space drawn in range. Spaces
 * must be drawn sequentially, in orthogonal directions (no diagonals), and
 * cannot overlap themselves or the ability user, but otherwise can twist and
 * turn and be placed in any pattern"). `start` is the ability user's origin
 * (never an arc cell); each `path` cell must be exactly one orthogonal step
 * from the previous cell (or from `start` for the first), and no cell may
 * repeat. Returns null when the path is not a legal arc — a chosen path is
 * never approximated or auto-shaped.
 */
export function arcCells(start: Position, path: readonly Position[]): Position[] | null {
  if (path.length === 0) return null;
  const cells: Position[] = [];
  const seen = new Set<string>([cellKey(start)]);
  let previous = start;
  for (const cell of path) {
    const dx = Math.abs(cell.x - previous.x);
    const dy = Math.abs(cell.y - previous.y);
    // Exactly one orthogonal step (no diagonals, no standing still, no jump).
    if (dx + dy !== 1) return null;
    const key = cellKey(cell);
    if (seen.has(key)) return null; // cannot overlap itself (or the origin)
    seen.add(key);
    cells.push(cell);
    previous = cell;
  }
  return cells;
}

export const cellKey = (cell: Position) => `${cell.x},${cell.y}`;

export const sameCell = (first: Position, second: Position) => first.x === second.x && first.y === second.y;

/** ICON p.97 area-placement rule: an AoE pattern with a listed range may be
 * placed in ANY configuration so long as AT LEAST ONE of its spaces is
 * within the listed range of the origin — never the center alone. Pure
 * geometry: a selected area is legal iff any of its cells is within `range`
 * (Chebyshev, the engine's range metric) of `origin`. */
export function areaHasCellWithinRange(cells: readonly Position[], origin: Position, range: number): boolean {
  return cells.some((cell) => Math.max(Math.abs(cell.x - origin.x), Math.abs(cell.y - origin.y)) <= range);
}
