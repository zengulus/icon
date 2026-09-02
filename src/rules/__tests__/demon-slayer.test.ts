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
  // Demon Strength is this job's heroic source and is fully executable
  // (Strive fails closed while its shove/half-damage seams are missing);
  // the explicit trait set makes the entitlement independent of catalog
  // defaults.
  hero.traitIds = ['demon-slayer:trait:demon-strength'];
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

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Demon Slayer ability automation (p.128–130)', () => {
  it('marks the reviewed abilities executable in the catalog and audit', () => {
    // 141 of 144 catalogued job abilities are executable; the three
    // documented non-executable abilities (raging-wolf, dark-knight,
    // eye-of-the-storm) are deliberately unresolved, so the allowlist is
    // 141. Comet and Draken Cross are executable with the EXACT Blast
    // templates (area-geometry blastTemplateCells), never squareArea
    // approximations.
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
    // line 3 area in range. The areas cannot overlap." Once the ability
    // gains range 2, ICON Line rules make the PRIMARY Line a ranged,
    // RECORDED player choice too (the origin is the first space of the
    // line, not the user); the repeat is MANDATORY once Charge fires — only
    // the AREAS are recorded player choices (Line 3 paths, never invented
    // directions).
    const { state, hero, foe, second } = demonSlayerEncounter({ second: { x: 3, y: 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        positions: {
          'primary-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
          'second-line': [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }],
        },
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

  it('Demon Cutter + Charge: the PRIMARY line is a recorded ranged choice — a line placed away from the user is legal', () => {
    // A ranged Line's origin is its FIRST space (ICON p.97): once Demon
    // Cutter gains range 2 under Charge, the primary Line 3 no longer
    // emanates from the user — it is placed anywhere legal (at least one
    // space within range 2) and its direction is never inferred from the
    // target. The primary line (3,2),(4,2),(5,2) has its nearest cell at
    // Chebyshev distance 2 from (1,1): legal but NOT adjacent, and its
    // direction is perpendicular to the target.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 4, y: 2 }, second: { x: 3, y: 4 }, ally: null, slowTurn: true });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        positions: {
          'primary-line': [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }],
          'second-line': [{ x: 3, y: 3 }, { x: 3, y: 4 }, { x: 3, y: 5 }],
        },
      },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' }, // the repeated line frays (3,4)
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(23); // attack only — the primary line frays everyone but the attack space
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter + Charge: a primary line that does not include the attack target fails closed', () => {
    // ICON Line attack rules: the attack space may be any character IN the
    // area. A recorded primary Line 3 that misses the chosen attack target
    // is malformed — the command fails atomically.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 9, y: 9 }, ally: null, slowTurn: true });
    const before = structuredClone(state);
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        positions: {
          'primary-line': [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }], // target at (3,1) not inside
          'second-line': [{ x: 5, y: 2 }, { x: 6, y: 2 }, { x: 7, y: 2 }],
        },
      },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
    expect(state).toEqual(before);
  });

  it('Demon Cutter + Heroic: the ranged PRIMARY line uses the same recorded placement semantics as Charge', () => {
    // "Charge or Heroic" (p.128) share one ranged-Line placement model: the
    // primary Line 3 is a recorded choice in range 2, the repeated line is
    // mandatory, and the two areas cannot overlap.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 1, y: 3 }, ally: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: {
        actorIds: { target: [foe.id] },
        positions: {
          'primary-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
          'second-line': [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }],
        },
      },
      attackTargetId: foe.id,
      triggers: ['heroic'],
    }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    // The Heroic declaration first applies Demon Strength's lockout condition,
    // then the ability's own mutations resolve.
    expect(mutations[0]).toMatchObject({ kind: 'condition', conditionId: 'demon-strength:heroic-lockout' });
    expect(mutations.slice(1)).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[second.id].hp).toBe(28);
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
      input: {
        actorIds: { target: [foe.id] },
        positions: { 'primary-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] },
      },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-required' }));
    expect(state).toEqual(before);
  });

  it('Demon Cutter: a missing PRIMARY line under Charge fails closed with nothing emitted', () => {
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
        positions: {
          'primary-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
          'second-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
        },
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
        positions: {
          'primary-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
          'second-line': [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }],
        },
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
        positions: {
          'primary-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
          'second-line': [{ x: 5, y: 3 }, { x: 6, y: 3 }, { x: 7, y: 3 }],
        },
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
        positions: {
          'primary-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
          'second-line': [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }], // an L, not a straight line
        },
      },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
  });

  it('Demon Cutter talent 2: a RECORDED rush 1 before the attack moves the line origin', () => {
    // Talent II (p.128): "You can rush 1 before using Demon Cutter." The
    // rush is OPTIONAL player movement: it requires the recorded
    // invoke/decline choice AND a recorded PATH — never an auto-rush
    // toward the nearest foe. The changed attack origin rides the same
    // deterministic event (never a post-mutation fold effect).
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: { booleans: { 'rush-before': true }, positions: { 'rush-before': [{ x: 2, y: 1 }] } },
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
    // The recorded rush-3 path moves the attack origin to (4,1), from which
    // the recorded primary charge line (ranged, first space = line origin)
    // reaches the target at (4,2) and the repeated line is mandatory.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 2 }, second: { x: 9, y: 9 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: {
        booleans: { 'rush-before': true },
        positions: {
          'rush-before': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
          'primary-line': [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }],
          'second-line': [{ x: 5, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }],
        },
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
      input: { booleans: { 'rush-before': true }, positions: { 'rush-before': [{ x: 1, y: -1 }] } },
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
    expect(state).toEqual(before);
  });

  it('Demon Cutter talent 2: an elected rush without a recorded path fails closed', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 } });
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: { booleans: { 'rush-before': true } },
    }, scriptedDice(12, 5))).toThrowError(expect.objectContaining({ code: 'choice.position-required' }));
  });

  it('Demon Cutter talent 2: a slow turn rushes 3 instead, and the charge line follows the new origin', () => {
    // The recorded rush-3 path moves the origin to (4,1); the recorded
    // primary line (3,2),(4,2),(5,2) is a ranged choice in range 2 of the
    // post-rush origin and contains the target at (4,2); the repeated line
    // frays the second foe at (6,1).
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 4, y: 2 }, second: { x: 6, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id],
      input: {
        booleans: { 'rush-before': true },
        positions: {
          'rush-before': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
          'primary-line': [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }],
          'second-line': [{ x: 5, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }],
        },
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
      input: {
        positions: {
          'primary-line': [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
          'second-line': [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }],
        },
      },
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

  it('Comet: the exact MEDIUM blast template (center + 8 surrounding squares) is the area footprint', () => {
    // ICON p.97: the medium blast template is the central square plus the 8
    // surrounding squares — the same cell set as Burst 1. Comet (p.128) is a
    // Medium Blast at range 3; the default center is (1,1)+3×east = (4,1),
    // so the template covers x 3..5, y 0..2. The foe at (6,1) is OUTSIDE — a
    // radius-2 approximation used to hit it; the exact template never does.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 6, y: 1 }, second: { x: 4, y: 0 }, ally: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:comet', targetIds: [] }, scriptedDice());
    const mutations = mutationsOf(result.events, 'demon-slayer:comet');
    const damages = mutations.filter((mutation) => mutation.kind === 'damage');
    expect(damages).toHaveLength(1);
    expect(damages[0]).toMatchObject({ actorId: second.id, amount: 2, delivery: 'area' });
    expect(mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id)).toHaveLength(0);
    expect(result.state.actors[foe.id].hp).toBe(32);
    expect(result.state.actors[second.id].hp).toBe(30);
    expect(result.state.actors[hero.id].ruleState['weapon-deployed']).toBe(true);
    expect(result.state.terrainEffects.filter((effect) => effect.terrain === 'rampart')).toHaveLength(4);
    const weapon = Object.values(result.state.entities).find((entity) => entity.state['thrownWeapon'] === true);
    expect(weapon!.positions[0]).toEqual({ x: 4, y: 1 }); // unblocked center
    expect(() => executeCommand(result.state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(15, 5))).toThrow(/deployed/);
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

  it('Draken Cross: the exact SMALL blast template excludes the DIAGONAL squares of the attack space', () => {
    // ICON p.97: the small blast template is the central square plus its 4
    // ORTHOGONAL neighbors only (a plus) — the four diagonal squares are NOT
    // in it. Draken Cross is a Small Blast attack on the target at (3,1);
    // the ally at (4,0) sits diagonal to the attack space, so it takes no
    // primary-blast fray (a radius-1 square approximation would have hit
    // it). The REQUIRED second blast at (3,4) frays the character there.
    const { state, hero, foe, second, ally } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 4 }, ally: { x: 4, y: 0 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 15 },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
    ]);
    expect(mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === ally.id)).toHaveLength(0);
    expect(result.state.actors[ally.id].hp).toBe(ally.hp); // diagonal = outside the small template, unhit
    expect(result.state.actors[foe.id].hp).toBe(17);
    expect(result.state.actors[second.id].hp).toBe(28); // frayed once by the required second blast
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: a Size 2 attack-space target straddling the blast needs the OWNER branch choice (attack)', () => {
    // ICON p.290: a large character inside an AoE attack's attack space AND
    // the area picks ONE branch — the owner chooses. The Size 2 foe anchored
    // in the central space (3,1) occupies (3,1),(4,1),(3,2),(4,2): (3,1) is
    // the attack space, while (4,1) and (3,2) are primary-blast area cells.
    // A recorded ATTACK branch applies the hit once and excludes the target
    // from the primary fray — never the old blanket target-ID exclusion.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 4 }, ally: null });
    state.actors[foe.id].size = 2;
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { 'target-branch-area': false }, positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    const targetAreaDamages = mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id && mutation.delivery === 'area');
    expect(targetAreaDamages).toHaveLength(0); // attack branch — no primary fray on the target
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - 15 attack once
    expect(result.state.actors[second.id].hp).toBe(28); // required second blast fray
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: the same straddling Size 2 target under a recorded AREA branch takes the primary fray once, never the hit', () => {
    // The owner chooses the AREA branch instead: the target takes the
    // primary-blast fray EXACTLY ONCE (identity-deduplicated over its
    // multi-cell footprint) and no hit/miss/crit damage — the two branches
    // never stack.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 4 }, ally: null });
    state.actors[foe.id].size = 2;
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { 'target-branch-area': true }, positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    const targetDamages = mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === foe.id);
    expect(targetDamages).toHaveLength(1); // exactly one branch, once
    expect(targetDamages[0]).toMatchObject({ amount: 4, delivery: 'area' });
    expect(result.state.actors[foe.id].hp).toBe(28); // 32 - 4 fray; no 15 hit
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: a missing owner branch choice for the straddling Size 2 target FAILS closed', () => {
    // The source grants the owner the choice — the engine never invents one.
    // A straddling large target without the recorded branch decision rejects
    // the whole command atomically.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 4 }, ally: null });
    state.actors[foe.id].size = 2;
    const before = structuredClone(state);
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.effect-branch-required' }));
    expect(state).toEqual(before);
  });

  it('Draken Cross: a size-1 attack-space target needs NO branch choice (attack is its only branch)', () => {
    // p.97: the attack-space character takes the attack INSTEAD of the area
    // effect — for a size-1 target that is a single branch, so the fixture
    // resolves without any recorded arbitration.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 4 }, ally: null });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - 15 attack, once
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: the Dark Wind Devil Blade mastery stays UNRESOLVED — no teleport or divine splash is invented', () => {
    // "After using this ability you may teleport to any space of an area
    // created, then all foes in created areas are slashed and take 2 divine
    // damage" needs the created-blade cells kept durably for a post-use fold
    // and a RECORDED teleport destination. Neither is approximated:
    // mastering the ability changes nothing observable about the base
    // resolution.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 3 }, ally: null });
    state.actors[hero.id].masteredAbilityIds = ['demon-slayer:draken-cross'];
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 1 }); // never teleported
    expect(mutationsOf(result.events, 'demon-slayer:draken-cross').some((mutation) => mutation.kind === 'move' && mutation.movement !== 'rush')).toBe(false);
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

  it('Demon Claw normal path (after attacking): each rush step\'s "may deal 2 damage to an adjacent foe" is the player\'s WHETHER + WHICH choice — recorded or declined, never auto-hit, never id-first', () => {
    // p.129: "Each time, you may deal 2 damage to an adjacent foe." The
    // per-step selection rides `demon-claw-damage-1`/`demon-claw-damage-2`;
    // absent = declined that step (even with exactly one eligible foe),
    // recorded = validated against the step's eligible set (living adjacent
    // foe, once per use), anything else fails closed. Hero rushes (2,1) then
    // (3,1); adjacency is the p.92 Chebyshev footprint metric.
    const declined = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 9, y: 9 }, ally: null });
    declined.state.actors[declined.hero.id].attackedThisTurn = true;
    const none = executeCommand(declined.state, { type: 'USE_ABILITY', actorId: declined.hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } } } }, scriptedDice());
    const noDamages = mutationsOf(none.events, 'demon-slayer:demon-claw').filter((mutation) => mutation.kind === 'damage');
    expect(noDamages).toHaveLength(0); // a single eligible foe still requires the "may" decision
    expect(none.state.actors[declined.foe.id].hp).toBe(32);
    expect(applyEvents(declined.state, none.events)).toEqual(none.state);

    const step2 = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 9, y: 9 }, ally: null });
    step2.state.actors[step2.hero.id].attackedThisTurn = true;
    const hit2 = executeCommand(step2.state, { type: 'USE_ABILITY', actorId: step2.hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } }, actorIds: { 'demon-claw-damage-2': [step2.foe.id] } } }, scriptedDice());
    const twoDamages = mutationsOf(hit2.events, 'demon-slayer:demon-claw').filter((mutation) => mutation.kind === 'damage');
    expect(twoDamages).toHaveLength(1); // step 1 declined, step 2 hit
    expect(twoDamages[0]!.amount).toBe(2);
    expect(hit2.state.actors[step2.foe.id].hp).toBe(30); // 32 - 2
    expect(applyEvents(step2.state, hit2.events)).toEqual(hit2.state);

    const step1 = demonSlayerEncounter({ foe: { x: 2, y: 2 }, second: { x: 9, y: 9 }, ally: null });
    step1.state.actors[step1.hero.id].attackedThisTurn = true;
    const hit1 = executeCommand(step1.state, { type: 'USE_ABILITY', actorId: step1.hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } }, actorIds: { 'demon-claw-damage-1': [step1.foe.id] } } }, scriptedDice());
    const oneDamages = mutationsOf(hit1.events, 'demon-slayer:demon-claw').filter((mutation) => mutation.kind === 'damage');
    expect(oneDamages).toHaveLength(1);
    expect(hit1.state.actors[step1.foe.id].hp).toBe(30); // step 1 hit, step 2 declined
    expect(applyEvents(step1.state, hit1.events)).toEqual(hit1.state);
  });

  it('Demon Claw normal path: with several eligible adjacent foes only the RECORDED one is hit; an ineligible recording FAILS closed; the once-per-use exclusion rejects a re-record', () => {
    // Both foes adjacent to the step-2 cell (3,1) — the player's WHICH
    // choice decides; the unrecorded foe is never touched.
    const pair = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 4, y: 2 }, ally: null });
    pair.state.actors[pair.hero.id].attackedThisTurn = true;
    const chosen = executeCommand(pair.state, { type: 'USE_ABILITY', actorId: pair.hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } }, actorIds: { 'demon-claw-damage-2': [pair.foe.id] } } }, scriptedDice());
    const chosenDamages = mutationsOf(chosen.events, 'demon-slayer:demon-claw').filter((mutation) => mutation.kind === 'damage');
    expect(chosenDamages).toHaveLength(1);
    expect(chosenDamages[0]!.actorId).toBe(pair.foe.id);
    expect(chosen.state.actors[pair.foe.id].hp).toBe(30);
    expect(chosen.state.actors[pair.second.id].hp).toBe(32); // untouched
    expect(applyEvents(pair.state, chosen.events)).toEqual(chosen.state);

    // A recorded foe that is not a living adjacent eligible foe at that step
    // (off-board here) is a malformed choice — fail closed, never ignored.
    const invalid = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 9, y: 9 }, ally: null });
    invalid.state.actors[invalid.hero.id].attackedThisTurn = true;
    expect(() => executeCommand(invalid.state, { type: 'USE_ABILITY', actorId: invalid.hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } }, actorIds: { 'demon-claw-damage-2': [invalid.second.id] } } }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'choice.actor-ineligible' }));

    // "Foes can only be damaged once per use": a foe hit at step 1 is
    // excluded from the step-2 eligible set, so recording it again is a
    // malformed choice (2,2 is adjacent to BOTH step cells).
    const once = demonSlayerEncounter({ foe: { x: 2, y: 2 }, second: { x: 9, y: 9 }, ally: null });
    once.state.actors[once.hero.id].attackedThisTurn = true;
    expect(() => executeCommand(once.state, { type: 'USE_ABILITY', actorId: once.hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } }, actorIds: { 'demon-claw-damage-1': [once.foe.id], 'demon-claw-damage-2': [once.foe.id] } } }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'choice.actor-ineligible' }));
  });

  it('Demon Claw special path never targets a defeated adjacent foe (U3 eligibility)', () => {
    // Defeat leaves an actor on-field (rescuable), so a raw side/distance
    // scan would include it; the shared U3 candidate authority excludes
    // defeated actors by default. Only the living adjacent foe takes the
    // per-step damage.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 4, y: 2 }, ally: null });
    state.actors[foe.id].defeated = true;
    state.actors[foe.id].hp = 0;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [], input: { directions: { rush1: { x: 1, y: 0 } } } }, scriptedDice());
    const clawDamages = mutationsOf(result.events, 'demon-slayer:demon-claw').filter((mutation) => mutation.kind === 'damage');
    expect(clawDamages).toHaveLength(1);
    expect(clawDamages[0]!.actorId).toBe(second.id);
    expect(result.state.actors[second.id].hp).toBe(30); // 32 - 2
    expect(result.state.actors[foe.id].hp).toBe(0);
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