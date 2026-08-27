import type { EncounterEntity, EncounterState, Position } from '../../types.js';
import { footprintCells } from '../primitives/spatial-intent.js';
import { hasLineOfSight } from '../primitives/line-of-sight.js';
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
  /** The creation origin for LoS/range validation. If provided, the kernel
   * checks line of sight from this position to each candidate cell and
   * optionally validates range. */
  origin?: Position;
  /** Maximum distance from origin (Chebyshev). Validated only when origin is
   * provided. Source-specific; the kernel does not hardcode one range. */
  maxRange?: number;
}

export interface EntityCreationResult {
  positions: Position[];
  count: number;
}

const sameCell = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

/** ICON general rule: "For a space to be valid for summoning, teleporting,
 * or creating objects, unless specified it must be free and unobstructed."
 * The summoner occupies space just like any other character — a summon's
 * initial space is not 'free' merely because the occupant owns the summon.
 * Only source rules that EXPLICITLY permit occupied-space creation may
 * bypass this check (handled as content-layer exceptions, never inferred
 * from entity type inside the kernel). */
function occupiedByActor(state: EncounterState, position: Position): boolean {
  return Object.values(state.actors).some((actor) => actor.onBattlefield && !actor.defeated
    && footprintCells(actor.position, Math.max(1, actor.size)).some((cell) => sameCell(cell, position)));
}

function occupiedByEntity(state: EncounterState, position: Position): boolean {
  return Object.values(state.entities).some((entity) => entity.positions.some((cell) => sameCell(cell, position)));
}

/** ICON general rule: creation spaces must be free AND unobstructed. Impassable
 * terrain (p.92) blocks creation unless the source explicitly says otherwise. */
function hasObstruction(state: EncounterState, position: Position): boolean {
  return state.grid.terrain.some((cell) => sameCell(cell.position, position) && cell.type === 'impassable');
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
    // Bounds check.
    if (footprint.some((cell) => cell.x < 0 || cell.y < 0 || cell.x >= state.grid.width || cell.y >= state.grid.height)) continue;
    // ICON p.92: the space must be free (no actor or entity).
    if (footprint.some((cell) => occupiedByActor(state, cell) || occupiedByEntity(state, cell))) continue;
    // ICON p.92: the space must be unobstructed (no impassable terrain).
    if (footprint.some((cell) => hasObstruction(state, cell))) continue;
    // ICON general rule: line of sight from the origin to the creation cell.
    if (request.origin && footprint.some((cell) => !hasLineOfSight({ grid: state.grid, terrainAt: (pos) => {
      const values = new Set<string>();
      for (const t of state.grid.terrain) if (t.position.x === pos.x && t.position.y === pos.y) values.add(t.type);
      for (const e of state.terrainEffects) if (e.positions.some((p) => p.x === pos.x && p.y === pos.y)) values.add(e.terrain);
      return values;
    }}, request.origin!, cell))) continue;
    // Range validation (source-provided).
    if (request.origin && request.maxRange !== undefined) {
      const chebyshev = Math.max(Math.abs(position.x - request.origin.x), Math.abs(position.y - request.origin.y));
      if (chebyshev > request.maxRange) continue;
    }
    if (selected.some((cell) => sameCell(cell, position))) continue;
    selected.push({ ...position });
  }
  return selected.length === 0 ? null : { positions: selected, count: selected.length };
}
