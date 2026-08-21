/**
 * Pure coordinate helpers for the tactical viewport.
 *
 * All coordinates in this module are CSS pixels except for grid coordinates
 * and native map coordinates. Keeping the conversion here means UI code never
 * has to reinterpret a mechanical grid position when the map or camera moves.
 * This module intentionally has no React or rules-engine dependency.
 */

/** A two-dimensional point in the named coordinate space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A (possibly fractional) coordinate measured in grid cells. */
export interface GridPoint extends Point {}

/** A discrete mechanical grid cell. */
export interface GridCell extends GridPoint {}

/** A point in the stable, unzoomed battlefield coordinate system. */
export interface WorldPoint extends Point {}

/** A point in the map image's native coordinate system. */
export interface MapPoint extends Point {}

/** A CSS-pixel point in the containing page or canvas. */
export interface ScreenPoint extends Point {}

/**
 * Grid calibration. `origin` is the world-space top-left corner of cell 0,0.
 * A grid coordinate maps to the top-left corner of its cell; use
 * `gridCellToWorldCenter` when positioning a token by its centre.
 */
export interface GridTransform {
  readonly cellSize: number;
  readonly origin?: WorldPoint;
}

/**
 * Calibration for the map image only. It deliberately does not alter grid or
 * token positions: it maps native image coordinates into stable world space.
 */
export interface MapCalibration {
  readonly scale: number;
  readonly offset: WorldPoint;
}

/**
 * Camera state for the viewport. `pan` is a CSS-pixel screen translation,
 * applied after zoom, so a pointer drag can be added directly to it.
 */
export interface CameraTransform {
  readonly pan: ScreenPoint;
  readonly zoom: number;
}

/**
 * The viewport's CSS-pixel rectangle. `x` and `y` make the helpers work with
 * client coordinates as well as a canvas-local viewport ({ x: 0, y: 0, … }).
 */
export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Shared inputs for world ↔ screen conversion. */
export interface WorldScreenTransform {
  readonly camera: CameraTransform;
  readonly viewport: ViewportRect;
}

/** Shared inputs for grid ↔ screen conversion. */
export interface GridScreenTransform extends WorldScreenTransform {
  readonly grid: GridTransform;
}

/** Shared inputs for map ↔ screen conversion. */
export interface MapScreenTransform extends WorldScreenTransform {
  readonly map: MapCalibration;
}

/** Complete presentation geometry for a tactical viewport. */
export interface TacticalViewportGeometry extends GridScreenTransform, MapScreenTransform {}

/** A world-space rectangle, useful for fitting a battlefield to a viewport. */
export interface WorldBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Mechanical grid dimensions, intentionally independent of EncounterState. */
export interface GridDimensions {
  readonly width: number;
  readonly height: number;
}

export interface FitBoundsOptions {
  /** CSS pixels reserved on each edge of the viewport. Defaults to 0. */
  readonly padding?: number;
  readonly minZoom?: number;
  readonly maxZoom?: number;
}

/** A conservative default for conversion and snapping comparisons. */
export const GEOMETRY_EPSILON = 1e-9;

export class GeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeometryError';
  }
}

const WORLD_ORIGIN: WorldPoint = { x: 0, y: 0 };

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new GeometryError(`${label} must be finite.`);
}

function assertPoint(point: Point, label: string): void {
  assertFinite(point.x, `${label}.x`);
  assertFinite(point.y, `${label}.y`);
}

function assertPositive(value: number, label: string): void {
  assertFinite(value, label);
  if (value <= 0) throw new GeometryError(`${label} must be greater than zero.`);
}

function assertNonNegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0) throw new GeometryError(`${label} cannot be negative.`);
}

function assertGridTransform(transform: GridTransform): void {
  assertPositive(transform.cellSize, 'grid.cellSize');
  assertPoint(transform.origin ?? WORLD_ORIGIN, 'grid.origin');
}

function assertMapCalibration(calibration: MapCalibration): void {
  assertPositive(calibration.scale, 'map.scale');
  assertPoint(calibration.offset, 'map.offset');
}

function assertCamera(camera: CameraTransform): void {
  assertPositive(camera.zoom, 'camera.zoom');
  assertPoint(camera.pan, 'camera.pan');
}

function assertViewport(viewport: ViewportRect): void {
  assertFinite(viewport.x, 'viewport.x');
  assertFinite(viewport.y, 'viewport.y');
  assertNonNegative(viewport.width, 'viewport.width');
  assertNonNegative(viewport.height, 'viewport.height');
}

function gridOrigin(transform: GridTransform): WorldPoint {
  return transform.origin ?? WORLD_ORIGIN;
}

/** Returns whether two values are equal within a floating-point tolerance. */
export function nearlyEqual(left: number, right: number, tolerance = GEOMETRY_EPSILON): boolean {
  assertFinite(left, 'left');
  assertFinite(right, 'right');
  assertNonNegative(tolerance, 'tolerance');
  return Math.abs(left - right) <= tolerance;
}

/** Returns whether two points are equal within a floating-point tolerance. */
export function pointsNearlyEqual(left: Point, right: Point, tolerance = GEOMETRY_EPSILON): boolean {
  assertPoint(left, 'left');
  assertPoint(right, 'right');
  return nearlyEqual(left.x, right.x, tolerance) && nearlyEqual(left.y, right.y, tolerance);
}

/** Converts a grid coordinate to the world-space top-left corner of its cell. */
export function gridToWorld(point: GridPoint, transform: GridTransform): WorldPoint {
  assertPoint(point, 'grid point');
  assertGridTransform(transform);
  const origin = gridOrigin(transform);
  return {
    x: origin.x + point.x * transform.cellSize,
    y: origin.y + point.y * transform.cellSize,
  };
}

/** Converts a world coordinate to a possibly fractional grid coordinate. */
export function worldToGrid(point: WorldPoint, transform: GridTransform): GridPoint {
  assertPoint(point, 'world point');
  assertGridTransform(transform);
  const origin = gridOrigin(transform);
  return {
    x: (point.x - origin.x) / transform.cellSize,
    y: (point.y - origin.y) / transform.cellSize,
  };
}

/** Converts a mechanical cell to the world-space centre of that cell. */
export function gridCellToWorldCenter(cell: GridCell, transform: GridTransform): WorldPoint {
  return gridToWorld({ x: cell.x + 0.5, y: cell.y + 0.5 }, transform);
}

function cellIndex(value: number, tolerance: number): number {
  const nearestInteger = Math.round(value);
  return nearlyEqual(value, nearestInteger, tolerance) ? nearestInteger : Math.floor(value);
}

/**
 * Finds the cell containing a world point. Values microscopically adjacent to
 * a cell boundary are snapped to that boundary before flooring.
 */
export function worldToGridCell(point: WorldPoint, transform: GridTransform, tolerance = GEOMETRY_EPSILON): GridCell {
  assertNonNegative(tolerance, 'tolerance');
  const grid = worldToGrid(point, transform);
  return {
    x: cellIndex(grid.x, tolerance),
    y: cellIndex(grid.y, tolerance),
  };
}

/** Maps an unscaled map-image point into stable world space. */
export function mapToWorld(point: MapPoint, calibration: MapCalibration): WorldPoint {
  assertPoint(point, 'map point');
  assertMapCalibration(calibration);
  return {
    x: calibration.offset.x + point.x * calibration.scale,
    y: calibration.offset.y + point.y * calibration.scale,
  };
}

/** Maps a stable world-space point back into the map image's native space. */
export function worldToMap(point: WorldPoint, calibration: MapCalibration): MapPoint {
  assertPoint(point, 'world point');
  assertMapCalibration(calibration);
  return {
    x: (point.x - calibration.offset.x) / calibration.scale,
    y: (point.y - calibration.offset.y) / calibration.scale,
  };
}

/** Returns the CSS-pixel centre of a viewport. */
export function viewportCenter(viewport: ViewportRect): ScreenPoint {
  assertViewport(viewport);
  return {
    x: viewport.x + viewport.width / 2,
    y: viewport.y + viewport.height / 2,
  };
}

/**
 * Converts world space to CSS-pixel screen space. The camera always looks at
 * world origin when its pan is `{ x: 0, y: 0 }`.
 */
export function worldToScreen(point: WorldPoint, transform: WorldScreenTransform): ScreenPoint {
  assertPoint(point, 'world point');
  assertCamera(transform.camera);
  const center = viewportCenter(transform.viewport);
  return {
    x: center.x + transform.camera.pan.x + point.x * transform.camera.zoom,
    y: center.y + transform.camera.pan.y + point.y * transform.camera.zoom,
  };
}

/** Converts CSS-pixel screen space back into stable world space. */
export function screenToWorld(point: ScreenPoint, transform: WorldScreenTransform): WorldPoint {
  assertPoint(point, 'screen point');
  assertCamera(transform.camera);
  const center = viewportCenter(transform.viewport);
  return {
    x: (point.x - center.x - transform.camera.pan.x) / transform.camera.zoom,
    y: (point.y - center.y - transform.camera.pan.y) / transform.camera.zoom,
  };
}

/** Converts a mechanical grid coordinate directly to CSS-pixel screen space. */
export function gridToScreen(point: GridPoint, transform: GridScreenTransform): ScreenPoint {
  return worldToScreen(gridToWorld(point, transform.grid), transform);
}

/** Converts CSS-pixel screen space to a possibly fractional grid coordinate. */
export function screenToGrid(point: ScreenPoint, transform: GridScreenTransform): GridPoint {
  return worldToGrid(screenToWorld(point, transform), transform.grid);
}

/** Converts a map-image point directly to CSS-pixel screen space. */
export function mapToScreen(point: MapPoint, transform: MapScreenTransform): ScreenPoint {
  return worldToScreen(mapToWorld(point, transform.map), transform);
}

/** Converts CSS-pixel screen space directly to a map-image coordinate. */
export function screenToMap(point: ScreenPoint, transform: MapScreenTransform): MapPoint {
  return worldToMap(screenToWorld(point, transform), transform.map);
}

/**
 * Returns a camera with a new zoom while keeping the world point beneath a
 * screen-space anchor stationary. Useful for wheel or pinch zooming.
 */
export function zoomCameraAtScreenPoint(
  camera: CameraTransform,
  viewport: ViewportRect,
  anchor: ScreenPoint,
  zoom: number,
): CameraTransform {
  assertCamera(camera);
  assertPoint(anchor, 'anchor');
  assertPositive(zoom, 'zoom');
  const worldAtAnchor = screenToWorld(anchor, { camera, viewport });
  const center = viewportCenter(viewport);
  return {
    zoom,
    pan: {
      x: anchor.x - center.x - worldAtAnchor.x * zoom,
      y: anchor.y - center.y - worldAtAnchor.y * zoom,
    },
  };
}

/** Adds a CSS-pixel drag delta to camera pan. */
export function panCameraBy(camera: CameraTransform, delta: ScreenPoint): CameraTransform {
  assertCamera(camera);
  assertPoint(delta, 'delta');
  return {
    ...camera,
    pan: { x: camera.pan.x + delta.x, y: camera.pan.y + delta.y },
  };
}

/** Returns the stable world-space bounds occupied by a rectangular grid. */
export function gridBoundsToWorld(dimensions: GridDimensions, transform: GridTransform): WorldBounds {
  assertNonNegative(dimensions.width, 'grid.width');
  assertNonNegative(dimensions.height, 'grid.height');
  assertGridTransform(transform);
  const origin = gridOrigin(transform);
  return {
    x: origin.x,
    y: origin.y,
    width: dimensions.width * transform.cellSize,
    height: dimensions.height * transform.cellSize,
  };
}

/**
 * Creates a camera that fits the supplied world bounds in a viewport. The
 * returned pan follows the screen-space pan convention used by this module.
 */
export function fitWorldBounds(bounds: WorldBounds, viewport: ViewportRect, options: FitBoundsOptions = {}): CameraTransform {
  assertFinite(bounds.x, 'bounds.x');
  assertFinite(bounds.y, 'bounds.y');
  assertPositive(bounds.width, 'bounds.width');
  assertPositive(bounds.height, 'bounds.height');
  assertViewport(viewport);
  assertPositive(viewport.width, 'viewport.width');
  assertPositive(viewport.height, 'viewport.height');

  const padding = options.padding ?? 0;
  assertNonNegative(padding, 'padding');
  const availableWidth = viewport.width - padding * 2;
  const availableHeight = viewport.height - padding * 2;
  assertPositive(availableWidth, 'viewport width after padding');
  assertPositive(availableHeight, 'viewport height after padding');

  const minZoom = options.minZoom ?? Number.MIN_VALUE;
  const maxZoom = options.maxZoom ?? Number.MAX_VALUE;
  assertPositive(minZoom, 'minZoom');
  assertPositive(maxZoom, 'maxZoom');
  if (minZoom > maxZoom) throw new GeometryError('minZoom cannot exceed maxZoom.');

  const fittedZoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
  const zoom = Math.min(maxZoom, Math.max(minZoom, fittedZoom));
  const boundsCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  return {
    zoom,
    pan: {
      x: -boundsCenter.x * zoom,
      y: -boundsCenter.y * zoom,
    },
  };
}

/** Fits a mechanical grid to a viewport using its world-space cell sizing. */
export function fitGridBounds(
  dimensions: GridDimensions,
  transform: GridTransform,
  viewport: ViewportRect,
  options: FitBoundsOptions = {},
): CameraTransform {
  return fitWorldBounds(gridBoundsToWorld(dimensions, transform), viewport, options);
}

/** Converts a CSS-pixel point to a physical-device-pixel point for canvas use. */
export function cssPixelsToDevicePixels(point: ScreenPoint, devicePixelRatio: number): ScreenPoint {
  assertPoint(point, 'CSS pixel point');
  assertPositive(devicePixelRatio, 'devicePixelRatio');
  return { x: point.x * devicePixelRatio, y: point.y * devicePixelRatio };
}

/** Converts a physical-device-pixel point back to CSS-pixel screen space. */
export function devicePixelsToCssPixels(point: ScreenPoint, devicePixelRatio: number): ScreenPoint {
  assertPoint(point, 'device pixel point');
  assertPositive(devicePixelRatio, 'devicePixelRatio');
  return { x: point.x / devicePixelRatio, y: point.y / devicePixelRatio };
}
