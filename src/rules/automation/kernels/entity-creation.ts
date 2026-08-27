import type { EncounterEntity, EncounterState, Position } from '../../types.js';
import { footprintCells } from '../primitives/spatial-intent.js';
import { summonCap } from './summon-recipes.js';

/** Shared generic entity-creation authority: bounds, occupancy, deterministic
 * caller-selected positions, and registered per-owner caps. */
export interface EntityCreationRequest {
  ownerId: string;
  entityType: string;
  positions: readonly Position[];
  count: number;
  state: Readonly<Record<string, string | number | boolean | null>>;
  duration: EncounterEntity['duration'];
}

export interface EntityCreationResult {
  positions: Position[];
  count: number;
}

const sameCell = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

function occupiedByActor(state: EncounterState, position: Position, ownerId: string): boolean {
  return Object.values(state.actors).some((actor) => actor.onBattlefield && !actor.defeated && actor.id !== ownerId
    && footprintCells(actor.position, Math.max(1, actor.size)).some((cell) => sameCell(cell, position)));
}

function occupiedByEntity(state: EncounterState, position: Position): boolean {
  return Object.values(state.entities).some((entity) => entity.positions.some((cell) => sameCell(cell, position)));
}

export function validateEntityCreation(state: EncounterState, request: EntityCreationRequest): EntityCreationResult | null {
  const count = Math.max(0, Math.floor(request.count));
  if (count === 0 || request.positions.length < count) return null;
  const cap = summonCap(request.entityType);
  const existing = Object.values(state.entities).filter((entity) => entity.type === request.entityType
    && entity.ownerId === request.ownerId && entity.state.companion !== true).length;
  if (cap !== null && existing >= cap) return null;
  const allowed = cap === null ? count : Math.min(count, cap - existing);
  const selected: Position[] = [];
  for (const position of request.positions) {
    if (selected.length >= allowed) break;
    const footprint = footprintCells(position, 1);
    if (footprint.some((cell) => cell.x < 0 || cell.y < 0 || cell.x >= state.grid.width || cell.y >= state.grid.height)) continue;
    if (footprint.some((cell) => occupiedByActor(state, cell, request.ownerId) || occupiedByEntity(state, cell))) continue;
    if (selected.some((cell) => sameCell(cell, position))) continue;
    selected.push({ ...position });
  }
  return selected.length === 0 ? null : { positions: selected, count: selected.length };
}
