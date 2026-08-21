import { describe, expect, it } from 'vitest';
import {
  cssPixelsToDevicePixels,
  devicePixelsToCssPixels,
  fitGridBounds,
  gridCellToWorldCenter,
  gridToScreen,
  gridToWorld,
  mapToScreen,
  mapToWorld,
  nearlyEqual,
  pointsNearlyEqual,
  screenToGrid,
  screenToMap,
  screenToWorld,
  worldToGrid,
  worldToGridCell,
  worldToMap,
  worldToScreen,
  zoomCameraAtScreenPoint,
  type CameraTransform,
  type GridTransform,
  type MapCalibration,
  type TacticalViewportGeometry,
  type ViewportRect,
} from '../geometry.js';

const grid: GridTransform = {
  cellSize: 37.5,
  origin: { x: 12.25, y: -19.5 },
};

const map: MapCalibration = {
  scale: 1.45,
  offset: { x: -73.5, y: 29.25 },
};

const viewport: ViewportRect = {
  x: 123.75,
  y: -48.5,
  width: 991.25,
  height: 615.5,
};

const camera: CameraTransform = {
  pan: { x: -37.75, y: 81.25 },
  zoom: 1.375,
};

const geometry: TacticalViewportGeometry = { grid, map, viewport, camera };

describe('tactical viewport geometry', () => {
  it('round-trips grid coordinates through world space with non-default cell sizing', () => {
    const mechanicalCell = { x: 4, y: 7 };
    const world = gridToWorld(mechanicalCell, grid);

    expect(world).toEqual({ x: 162.25, y: 243 });
    expect(worldToGrid(world, grid)).toEqual(mechanicalCell);
    expect(gridCellToWorldCenter(mechanicalCell, grid)).toEqual({ x: 181, y: 261.75 });
  });

  it('handles floating-point drift when finding the mechanical cell for a world point', () => {
    const boundary = gridToWorld({ x: 4, y: 7 }, grid);
    const drifted = { x: boundary.x - 1e-10, y: boundary.y + 1e-10 };

    expect(worldToGridCell(drifted, grid)).toEqual({ x: 4, y: 7 });
    expect(pointsNearlyEqual(worldToGrid(drifted, grid), { x: 4, y: 7 }, 1e-9)).toBe(true);
    expect(nearlyEqual(0.3 - 0.2, 0.1)).toBe(true);
  });

  it('round-trips world and screen coordinates with arbitrary viewport, zoom, and pan', () => {
    const world = { x: -183.125, y: 407.875 };
    const screen = worldToScreen(world, { viewport, camera });

    expect(screen).toEqual({ x: 329.828125, y: 901.328125 });
    expect(pointsNearlyEqual(screenToWorld(screen, { viewport, camera }), world)).toBe(true);
  });

  it('calibrates map image coordinates independently with scale and non-zero offset', () => {
    const mapPoint = { x: 364.25, y: -18.5 };
    const world = mapToWorld(mapPoint, map);

    expect(pointsNearlyEqual(world, { x: 454.6625, y: 2.425 })).toBe(true);
    expect(pointsNearlyEqual(worldToMap(world, map), mapPoint)).toBe(true);
    expect(pointsNearlyEqual(screenToMap(mapToScreen(mapPoint, geometry), geometry), mapPoint)).toBe(true);
  });

  it('keeps a mechanical grid coordinate stable while map calibration changes', () => {
    const mechanicalCell = { x: 4, y: 7 };
    const calibrated: TacticalViewportGeometry = {
      ...geometry,
      map: { scale: 2.75, offset: { x: 901.5, y: -321.25 } },
    };

    expect(gridToScreen(mechanicalCell, geometry)).toEqual(gridToScreen(mechanicalCell, calibrated));
    expect(screenToGrid(gridToScreen(mechanicalCell, calibrated), calibrated)).toEqual(mechanicalCell);
  });

  it('preserves a world and grid coordinate across a viewport resize', () => {
    const world = gridToWorld({ x: 4, y: 7 }, grid);
    const resized: ViewportRect = { x: -210.5, y: 87.25, width: 1_744.5, height: 923.75 };
    const originalScreen = worldToScreen(world, { viewport, camera });
    const resizedScreen = worldToScreen(world, { viewport: resized, camera });

    expect(resizedScreen.x - originalScreen.x).toBeCloseTo((resized.x + resized.width / 2) - (viewport.x + viewport.width / 2));
    expect(resizedScreen.y - originalScreen.y).toBeCloseTo((resized.y + resized.height / 2) - (viewport.y + viewport.height / 2));
    expect(pointsNearlyEqual(screenToWorld(resizedScreen, { viewport: resized, camera }), world)).toBe(true);
    expect(screenToGrid(resizedScreen, { grid, viewport: resized, camera })).toEqual({ x: 4, y: 7 });
  });

  it('keeps a pointer anchor fixed when zoom changes', () => {
    const anchor = { x: 637.125, y: 142.875 };
    const nextCamera = zoomCameraAtScreenPoint(camera, viewport, anchor, 2.625);
    const worldBefore = screenToWorld(anchor, { viewport, camera });

    expect(pointsNearlyEqual(screenToWorld(anchor, { viewport, camera: nextCamera }), worldBefore)).toBe(true);
  });

  it('fits a grid and round-trips through device pixels without changing the selected cell', () => {
    const fit = fitGridBounds({ width: 10, height: 8 }, grid, viewport, { padding: 24 });
    const center = gridCellToWorldCenter({ x: 4, y: 7 }, grid);
    const screen = worldToScreen(center, { viewport, camera: fit });
    const devicePoint = cssPixelsToDevicePixels(screen, 2.5);
    const cssPoint = devicePixelsToCssPixels(devicePoint, 2.5);

    expect(fit.zoom).toBeCloseTo(1.8916666666666666);
    expect(pointsNearlyEqual(cssPoint, screen)).toBe(true);
    expect(worldToGridCell(screenToWorld(cssPoint, { viewport, camera: fit }), grid)).toEqual({ x: 4, y: 7 });
  });
});
