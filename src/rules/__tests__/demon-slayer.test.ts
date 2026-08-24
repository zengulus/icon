import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { findAbility, JOBS } from '../catalog.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnOnly, endTurnTo, startEncounterTo} from './fixtures.js';

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
  it('marks all nine abilities executable in the catalog and audit', () => {
    expect(EXECUTABLE_JOB_ABILITY_IDS.size).toBe(144); // all 16 jobs × 9 abilities
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

  it('Demon Cutter: Charge repeats the area effect in a second non-overlapping line', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ second: { x: 1, y: 3 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:demon-cutter',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      attackTargetId: foe.id,
      triggers: ['charge'],
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

  it('Draken Cross: two-action small-blast attack with a second non-overlapping blast', () => {
    const { state, hero, foe, second } = demonSlayerEncounter({ second: { x: 0, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 15 }, // 2[D] = 11 + fray 4
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(13);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Draken Cross talent 2: charged blasts become medium and catch a foe outside the small blast', () => {
    // The second program-level talent variant (F7), same seam as Demon Cutter
    // t2: the program reads the equipped choice through the projected
    // `talents` surface and upgrades both blasts to medium (radius 2) on a
    // slow turn. The foe at (4,2) sits inside the medium blast around the
    // target (2,1) but outside the small one.
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 2, y: 1 }, second: { x: 4, y: 2 }, ally: null, talents: { 'demon-slayer:draken-cross': 2 }, slowTurn: true });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:draken-cross', targetIds: [foe.id] }, scriptedDice(12, 5, 6));
    const mutations = mutationsOf(result.events, 'demon-slayer:draken-cross');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 15 }, // 2[D] = 11 + fray 4
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(13);
    expect(result.state.actors[second.id].hp).toBe(28); // hit by the medium primary blast
    expect(applyEvents(state, result.events)).toEqual(result.state);
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
    expect(result.state.actors[hero.id].interruptUses['demon-slayer:righteous-disdain']).toBe(1);
    expect(result.state.actors[hero.id].interruptUsedThisTurn).toBe(true);
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
    const { state, hero, foe, second } = demonSlayerEncounter({ foe: { x: 4, y: 1 }, second: { x: 4, y: 2 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:demon-claw', targetIds: [] }, scriptedDice());
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
    expect(rushed.actors[hero.id].ruleState['gates-of-hell:vigilance-rushed']).toBe(true);
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
