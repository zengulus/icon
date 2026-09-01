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

  it('Demon Cutter: line-3 true-strike attack, slashed target, and line-area fray', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ second: { x: 5, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(12, 5));
    expect(mutationsOf(result.events, 'demon-slayer:demon-cutter')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true, critical: false },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(result.state.actors[hero.id].attackedThisTurn).toBe(true);
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - 4 area fray - 9 attack
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
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - 4 area fray - 9 attack
    expect(result.state.actors[foe.id].statuses).toContain('slashed');
    expect(result.state.actors[second.id].hp).toBe(32); // outside the line
    expect(applyEvents(setup, result.events)).toEqual(result.state);
  });

  it('Demon Cutter: Charge repeats the area effect in a second non-overlapping line', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ second: { x: 1, y: 3 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      attackTargetId: foe.id,
    }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[second.id].hp).toBe(28); // hit by the second line
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter talent 2: rush 1 before the attack, and the line originates from the new position', () => {
    // The first program-level talent variant (F7): the program reads the
    // equipped choice through the projected `talents` surface and emits the
    // pre-ability rush itself, so the changed attack origin rides the same
    // deterministic event (never a post-mutation fold effect).
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: hero.id, movement: 'rush', positions: [{ x: 2, y: 1 }] },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - 4 area fray - 9 attack, hit from the new origin
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter talent 2: a slow turn rushes 3 instead, and the charge line follows the new origin', () => {
    // The range gate checks the target against the pre-rush origin, so the
    // foe sits within range 3 of (1,1); the rush-3 path (2,1),(3,1),(4,1) is
    // clear and the post-rush line from (4,1) reaches the foe at (4,2).
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 4, y: 2 }, second: { x: 6, y: 1 }, ally: null, talents: { 'demon-slayer:demon-cutter': 2 }, slowTurn: true });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: hero.id, movement: 'rush', positions: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' }, // second line from the post-rush origin
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 9 },
    ]);
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(19);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Demon Cutter: the pre-ability rush is gated on talent 2 — a slow turn alone never rushes', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 3, y: 1 }, second: { x: 1, y: 3 }, slowTurn: true });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(12, 5));
    const mutations = mutationsOf(result.events, 'demon-slayer:demon-cutter');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
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



  it('Draken Cross: the optional Effect may be declined — a legal use resolves with only the primary blast', () => {
    // "Effect: You may rush 1, then target another small blast area in range
    // 3…" (p.128) is entirely OPTIONAL: a use without the recorded decision
    // performs no rush and no second area, and a legal Draken Cross must
    // still resolve.
    const { state, hero, foe, second } = demonSlayerEncounter({ second: { x: 0, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 15 }, // 2[D] = 11 + fray 4
    ]);
    expect(mutations.some((mutation) => mutation.kind === 'move')).toBe(false);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(0);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 1 }); // never rushed
    expect(result.state.actors[foe.id].hp).toBe(13);
    expect(result.state.actors[second.id].hp).toBe(32); // outside the small blast
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: the Effect rushes 1, then its second-area legality is judged from the POST-rush position', () => {
    // The center (4,5) is 4 spaces from the pre-rush cell (1,1) but 3 from
    // the post-rush origin (1,2) — legal only because the supplied center is
    // validated against the position AFTER the rush, and non-overlapping
    // with the primary blast around the target (2,1).
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 5 }, ally: null });
    // The eastward default rush is blocked by the adjacent foe, so the
    // origin is still (1,1): the same center is now out of range 3 and the
    // Effect fails closed rather than guessing another center.
    expect(() => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { effect: true }, positions: { 'effect-area-1': [{ x: 4, y: 5 }] } },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.position-range' }));
    // With the recorded SOUTH rush the origin becomes (1,2) and the same
    // center is legal: the second blast frays the character lying there.
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { effect: true }, directions: { 'effect-rush-1': { x: 0, y: 1 } }, positions: { 'effect-area-1': [{ x: 4, y: 5 }] } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'move', actorId: hero.id, movement: 'rush' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 15 },
    ]);
    expect(result.state.actors[hero.id].position).toEqual({ x: 1, y: 2 });
    expect(result.state.actors[foe.id].hp).toBe(13);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: a supplied effect center that overlaps an area of this use fails closed', () => {
    // p.128 "The areas cannot overlap": both overlap directions reject — a
    // second area over the primary blast, and a repeated area over the
    // first Effect area.
    const overlapPrimary = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 5 }, ally: null });
    expect(() => executeCommand(overlapPrimary.state, {
      type: 'USE_ABILITY', actorId: overlapPrimary.hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [overlapPrimary.foe.id],
      // South rush → origin (1,2); center (2,2) is in range but its small
      // blast overlaps the primary around the target (2,1).
      input: { booleans: { effect: true }, directions: { 'effect-rush-1': { x: 0, y: 1 } }, positions: { 'effect-area-1': [{ x: 2, y: 2 }] } },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.area-overlap' }));
    // Repeat overlap: the repeated Effect's area equals the first Effect's
    // (and reuses its rush chain) — rejected, never silently re-targeted.
    const repeat = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 5 }, ally: null, slowTurn: true });
    expect(() => executeCommand(repeat.state, {
      type: 'USE_ABILITY', actorId: repeat.hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [repeat.foe.id],
      input: {
        booleans: { effect: true, repeat: true },
        directions: { 'effect-rush-1': { x: 0, y: 1 }, 'effect-rush-2': { x: 0, y: 1 } },
        positions: { 'effect-area-1': [{ x: 4, y: 5 }], 'effect-area-2': [{ x: 4, y: 5 }] },
      },
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'choice.area-overlap' }));
  });

  it('Draken Cross talent 2: medium blasts require the RECORDED player decision — chosen or left small', () => {
    // Talent II is "all areas MAY be increased to medium blasts instead"
    // (p.128): a REAL player choice (larger areas can include unintended
    // characters/terrain), recorded durably on the command and applying to
    // every area of the use. Declining keeps the areas small.
    const declined = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 2 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const declinedResult = executeCommand(declined.state, { type: 'USE_ABILITY', actorId: declined.hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [declined.foe.id] }, scriptedDice(12, 5, 6));
    expect(declinedResult.state.actors[declined.second.id].hp).toBe(32); // outside the small primary
    expect(mutationsOf(declinedResult.events, 'demon-slayer:draken-cross').filter((mutation) => mutation.kind === 'damage' && mutation.actorId === declined.second.id)).toHaveLength(0);
    expect(applyEvents(declined.state, declinedResult.events)).toEqual(declinedResult.state);

    const chosen = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 2 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const chosenResult = executeCommand(chosen.state, {
      type: 'USE_ABILITY', actorId: chosen.hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [chosen.foe.id],
      input: { booleans: { 'medium-areas': true } },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(chosenResult.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'damage', actorId: chosen.foe.id, amount: 4, delivery: 'area' },
      { kind: 'damage', actorId: chosen.second.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: chosen.foe.id, amount: 15 },
    ]);
    expect(chosenResult.state.actors[chosen.foe.id].hp).toBe(13); // 32 - 4 fray - 15
    expect(chosenResult.state.actors[chosen.second.id].hp).toBe(28); // the medium primary fray
    expect(applyEvents(chosen.state, chosenResult.events)).toEqual(chosenResult.state);
  });

  it('Draken Cross: Charge/Heroic may repeat the WHOLE Effect — its own rush, its own area — and the foe is NOT re-damaged', () => {
    // p.128 "Charge or Heroic: … may repeat the effect." The repeat is the
    // whole optional operation again — a SECOND recorded rush and a SECOND
    // independent area (non-overlapping with every prior one) — never another
    // damage instance against an existing blast.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 5, y: 5 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: {
        booleans: { effect: true, repeat: true },
        directions: { 'effect-rush-1': { x: 1, y: 0 }, 'effect-rush-2': { x: 0, y: 1 } },
        positions: { 'effect-area-1': [{ x: 5, y: 5 }], 'effect-area-2': [{ x: 2, y: 6 }] },
      },
    }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    const rushes = mutations.filter((mutation) => mutation.kind === 'move' && mutation.movement === 'rush');
    expect(rushes).toHaveLength(2); // the Effect's rush 1 + the repeated Effect's OWN rush 1
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 2 });
    const secondDamages = mutations
      .filter((mutation) => mutation.kind === 'damage')
      .filter((mutation) => mutation.actorId === second.id);
    expect(secondDamages).toHaveLength(1); // the FIRST Effect's fray — the repeat does NOT re-damage it
    expect(secondDamages[0] && secondDamages[0].kind === 'damage' ? secondDamages[0].amount : 0).toBe(4);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(result.state.actors[foe.id].hp).toBe(13); // 32 - 4 primary fray - 15
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross: declining the repeat is legal — Charge resolves the Effect once', () => {
    // Talent 2 widens the attack/effect range to 5 on the slow turn; the
    // repeat stays DECLINED, so only one Effect invocation resolves.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 0, y: 0 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { effect: true }, directions: { 'effect-rush-1': { x: 1, y: 0 } }, positions: { 'effect-area-1': [{ x: 3, y: 4 }] } },
    }, scriptedDice(12, 5, 6));
    const rushes = mutationsOf(result.events, 'demon-slayer:draken-cross').filter((mutation) => mutation.kind === 'move' && mutation.movement === 'rush');
    expect(rushes).toHaveLength(1);
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross talent 2 + Charge: a LATER area can be medium — a foe in its medium-only fringe is hit', () => {
    // "all areas may be increased to medium blasts" covers the Effect's area
    // as well as the primary. With Charge + talent 2 + the recorded
    // decision, the Effect's radius-2 square at (5,6) catches the foe at
    // (5,4) — outside that area's small radius-1 square — while the medium
    // primary around the target (5,1) does NOT reach it.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 5, y: 4 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id],
      input: { booleans: { effect: true, 'medium-areas': true }, directions: { 'effect-rush-1': { x: 0, y: 1 } }, positions: { 'effect-area-1': [{ x: 5, y: 6 }] } },
    }, scriptedDice(12, 5, 6));
    const secondDamages = mutationsOf(result.events, 'demon-slayer:draken-cross')
      .filter((mutation) => mutation.kind === 'damage')
      .filter((mutation) => mutation.actorId === second.id);
    expect(secondDamages).toHaveLength(1);
    expect(secondDamages[0] && secondDamages[0].kind === 'damage' ? secondDamages[0].amount : 0).toBe(4);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(result.state.actors[foe.id].hp).toBe(13); // 32 - 4 primary fray - 15 attack
    expect(applyEvents(state, result.events)).toEqual(result.state);
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

  it('Draken Cross talent 2: the medium-blast upgrade is gated on the slow turn', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 2 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 15 },
    ]);
    expect(result.state.actors[second.id].hp).toBe(32); // outside the small blast
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross talent 2 + Charge: the attack target may legally be chosen at range 4/5 (shared charge-gated range rule)', () => {
    // ICON p.128 talent 2: "Charge: Increase range to 5…" — the range half is
    // the shared charge-gated range rule folded by the generic USE_ABILITY
    // gate, so a target at distance 4 is LEGAL on a slow turn with the talent
    // equipped (previously the gate kept the target capped at range 3).
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 0, y: 0 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6));
    expect(result.state.actors[foe.id].hp).toBe(13); // 32 - 4 primary fray - 15 (2[D] = 11 + fray 4)
    expect(result.state.actors[hero.id].actionsRemaining).toBe(0);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross talent 2 + Charge: a target beyond range 5 is still rejected', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 7, y: 1 }, second: { x: 0, y: 0 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6)))
      .toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });

  it('Draken Cross: without talent 2, Charge does NOT expand the range', () => {
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 0, y: 0 }, ally: null, slowTurn: true });
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6)))
      .toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });

  it('Draken Cross talent 2: Heroic WITHOUT Charge does NOT activate the Charge-only range/area upgrade', () => {
    // The Talent clause is "Charge:" — Charge and Heroic are distinct ICON
    // triggered effects, so a Heroic alone (no slow turn) keeps range 3 and
    // small blasts even with the talent equipped.
    const { state, hero, foe } = demonSlayerEncounter({ foe: { x: 5, y: 1 }, second: { x: 0, y: 0 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 } });
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:draken-cross',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
      triggers: ['heroic'],
    }, scriptedDice(12, 5, 6))).toThrowError(expect.objectContaining({ code: 'ability.range' }));
    // With an in-range target, the areas stay small: a foe in the medium-only
    // fringe of the primary blast is NOT hit on a Heroic alone.
    const small = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 2 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 } });
    const heroic = executeCommand(small.state, {
      type: 'EXECUTE_RULE',
      actorId: small.hero.id,
      sourceId: 'demon-slayer:draken-cross',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: small.foe.id,
      triggers: ['heroic'],
    }, scriptedDice(12, 5, 6));
    expect(heroic.state.actors[small.second.id].hp).toBe(32); // outside the small primary blast (r1)
    expect(applyEvents(small.state, heroic.events)).toEqual(heroic.state);
  });

  it('Draken Cross: the medium-blast upgrade also requires talent 2 — a slow turn alone keeps small blasts', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 2 }, ally: null, slowTurn: true });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 15 },
    ]);
    expect(result.state.actors[second.id].hp).toBe(32); // the charge repeat re-frays the second blast, not the primary
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
