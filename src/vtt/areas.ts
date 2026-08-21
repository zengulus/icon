/**
 * Deterministic, presentation-only square-grid geometry for table templates.
 *
 * This module intentionally knows nothing about attacks, range, cover, or
 * legal ICON targets.  It turns a durable `AreaTemplate` into cells that a UI
 * can render, preview, resize, or use as a candidate-cell query.  Mechanical
 * ability resolvers remain responsible for deciding whether any actor can be
 * targeted or affected.
 */
import type { Position } from '../rules/types.js';
import type { AreaTemplate } from '../rules/vtt-room.js';

/** The geometry-bearing subset of the shared table template model. */
export type AreaTemplateGeometry = Pick<AreaTemplate, 'kind' | 'origin' | 'rotation' | 'length' | 'width'>;

/**
 * Grid directions are clockwise in screen/grid coordinates: `0` points east
 * and `90` points south (positive y).  Diagonal directions remain discrete
 * grid directions rather than sub-cell render rotations.
 */
export type AreaTemplateRotation = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;

/** Every rotation accepted by the square-grid template layer. */
export const AREA_TEMPLATE_ROTATIONS: readonly AreaTemplateRotation[] = [0, 45, 90, 135, 180, 225, 270, 315];

/** Matches the durable TableState validation limit and bounds preview work. */
export const MAX_AREA_TEMPLATE_DIMENSION = 100;

/** A unit step on the square grid. */
export interface GridDirection {
  readonly x: -1 | 0 | 1;
  readonly y: -1 | 0 | 1;
}

/** Inclusive cell bounds for rendering, placement validation, or clipping. */
export interface AreaTemplateBounds {
  readonly min: Position;
  readonly max: Position;
  readonly width: number;
  readonly height: number;
}

/** A zero-based rectangular board, matching `EncounterState.grid`. */
export interface SquareGridBounds {
  readonly width: number;
  readonly height: number;
}

/** One actor/object cell supplied to the generic candidate-cell helper. */
export interface AreaTemplateActorCell<T = unknown> {
  readonly actor: T;
  readonly position: Position;
}

/** The minimal shape needed to inspect a single-cell encounter actor. */
export interface PositionedAreaActor {
  readonly position: Position;
}

export class AreaTemplateGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AreaTemplateGeometryError';
  }
}

const ROTATION_DIRECTIONS: Readonly<Record<AreaTemplateRotation, GridDirection>> = {
  0: { x: 1, y: 0 },
  45: { x: 1, y: 1 },
  90: { x: 0, y: 1 },
  135: { x: -1, y: 1 },
  180: { x: -1, y: 0 },
  225: { x: -1, y: -1 },
  270: { x: 0, y: -1 },
  315: { x: 1, y: -1 },
};

const AREA_KINDS = new Set<AreaTemplateGeometry['kind']>(['burst', 'cone', 'line', 'rectangle']);

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new AreaTemplateGeometryError(`${label} must be finite.`);
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AreaTemplateGeometryError(`${label} must be a positive safe integer.`);
  }
}

function assertTemplateDimension(value: number, label: string): void {
  assertPositiveSafeInteger(value, label);
  if (value > MAX_AREA_TEMPLATE_DIMENSION) {
    throw new AreaTemplateGeometryError(`${label} cannot exceed ${MAX_AREA_TEMPLATE_DIMENSION}.`);
  }
}

function copyPosition(position: Position): Position {
  return { x: position.x, y: position.y };
}

function cellKey(position: Position): string {
  return `${position.x},${position.y}`;
}

function compareCells(left: Position, right: Position): number {
  if (left.y !== right.y) return left.y < right.y ? -1 : 1;
  if (left.x !== right.x) return left.x < right.x ? -1 : 1;
  return 0;
}

function sortUniqueCells(cells: Iterable<Position>): Position[] {
  const unique = new Map<string, Position>();
  for (const cell of cells) {
    assertGridCell(cell, 'generated area cell');
    unique.set(cellKey(cell), copyPosition(cell));
  }
  return [...unique.values()].sort(compareCells);
}

function crossOffsetsCentered(width: number): number[] {
  const start = -Math.floor((width - 1) / 2);
  const end = Math.ceil((width - 1) / 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function clockwisePerpendicular(direction: GridDirection): GridDirection {
  return { x: -direction.y as GridDirection['x'], y: direction.x as GridDirection['y'] };
}

function cellAt(origin: Position, forward: GridDirection, side: GridDirection, forwardSteps: number, sideSteps: number): Position {
  return {
    x: origin.x + forward.x * forwardSteps + side.x * sideSteps,
    y: origin.y + forward.y * forwardSteps + side.y * sideSteps,
  };
}

/** Returns true when a position is a valid discrete square-grid cell. */
export function isGridCell(position: Position): boolean {
  return Number.isSafeInteger(position.x) && Number.isSafeInteger(position.y);
}

/** Throws when a position cannot serve as a deterministic grid-cell origin. */
export function assertGridCell(position: Position, label = 'position'): asserts position is Position {
  if (!isGridCell(position)) throw new AreaTemplateGeometryError(`${label} must use safe integer grid coordinates.`);
}

/**
 * Canonicalizes an equivalent rotation into `[0, 360)`.  Only eighth-turn
 * rotations are valid because they map exactly onto discrete square-grid
 * directions.
 */
export function normalizeAreaTemplateRotation(rotation: number): AreaTemplateRotation {
  assertFinite(rotation, 'rotation');
  if (!Number.isInteger(rotation)) throw new AreaTemplateGeometryError('rotation must be a whole number of degrees.');
  const normalized = ((rotation % 360) + 360) % 360;
  if (!AREA_TEMPLATE_ROTATIONS.includes(normalized as AreaTemplateRotation)) {
    throw new AreaTemplateGeometryError('rotation must be a multiple of 45 degrees.');
  }
  return normalized as AreaTemplateRotation;
}

/** Returns whether a rotation can be represented by this square-grid layer. */
export function isAreaTemplateRotation(rotation: number): boolean {
  try {
    normalizeAreaTemplateRotation(rotation);
    return true;
  } catch {
    return false;
  }
}

/** Returns the forward grid direction for a valid template rotation. */
export function areaTemplateDirection(rotation: number): GridDirection {
  return ROTATION_DIRECTIONS[normalizeAreaTemplateRotation(rotation)];
}

/**
 * Validates only the fields that determine a footprint.  It does not validate
 * presentation fields (labels, colors, ownership), which remain TableState's
 * responsibility.
 */
export function assertAreaTemplateGeometry(template: AreaTemplateGeometry): void {
  if (!AREA_KINDS.has(template.kind)) throw new AreaTemplateGeometryError(`Unknown area template kind: ${String(template.kind)}.`);
  assertGridCell(template.origin, 'template origin');
  assertTemplateDimension(template.length, 'template length');
  assertTemplateDimension(template.width, 'template width');
  normalizeAreaTemplateRotation(template.rotation);
}

/**
 * Returns a fresh geometry-only template with copied origin and canonical
 * rotation.  It never mutates the shared room state.
 */
export function normalizeAreaTemplateGeometry(template: AreaTemplateGeometry): AreaTemplateGeometry {
  assertAreaTemplateGeometry(template);
  return {
    kind: template.kind,
    origin: copyPosition(template.origin),
    rotation: normalizeAreaTemplateRotation(template.rotation),
    length: template.length,
    width: template.width,
  };
}

function burstCells(template: AreaTemplateGeometry): Position[] {
  // `length` is the burst radius in Chebyshev (square-grid) cells. `width`
  // is retained by the generic TableState model but does not change a radial
  // footprint; UI controls should mirror the displayed burst size into both.
  const radius = template.length;
  const cells: Position[] = [];
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      cells.push({ x: template.origin.x + x, y: template.origin.y + y });
    }
  }
  return cells;
}

function lineCells(template: AreaTemplateGeometry): Position[] {
  const forward = areaTemplateDirection(template.rotation);
  const side = clockwisePerpendicular(forward);
  const cells: Position[] = [];
  for (let step = 0; step < template.length; step += 1) {
    for (const offset of crossOffsetsCentered(template.width)) {
      cells.push(cellAt(template.origin, forward, side, step, offset));
    }
  }
  return cells;
}

function rectangleCells(template: AreaTemplateGeometry): Position[] {
  const forward = areaTemplateDirection(template.rotation);
  const side = clockwisePerpendicular(forward);
  const cells: Position[] = [];
  // A rectangle's origin is its anchored counter-clockwise corner; width
  // grows toward the clockwise perpendicular. This makes even widths and
  // drag/reposition behavior deterministic.
  for (let step = 0; step < template.length; step += 1) {
    for (let offset = 0; offset < template.width; offset += 1) {
      cells.push(cellAt(template.origin, forward, side, step, offset));
    }
  }
  return cells;
}

function coneCells(template: AreaTemplateGeometry): Position[] {
  const forward = areaTemplateDirection(template.rotation);
  const side = clockwisePerpendicular(forward);
  const cells: Position[] = [];
  const finalStep = template.length - 1;

  for (let step = 0; step <= finalStep; step += 1) {
    // The apex is one cell. The base is exactly `width` cells, with a stable
    // discrete interpolation for the intervening rows.
    const rowWidth = finalStep === 0
      ? 1
      : 1 + Math.floor((step * (template.width - 1)) / finalStep);
    for (const offset of crossOffsetsCentered(rowWidth)) {
      cells.push(cellAt(template.origin, forward, side, step, offset));
    }
  }
  return cells;
}

/**
 * Returns a stable row-major list of occupied cells for a visual template.
 *
 * - `burst`: `length` is a Chebyshev radius around `origin`.
 * - `cone`: `origin` is the one-cell apex; `length` includes it and `width`
 *   is the base width.
 * - `line`: `origin` is the centered starting cross-section; `length`
 *   includes it and `width` is its thickness.
 * - `rectangle`: `origin` is the anchored corner; `length` extends forward
 *   and `width` extends clockwise from it.
 *
 * A returned cell is not a mechanical target declaration.
 */
export function areaTemplateCells(template: AreaTemplateGeometry): Position[] {
  const normalized = normalizeAreaTemplateGeometry(template);
  switch (normalized.kind) {
    case 'burst': return sortUniqueCells(burstCells(normalized));
    case 'cone': return sortUniqueCells(coneCells(normalized));
    case 'line': return sortUniqueCells(lineCells(normalized));
    case 'rectangle': return sortUniqueCells(rectangleCells(normalized));
  }
}

/** Returns whether a template visually contains a particular discrete cell. */
export function areaTemplateContainsCell(template: AreaTemplateGeometry, cell: Position): boolean {
  assertGridCell(cell, 'cell');
  const key = cellKey(cell);
  return areaTemplateCells(template).some((candidate) => cellKey(candidate) === key);
}

/** Returns the smallest inclusive rectangle that contains a template footprint. */
export function areaTemplateBounds(template: AreaTemplateGeometry): AreaTemplateBounds {
  const cells = areaTemplateCells(template);
  const xs = cells.map(({ x }) => x);
  const ys = cells.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function assertSquareGridBounds(bounds: SquareGridBounds): void {
  assertPositiveSafeInteger(bounds.width, 'grid width');
  assertPositiveSafeInteger(bounds.height, 'grid height');
}

/** Returns whether a discrete cell is inside a zero-based rectangular board. */
export function isGridCellInBounds(cell: Position, bounds: SquareGridBounds): boolean {
  assertGridCell(cell, 'cell');
  assertSquareGridBounds(bounds);
  return cell.x >= 0 && cell.y >= 0 && cell.x < bounds.width && cell.y < bounds.height;
}

/** Clips a visual footprint to a zero-based rectangular board. */
export function areaTemplateCellsInBounds(template: AreaTemplateGeometry, bounds: SquareGridBounds): Position[] {
  assertSquareGridBounds(bounds);
  return areaTemplateCells(template).filter((cell) => isGridCellInBounds(cell, bounds));
}

/** Returns true only when every visual template cell is inside the board. */
export function isAreaTemplateFullyInBounds(template: AreaTemplateGeometry, bounds: SquareGridBounds): boolean {
  assertSquareGridBounds(bounds);
  return areaTemplateCells(template).every((cell) => isGridCellInBounds(cell, bounds));
}

/**
 * Filters arbitrary actor/object-cell records to cells covered by a visual
 * template. This is deliberately a geometry query—not authorization, range,
 * line-of-effect, or a mechanics target resolver.
 */
export function actorCellsInAreaTemplate<T>(
  template: AreaTemplateGeometry,
  actorCells: Iterable<AreaTemplateActorCell<T>>,
): AreaTemplateActorCell<T>[] {
  const footprint = new Set(areaTemplateCells(template).map(cellKey));
  const result: AreaTemplateActorCell<T>[] = [];
  for (const actorCell of actorCells) {
    if (isGridCell(actorCell.position) && footprint.has(cellKey(actorCell.position))) {
      result.push({ actor: actorCell.actor, position: copyPosition(actorCell.position) });
    }
  }
  return result;
}

/**
 * Convenience for the one-cell `EncounterActor` shape. It preserves the
 * iterable's order and makes no judgement about whether a returned actor is a
 * legal game target.
 */
export function actorsInAreaTemplate<T extends PositionedAreaActor>(
  template: AreaTemplateGeometry,
  actors: Iterable<T>,
): T[] {
  const footprint = new Set(areaTemplateCells(template).map(cellKey));
  const result: T[] = [];
  for (const actor of actors) {
    if (isGridCell(actor.position) && footprint.has(cellKey(actor.position))) result.push(actor);
  }
  return result;
}

/**
 * Convenience for `EncounterState.actors`. IDs are sorted so a state loaded
 * through a different insertion order produces the same candidate ordering.
 */
export function actorIdsInAreaTemplate(
  template: AreaTemplateGeometry,
  actors: Readonly<Record<string, PositionedAreaActor>>,
): string[] {
  const footprint = new Set(areaTemplateCells(template).map(cellKey));
  return Object.entries(actors)
    .filter(([, actor]) => isGridCell(actor.position) && footprint.has(cellKey(actor.position)))
    .map(([actorId]) => actorId)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
