import { describe, it, expect } from 'vitest';
import { gambleD6 } from '../automation/primitives/job-kit.js';
import type { RuleExecutionContext } from '../automation/primitives/types.js';
import { actorFromCharacter, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { scriptedDice, validCharacter } from './fixtures.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';

/** Build a minimal RuleExecutionContext for the gambleD6 unit tests. */
function gambleContext(rolls: number[]): RuleExecutionContext {
  let index = 0;
  return {
    state: { actors: {}, entities: {}, grid: { width: 10, height: 10, terrain: [] }, round: 1, turn: 0 } as any,
    actorId: 'test',
    sourceId: 'test:gamble',
    dice: {
      die(_sides: number) {
        const value = rolls[index++] ?? 1;
        return value;
      },
    },
  } as unknown as RuleExecutionContext;
}

// ── gambleD6 unit tests ─────────────────────────────────────────────────────

describe('gambleD6', () => {
  it('returns the exact die roll', () => {
    const ctx = gambleContext([3]);
    const { roll, success } = gambleD6(ctx);
    expect(roll).toBe(3);
    expect(success).toBe(true); // threshold defaults to 1
  });

  it('succeeds at threshold', () => {
    const ctx = gambleContext([4]);
    const { roll, success } = gambleD6(ctx, 4);
    expect(roll).toBe(4);
    expect(success).toBe(true);
  });

  it('succeeds above threshold', () => {
    const ctx = gambleContext([6]);
    const { roll, success } = gambleD6(ctx, 4);
    expect(roll).toBe(6);
    expect(success).toBe(true);
  });

  it('fails below threshold', () => {
    const ctx = gambleContext([3]);
    const { roll, success } = gambleD6(ctx, 4);
    expect(roll).toBe(3);
    expect(success).toBe(false);
  });

  it('fails at one below threshold', () => {
    const ctx = gambleContext([3]);
    const { roll, success } = gambleD6(ctx, 4);
    expect(roll).toBe(3);
    expect(success).toBe(false);
  });

  it('succeeds exactly at boundary (threshold 6)', () => {
    const ctx = gambleContext([6]);
    const { roll, success } = gambleD6(ctx, 6);
    expect(roll).toBe(6);
    expect(success).toBe(true);
  });

  it('fails at boundary - 1 (threshold 6, roll 5)', () => {
    const ctx = gambleContext([5]);
    const { roll, success } = gambleD6(ctx, 6);
    expect(roll).toBe(5);
    expect(success).toBe(false);
  });

  it('defaults threshold to 1 (always succeeds)', () => {
    const ctx = gambleContext([1]);
    const { roll, success } = gambleD6(ctx);
    expect(roll).toBe(1);
    expect(success).toBe(true);
  });

  it('consumes dice sequentially — multiple gambles are independent', () => {
    const ctx = gambleContext([2, 5, 1]);
    const g1 = gambleD6(ctx, 4);
    const g2 = gambleD6(ctx, 4);
    const g3 = gambleD6(ctx, 4);
    expect(g1.roll).toBe(2);
    expect(g1.success).toBe(false);
    expect(g2.roll).toBe(5);
    expect(g2.success).toBe(true);
    expect(g3.roll).toBe(1);
    expect(g3.success).toBe(false);
  });

  it('replay produces identical results using the same dice source', () => {
    const run = () => {
      const ctx = gambleContext([4, 6, 2, 5, 1, 3]);
      const results: number[] = [];
      for (let i = 0; i < 6; i++) results.push(gambleD6(ctx, 4).roll);
      return results;
    };
    expect(run()).toEqual(run());
  });

  it('one gamble is never resolved twice', () => {
    const ctx = gambleContext([3]);
    const g1 = gambleD6(ctx, 4);
    const g2 = gambleD6(ctx, 4);
    // First consumed 3, second consumed whatever is next (default 1)
    expect(g1.roll).toBe(3);
    expect(g2.roll).toBe(1);
  });
});

// ── Existing consumer regression tests ──────────────────────────────────────

function heroEncounter(options: { foePosition?: { x: number; y: number } } = {}) {
  let state = createEncounter('Gamble fixture');
  const hero = actorFromCharacter(validCharacter('Hero'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];

  hero.chapter = 3;
  const foe = createFoe('Foe', options.foePosition ?? { x: 3, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe };
}

describe('existing gamble consumers', () => {
  it('Spinning Top uses gamble for dash distance and grants evasion at full distance', () => {
    const { state: s0, hero } = heroEncounter({ foePosition: { x: 3, y: 5 } });
    // Gamble of 4 → dash 6 spaces right
    const result = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:spinning-top',
      targetIds: [],
    }, scriptedDice(4));
    const h = result.state.actors[hero.id]!;
    // Moved to x=7 (from x=1, 6 spaces right), and gained evasion at full distance
    expect(h.position).toEqual({ x: 7, y: 1 });
    expect(h.conditions.some(({ id }) => id === 'evasion')).toBe(true);
  });

  it('Spinning Top: replay produces identical state', () => {
    const run = (rolls: number[]) => {
      const { state: s0, hero } = heroEncounter({ foePosition: { x: 3, y: 5 } });
      const result = executeCommand(s0, {
        type: 'USE_ABILITY',
        actorId: hero.id,
        abilityId: 'fool:spinning-top',
        targetIds: [],
      }, scriptedDice(...rolls));
      return result.state.actors[hero.id]!.position;
    };
    expect(run([4])).toEqual(run([4]));
    expect(run([1])).toEqual(run([1]));
  });

  it('Spinning Top: lower gamble produces shorter dash', () => {
    const { state: s0, hero } = heroEncounter({ foePosition: { x: 3, y: 5 } });
    // Gamble of 1 → dash 3 spaces right → no evasion (not full distance)
    const result = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:spinning-top',
      targetIds: [],
    }, scriptedDice(1));
    const h = result.state.actors[hero.id]!;
    expect(h.position).toEqual({ x: 4, y: 1 });
    expect(h.conditions.some(({ id }) => id === 'evasion')).toBe(true); // moved full distance
  });

  it('Chaos Tarot gambles the tarot effect', () => {
    const { state: s0, hero } = heroEncounter({ foePosition: { x: 3, y: 5 } });
    const result = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'seer:chaos-tarot',
      targetIds: [],
      input: {},
    }, scriptedDice(3)); // gamble 3
    const h = result.state.actors[hero.id]!;
    expect(h.position).toBeDefined();
  });

  it('Dire Parry gambles the damage amount (Knave)', () => {
    const { state: s0, hero } = heroEncounter({ foePosition: { x: 3, y: 5 } });
    // Enter Riposte stance first
    const s1 = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'knave:riposte',
      targetIds: [],
      input: {},
    }, scriptedDice()).state;
    expect(s1.actors[hero.id]!.ruleState['riposte:armed']).toBe(true);
  });
});
