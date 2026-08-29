import { describe, expect, it } from 'vitest';
import { validateLine } from '../area-geometry.js';

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