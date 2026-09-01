/** Source-ID-free battlefield metric and static-space primitives. */
import type { Position } from '../../types.js';
import { sameCell } from '../../area-geometry.js';
import { entityKindOf } from './entity-kind.js';
import { footprintIntersectsCells } from './spatial-intent.js';
import type { RuleExecutionContext } from './types.js';

export const distance = (first: Position, second: Position): number =>
  Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y));

export const withinGrid = (position: Position, context: RuleExecutionContext): boolean =>
  position.x >= 0 && position.y >= 0
  && position.x < context.state.grid.width && position.y < context.state.grid.height;

/**
 * Whether a cell is unavailable as a final character space because it is
 * occupied by another character or an OBJECT. This is deliberately not a
 * movement-obstruction query: ICON p.88 allows movement through allies while
 * forbidding a move from ending in their space. Intangible summons do not
 * occupy a character's final space (p.95).
 */
export const finalSpaceOccupied = (position: Position, context: RuleExecutionContext, excludeId = ''): boolean =>
  Object.values(context.state.actors).some((actor) => actor.id !== excludeId
    && !actor.defeated
    && actor.position
    && footprintIntersectsCells({ position: actor.position, size: actor.size ?? 1 }, [position]))
  || Object.values(context.state.entities).some((entity) => entityKindOf(entity) === 'object'
    && entity.positions.some((cell) => sameCell(cell, position)));

export const impassable = (position: Position, context: RuleExecutionContext): boolean =>
  !withinGrid(position, context) || context.state.terrainAt(position).has('impassable');
