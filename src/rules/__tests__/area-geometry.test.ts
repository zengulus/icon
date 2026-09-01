import { describe, expect, it } from 'vitest';
import { areaHasCellWithinRange, sameCell, squareArea, validateLine } from '../area-geometry.js';

/**
 * ICON p.97: a Line X is X spaces long, orthogonal only, and each successive
 * space must be further from the line's origin (its first space) than the
 * previous one. `validateLine` is the single authority for that geometry.
 */
describe('validateLine (ICON p.97 canonical Line geometry)', () => {
  it('accepts a straight orthogonal line strictly further from the origin', () => {
    const line = validateLine([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 3);
    expect(line).not.toBeNull();
    expect(line!.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  });

  it('rejects an L-shaped three-cell path (not monotone from the origin)', () => {
    // (0,0) -> (1,0) -> (1,1): the final space is orthogonally adjacent but not
    // strictly further from the origin (origin-dist 1 == 1) — an L-turn.
    expect(validateLine([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 3)).toBeNull();
  });

  it('rejects backtracking (revisits a prior space)', () => {
    expect(validateLine([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }], 3)).toBeNull();
  });

  it('rejects a duplicate / repeated cell', () => {
    expect(validateLine([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }], 3)).toBeNull();
    expect(validateLine([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 1 }], 3)).toBeNull();
  });

  it('rejects a diagonal step (not orthogonally contiguous)', () => {
    expect(validateLine([{ x: 0, y: 0 }, { x: 1, y: 1 }], 2)).toBeNull();
  });

  it('rejects wrong-length paths', () => {
    expect(validateLine([{ x: 0, y: 0 }, { x: 1, y: 0 }], 3)).toBeNull();
    expect(validateLine([{ x: 0, y: 0 }], 2)).toBeNull();
  });
});

/**
 * ICON p.97 area-placement rule: an AoE pattern with a listed range may be
 * placed in ANY configuration so long as AT LEAST ONE of its spaces is within
 * the listed range of the origin — never "the center must be in range".
 * `areaHasCellWithinRange` is the single pure-geometry authority for that
 * placement legality check.
 */
describe('areaHasCellWithinRange (ICON p.97 at-least-one-cell placement)', () => {
  it('a blast whose CENTER is out of range is still legal when one of its cells is in range', () => {
    // A small blast centered 4 away from the origin: the center is beyond
    // range 3, but its nearest edge cells sit at Chebyshev 3 → legal.
    const legal = areaHasCellWithinRange(squareArea({ x: 4, y: 0 }, 1), { x: 0, y: 0 }, 3);
    expect(legal).toBe(true);
    // The old center-distance rule is wrong: distance(origin, center) = 4 > 3.
    expect(Math.max(Math.abs(4 - 0), Math.abs(0 - 0))).toBe(4);
  });

  it('an area whose EVERY cell is beyond range is rejected', () => {
    const outOfRange = areaHasCellWithinRange(squareArea({ x: 5, y: 0 }, 1), { x: 0, y: 0 }, 3);
    expect(outOfRange).toBe(false); // nearest cell (4,0) is Chebyshev 4 away
  });

  it('an area touching the range boundary exactly is legal', () => {
    expect(areaHasCellWithinRange(squareArea({ x: 3, y: 0 }, 1), { x: 0, y: 0 }, 3)).toBe(true);
    expect(areaHasCellWithinRange(squareArea({ x: 4, y: 1 }, 1), { x: 0, y: 0 }, 3)).toBe(true); // (3,1) is exactly 3
  });

  it('the origin itself counts as a cell inside any area containing it', () => {
    expect(areaHasCellWithinRange(squareArea({ x: 0, y: 0 }, 2), { x: 0, y: 0 }, 3)).toBe(true);
    expect(areaHasCellWithinRange([{ x: 0, y: 0 }], { x: 0, y: 0 }, 0)).toBe(true);
  });

  it('a large footprint is legal if ANY of its cells qualifies — identity never matters', () => {
    const medium = squareArea({ x: 6, y: 4 }, 2); // the whole (4,2)..(8,6) pattern
    // The nearest cell (4,2) is Chebyshev 4 from the origin: range 3 rejects
    // the whole area, range 4 admits it — the cell, never the center.
    expect(areaHasCellWithinRange(medium, { x: 0, y: 0 }, 3)).toBe(false);
    expect(areaHasCellWithinRange(medium, { x: 0, y: 0 }, 4)).toBe(true);
  });

  it('the pattern is consulted as a SET — a single qualifying cell is enough', () => {
    const cells = [{ x: 9, y: 9 }, { x: 1, y: 0 }];
    expect(areaHasCellWithinRange(cells, { x: 0, y: 0 }, 1)).toBe(true);
    expect(cells.some((cell) => sameCell(cell, { x: 1, y: 0 }))).toBe(true);
  });
});