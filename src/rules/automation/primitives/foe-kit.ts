import type { Position } from '../../types.js';
import type { RuleActorView, RuleExecutionContext } from './types.js';
import { ringAround } from './job-kit.js';

export * from './job-kit.js';

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
