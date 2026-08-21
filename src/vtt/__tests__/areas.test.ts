import { describe, expect, it } from 'vitest';
import {
  AREA_TEMPLATE_ROTATIONS,
  AreaTemplateGeometryError,
  actorCellsInAreaTemplate,
  actorIdsInAreaTemplate,
  actorsInAreaTemplate,
  areaTemplateBounds,
  areaTemplateCells,
  areaTemplateCellsInBounds,
  areaTemplateContainsCell,
  areaTemplateDirection,
  isAreaTemplateFullyInBounds,
  isAreaTemplateRotation,
  isGridCellInBounds,
  normalizeAreaTemplateGeometry,
  normalizeAreaTemplateRotation,
  type AreaTemplateGeometry,
} from '../areas.js';

function template(overrides: Partial<AreaTemplateGeometry> = {}): AreaTemplateGeometry {
  return {
    kind: 'line',
    origin: { x: 4, y: 4 },
    rotation: 0,
    length: 3,
    width: 1,
    ...overrides,
  };
}

describe('square-grid area template geometry', () => {
  it('uses canonical eighth-turn rotations and integer origins', () => {
    expect(AREA_TEMPLATE_ROTATIONS).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(normalizeAreaTemplateRotation(-45)).toBe(315);
    expect(normalizeAreaTemplateRotation(405)).toBe(45);
    expect(areaTemplateDirection(90)).toEqual({ x: 0, y: 1 });
    expect(isAreaTemplateRotation(315)).toBe(true);
    expect(isAreaTemplateRotation(30)).toBe(false);

    expect(normalizeAreaTemplateGeometry(template({ rotation: 360 }))).toEqual(template({ rotation: 0 }));
    expect(() => areaTemplateCells(template({ rotation: 30 }))).toThrow(AreaTemplateGeometryError);
    expect(() => areaTemplateCells(template({ origin: { x: 1.5, y: 2 } }))).toThrow('safe integer');
    expect(() => areaTemplateCells(template({ length: 101 }))).toThrow('cannot exceed 100');
    expect(() => areaTemplateCells(template({ origin: { x: Number.MAX_SAFE_INTEGER, y: 0 }, length: 2 }))).toThrow('generated area cell');
  });

  it('maps a burst to its square-grid radial footprint', () => {
    const burst = template({ kind: 'burst', origin: { x: 4, y: 7 }, rotation: 225, length: 1, width: 99 });

    expect(areaTemplateCells(burst)).toEqual([
      { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 },
      { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 },
      { x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 },
    ]);
    expect(areaTemplateBounds(burst)).toEqual({ min: { x: 3, y: 6 }, max: { x: 5, y: 8 }, width: 3, height: 3 });
    expect(areaTemplateContainsCell(burst, { x: 5, y: 8 })).toBe(true);
    expect(areaTemplateContainsCell(burst, { x: 6, y: 8 })).toBe(false);
  });

  it('creates a discrete cone with an apex, interpolated rows, and exact base width', () => {
    const cone = template({ kind: 'cone', origin: { x: 5, y: 5 }, rotation: 0, length: 3, width: 5 });

    expect(areaTemplateCells(cone)).toEqual([
      { x: 7, y: 3 },
      { x: 6, y: 4 }, { x: 7, y: 4 },
      { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 },
      { x: 6, y: 6 }, { x: 7, y: 6 },
      { x: 7, y: 7 },
    ]);
    expect(areaTemplateCells(template({ kind: 'cone', origin: { x: 3, y: 3 }, rotation: 180, length: 1, width: 9 }))).toEqual([{ x: 3, y: 3 }]);
  });

  it('rotates lines through cardinal and diagonal square-grid directions', () => {
    const southLine = template({ kind: 'line', origin: { x: 4, y: 4 }, rotation: 90, length: 3, width: 2 });
    const northEastLine = template({ kind: 'line', origin: { x: 4, y: 4 }, rotation: 315, length: 3, width: 1 });

    expect(areaTemplateCells(southLine)).toEqual([
      { x: 3, y: 4 }, { x: 4, y: 4 },
      { x: 3, y: 5 }, { x: 4, y: 5 },
      { x: 3, y: 6 }, { x: 4, y: 6 },
    ]);
    expect(areaTemplateCells(northEastLine)).toEqual([
      { x: 6, y: 2 }, { x: 5, y: 3 }, { x: 4, y: 4 },
    ]);
  });

  it('uses an anchored corner for rectangles, so their position is deterministic at every rotation', () => {
    const rectangle = template({ kind: 'rectangle', origin: { x: 3, y: 3 }, rotation: 270, length: 2, width: 3 });

    expect(areaTemplateCells(rectangle)).toEqual([
      { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 },
      { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
    ]);
    expect(areaTemplateBounds(rectangle)).toEqual({ min: { x: 3, y: 2 }, max: { x: 5, y: 3 }, width: 3, height: 2 });
  });

  it('clips and validates visual footprints against an encounter-style board without changing the template', () => {
    const edgeLine = template({ kind: 'line', origin: { x: 3, y: 1 }, rotation: 0, length: 3, width: 1 });
    const board = { width: 5, height: 4 };

    expect(isGridCellInBounds({ x: 4, y: 3 }, board)).toBe(true);
    expect(isGridCellInBounds({ x: 5, y: 3 }, board)).toBe(false);
    expect(areaTemplateCellsInBounds(edgeLine, board)).toEqual([{ x: 3, y: 1 }, { x: 4, y: 1 }]);
    expect(isAreaTemplateFullyInBounds(edgeLine, board)).toBe(false);
    expect(edgeLine.origin).toEqual({ x: 3, y: 1 });
  });

  it('identifies candidate actor cells without asserting a mechanical target result', () => {
    const area = template({ kind: 'rectangle', origin: { x: 1, y: 1 }, rotation: 0, length: 2, width: 2 });
    const actors = [
      { id: 'bravo', position: { x: 2, y: 1 } },
      { id: 'outside', position: { x: 3, y: 1 } },
      { id: 'alpha', position: { x: 1, y: 2 } },
    ];

    expect(actorsInAreaTemplate(area, actors).map(({ id }) => id)).toEqual(['bravo', 'alpha']);
    expect(actorCellsInAreaTemplate(area, [
      { actor: 'multi-cell token', position: { x: 1, y: 1 } },
      { actor: 'multi-cell token', position: { x: 3, y: 1 } },
      { actor: 'outside', position: { x: 9, y: 9 } },
    ])).toEqual([{ actor: 'multi-cell token', position: { x: 1, y: 1 } }]);
    expect(actorIdsInAreaTemplate(area, Object.fromEntries(actors.map((actor) => [actor.id, actor])))).toEqual(['alpha', 'bravo']);
  });
});
