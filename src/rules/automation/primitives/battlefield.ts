/** Source-ID-free battlefield metric and obstruction primitives. */
import type { Position } from '../../types.js';
import { sameCell } from '../../area-geometry.js';
import { entityKindOf } from './entity-kind.js';
import { footprintCells, footprintIntersectsCells, footprintsOverlap } from './spatial-intent.js';
import type { RuleExecutionContext } from './types.js';

export const distance = (first: Position, second: Position): number =>
  Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y));

export const withinGrid = (position: Position, context: RuleExecutionContext): boolean =>
  position.x >= 0 && position.y >= 0
  && position.x < context.state.grid.width && position.y < context.state.grid.height;

/** Character footprints and objects obstruct; intangible summons do not (p.95). */
export const occupied = (position: Position, context: RuleExecutionContext, excludeId = ''): boolean =>
  Object.values(context.state.actors).some((actor) => actor.id !== excludeId
    && actor.position
    && footprintIntersectsCells({ position: actor.position, size: actor.size ?? 1 }, [position]))
  || Object.values(context.state.entities).some((entity) => entityKindOf(entity) === 'object'
    && entity.position
    && sameCell(entity.position, position));

export const impassable = (position: Position, context: RuleExecutionContext): boolean =>
  !withinGrid(position, context) || context.state.terrainAt(position).has('impassable');

/** Compute a straight-line destination; movement application remains a domain concern. */
export function walk(
  context: RuleExecutionContext,
  start: Position,
  direction: Position,
  steps: number,
  phasing: boolean,
  moverId: string,
  options: { excludeIds?: ReadonlySet<string> } = {},
): Position {
  const excludeIds = options.excludeIds ?? new Set<string>();
  const moverSize = Math.max(1, context.state.actors[moverId]?.size ?? 1);
  let position = { ...start };
  for (let step = 0; step < steps; step += 1) {
    const next = { x: position.x + Math.sign(direction.x), y: position.y + Math.sign(direction.y) };
    if (footprintCells(next, moverSize).some((cell) => !withinGrid(cell, context)
      || context.state.terrainAt(cell).has('impassable'))) break;
    if (!phasing) {
      const blockedByActor = Object.values(context.state.actors).some(
        (actor) => actor.id !== moverId && !excludeIds.has(actor.id) && actor.position
          && footprintsOverlap(
            { position: next, size: moverSize },
            { position: actor.position, size: actor.size ?? 1 },
          ),
      );
      const blockedByEntity = Object.values(context.state.entities).some(
        (entity) => entityKindOf(entity) === 'object' && entity.position && sameCell(entity.position, next),
      );
      if (blockedByActor || blockedByEntity) break;
    }
    position = next;
  }
  return position;
}

export function firstFreeCell(context: RuleExecutionContext, cells: Position[], excludeId: string): Position | null {
  return cells.find((cell) => withinGrid(cell, context) && !occupied(cell, context, excludeId)) ?? null;
}

/** Eight neighboring cells clockwise from north; geometry, not U17 arbitration. */
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
