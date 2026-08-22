import type { Position } from '../types.js';
import type { RuleActorView, RuleExecutionContext } from './types.js';
import { ringAround, walk } from './job-kit.js';

/**
 * foe-kit.ts — the shared building blocks every foe ability program is
 * assembled from, mirroring `job-kit.ts` for the re-runner/GM side.
 *
 * The 1,365 source `foe-ability` units are far more repetitive than job
 * abilities: a handful of mechanics (standard attack "On hit: [D]+fray" /
 * "Miss: fray", area blasts, forced saves, marks, shoves, rushes, teleports,
 * end-turn abilities) cover most of them. The `foe-recipes.ts` layer consumes
 * this kit: a recipe names a primitive (attack, shove, rush, mark, blast, …)
 * plus its parameterized options, and the generic resolver factories below
 * turn the recipe into deterministic mutations — no per-ability resolver code.
 *
 * Foe semantics notes:
 * - The package-agnostic `job-kit.ts` helpers are re-exported so a foe file
 *   imports from one place. Foes use the same `resolveAttack`, `walk`,
 *   movement/condition mutation builders, and `compilation`/`action` helpers.
 * - Foe abilities are cost-modeled exactly like job abilities: an `action`
 *   cost becomes an `actions` spend mutation the reducer validates and applies.
 * - Foes that target by adjacency (rather than a numeric range, which most
 *   `foe-ability` units leave `null`) select their target positionally from
 *   `ringAround(...)`, so the reusable `adjacentActors` selector below covers
 *   the deterministic positional cases.
 */

// Re-export the full job-kit surface so a foe file has one import point.
export * from './job-kit.js';
export { ringAround, walk };

/** Every living actor on the given side occupying a cell orthogonally or
 * diagonally adjacent to `position`, excluding `excludeId`. Deterministic
 * order (row-major by position, then id). */
export function adjacentActors(
  context: RuleExecutionContext,
  position: Position,
  side: 'heroes' | 'foes' | null,
  excludeId = '',
): RuleActorView[] {
  const cells = ringAround(position);
  return Object.values(context.state.actors)
    .filter((actor) => actor.id !== excludeId && actor.position && !actor.defeated
      && (side === null || actor.side === side)
      && cells.some((cell) => cell.x === actor.position!.x && cell.y === actor.position!.y))
    .sort((a, b) => (a.position!.y - b.position!.y) || (a.position!.x - b.position!.x) || a.id.localeCompare(b.id));
}

/** `true` when any living actor occupies a cell adjacent to `position`. */
export function anyAdjacentActor(context: RuleExecutionContext, position: Position, side: 'heroes' | 'foes' | null): boolean {
  return adjacentActors(context, position, side).length > 0;
}

/** Push `actorId` one cell along `direction` (stopping at grid edge,
 * impassable terrain, and — unless `phasing` — other characters/entities),
 * returning the shove's effective end position via the kit's `walk`. */
export function shoveMove(
  context: RuleExecutionContext,
  actorId: string,
  direction: Position,
  phasing = false,
): Position {
  const actor = context.state.actors[actorId];
  const position = actor?.position;
  if (!position) return position ?? { x: 0, y: 0 };
  return walk(context, position, direction, 1, phasing, actorId);
}
