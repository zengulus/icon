import { describe, expect, it } from 'vitest';
import { rollBoonOrCurse, rollDamage, rollNarrativeAction } from '../dice.js';
import { scriptedDice } from './fixtures.js';

describe('ICON dice', () => {
  it('rolls 2d6 and keeps the lowest at zero narrative dice', () => {
    expect(rollNarrativeAction(0, 0, scriptedDice(6, 2))).toEqual({
      dice: [6, 2],
      kept: 2,
      result: 'failure',
      zeroRating: true,
    });
  });

  it('recognizes a narrative critical from two sixes', () => {
    expect(rollNarrativeAction(3, 0, scriptedDice(6, 4, 6)).result).toBe('critical');
  });

  it('caps boons and curses at two and keeps the highest d6', () => {
    expect(rollBoonOrCurse(5, scriptedDice(2, 5))).toEqual({ rolls: [2, 5], modifier: 5 });
    expect(rollBoonOrCurse(-4, scriptedDice(3, 6))).toEqual({ rolls: [3, 6], modifier: -6 });
  });

  it('uses bonus damage dice by keeping the highest required dice', () => {
    expect(rollDamage(6, 2, 1, scriptedDice(2, 6, 4))).toEqual({ rolls: [2, 6, 4], kept: [6, 4], total: 10 });
  });
});
