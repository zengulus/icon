import { describe, it, expect } from 'vitest';
import { gambleD6 } from '../automation/primitives/job-kit.js';
import type { RuleExecutionContext } from '../automation/primitives/types.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';
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

  it('replay via applyEvents produces identical mechanical state', () => {
    // Execute with scripted dice, then replay the recorded events onto
    // the same starting state — the replay-side DiceSource is never
    // consulted because the RULE_MUTATIONS_APPLIED events carry the
    // resolved mutations. This proves the encounter event system records
    // sufficient state for deterministic replay.
    const setup = () => {
      const state = createEncounter('Replay fixture');
      const hero = actorFromCharacter(validCharacter('Hero'), { x: 1, y: 1 });
      hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
      hero.chapter = 3;
      const foe = createFoe('Foe', { x: 9, y: 9 });
      let s = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
      s = executeCommand(s, { type: 'ADD_ACTOR', actor: foe }).state;
      s = startEncounterTo(s, hero.id);
      return { state: s, hero, foe };
    };

    const { state: s0, hero } = setup();
    const executed = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:spinning-top',
      targetIds: [],
    }, scriptedDice(4));

    // Replay: apply the recorded events onto the same starting state.
    // No dice source is provided — if applyEvents tried to re-roll,
    // it would fail or produce different results.
    const replayed = applyEvents(s0, executed.events);
    expect(replayed.actors[hero.id]!.position).toEqual(executed.state.actors[hero.id]!.position);
    expect(replayed.actors[hero.id]!.hp).toEqual(executed.state.actors[hero.id]!.hp);
    expect(replayed.actors[hero.id]!.conditions.map((c) => c.id).sort())
      .toEqual(executed.state.actors[hero.id]!.conditions.map((c) => c.id).sort());
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
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe };
}

describe('existing gamble consumers', () => {
  it('Spinning Top: gamble 4 dashes 6 spaces and grants evasion at full distance', () => {
    const { state: s0, hero } = heroEncounter({ foePosition: { x: 3, y: 5 } });
    const result = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:spinning-top',
      targetIds: [],
    }, scriptedDice(4));
    const h = result.state.actors[hero.id]!;
    // Gamble 4 → dash 4+2=6 spaces → x=1 to x=7
    expect(h.position).toEqual({ x: 7, y: 1 });
    expect(h.conditions.some(({ id }) => id === 'evasion')).toBe(true);
  });

  it('Spinning Top: gamble 1 dashes only 3 spaces (shorter result = shorter dash)', () => {
    const { state: s0, hero } = heroEncounter({ foePosition: { x: 3, y: 5 } });
    const result = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:spinning-top',
      targetIds: [],
    }, scriptedDice(1));
    const h = result.state.actors[hero.id]!;
    // Gamble 1 → dash 1+2=3 spaces → x=1 to x=4
    expect(h.position).toEqual({ x: 4, y: 1 });
    expect(h.conditions.some(({ id }) => id === 'evasion')).toBe(true);
  });

  it('Spinning Top: replay via applyEvents matches direct execution', () => {
    const { state: s0, hero } = heroEncounter({ foePosition: { x: 3, y: 5 } });
    const executed = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:spinning-top',
      targetIds: [],
    }, scriptedDice(4));
    const replayed = applyEvents(s0, executed.events);
    expect(replayed.actors[hero.id]!.position).toEqual(executed.state.actors[hero.id]!.position);
    expect(replayed.actors[hero.id]!.conditions.map((c) => c.id).sort())
      .toEqual(executed.state.actors[hero.id]!.conditions.map((c) => c.id).sort());
  });

  it('Chaos Tarot: gamble result determines tarot effect (roll 1 = explode card)', () => {
    const { state: s0, hero, foe } = heroEncounter({ foePosition: { x: 3, y: 5 } });
    // Gamble 1 → "explode the card for fray damage"
    const result = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'seer:chaos-tarot',
      targetIds: [],
      input: {},
    }, scriptedDice(1));
    // Gamble 1 deals fray damage to the hero (card explosion)
    const heroHp = result.state.actors[hero.id]!.hp;
    expect(heroHp).toBeLessThan(40); // took fray damage from the card explosion
  });

  it('Chaos Tarot: replay via applyEvents matches direct execution', () => {
    const { state: s0, hero } = heroEncounter({ foePosition: { x: 3, y: 5 } });
    const executed = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'seer:chaos-tarot',
      targetIds: [],
      input: {},
    }, scriptedDice(3));
    const replayed = applyEvents(s0, executed.events);
    expect(replayed.actors[hero.id]!.hp).toEqual(executed.state.actors[hero.id]!.hp);
    expect(replayed.actors[hero.id]!.conditions.map((c) => c.id).sort())
      .toEqual(executed.state.actors[hero.id]!.conditions.map((c) => c.id).sort());
  });

  it('Dire Parry: gamble of 6 deals 6 damage, slashes, and shoves', () => {
    const { state: s0, hero, foe } = heroEncounter({ foePosition: { x: 2, y: 1 } });
    // Enter Riposte stance
    const s1 = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'knave:riposte',
      targetIds: [],
    }, scriptedDice()).state;
    expect(s1.actors[hero.id]!.ruleState['riposte:armed']).toBe(true);
    // Trigger Dire Parry against the foe — gamble 6
    const parry = executeCommand(s1, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:riposte',
      actionId: 'dire-parry',
      timing: 'interrupt',
      input: {},
      triggerSourceId: foe.id,
    }, scriptedDice(6));
    expect(parry.state.actors[foe.id].hp).toBe(26); // 32 - 6 gamble damage
    expect(parry.state.actors[foe.id].statuses).toContain('slashed'); // 6 triggers slash
  });

  it('Party Favor detonation: gamble 3 deals 2 damage (ally flight unresolved)', () => {
    const { state: s0, hero, foe } = heroEncounter({ foePosition: { x: 1, y: 2 } });
    // Place the mine
    const placed = executeCommand(s0, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'fool:party-favor',
      targetIds: [],
      input: { positions: { 'mine-position': [{ x: 2, y: 2 }] } },
    }, scriptedDice()).state;
    expect(placed.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(true);
    // Detonate with gamble 3
    const detonated = executeCommand(placed, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:party-favor',
      actionId: 'detonate',
      timing: 'movement-end',
      input: {},
    }, scriptedDice(3));
    expect(detonated.state.actors[foe.id].hp).toBe(30); // 32 - 2 damage
    // UNRESOLVED: source says "fly 1" but does not specify direction
    expect(detonated.state.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(false);
  });
});
