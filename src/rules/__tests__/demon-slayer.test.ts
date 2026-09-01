import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS, EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { findAbility, JOBS } from '../catalog.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnOnly, endTurnTo, startEncounterTo, interruptUses, interruptUsedThisTurn} from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Demon Slayer
 * ability set (ICON p.128–130). Every scenario resolves through the shared
 * encounter reducer, and every accepted command must replay to the exact same
 * state through applyEvents.
 *
 * Mutation order documents the deterministic VM pipeline: action costs are
 * emitted first, then named-resolver effects, then step effects (attack roll
 * before its damage), matching the order executeRuleProgram produces.
 *
 * AoE attack semantics (ICON p.95 + part E of the trigger/AoE repair): the
 * character in the attack space takes the ATTACK component instead of the
 * area effect; every other character in the area — allies and foes alike —
 * takes the source's unrestricted "Area effect". Draken Cross's base Effect
 * is REQUIRED (only the rush is optional), its areas need the player's
 * recorded centers and elected rush directions, and the areas cannot overlap.
 */

interface DemonSlayerFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor;
  ally: EncounterActor;
}

function demonSlayerEncounter(options: { foe?: Position; second?: Position; ally?: Position | null; chapter?: 1 | 2 | 3; talents?: Record<string, 1 | 2>; slowTurn?: boolean } = {}): DemonSlayerFixture {
  let state = createEncounter('Demon Slayer fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = options.chapter ?? 3;
  if (options.talents) hero.talents = { ...hero.talents, ...options.talents };
  if (options.slowTurn) {
    hero.ruleState['slow-turn'] = true;
    hero.ruleStateOwners['slow-turn'] = hero.id;
  }
  const foe = createFoe('Relict', options.foe ?? { x: 3, y: 1 });
  const second = createFoe('Grim', options.second ?? { x: 5, y: 1 });
  const ally = options.ally === null ? null : actorFromCharacter(validCharacter('Bryn'), options.ally ?? { x: 7, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second, ally: ally! };
}

/** Draken Corner fixtures need THREE foes plus the Charge state: a slow-turn
 * demon-slayer with talent 2, the attack target at (3,1), and two area
 * occupants for the base/second/repeated blast geometry. */
function drakenRepeatEncounter(options: { third?: Position; talents?: Record<string, 1 | 2> } = {}): DemonSlayerFixture & { third: EncounterActor } {
  let state = createEncounter('Draken repeat fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  hero.talents = { ...hero.talents, 'demon-slayer:draken-cross': 2, ...(options.talents ?? {}) };
  hero.ruleState['slow-turn'] = true;
  hero.ruleStateOwners['slow-turn'] = hero.id;
  const foe = createFoe('Relict', { x: 3, y: 1 });
  const second = createFoe('Grim', { x: 5, y: 4 });
  const third = createFoe('Maw', options.third ?? { x: 2, y: 6 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: third }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second, ally: undefined as never, third };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Demon Slayer ability automation (p.128–130)', () => {
  it('marks the reviewed abilities executable in the catalog and audit', () => {
    // 143 of 144 catalogued job abilities are executable; colossus:raging-wolf
    // is deliberately unresolved (Ultra Part 1), so the allowlist is 143.
    expect(EXECUTABLE_JOB_ABILITY_IDS.size).toBe(144 - DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS.size);
    const demonSlayerIds = JOBS.find((job) => job.id === 'demon-slayer')!.abilities.map(({ id }) => id);
    expect(demonSlayerIds).toHaveLength(9);
    for (const abilityId of demonSlayerIds) {
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      expect([128, 129, 130]).toContain(ability.source.page);
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
  });

  it('Demon Cutter: the attack-space target takes the ATTACK instead of the line fray', () => {
    // ICON's AoE attack rule: the target at (3,1) sits INSIDE its own Line 3
    // ((2,1),(3,1),(4,1)) but takes only the attack component — the line's
    // "Area effect: Fray" is for every OTHER character in the line.
    const { state, hero, foe, second } = demonSlayerEncounter({ second: { x: 5, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(12, 5));
    expect(mutationsOf(result.events, 'demon-slayer:demon-cutter')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'attack', d20: 12, hit: true, critical: false },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(result.state.actors[hero.id].attackedThisTurn).toBe(true);
    expect(result.state.actors[foe.id].hp).toBe(23); // 32 - 9 attack; no line fray on the attack space
    expect(result.state.actors[foe.id].statuses).toContain('slashed');
    expect(result.state.actors[second.id].hp).toBe(32); // outside the line
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter: reversing actor INSERTION order changes nothing — the migrated reference reads resolve by recorded slot identity, not iteration order', () => {
    // The migrated source/attack-target reads are singular slot dereferences
    // (context.actorId / attackTargetId → adapter), deterministic by the
    // RECORDED identity; object-iteration order of state.actors cannot select
    // who the ability user or its target is. Insert the second foe BEFORE the
    // target so object order differs from the canonical fixture, and assert
    // the same slash outcome and replay state.
    let setup = createEncounter('Demon Slayer insertion-order fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 3, y: 1 });
    const second = createFoe('Grim', { x: 5, y: 1 });
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: hero }).state;
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: second }).state; // second BEFORE target
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: foe }).state;
    setup = startEncounterTo(setup, hero.id);
    const result = executeCommand(setup, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(12, 5));
    expect(result.state.actors[foe.id].hp).toBe(23); // 32 - 9 attack only
    expect(result.state.actors[foe.id].statuses).toContain('slashed');
    expect(result.state.actors[second.id].hp).toBe(32); // outside the line
    expect(applyEvents(setup, result.events)).toEqual(result.state);
  });

  it('Demon Cutter: Charge repeats the area effect in a recorded non-overlapping second line', () => {
    // "Charge or Heroic: Gains range 2, and repeat the area effect in a new
    // line 3 area in range. The areas cannot overlap." The repeat is
    // MANDATORY once Charge fires — only the AREA is a recorded player
    // choice (a Line 3 path, never an invented direction).
    const { state, hero, foe, second } = demonSlayerEncounter({ second: { x: 3, y: 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        positions: { 'second-line': [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }] },
      },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(23); // attack only — excluded from the line fray
    expect(result.state.actors[second.id].hp).toBe(28); // hit by the repeated line
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter: a missing repeated line under Charge fails closed with nothing emitted', () => {
    const { state, hero, foe } = demonSlayerEncounter({ second: { x: 9, y: 9 }, ally: null, slowTurn: true });
    const before = structuredClone(state);
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-required' }));
    expect(state).toEqual(before);
  });

  it('Demon Cutter: a repeated line overlapping the first line is rejected atomically', () => {
    const { state, hero, foe } = demonSlayerEncounter({ second: { x: 9, y: 9 }, ally: null, slowTurn: true });
    const before = structuredClone(state);
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        positions: { 'second-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] },
      },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.area-overlap' }));
    expect(state).toEqual(before);
  });

  it('Demon Cutter: a repeated line placed in range does NOT need to start adjacent to the user', () => {
    // A ranged Line 3's placement is legal when at least one of its spaces is
    // within the granted range 2 of the user (p.97) — its first space can be
    // two spaces away, and every cell of the pattern is still a fresh area.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        positions: { 'second-line': [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }] },
      },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5));
    // (3,2) is Chebyshev distance 2 from (1,1) — in range but NOT adjacent.
    expect(result.state.actors[second.id].hp).toBe(28); // fray from the repeated line
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter: a repeated line with no cell within range 2 is rejected', () => {
    const { state, hero, foe } = demonSlayerEncounter({ second: { x: 9, y: 9 }, ally: null, slowTurn: true });
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        positions: { 'second-line': [{ x: 5, y: 3 }, { x: 6, y: 3 }, { x: 7, y: 3 }] },
      },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
  });

  it('Demon Cutter: a repeated line that is not an orthogonal Line 3 is rejected', () => {
    const { state, hero, foe } = demonSlayerEncounter({ second: { x: 9, y: 9 }, ally: null, slowTurn: true });
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        positions: { 'second-line': [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }] }, // an L, not a straight line
      },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
  });

  it('Demon Cutter talent 2: a RECORDED rush 1 before the attack moves the line origin', () => {
    // Talent II (p.128): "You can rush 1 before using Demon Cutter." The
    // rush is OPTIONAL player movement: it requires the recorded
    // invoke/decline choice AND a recorded direction — never an auto-rush
    // toward the nearest foe. The changed attack origin rides the same
    // deterministic event (never a post-mutation fold effect).
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: { booleans: { 'rush-before': true }, directions: { 'rush-before': { x: 1, y: 0 } } },
    }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: hero.id, movement: 'rush', positions: [{ x: 2, y: 1 }] },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(23); // 32 - 9 attack, hit from the new origin
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter talent 2: NO decision invents no rush — the attack keeps its origin', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations.some((mutation) => mutation.kind === 'move')).toBe(false);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(23); // still hit from (1,1)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter talent 2: a recorded DECLINE also keeps the attack origin', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: { booleans: { 'rush-before': false } },
    }, scriptedDice(12, 5));
    expect(mutationsOf(result.events, 'demon-slayer:demon-cutter').some((mutation) => mutation.kind === 'move')).toBe(false);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter talent 2 + Charge: an elected rush moves 3 instead of 1', () => {
    // The target gate validates against the PRE-rush origin (the foe at
    // (4,2) is within the Line-3 reach of (1,1)); the recorded rush-3 moves
    // the attack origin to (4,1), from which the charge line reaches it.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 2 }, second: { x: 9, y: 9 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: {
        booleans: { 'rush-before': true },
        directions: { 'rush-before': { x: 1, y: 0 } },
        positions: { 'second-line': [{ x: 5, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }] },
      },
    }, scriptedDice(12, 5));
    const moves = mutationsOf(result.events, 'demon-slayer:demon-cutter').filter((mutation) => mutation.kind === 'move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ movement: 'rush', positions: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] });
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter talent 2: an elected rush the movement authority cannot make fails atomically', () => {
    // The hero stands on the bottom grid row: an elected rush SOUTH has no
    // path. The malformed choice fails before any mutation is emitted.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 } });
    state.actors[hero.id].position = { x: 1, y: 0 };
    const before = structuredClone(state);
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: { booleans: { 'rush-before': true }, directions: { 'rush-before': { x: 0, y: -1 } } },
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
    expect(state).toEqual(before);
  });

  it('Demon Cutter talent 2: an elected rush without a recorded direction fails closed', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 } });
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: { booleans: { 'rush-before': true } },
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-required' }));
  });

  it('Demon Cutter talent 2: a slow turn rushes 3 instead, and the charge line follows the new origin', () => {
    // The range gate checks the target against the pre-rush origin, so the
    // foe sits within range 3 of (1,1); the rush-3 path (2,1),(3,1),(4,1) is
    // clear and the post-rush line from (4,1) reaches the foe at (4,2).
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 4, y: 2 }, second: { x: 6, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: {
        booleans: { 'rush-before': true },
        directions: { 'rush-before': { x: 1, y: 0 } },
        positions: { 'second-line': [{ x: 5, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }] },
      },
    }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: hero.id, movement: 'rush', positions: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' }, // recorded second line from the post-rush origin
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(23);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter: the pre-ability rush is gated on talent 2 — a slow turn alone never rushes', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 1, y: 3 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: { positions: { 'second-line': [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }] } },
    }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' }, // the charge line still fires
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(mutations.some((mutation) => mutation.kind === 'move')).toBe(false);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Comet: blast damage, a thrown-weapon object with rampart, and no attacks while deployed', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 6, y: 1 }, second: { x: 9, y: 4 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:comet', targetIds: [] }, scriptedDice());
    const mutations = mutationsOf(result.events, 'demon-slayer:comet');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'damage', actorId: foe.id, amount: 2, delivery: 'area' },
      { kind: 'entity', operation: 'create', entityType: 'object' },
      { kind: 'terrain', operation: 'create', terrain: 'rampart' },
      { kind: 'terrain', operation: 'create', terrain: 'rampart' },
      { kind: 'terrain', operation: 'create', terrain: 'rampart' },
      { kind: 'terrain', operation: 'create', terrain: 'rampart' },
      { kind: 'state', actorId: hero.id, key: 'weapon-deployed', value: true },
    ]);
    const weapon = Object.values(result.state.entities).find((entity) => entity.state['thrownWeapon'] === true);
    expect(weapon).toBeDefined();
    expect(weapon!.positions[0]).toEqual({ x: 4, y: 1 }); // default center, unblocked
    expect(result.state.terrainEffects.filter((effect) => effect.terrain === 'rampart')).toHaveLength(4);
    expect(result.state.actors[hero.id].ruleState['weapon-deployed']).toBe(true);
    expect(result.state.actors[foe.id].hp).toBe(30);
    expect(() => executeCommand(result.state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(15, 5))).toThrow(/deployed/);

    // Entering a space adjacent to the thrown weapon picks it up again.
    const pickedUp = executeCommand(result.state, { type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }], mode: 'standard' }, scriptedDice()).state;
    expect(Object.values(pickedUp.entities).some((entity) => entity.state['thrownWeapon'] === true)).toBe(false);
    expect(pickedUp.actors[hero.id].ruleState['weapon-deployed']).toBe(false);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Comet: a large-footprint area hits each member ONCE (identity-deduplicated recipients)', () => {
    // A medium blast is a 5×5 pattern, but a character occupies one space:
    // recipient membership is decided per CHARACTER, never per cell — the foe
    // inside the medium blast takes exactly one area-damage mutation even
    // though its footprint spans many spaces.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 6, y: 1 }, second: { x: 9, y: 4 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:comet', targetIds: [] }, scriptedDice());
    const foeDamages = mutationsOf(result.events, 'demon-slayer:comet').filter((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id);
    expect(foeDamages).toHaveLength(1);
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2, exactly once
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter: a Size 2 character whose ANCHOR is outside the Line but whose footprint intersects it takes the area fray exactly once', () => {
    // ICON p.290 large characters count as "inside" an area when one of
    // their spaces is hit. The Line 3 is (2,1),(3,1),(4,1); the Size 2 foe
    // anchored at (3,0) occupies (3,0),(4,0),(3,1),(4,1) — its anchor is
    // OUTSIDE the line, but its footprint overlaps it at two cells. It must
    // take the unrestricted "Area effect: Fray" exactly once (never per
    // cell, never anchor-only).
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 3, y: 0 }, ally: null });
    state.actors[second.id].size = 2;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(12, 5));
    const secondDamages = mutationsOf(result.events, 'demon-slayer:demon-cutter').filter((mutation) => mutation.kind === 'damage' && mutation.actorId === second.id);
    expect(secondDamages).toHaveLength(1);
    expect(secondDamages[0]).toMatchObject({ amount: 4, delivery: 'area' });
    expect(result.state.actors[second.id].hp).toBe(28); // 32 - 4 fray, exactly once
    expect(result.state.actors[foe.id].statuses).toContain('slashed'); // the attack-space target still takes the attack
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Comet: a Size 2 character whose anchor is OUTSIDE the medium blast but whose footprint intersects it is hit exactly once', () => {
    // Blast center (4,1) radius 2 covers x 2..6. The Size 2 foe anchored at
    // (1,2) occupies (1,2),(2,2),(1,3),(2,3): its anchor sits outside the
    // blast (x=1) while its footprint overlaps it — membership is decided by
    // the FOOTPRINT, never the anchor cell.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 1, y: 2 }, second: { x: 9, y: 9 }, ally: null });
    state.actors[foe.id].size = 2;
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:comet', targetIds: [],
      input: { directions: { 'throw-direction': { x: 1, y: 0 } } },
    }, scriptedDice());
    const foeDamages = mutationsOf(result.events, 'demon-slayer:comet').filter((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id);
    expect(foeDamages).toHaveLength(1);
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2, exactly once
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: a Size 2 character occupying several cells of a LATER (base-effect) area takes that area\'s fray exactly once', () => {
    // The base Effect's REQUIRED second blast (E1) is centered (3,4)
    // radius 1: cells (2..4, 3..5). The Size 2 foe anchored at (3,5)
    // occupies (3,5),(4,5),(3,6),(4,6) — TWO cells inside E1 and no cell in
    // the primary blast — so it takes exactly ONE area-fray instance.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 5 }, ally: null });
    state.actors[second.id].size = 2;
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    const secondDamages = mutationsOf(result.events, 'demon-slayer:draken-cross').filter((mutation) => mutation.kind === 'damage' && mutation.actorId === second.id);
    expect(secondDamages).toHaveLength(1);
    expect(secondDamages[0]).toMatchObject({ amount: 4, delivery: 'area' });
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross Talent I on Exceed regenerates the area fray ONCE per area for a Size 2 multi-cell occupant', () => {
    // "Exceed: Deal fray damage again to all characters in any area created
    // by this ability." — a later separate effect, identity-deduplicated per
    // area. The Size 2 foe inside E1 takes the E1 fray PLUS the Talent I
    // regeneration (two instances total, each exactly once) while its
    // multi-cell footprint stays one identity.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 5 }, ally: null, talents: { 'demon-slayer:draken-cross': 1 } });
    state.actors[second.id].size = 2;
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(15, 5, 6)); // d20 15 = natural Exceed
    const secondDamages = mutationsOf(result.events, 'demon-slayer:draken-cross').filter((mutation) => mutation.kind === 'damage' && mutation.actorId === second.id);
    expect(secondDamages).toHaveLength(2); // the E1 fray, then the Exceed regeneration
    expect(secondDamages.every((mutation) => mutation.kind === 'damage' && mutation.amount === 4 && mutation.delivery === 'area')).toBe(true);
    expect(result.state.actors[second.id].hp).toBe(24); // 32 - 4 - 4
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: the base Effect is REQUIRED — a use without a recorded second blast fails closed', () => {
    // "Effect: You may rush 1, then target another small blast area in range
    // 3…" (p.128): like every other "You may Rush X, then …" construction the
    // RUSH may be declined, but the SECOND BLAST remains part of the ability.
    // A use without the recorded area center never resolves — Draken Cross is
    // NOT complete with only the primary blast — and the rejected command
    // leaves the table untouched.
    const { state, hero, foe } = demonSlayerEncounter({ second: { x: 0, y: 0 }, ally: null });
    const before = structuredClone(state);
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6)))
      .toThrowError(expect.objectContaining({ code: 'choice.position-required' }));
    expect(state).toEqual(before);
  });

  it('Draken Cross: the attack-space character takes the ATTACK instead of the area effect', () => {
    // ICON's AoE attack rule: the target at (3,1) sits INSIDE its own primary
    // blast but takes only the 2[D]+fray hit — never a second primary-area
    // fray. Other characters in the blast — the ally at (4,1) — take the
    // unrestricted "Area effect: Fray". Source order (p.128): Attack, then
    // its area effect, then the base Effect's required second blast.
    const { state, hero, foe, second, ally } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, ally: { x: 4, y: 1 }, second: { x: 3, y: 4 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', d20: 12, hit: true, critical: false },
      { kind: 'damage', actorId: foe.id, amount: 15 },
      { kind: 'damage', actorId: ally.id, amount: 4, delivery: 'area' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
    ]);
    // The attack space never takes the area effect on top of the attack.
    const foeAreaDamages = mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id && mutation.delivery === 'area');
    expect(foeAreaDamages).toHaveLength(0);
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - 15 attack only
    expect(result.state.actors[second.id].hp).toBe(28); // 32 - 4 required second blast
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: the base Effect rush may be declined — the required second blast still resolves', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 4 }, ally: null });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations.some((mutation) => mutation.kind === 'move')).toBe(false);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 1 }); // never rushed
    expect(result.state.actors[second.id].hp).toBe(28); // frayed by the required second blast
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: the second blast is measured from the POST-rush origin, and an elected rush needs its recorded direction', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 6 }, ally: null });
    // Center (4,6): every cell is Chebyshev ≥ 4 from the pre-rush origin
    // (1,1) — OUT of range 3. An area is legal when at least one of its cells
    // is within the effective blast range of the POST-rush origin (ICON
    // p.97), so without the rush the same center fails closed.
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 4, y: 6 }] } },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
    // An elected rush without its recorded direction is malformed too.
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { 'effect-rush-1': true }, positions: { 'effect-area-1': [{ x: 4, y: 6 }] } },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.position-required' }));
    // With the recorded SOUTH rush the origin becomes (1,2) and the same
    // center is legal (its cell (3,5) is Chebyshev 3 away): the effect frays
    // the character there AFTER the recorded rush mutation — never before it.
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { 'effect-rush-1': true }, directions: { 'effect-rush-1': { x: 0, y: 1 } }, positions: { 'effect-area-1': [{ x: 4, y: 6 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 15 },
      { kind: 'move', actorId: hero.id, movement: 'rush' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
    ]);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 });
    expect(result.state.actors[foe.id].hp).toBe(17);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: an overlapping selected area is rejected ATOMICALLY — no rush is left behind', () => {
    // "The areas cannot overlap" (p.128). A second blast overlapping the
    // primary fails closed BEFORE any mutation is emitted: the recorded rush
    // is never half-applied, and the rejected command changes nothing.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 5 }, ally: null });
    const before = structuredClone(state);
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { 'effect-rush-1': true }, directions: { 'effect-rush-1': { x: 0, y: 1 } }, positions: { 'effect-area-1': [{ x: 3, y: 3 }] } },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.area-overlap' }));
    expect(state).toEqual(before);
  });

  it('Draken Cross talent 2 + Charge: all areas stay SMALL when the player declines the recorded medium decision', () => {
    // Talent II (p.128): "all areas may be increased to medium blasts
    // instead" — ONE recorded resolution-level decision. Declining keeps
    // every area radius 1: the foe at (2,6) sits inside the radius-2 medium
    // footprint of the second blast at (4,6) but outside its small radius-1
    // square, so it is unhit.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 6, y: 1 }, second: { x: 2, y: 6 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 4, y: 6 }] } },
    }, scriptedDice(12, 5, 6));
    expect(result.state.actors[second.id].hp).toBe(32);
    expect(mutationsOf(result.events, 'demon-slayer:draken-cross').filter((mutation) => mutation.kind === 'damage' && mutation.actorId === second.id)).toHaveLength(0);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross talent 2 + Charge: the RECORDED medium decision sizes EVERY area medium', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 6, y: 1 }, second: { x: 2, y: 6 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { 'medium-areas': true }, positions: { 'effect-area-1': [{ x: 4, y: 6 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 15 },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' }, // the medium E1 fringe
    ]);
    expect(result.state.actors[foe.id].hp).toBe(17);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross talent 2: Heroic alone does NOT activate the Charge-only range or size upgrade', () => {
    // Talent II is a "Charge:" clause — Charge and Heroic are distinct ICON
    // triggered effects. With Heroic (a validated declaration) but no slow
    // turn, the effective range stays 3 and the areas stay small even with
    // the talent equipped.
    const far = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 0, y: 0 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 } });
    expect(() => executeCommand(far.state, {
      type: 'EXECUTE_RULE', actorId: far.hero.id, sourceId: 'demon-slayer:draken-cross', actionId: 'default', timing: 'use',
      input: {}, attackTargetId: far.foe.id, triggers: ['heroic'],
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'ability.range' }));
    // In range, the areas stay small: a foe in the medium-only fringe of the
    // second blast is unhit.
    const small = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 2, y: 6 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 } });
    const heroic = executeCommand(small.state, {
      type: 'EXECUTE_RULE', actorId: small.hero.id, sourceId: 'demon-slayer:draken-cross', actionId: 'default', timing: 'use',
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } }, attackTargetId: small.foe.id, triggers: ['heroic'],
    }, scriptedDice(12, 5, 6));
    expect(heroic.state.actors[small.second.id].hp).toBe(32); // outside the small E1
    expect(applyEvents(small.state, heroic.events)).toEqual(heroic.state);
  });

  it('Draken Cross talent 2: without a genuine Charge the range stays 3 even with the talent', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 0, y: 0 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 } });
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6)))
      .toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });

  it('Draken Cross: Charge without talent 2 also keeps range 3 — and a slow turn alone keeps the areas small', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 0, y: 0 }, ally: null, slowTurn: true });
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6)))
      .toThrowError(expect.objectContaining({ code: 'ability.range' }));
    // With an in-range target the areas stay radius 1 even on the slow turn:
    // (2,6) is inside the medium footprint of the E1 at (3,4) but outside its
    // small radius-1 square.
    const small = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 2, y: 6 }, ally: null, slowTurn: true });
    const result = executeCommand(small.state, {
      type: 'USE_ABILITY', actorId: small.hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [small.foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    expect(result.state.actors[small.second.id].hp).toBe(32);
    expect(applyEvents(small.state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: a forged \'charge\' trigger cannot activate Talent II without the authoritative slow turn', () => {
    // Charge is a state-derived trigger (p.95): only the durable slow-turn
    // fact may produce it. A caller asserting triggers: ['charge'] fails
    // closed at the command boundary — the talent's range/area upgrade
    // stays off and no approximate behavior is invented.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 2 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 } });
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:draken-cross',
      actionId: 'default',
      timing: 'use',
      input: { booleans: { 'medium-areas': true } },
      attackTargetId: foe.id,
      triggers: ['charge'],
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'rule.trigger-forged' }));
  });

  it('Draken Cross talent 2 + Charge: the attack target may legally be chosen at range 4/5 (shared charge-gated range rule)', () => {
    // ICON p.128 talent 2: "Charge: Increase range to 5…" — the range half is
    // the shared charge-gated range rule folded by the generic USE_ABILITY
    // gate, so a target at distance 4 is LEGAL on a slow turn with the talent
    // equipped (previously the gate kept the target capped at range 3).
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 0, y: 0 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 7, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - 15 attack; the attack space never takes the area fray too
    expect(result.state.actors[hero.id].actionsRemaining).toBe(0);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross talent 2 + Charge: a target beyond range 5 is still rejected', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 7, y: 1 }, second: { x: 0, y: 0 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6)))
      .toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });

  it('Draken Cross + Charge: declining the repeat resolves the base Effect exactly once', () => {
    // "Charge or Heroic: … may repeat the effect." The repeat is OPTIONAL and
    // is another complete Effect operation — never a re-damage of an existing
    // blast. Without the recorded repeat decision, only the base Effect's
    // area frays: second (5,4) once, third (2,6) never.
    const { state, hero, foe, second, third } = drakenRepeatEncounter();
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 5, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations.filter((mutation) => mutation.kind === 'move')).toHaveLength(0);
    expect(mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === second.id)).toHaveLength(1);
    expect(mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === third.id)).toHaveLength(0);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(result.state.actors[third.id].hp).toBe(32);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross + Charge: a recorded repeat creates a DISTINCT area — never duplicate damage on an existing one', () => {
    // The repeated Effect is the whole operation again with its own area at
    // (2,6): third is frayed by IT, and second at (5,4) is frayed only by the
    // base Effect's area (a repeat must not re-damage an existing blast).
    const { state, hero, foe, second, third } = drakenRepeatEncounter();
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { repeat: true }, positions: { 'effect-area-1': [{ x: 5, y: 4 }], 'effect-area-2': [{ x: 2, y: 6 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations.filter((mutation) => mutation.kind === 'move')).toHaveLength(0); // both rushes declined
    expect(mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === second.id)).toHaveLength(1);
    expect(mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === third.id)).toHaveLength(1);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(result.state.actors[third.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross + Charge: the repeated Effect has its OWN optional rush, measured from ITS post-rush origin', () => {
    const { state, hero, foe, second, third } = drakenRepeatEncounter({ third: { x: 6, y: 8 } });
    // E2 center (6,8): every cell is Chebyshev ≥ 6 from the pre-rush origin
    // (1,1) — outside the charged range 5 — but its nearest cell (5,7) is
    // Chebyshev 5 from the POST-rush origin (1,2), so the recorded repeat
    // rush makes it legal. Without it, the same area fails closed.
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { repeat: true }, positions: { 'effect-area-1': [{ x: 5, y: 4 }], 'effect-area-2': [{ x: 6, y: 8 }] } },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: {
        booleans: { repeat: true, 'effect-rush-2': true },
        directions: { 'effect-rush-2': { x: 0, y: 1 } },
        positions: { 'effect-area-1': [{ x: 5, y: 4 }], 'effect-area-2': [{ x: 6, y: 8 }] },
      },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    const rushes = mutations.filter((mutation) => mutation.kind === 'move' && mutation.movement === 'rush');
    expect(rushes).toHaveLength(1); // the base Effect declined its rush; only the repeat rushed
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 });
    expect(result.state.actors[third.id].hp).toBe(28); // frayed by the repeated Effect's own area
    expect(result.state.actors[second.id].hp).toBe(28); // frayed once by the base Effect — never twice
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross + Charge: the repeated area cannot overlap EITHER prior area of the use', () => {
    const { state, hero, foe } = drakenRepeatEncounter();
    // E2 centered on the first Effect's own center — overlaps the E1 area.
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { repeat: true }, positions: { 'effect-area-1': [{ x: 5, y: 4 }], 'effect-area-2': [{ x: 5, y: 4 }] } },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.area-overlap' }));
    // E2 overlapping the PRIMARY blast (centered on the target (3,1)) is
    // rejected too.
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { repeat: true }, positions: { 'effect-area-1': [{ x: 5, y: 4 }], 'effect-area-2': [{ x: 3, y: 1 }] } },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.area-overlap' }));
  });

  it('Draken Cross talent 1: Exceed re-frays ALL characters in every created area — including the attack-space target', () => {
    // Talent I (p.128): "Exceed: Deal fray damage again to all characters in
    // any area created by this ability." "All characters" is explicit — the
    // attack-space target IS included, because this is a separate later
    // effect, not the primary Area Effect repeated blindly. The Exceed fact
    // reads the SAME authoritative roll (d20 15 → total 15 ≥ 15).
    const { state, hero, foe, second, ally } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, ally: { x: 4, y: 1 }, second: { x: 3, y: 4 }, talents: { 'demon-slayer:draken-cross': 1 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(15, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    const attackMutation = mutations.find((mutation) => mutation.kind === 'attack') as { exceed?: boolean } | undefined;
    expect(attackMutation?.exceed).toBe(true);
    // Source order: attack, its damage, primary area fray, base Effect fray,
    // THEN Talent I re-frays every created area in creation order.
    const foeAreaDamages = mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id && mutation.delivery === 'area');
    expect(foeAreaDamages).toHaveLength(1); // only Talent I — the attack space never takes the primary fray
    const allyAreaDamages = mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === ally.id && mutation.delivery === 'area');
    expect(allyAreaDamages).toHaveLength(2); // primary fray + Talent I
    const secondAreaDamages = mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === second.id && mutation.delivery === 'area');
    expect(secondAreaDamages).toHaveLength(2); // base Effect fray + Talent I
    expect(result.state.actors[foe.id].hp).toBe(13); // 32 - 15 attack - 4 Talent I (the explicit primary-target Talent I case)
    expect(result.state.actors[second.id].hp).toBe(24); // 32 - 4 - 4
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross talent 1: without Exceed the re-fray never fires', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 4 }, ally: null, talents: { 'demon-slayer:draken-cross': 1 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    const attackMutation = mutations.find((mutation) => mutation.kind === 'attack') as { exceed?: boolean } | undefined;
    expect(attackMutation?.exceed).toBe(false);
    expect(result.state.actors[foe.id].hp).toBe(17); // no Talent I fray on the attack space
    expect(result.state.actors[second.id].hp).toBe(28); // base Effect fray only
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: the Dark Wind Devil Blade mastery stays UNRESOLVED — no teleport or divine splash is invented', () => {
    // "After using this ability you may teleport to any space of an area
    // created, then all foes in created areas are slashed and take 2 divine
    // damage" needs exact source Blast geometry and a RECORDED teleport
    // destination. Neither is approximated: mastering the ability changes
    // nothing observable about the base resolution.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 4 }, ally: null });
    state.actors[hero.id].masteredAbilityIds = ['demon-slayer:draken-cross'];
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 1 }); // never teleported
    expect(mutationsOf(result.events, 'demon-slayer:draken-cross').some((mutation) => mutation.kind === 'move' && mutation.movement !== 'rush')).toBe(false);
    expect(result.state.actors[second.id].hp).toBe(28); // ordinary E1 fray only — no 2 divine splash
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Righteous Disdain: interrupt splits determined damage and grants sturdy', () => {
    const { state, hero, foe, ally } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, ally: { x: 2, y: 1 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:righteous-disdain',
      actionId: 'default',
      timing: 'interrupt',
      input: { numbers: { damage: 8 }, actorIds: { target: [ally.id] } },
    }, scriptedDice());
    const mutations = mutationsOf(result.events, 'demon-slayer:righteous-disdain');
    expect(mutations).toMatchObject([
      { kind: 'damage', actorId: hero.id, amount: 4, delivery: 'effect' },
      { kind: 'damage', actorId: ally.id, amount: 4, delivery: 'effect' },
      { kind: 'condition', actorId: hero.id, conditionId: 'sturdy' },
      { kind: 'condition', actorId: ally.id, conditionId: 'sturdy' },
    ]);
    expect(result.state.actors[hero.id].hp).toBe(38); // 4 damage reduced by the hero's armor 2
    expect(result.state.actors[ally.id].hp).toBe(38);
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'sturdy')).toBe(true);
    expect(result.state.actors[ally.id].conditions.some(({ id }) => id === 'sturdy')).toBe(true);
    expect(interruptUses(result.state.actors[hero.id], 'demon-slayer:righteous-disdain')).toBe(1);
    expect(interruptUsedThisTurn(result.state.actors[hero.id])).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Righteous Disdain: Heroic grants vigor after the split resolves', () => {
    const { state, hero, foe, ally } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, ally: { x: 2, y: 1 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:righteous-disdain',
      actionId: 'default',
      timing: 'interrupt',
      input: { numbers: { damage: 4 }, actorIds: { target: [ally.id] } },
      triggers: ['heroic'],
    }, scriptedDice());
    expect(result.state.actors[hero.id].vigor).toBe(4);
  });

  it('Demon Claw: two rushes damage every adjacent foe when the user has not attacked', () => {
    // The rush direction is the player's choice (ICON movement); the fixture
    // supplies +x explicitly rather than relying on the nearest-foe default
    // (the two foes here are equidistant, and the engine must not pick).
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 4, y: 2 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } } } }, scriptedDice());
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-claw');
    expect(mutations.slice(0, 3)).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: hero.id, movement: 'rush', positions: [{ x: 2, y: 1 }] },
      { kind: 'move', actorId: hero.id, movement: 'rush', positions: [{ x: 3, y: 1 }] },
    ]);
    // Both adjacent foes take 2 damage (adjacent foes are ordered by id, so
    // only the set is asserted).
    const clawDamages = mutations.filter((mutation) => mutation.kind === 'damage');
    expect(clawDamages).toHaveLength(2);
    expect(new Set(clawDamages.map(({ actorId }) => actorId))).toEqual(new Set([foe.id, second.id]));
    for (const mutation of clawDamages) expect(mutation.amount).toBe(2);
    expect(result.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(30);
    expect(result.state.actors[second.id].hp).toBe(30);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Claw mastery (RAGING DEMON): damage rises by 1 per missing 25% of max hp, capped at +3 (p.129)', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 4, y: 2 } });
    state.actors[hero.id].masteredAbilityIds = ['demon-slayer:demon-claw'];
    // Missing 50% of maximum hp → +2 damage on every 2-damage instance.
    const maxHp = state.actors[hero.id].baseMaxHp;
    state.actors[hero.id].hp = Math.floor(maxHp / 2);
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } } } }, scriptedDice());
    const clawDamages = mutationsOf(result.events, 'demon-slayer:demon-claw').filter((mutation) => mutation.kind === 'damage');
    expect(clawDamages).toHaveLength(2);
    for (const mutation of clawDamages) expect(mutation.amount).toBe(4); // 2 + 2
    expect(result.state.actors[foe.id].hp).toBe(28); // 32 - 4
    expect(result.state.actors[second.id].hp).toBe(28); // 32 - 4
    expect(applyEvents(state, result.events)).toEqual(result.state);

    // Not mastered: base 2 damage per instance.
    const plain = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 4, y: 2 } });
    const max = plain.state.actors[plain.hero.id].baseMaxHp;
    plain.state.actors[plain.hero.id].hp = Math.floor(max / 2);
    const base = executeCommand(plain.state, { type: 'USE_ABILITY', actorId: plain.hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } } } }, scriptedDice());
    for (const mutation of mutationsOf(base.events, 'demon-slayer:demon-claw').filter((mutation) => mutation.kind === 'damage')) {
      expect(mutation.amount).toBe(2);
    }
    expect(applyEvents(plain.state, base.events)).toEqual(base.state);

    // Mastered at full hp: no missing quarters → base 2.
    const fresh = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 4, y: 2 } });
    fresh.state.actors[fresh.hero.id].masteredAbilityIds = ['demon-slayer:demon-claw'];
    const fullHp = executeCommand(fresh.state, { type: 'USE_ABILITY', actorId: fresh.hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } } } }, scriptedDice());
    for (const mutation of mutationsOf(fullHp.events, 'demon-slayer:demon-claw').filter((mutation) => mutation.kind === 'damage')) {
      expect(mutation.amount).toBe(2);
    }
    expect(applyEvents(fresh.state, fullHp.events)).toEqual(fullHp.state);
  });

  it('Demon Claw mastery (RAGING DEMON): the missing-HP percentage uses the BASE maximum, not the wounds-adjusted maximum (p.107 % HEALTH)', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 4, y: 2 } });
    state.actors[hero.id].masteredAbilityIds = ['demon-slayer:demon-claw'];
    // One wound reduces the current maximum from 28 to 21 (VIT 7). At full
    // current HP (21/21) the character is missing 7 of the BASE 28 — exactly
    // 25% — so the p.107 base-max rule awards +1 damage, while a
    // wounds-adjusted calculation (missing 0 of 21) would award nothing.
    state.actors[hero.id].wounds = 1;
    state.actors[hero.id].hp = 28 - 7;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } } } }, scriptedDice());
    const clawDamages = mutationsOf(result.events, 'demon-slayer:demon-claw').filter((mutation) => mutation.kind === 'damage');
    expect(clawDamages).toHaveLength(2);
    for (const mutation of clawDamages) expect(mutation.amount).toBe(3); // 2 + 1
    expect(result.state.actors[foe.id].hp).toBe(29); // 32 - 3
    expect(result.state.actors[second.id].hp).toBe(29);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Gates of Hell: rush, vigilance, counter, and the once-per-turn vigilance rush', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 6, y: 1 }, second: { x: 8, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:gates-of-hell', targetIds: [] }, scriptedDice());
    const mutations = mutationsOf(result.events, 'demon-slayer:gates-of-hell');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: hero.id, movement: 'rush', positions: [{ x: 2, y: 1 }, { x: 3, y: 1 }] },
      { kind: 'resource', actorId: hero.id, resourceId: 'vigilance', operation: 'gain', amount: 1 },
      { kind: 'condition', actorId: hero.id, conditionId: 'counter' },
    ]);
    expect(result.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(result.state.actors[hero.id].resources.vigilance).toBe(1);
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'counter')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);

    const rushed = executeCommand(result.state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:gates-of-hell',
      actionId: 'vigilance-rush',
      timing: 'targeted',
      input: {},
    }, scriptedDice()).state;
    expect(rushed.actors[hero.id].position).toEqual({ x: 5, y: 1 });
    // The once-per-turn vigilance-rush gate is a U16 any-turn ledger key.
    expect(rushed.actors[hero.id].ruleState['ledger:any-turn:gates-of-hell:vigilance-rushed']).toBe(true);
    expect(() => executeCommand(rushed, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:gates-of-hell',
      actionId: 'vigilance-rush',
      timing: 'targeted',
      input: {},
    }, scriptedDice())).toThrow(/once a turn/);
  });

  it('Soul Blade: stance die at 2, refresh ticks up, and the aether slash ticks down', () => {
    const { state, hero, foe } = demonSlayerEncounter();
    const entered = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:soul-blade', targetIds: [] }, scriptedDice()).state;
    expect(entered.actors[hero.id].stance).toMatchObject({ stanceId: 'soul-blade' });
    expect(entered.actors[hero.id].ruleState['soul-blade:die']).toBe(2);
    expect(entered.actors[hero.id].actionsRemaining).toBe(1);
    expect(applyEvents(state, executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:soul-blade', targetIds: [] }, scriptedDice()).events)).toEqual(entered);

    const refreshed = executeCommand(entered, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:soul-blade',
      actionId: 'stance-refresh',
      timing: 'stance-refresh',
      input: {},
    }, scriptedDice()).state;
    expect(refreshed.actors[hero.id].ruleState['soul-blade:die']).toBe(3);

    const slashed = executeCommand(refreshed, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:soul-blade',
      actionId: 'aether-slash',
      timing: 'targeted',
      input: { numbers: { tick: 2 } },
      attackTargetId: foe.id,
    }, scriptedDice()).state;
    expect(mutationsOf(executeCommand(refreshed, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:soul-blade',
      actionId: 'aether-slash',
      timing: 'targeted',
      input: { numbers: { tick: 2 } },
      attackTargetId: foe.id,
    }, scriptedDice()).events, 'demon-slayer:soul-blade')).toMatchObject([
      { kind: 'damage', actorId: foe.id, amount: 2, delivery: 'area' },
      { kind: 'state', actorId: hero.id, key: 'soul-blade:die', value: 1 },
    ]);
    expect(slashed.actors[foe.id].hp).toBe(30);
    expect(slashed.actors[hero.id].stance).toMatchObject({ stanceId: 'soul-blade' }); // die 1 remains

    const exhausted = executeCommand(slashed, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:soul-blade',
      actionId: 'aether-slash',
      timing: 'targeted',
      input: { numbers: { tick: 1 } },
      attackTargetId: foe.id,
    }, scriptedDice()).state;
    expect(exhausted.actors[hero.id].stance).toBeNull();
    expect(exhausted.actors[hero.id].ruleState['soul-blade:die']).toBe(0);
    expect(exhausted.actors[foe.id].hp).toBe(29);
  });

  it('Soul Blade: the slash cannot tick the die below zero', () => {
    const { state, hero, foe } = demonSlayerEncounter();
    const entered = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:soul-blade', targetIds: [] }, scriptedDice()).state;
    expect(() => executeCommand(entered, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:soul-blade',
      actionId: 'aether-slash',
      timing: 'targeted',
      input: { numbers: { tick: 3 } },
      attackTargetId: foe.id,
    }, scriptedDice())).toThrow(/tick the die down by/);
  });

  it('Six Hells Trigram: ends the turn, activates at the user’s next turn, and traps foes inside', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 5, y: 1 }, ally: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:six-hells-trigram', targetIds: [] }, scriptedDice());
    const afterUse = used.state;
    expect(used.events.some((event) => event.type === 'TURN_ENDED')).toBe(true);
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    expect(afterUse.activeActorId).toBeNull();
    expect(afterUse.eligibleSide).toBe('foes');
    expect(afterUse.actors[hero.id].ruleState['six-hells:stage']).toBe('pending');
    expect(afterUse.actors[hero.id].ruleState['six-hells:slow-turn']).toBe(true);
    expect(afterUse.terrainEffects.filter((effect) => effect.terrain === 'six-hells-trigram')).toHaveLength(1);
    expect(applyEvents(state, used.events)).toEqual(afterUse);

    // Foe 1 and foe 2 end their turns; round 2 opens and the round-start
    // lifecycle activates the trigram. The hero's next turn is Slow (the
    // trigram's Delay), so the allied normal slot passes: the foes take their
    // round-2 normal turns first, then the Slow mini-round runs the hero.
    const foe1Turn = executeCommand(afterUse, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const afterFoe1 = endTurnOnly(foe1Turn, scriptedDice());
    const foe2Turn = executeCommand(afterFoe1, { type: 'TAKE_TURN', actorId: second.id }, scriptedDice()).state;
    const afterFoe2 = endTurnOnly(foe2Turn, scriptedDice());
    expect(afterFoe2.activeActorId).toBeNull();
    expect(afterFoe2.eligibleSide).toBe('foes');
    expect(afterFoe2.round).toBe(2);
    expect(afterFoe2.actors[hero.id].ruleState['six-hells:stage']).toBe('pending');

    // Round 2: the foes' normal turns, then the hero's Slow turn, whose
    // turn-start lifecycle activates the trigram.
    const r2f1 = executeCommand(afterFoe2, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const r2f1Ended = endTurnOnly(r2f1, scriptedDice());
    const r2f2 = executeCommand(r2f1Ended, { type: 'TAKE_TURN', actorId: second.id }, scriptedDice()).state;
    const r2f2Ended = endTurnOnly(r2f2, scriptedDice());
    expect(r2f2Ended.turnPhase).toBe('slow');
    const heroTurn = executeCommand(r2f2Ended, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(heroTurn.turnPhase).toBe('slow');
    expect(heroTurn.activeActorId).toBe(hero.id);
    expect(heroTurn.actors[hero.id].ruleState['six-hells:stage']).toBe('active');
    expect(heroTurn.actors[foe.id].statuses).toContain('weakened');

    // With the trigram active, a foe attempting to exit must pass a save.
    const heroEnded = endTurnTo(heroTurn, foe.id, scriptedDice());
    expect(heroEnded.activeActorId).toBe(foe.id);
    expect(() => executeCommand(heroEnded, { type: 'MOVE', actorId: foe.id, path: [{ x: 3, y: 1 }, { x: 4, y: 1 }], mode: 'standard' }, scriptedDice(5))).toThrow(/trapped: the save to leave/);
    const escaped = executeCommand(heroEnded, { type: 'MOVE', actorId: foe.id, path: [{ x: 3, y: 1 }, { x: 4, y: 1 }], mode: 'standard' }, scriptedDice(15)).state;
    expect(escaped.actors[foe.id].position).toEqual({ x: 4, y: 1 });
  });

  it('Wicked Sheath: fray and shove 1 on hit, no shove on miss, and the charged die', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 2, y: 1 } });
    // Miss: fray only, no shove; the weapon still becomes charged.
    const missed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:wicked-sheath', targetIds: [foe.id] }, scriptedDice(5, 4));
    expect(mutationsOf(missed.events, 'demon-slayer:wicked-sheath')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'state', actorId: hero.id, key: 'wicked-sheath:charged', value: true },
      { kind: 'attack', d20: 5, hit: false },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'miss' },
    ]);
    expect(missed.state.actors[hero.id].ruleState['wicked-sheath:charged']).toBe(true);
    expect(missed.state.actors[foe.id].position).toEqual({ x: 2, y: 1 }); // no shove on miss
    expect(missed.state.actors[foe.id].hp).toBe(28);

    // A hit from the charged weapon shoves 1 + die and adds die damage dice.
    const hit = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:wicked-sheath', targetIds: [foe.id] }, scriptedDice(12, 6));
    expect(hit.state.actors[foe.id].position).toEqual({ x: 3, y: 1 }); // shove 1
    expect(hit.state.actors[foe.id].hp).toBe(28); // fray 4 on hit, die 0
    expect(hit.state.actors[hero.id].ruleState['wicked-sheath:charged']).toBe(false); // discarded on hit
  });

  it('Wicked Sheath: the power die charges at round start and boosts the next hit', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 6, y: 1 }, ally: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:wicked-sheath', targetIds: [foe.id] }, scriptedDice(5, 4)).state; // miss, stays charged
    expect(used.actors[hero.id].ruleState['wicked-sheath:charged']).toBe(true);

    // The hero ends the turn, the foes pass, and round 2 charges the die to 1
    // at the round boundary (the player then selects the hero, ICON p.87).
    const heroEnded = endTurnTo(used, foe.id, scriptedDice());
    const afterFoe = endTurnOnly(heroEnded, scriptedDice());
    const secondTurn = executeCommand(afterFoe, { type: 'TAKE_TURN', actorId: second.id }, scriptedDice()).state;
    const afterSecond = endTurnOnly(secondTurn, scriptedDice());
    expect(afterSecond.round).toBe(2);
    expect(afterSecond.activeActorId).toBeNull();
    expect(afterSecond.eligibleSide).toBe('heroes');
    expect(afterSecond.actors[hero.id].resources['wicked-sheath-die']).toBe(1);

    // The player selects the hero; the boosted attack is fray + [D]×1, shove
    // 1 + 1, +1 boon from the die. d20=11 + boon 1 = 12 hits; the [D] roll is 6.
    const heroTurn = executeCommand(afterSecond, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    const boosted = executeCommand(heroTurn, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:wicked-sheath', targetIds: [foe.id] }, scriptedDice(11, 1, 6));
    const mutations = mutationsOf(boosted.events, 'demon-slayer:wicked-sheath');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'state', actorId: hero.id, key: 'wicked-sheath:charged', value: true },
      { kind: 'attack', d20: 11, boon: 1, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 10 }, // fray 4 + [D]6×1
      { kind: 'move', actorId: foe.id, movement: 'shove', distance: 2 },
    ]);
    expect(boosted.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(boosted.state.actors[foe.id].hp).toBe(18); // 28 from the earlier miss - 10

    expect(boosted.state.actors[hero.id].ruleState['wicked-sheath:charged']).toBe(false); // discarded by the hit
    expect(boosted.state.actors[hero.id].resources['wicked-sheath-die']).toBe(0);
  });

  it('enforces the chapter gate for Chapter 3 abilities', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 2, y: 1 }, chapter: 2 });
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:wicked-sheath', targetIds: [foe.id] }, scriptedDice(12, 5))).toThrow(/Chapter 3/);
  });
});