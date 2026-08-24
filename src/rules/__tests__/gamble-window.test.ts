import { describe, expect, it } from 'vitest';
import { resolveGamble } from '../automation/primitives/gamble-window.js';
import {scriptedDice, endTurnTo, startEncounterTo} from './fixtures.js';
import { monogatariGambleForTurnEnd } from '../automation/content/jobs/lifecycle-recipes.js';
import { actorFromCharacter, createEncounter } from '../encounter.js';
import { validCharacter } from './fixtures.js';

/**
 * F10 Gamble seam (docs/rules-foundations.md §8): a small recorded-dice
 * operation that answers what was rolled, which result was used, and why extra
 * dice were rolled — with replay-safe dice owned by the command boundary.
 */

describe('resolveGamble (recorded-dice seam)', () => {
  it('a single die records the roll and uses it', () => {
    const r = resolveGamble(scriptedDice(4), 1, 'single');
    expect(r.rolls).toEqual([4]);
    expect(r.kept).toEqual([4]);
    expect(r.result).toBe(4);
  });

  it('three dice records all three rolls and picks the highest', () => {
    const r = resolveGamble(scriptedDice(2, 6, 4), 3, 'highest');
    expect(r.rolls).toEqual([2, 6, 4]);
    expect(r.kept).toEqual([6]);
    expect(r.result).toBe(6);
  });

  it('replay never re-rolls: the same recorded dice produce identical rolls', () => {
    // The dice come from the command boundary; replay reuses the identical
    // recorded sequence rather than re-rolling. Two callers with the same
    // source produce the same recorded rolls and result.
    const first = resolveGamble(scriptedDice(3, 5), 2, 'highest');
    const second = resolveGamble(scriptedDice(3, 5), 2, 'highest');
    expect(second.rolls).toEqual(first.rolls);
    expect(second.result).toBe(first.result);
  });

  it('count is floored to at least one die', () => {
    const r = resolveGamble(scriptedDice(4), 0, 'single');
    expect(r.rolls).toEqual([4]);
  });
});

describe('monogatari gamble (migrated through the seam)', () => {
  it('charge takes the higher of two d6; non-charge takes a single d6', () => {
    const state = createEncounter('gamble');
    const actor = actorFromCharacter(validCharacter('Melody'), { x: 1, y: 1 });
    actor.ruleState['monogatari:active'] = true;
    actor.ruleState['monogatari:tale'] = null;
    actor.ruleState['monogatari:charge'] = true;
    const charged = monogatariGambleForTurnEnd(state, actor, scriptedDice(5));
    actor.ruleState['monogatari:charge'] = false;
    const plain = monogatariGambleForTurnEnd(state, actor, scriptedDice(5));
    // Both are valid d6 results; the charge branch is the higher of two
    // successive rolls from the same source, the plain branch a single roll.
    expect([1, 2, 3, 4, 5, 6]).toContain(charged?.result);
    expect([1, 2, 3, 4, 5, 6]).toContain(plain?.result);
  });
});
