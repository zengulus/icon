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

export const sameCell = (first: Position, second: Position) => first.x === second.x && first.y === second.y;
