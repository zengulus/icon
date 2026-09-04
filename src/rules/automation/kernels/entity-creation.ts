import type { EncounterEntity, EncounterState, Position } from '../../types.js';
import { footprintCells, footprintDistance } from '../primitives/spatial-intent.js';
import { hasLineOfSightBetween } from '../primitives/line-of-sight.js';
import { entityKind, entityKindOf } from '../primitives/entity-kind.js';
import type { EntityKind } from '../primitives/entity-kind.js';
import { summonCap } from './summon-recipes.js';

export { entityKind, entityKindOf } from '../primitives/entity-kind.js';
export type { EntityKind } from '../primitives/entity-kind.js';

/** Whether a creation must land exactly N legal cells or may land up to N. */
export type CountMode = 'exact' | 'up-to';

/** Shared generic entity-creation authority: bounds, occupancy, stacking,
 * deterministic candidate selection, creator LoS/footprint range, and
 * registered per-owner caps. */
export interface EntityCreationRequest {
  ownerId: string;
  entityType: string;
  /** The category (defaults from the central registry / request `kind`). */
  kind?: EntityKind;
  positions: readonly Position[];
  count: number;
  /** 'exact' — the creation requires exactly N legal cells and fails (returns
   * null → nothing is created) when it cannot reach them; 'up-to' (default) —
   * create as many legal cells as exist (0..N). The per-owner summon cap can
   * still reduce an 'exact' request to its remaining allowance (cap-limited
   * partial success), because the cap is a source-level ceiling, not a
   * creation-capacity failure. */
  countMode?: CountMode;
  state: Readonly<Record<string, string | number | boolean | null>>;
  duration: EncounterEntity['duration'];
  /** The creation spatial contract: CREATOR LoS origin (required for any
   * LoS/range enforcement) plus an optional maximum footprint range. Origin
   * and range are a PAIRED invariant: the kernel REJECTS a declared range
   * without a valid origin and an origin that is not inside the battlefield
   * grid — it never silently skips enforcement. The origin is the summoner /
   * creator (the source actor), not the placement region's center; a
   * target-centered placement region is expressed entirely through
   * `positions` without changing the LoS origin. */
  spatial?: { origin: Position; originSize?: number; maxRange?: number };
}

export interface EntityCreationResult {
  positions: Position[];
  count: number;
}

const sameCell = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const heightOf = (entity: Pick<EncounterEntity, 'state'>): number => {
  const height = entity.state?.['height'];
  return typeof height === 'number' && Number.isFinite(height) ? height : 1;
};

/** ICON general rule (p.108): \"For a space to be valid for summoning,
 * teleporting, or creating objects, unless specified it must be free and
 * unobstructed.\" The summoner occupies space just like any other character —
 * a summon's initial space is not 'free' merely because the occupant owns the
 * summon. Only source rules that EXPLICITLY permit occupied-space creation
 * may bypass this check (handled as content-layer exceptions). */
function occupiedByActor(state: EncounterState, position: Position): boolean {
  return Object.values(state.actors).some((actor) => actor.onBattlefield && !actor.defeated
    && footprintCells(actor.position, Math.max(1, actor.size)).some((cell) => sameCell(cell, position)));
}

/** The object and summon entities whose footprint includes `position`. */
function entitiesAt(state: EncounterState, position: Position): EncounterEntity[] {
  return Object.values(state.entities).filter((entity) => entity.positions.some((cell) => sameCell(cell, position)));
}

/** The per-cell union of base grid terrain and overlay terrain effects, the
 * SAME unified view the movement planner and line-of-sight use — so a dynamic
 * impassable effect created during play (not merely a base grid cell) can block
 * a later creation cell. An undriven effect blocks only when i's terrain name
 * is impassable, matching the canonical `terrainAt` union in encounter.ts. */
function terrainTypesAt(state: EncounterState, position: Position): ReadonlySet<string> {
  const types = new Set<string>();
  for (const cell of state.grid.terrain) if (sameCell(cell.position, position)) types.add(cell.type);
  for (const effect of state.terrainEffects) if (effect.positions.some((p) => sameCell(p, position))) types.add(effect.terrain);
  return types;
}

/** ICON general rule: creation spaces must be free AND unobstructed. Impassable
 * terrain (p.89/p.92) blocks creation unless the source explicitly says
 * otherwise — including a dynamic impassable terrain effect, not merely a base
 * `state.grid.terrain` cell. */
function hasObstruction(state: EncounterState, position: Position): boolean {
  return terrainTypesAt(state, position).has('impassable');
}

/** A creation occupies a cell legally when it is free of characters and of a
 * conflicting category, and — for an object stacked onto existing objects —
 * the total object height stays ≤ 3 (ICON p.95/p.107). Summons may never
 * occupy any entity's space (including an object's). Objects may be stacked on
 * other objects but never on summons, and never where characters stand. */
function categoryOccupantBlocked(state: EncounterState, kind: EntityKind, position: Position): boolean {
  if (occupiedByActor(state, position)) return true;
  const occupants = entitiesAt(state, position);
  return occupants.some((entity) => {
    const occupantKind = entityKindOf(entity);
    if (occupantKind === 'summon') return true; // never on a summon (either category)
    // occupant is an object: a summon can't take an object's space; an object
    // can, as long as the stacked total height stays ≤ 3.
    if (kind === 'summon') return true;
    return false;
  });
}

function objectStackTooHigh(state: EncounterState, kind: EntityKind, position: Position, newHeight: number): boolean {
  if (kind !== 'object') return false;
  const existingTotal = entitiesAt(state, position)
    .filter((entity) => entityKindOf(entity) === 'object')
    .reduce((total, entity) => total + heightOf(entity), 0);
  return existingTotal + newHeight > 3;
}

/** Source-defined per-owner ceiling, shared by candidate/choice planning and
 * application. A full cap suppresses creation, not the containing ability. */
export function entityCreationAllowance(state: EncounterState, request: Pick<EntityCreationRequest, 'count' | 'entityType' | 'ownerId'>): number {
  const count = Math.max(0, Math.floor(request.count));
  const cap = summonCap(request.entityType);
  const existing = Object.values(state.entities).filter((entity) => entity.type === request.entityType
    && entity.ownerId === request.ownerId && entity.state.companion !== true).length;
  return cap === null ? count : Math.max(0, Math.min(count, cap - existing));
}

export function validateEntityCreation(state: EncounterState, request: EntityCreationRequest): EntityCreationResult | null {
  const kind = request.kind ?? entityKind(request.entityType);
  const mode = request.countMode ?? 'up-to';
  const count = Math.max(0, Math.floor(request.count));
  if (count === 0 || request.positions.length === 0) return null;
  // Exactly-N requires enough CANDIDATES to even try (a creation with fewer
  // offered positions than the mandatory count can never be satisfied).
  if (mode === 'exact' && request.positions.length < count) return null;
  const spatial = request.spatial;
  // Fail-closed pairing invariant: a declared range without a valid origin,
  // or an origin outside the battlefield grid, rejects the whole creation —
  // a malformed "range with no origin" can never become unlimited creation.
  if (spatial) {
    const origin = spatial.origin;
    if (origin === undefined) return null;
    if (origin.x < 0 || origin.y < 0 || origin.x >= state.grid.width || origin.y >= state.grid.height) return null;
  }
  const allowed = entityCreationAllowance(state, request);
  if (allowed === 0) return null;
  const newHeight = heightOf({ state: request.state });
  const selected: Position[] = [];
  for (const position of request.positions) {
    if (selected.length >= allowed) break;
    const footprint = footprintCells(position, 1);
    // Bounds check.
    if (footprint.some((cell) => cell.x < 0 || cell.y < 0 || cell.x >= state.grid.width || cell.y >= state.grid.height)) continue;
    // ICON p.108: the space must be free (no blocking character/category
    // occupant) and unobstructed (no impassable terrain).
    if (footprint.some((cell) => hasObstruction(state, cell) || categoryOccupantBlocked(state, kind, cell))) continue;
    // ICON p.95/p.107: objects may be created on other objects as long as the
    // total stacked object height isn't past 3; over-stacking is rejected.
    if (objectStackTooHigh(state, kind, position, newHeight)) continue;
    // ICON general rule: line of sight from the CREATOR (spatial origin) to
    // the creation cell — not from the placement region center — using the same
    // combined terrain view as the obstruction check above.
    if (spatial && footprint.some((cell) => !hasLineOfSightBetween(
      { grid: state.grid, terrainAt: (pos) => terrainTypesAt(state, pos) },
      { position: spatial.origin!, size: spatial.originSize ?? 1 },
      { position: cell, size: 1 },
    ))) continue;
    // ICON p.92: range validation using the canonical footprint metric (L∞
    // between occupied footprints) — the same distance authority targeting,
    // auras, and the attack modifiers use. For a Size-1 creator this
    // collapses to plain Chebyshev. For larger creators, the distance is
    // measured from the edge of the creator footprint, not the anchor cell —
    // so a Size>1 creator may place at a cell beyond anchor-radius.
    if (spatial && spatial.maxRange !== undefined) {
      const dist = footprintDistance(
        { position: spatial.origin, size: spatial.originSize ?? 1 },
        { position, size: 1 },
      );
      if (dist > spatial.maxRange) continue;
    }
    if (selected.some((cell) => sameCell(cell, position))) continue;
    selected.push({ ...position });
  }
  // Exactly-N that cannot reach its target (`allowed`, already cap-bounded)
  // fails (nothing created). A cap that reduces `allowed` below `count` is a
  // legitimate cap-limited success at `allowed`, not a failure. Up-to creates
  // the legal subset. The cap always bounds `allowed`.
  if (mode === 'exact' && selected.length < allowed) return null;
  return selected.length === 0 ? null : { positions: selected, count: selected.length };
}
