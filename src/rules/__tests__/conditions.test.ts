import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { applyRuleMutations, encounterRuleState, isBloodied, retaliate } from '../automation/kernels/encounter-adapter.js';
import { RULE_PROGRAM_SCHEMA_VERSION, type RuleExecutionContext, type RuleMutation, type RuleProgram } from '../automation/primitives/types.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand, executeRuleProgramWithReactiveTriggers, orderCrossCharacterEffects } from '../encounter.js';
import { executeRuleProgram, evaluatePredicate } from '../automation/kernels/runtime.js';
import { planMovementPath } from '../movement.js';
import type { EncounterActor, EncounterCondition, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, endTurnOnly, startEncounterTo} from './fixtures.js';

/**
 * Source-derived fixtures for the combat conditions wired into the shared
 * damage, movement, and targeting pipelines (ICON p.104–105). These are the
 * passive vocabulary that Job abilities reference, so they are exercised here
 * independently of any single ability.
 */

interface ConditionFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally: EncounterActor | null;
}

function conditionEncounter(options: { heroAt?: Position; foeAt?: Position; allyAt?: Position | null } = {}): ConditionFixture {
  let state = createEncounter('Conditions fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), options.heroAt ?? { x: 1, y: 1 });
  const foe = createFoe('Relict', options.foeAt ?? { x: 2, y: 1 });
  const ally = options.allyAt === null ? null : actorFromCharacter(validCharacter('Bryn'), options.allyAt ?? { x: 7, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero: state.actors[hero.id], foe: state.actors[foe.id], ally: ally ? state.actors[ally.id] : null };
}

const counterCondition = { id: 'counter', sourceId: 'test', ownerId: null, potency: 'normal' as const, duration: null };
const stealthCondition = { id: 'stealth', sourceId: 'test', ownerId: null, potency: 'normal' as const, duration: null };

describe('combat condition pipeline (p.104–105)', () => {
  it('Rampart blocks a foe dashing across it but not a standard move', () => {
    const { state, hero, foe } = conditionEncounter({ heroAt: { x: 3, y: 3 }, foeAt: { x: 6, y: 3 }, allyAt: null });
    // Fortify (p.116): spaces adjacent to the hero have Rampart.
    state.actors[hero.id].traitIds.push('stalwart:trait:fortify');
    const foeActive = endTurnTo(state, foe.id, scriptedDice());
    expect(foeActive.activeActorId).toBe(foe.id);

    const dash = planMovementPath(foeActive, foe.id, [{ x: 5, y: 3 }, { x: 4, y: 3 }], 'dash');
    expect(dash.legal).toBe(false);
    expect(dash.issue?.code).toBe('move.rampart');

    const standard = planMovementPath(foeActive, foe.id, [{ x: 5, y: 3 }, { x: 4, y: 3 }], 'standard');
    expect(standard.legal).toBe(true);
  });

  it('Slip and Unstoppable ignore Rampart', () => {
    const slipped = conditionEncounter({ heroAt: { x: 3, y: 3 }, foeAt: { x: 6, y: 3 }, allyAt: null });
    slipped.state.actors[slipped.hero.id].traitIds.push('stalwart:trait:fortify');
    slipped.state.actors[slipped.foe.id].traitIds.push('wright:trait:slip');
    const slippedActive = endTurnTo(slipped.state, slipped.foe.id, scriptedDice());
    expect(planMovementPath(slippedActive, slipped.foe.id, [{ x: 5, y: 3 }, { x: 4, y: 3 }], 'dash').legal).toBe(true);

    const unstoppable = conditionEncounter({ heroAt: { x: 3, y: 3 }, foeAt: { x: 6, y: 3 }, allyAt: null });
    unstoppable.state.actors[unstoppable.hero.id].traitIds.push('stalwart:trait:fortify');
    unstoppable.state.actors[unstoppable.foe.id].conditions.push({ id: 'unstoppable', sourceId: 'test', ownerId: null, potency: 'normal', duration: null });
    const unstoppableActive = endTurnTo(unstoppable.state, unstoppable.foe.id, scriptedDice());
    expect(planMovementPath(unstoppableActive, unstoppable.foe.id, [{ x: 5, y: 3 }, { x: 4, y: 3 }], 'dash').legal).toBe(true);
  });

  it('Rampart blocks a foe teleporting into an affected space', () => {
    const { state, hero, foe } = conditionEncounter({ heroAt: { x: 3, y: 3 }, foeAt: { x: 6, y: 3 }, allyAt: null });
    state.actors[hero.id].traitIds.push('stalwart:trait:fortify');
    applyRuleMutations(state, [{
      kind: 'move', sourceId: 'test', sourceActorId: hero.id, actorId: foe.id, movement: 'teleport', distance: null, positions: [{ x: 4, y: 3 }], direction: null, phasing: false,
    }]);
    expect(state.actors[foe.id].position).toEqual({ x: 6, y: 3 }); // entering (4,3) crosses Rampart
  });

  it("Counter's raw damage enters the shared mitigation path", () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    state.actors[foe.id].conditions.push({ ...counterCondition });
    const result = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 6));
    expect(result.state.actors[foe.id].hp).toBe(22); // 32 - (6 + fray 4)
    // Counter supplies a raw normal-damage instance. Aster's Armor 2 then
    // reduces it to zero through the same p.93 kernel as all other damage.
    expect(result.state.actors[hero.id].hp).toBe(40);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Counter preserves Gentleness reflection while suppressing only Counter recursion', () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    state.actors[hero.id].conditions.push({ ...counterCondition });
    state.actors[foe.id].conditions.push({ ...counterCondition });
    state.actors[hero.id].armor = 0;
    state.actors[hero.id].stance = {
      id: 'fixture:gentleness', sourceId: 'fixture:gentleness', ownerId: hero.id,
      stanceId: 'gentleness', state: {},
    };

    // The Counter source (the foe) is inside the hero's Gentleness aura. Its
    // applied normal retaliation deals 2 damage, then takes 1 divine
    // reflection. The hero's own Counter proves that only Counter
    // recursion—not all reactions—is off.
    retaliate(state, state.actors[hero.id], state.actors[foe.id]);

    expect(state.actors[hero.id].hp).toBe(38);
    expect(state.actors[foe.id].hp).toBe(31);
  });

  it('uses the same Defiance application path for dangerous terrain as ability damage', () => {
    const { state, hero } = conditionEncounter({ heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 }, allyAt: null });
    state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'dangerous', elevation: 0 });
    state.actors[hero.id].hp = 2;
    state.actors[hero.id].vigor = 0;
    state.actors[hero.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });

    const result = executeCommand(state, {
      type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }], mode: 'standard',
    });

    expect(result.state.actors[hero.id]).toMatchObject({ hp: 1, vigor: 0, defeated: false });
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'defiance')).toBe(false);
    expect(result.state.actors[hero.id].ruleState['damage-immune']).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('uses the canonical defeat lifecycle when replaying a recorded defeat', () => {
    const { state, hero } = conditionEncounter({ allyAt: null });
    applyRuleMutations(state, [
      { kind: 'persistent', sourceId: 'fixture', ownerId: hero.id, operation: 'add', actorId: hero.id, effectId: 'fixture-effect', duration: { kind: 'combat' }, modifiers: [], triggers: [], state: {} },
      { kind: 'stance', sourceId: 'fixture', sourceActorId: hero.id, operation: 'enter', actorId: hero.id, stanceId: 'fixture-stance', state: {} },
      { kind: 'mark', sourceId: 'fixture', ownerId: hero.id, operation: 'apply', actorId: hero.id, markId: 'fixture-mark', state: {} },
      { kind: 'entity', sourceId: 'fixture', operation: 'create', entityType: 'fixture-summon', ownerId: hero.id, positions: [{ x: 0, y: 0 }], count: 1, state: {} },
    ]);

    const defeated = applyEvents(state, [{ type: 'ACTOR_DEFEATED', actorId: hero.id, woundGained: true }]);
    expect(defeated.actors[hero.id]).toMatchObject({ defeated: true, hp: 0, vigor: 0, statuses: [], conditions: [], activeEffects: [], marks: [], stance: null, wounds: 1 });
    expect(Object.values(defeated.entities).some((entity) => entity.ownerId === hero.id)).toBe(false);
  });

  it('Counter retaliates against resolver-driven ability damage', () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    state.actors[hero.id].abilityIds = ['bastion:heracule'];
    state.actors[foe.id].conditions.push({ ...counterCondition });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[hero.id].hp).toBe(40); // Armor absorbs the raw 2 Counter damage
  });

  it('Slashed only follows an actual self/ally ability movement, once per turn', () => {
    const allied = conditionEncounter({ allyAt: { x: 1, y: 2 } });
    // Conditions are the canonical durable form. Do not rely on the legacy
    // status projection being populated by a migrated/imported snapshot.
    allied.state.actors[allied.hero.id].conditions.push({
      id: 'slashed', sourceId: 'fixture:slashed', ownerId: null, potency: 'normal', duration: null,
    });
    applyRuleMutations(allied.state, [{
      kind: 'move', sourceId: 'fixture:ally-ability', sourceActorId: allied.ally!.id,
      actorId: allied.hero.id, movement: 'rush', distance: null,
      positions: [{ x: 2, y: 1 }], direction: null, phasing: false,
    }, {
      kind: 'move', sourceId: 'fixture:ally-ability', sourceActorId: allied.ally!.id,
      actorId: allied.hero.id, movement: 'rush', distance: null,
      positions: [{ x: 3, y: 1 }], direction: null, phasing: false,
    }]);
    // The fixture hero has Armor 2, so one 4-damage Slashed instance leaves
    // 2 HP damage despite two qualifying ability moves.
    expect(allied.state.actors[allied.hero.id]).toMatchObject({ hp: 38, slashedTriggeredThisTurn: true });

    const hostile = conditionEncounter({ allyAt: null });
    hostile.state.actors[hostile.hero.id].statuses.push('slashed');
    applyRuleMutations(hostile.state, [{
      kind: 'move', sourceId: 'fixture:foe-ability', sourceActorId: hostile.foe.id,
      actorId: hostile.hero.id, movement: 'shove', distance: 1,
      positions: [], direction: { x: -1, y: 0 }, phasing: false,
    }]);
    // A foe forcing the character to move is outside p.104's self/ally gate.
    expect(hostile.state.actors[hostile.hero.id]).toMatchObject({ hp: 40, slashedTriggeredThisTurn: false });
  });

  it('Hatred of X deals full damage to X and half damage to other foes', () => {
    const full = conditionEncounter({ allyAt: { x: 1, y: 3 } });
    applyRuleMutations(full.state, [{ kind: 'condition', sourceId: 'test', sourceActorId: full.hero.id, actorId: full.foe.id, conditionId: 'hatred', operation: 'apply', potency: 'normal' }]);
    expect(full.state.actors[full.foe.id].ruleState['hatred-of']).toBe(full.hero.id);
    const foeActive = endTurnTo(full.state, full.foe.id, scriptedDice());
    const againstX = executeCommand(foeActive, { type: 'BASIC_ATTACK', actorId: full.foe.id, targetId: full.hero.id, weight: 'light' }, scriptedDice(12, 6));
    expect(againstX.state.actors[full.hero.id].hp).toBe(33); // 40 - (9 - armor 2)

    const halved = conditionEncounter({ allyAt: { x: 1, y: 3 } });
    applyRuleMutations(halved.state, [{ kind: 'condition', sourceId: 'test', sourceActorId: halved.hero.id, actorId: halved.foe.id, conditionId: 'hatred', operation: 'apply', potency: 'normal' }]);
    const foeActiveB = endTurnTo(halved.state, halved.foe.id, scriptedDice());
    const againstAlly = executeCommand(foeActiveB, { type: 'BASIC_ATTACK', actorId: halved.foe.id, targetId: halved.ally!.id, weight: 'light' }, scriptedDice(12, 6));
    // ICON p.93 applies armor before the single Hatred halving: 9 - 2 = 7,
    // then ceil(7 / 2) = 4. Multiple paths share this kernel now.
    expect(againstAlly.state.actors[halved.ally!.id].hp).toBe(36);
  });

  it('Hatred ends when the hated target is defeated', () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    applyRuleMutations(state, [{ kind: 'condition', sourceId: 'test', sourceActorId: hero.id, actorId: foe.id, conditionId: 'hatred', operation: 'apply', potency: 'normal' }]);
    expect(state.actors[foe.id].statuses).toContain('hatred');
    applyRuleMutations(state, [{ kind: 'damage', sourceId: 'test', sourceActorId: foe.id, actorId: hero.id, amount: 999, damageType: 'divine', instance: 1, delivery: 'effect', ignoreCover: true }]);
    expect(state.actors[hero.id].defeated).toBe(true);
    expect(state.actors[foe.id].statuses).not.toContain('hatred');
    expect(state.actors[foe.id].ruleState['hatred-of']).toBeUndefined();
  });

  it('Stealth cannot be directly targeted beyond adjacency', () => {
    const { state, hero, foe } = conditionEncounter({ heroAt: { x: 3, y: 1 }, foeAt: { x: 6, y: 1 }, allyAt: null });
    state.actors[foe.id].conditions.push({ ...stealthCondition });
    expect(() => executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 6))).toThrow(/stealth/i);

    const moved = executeCommand(state, { type: 'MOVE', actorId: hero.id, path: [{ x: 4, y: 1 }, { x: 5, y: 1 }], mode: 'standard' }, scriptedDice()).state;
    const adjacent = executeCommand(moved, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 6));
    expect(adjacent.state.actors[foe.id].hp).toBe(22); // 32 - 10
  });

  it('Using an attack ability breaks the user’s own stealth', () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    state.actors[hero.id].conditions.push({ ...stealthCondition });
    const result = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 6));
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'stealth')).toBe(false);
  });

  it('Vigilance: guard rolls d6 and reduces determined damage to a nearby ally', () => {
    const { state, hero, ally } = conditionEncounter({ foeAt: { x: 5, y: 1 }, allyAt: { x: 2, y: 1 } });
    state.actors[hero.id].resources.vigilance = 2;
    const result = executeCommand(state, { type: 'SPEND_VIGILANCE', actorId: hero.id, targetId: ally!.id, use: 'guard', damage: 8 }, scriptedDice(4));
    expect(result.events[0]).toMatchObject({ type: 'VIGILANCE_SPENT', roll: 4, appliedDamage: 4 });
    expect(result.state.actors[ally!.id].hp).toBe(36); // 40 - (8 - 4)
    expect(result.state.actors[hero.id].resources.vigilance).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Vigilance: punish rolls d6 and damages a foe breaking adjacency', () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    state.actors[hero.id].resources.vigilance = 2;
    const result = executeCommand(state, { type: 'SPEND_VIGILANCE', actorId: hero.id, targetId: foe.id, use: 'punish' }, scriptedDice(5));
    expect(result.events[0]).toMatchObject({ type: 'VIGILANCE_SPENT', roll: 5, appliedDamage: 5 });
    expect(result.state.actors[foe.id].hp).toBe(27); // 32 - 5
    expect(result.state.actors[hero.id].resources.vigilance).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Vigilance: punish records Defiance\'s result and replays it identically (p.104)', () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    state.actors[hero.id].resources.vigilance = 2;
    // A roll of 5 is lethal against 3 HP, so Defiance floors the applied
    // amount at 1 HP: the recorded appliedDamage (2) is no longer lethal on
    // its own. Replay must trust the durable defianceTriggered result.
    state.actors[foe.id].hp = 3;
    state.actors[foe.id].vigor = 0;
    state.actors[foe.id].armor = 0;
    state.actors[foe.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });

    const result = executeCommand(state, { type: 'SPEND_VIGILANCE', actorId: hero.id, targetId: foe.id, use: 'punish' }, scriptedDice(5));
    expect(result.events[0]).toMatchObject({ type: 'VIGILANCE_SPENT', roll: 5, appliedDamage: 2, defianceTriggered: true });
    expect(result.state.actors[foe.id]).toMatchObject({ hp: 1, vigor: 0, defeated: false });
    expect(result.state.actors[foe.id].conditions.some(({ id }) => id === 'defiance')).toBe(false);
    expect(result.state.actors[foe.id].ruleState['damage-immune']).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Vigilance: requires charges and a legal target side', () => {
    const { state, hero, foe, ally } = conditionEncounter({ foeAt: { x: 5, y: 1 }, allyAt: { x: 2, y: 1 } });
    expect(() => executeCommand(state, { type: 'SPEND_VIGILANCE', actorId: hero.id, targetId: foe.id, use: 'punish' }, scriptedDice(5))).toThrow(/charges/);
    state.actors[hero.id].resources.vigilance = 1;
    expect(() => executeCommand(state, { type: 'SPEND_VIGILANCE', actorId: hero.id, targetId: foe.id, use: 'guard', damage: 5 }, scriptedDice(3))).toThrow(/ally/);
    expect(() => executeCommand(state, { type: 'SPEND_VIGILANCE', actorId: hero.id, targetId: ally!.id, use: 'punish' }, scriptedDice(3))).toThrow(/foe/);
    expect(state.actors[hero.id].resources.vigilance).toBe(1); // rejected spends do not consume
  });

  it('Slow turn lifecycle: a delayed turn converts to a slow turn and Charge fires', () => {
    let state = createEncounter('Slow turn fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foe = createFoe('Relict', { x: 3, y: 1 });
    const second = createFoe('Grim', { x: 1, y: 3 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
    state = startEncounterTo(state, hero.id);
    const heroId = hero.id;
    state.actors[heroId].abilityIds = ['demon-slayer:demon-cutter'];
    state.actors[heroId].chapter = 3;
    state.actors[heroId].ruleState['six-hells:slow-turn'] = true;

    // ICON p.95 Delay: "your next turn must be a slow turn". The flag is set
    // during the hero's round-1 turn, so the hero's NEXT turn (round 2) is
    // slow. Round 1 closes hero → foe → foe; round 2 opens with the foes
    // (the hero's next turn is slow, so the allied normal slot passes); after
    // the foes' round-2 normal turns, the Slow mini-round (ICON p.87) runs
    // with the delayed hero as the only eligible actor.
    const afterHero = endTurnTo(state, foe.id, scriptedDice());
    const afterFoe = endTurnTo(afterHero, second.id, scriptedDice());
    const round2Foe = endTurnTo(afterFoe, foe.id, scriptedDice());
    const round2Second = endTurnTo(round2Foe, second.id, scriptedDice());
    expect(round2Second.round).toBe(2);
    expect(round2Second.turnPhase).toBe('normal');
    const slowTurn = endTurnTo(round2Second, heroId, scriptedDice());
    expect(slowTurn.round).toBe(2);
    expect(slowTurn.turnPhase).toBe('slow');
    expect(slowTurn.activeActorId).toBe(heroId);
    expect(slowTurn.actors[heroId].ruleState['slow-turn']).toBe(true);
    expect(slowTurn.actors[heroId].ruleState['six-hells:slow-turn']).toBeUndefined();

    // Charge now fires automatically: Demon Cutter's second line frays Grim.
    const used = executeCommand(slowTurn, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'demon-slayer:demon-cutter', targetIds: [foe.id] }, scriptedDice(12, 5));
    expect(used.state.actors[second.id].hp).toBe(28); // 32 - 4 second-line area fray

    const ended = executeCommand(used.state, { type: 'END_TURN', actorId: heroId }, scriptedDice()).state;
    expect(ended.actors[heroId].ruleState['slow-turn']).toBe(false);
  });

  it('Chain Reaction grants 1 Aether once per round after damaging two foes', () => {
    let state = createEncounter('Chain Reaction fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foe = createFoe('Relict', { x: 2, y: 1 });
    const second = createFoe('Grim', { x: 3, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
    state = startEncounterTo(state, hero.id);
    const heroId = hero.id;
    state.actors[heroId].abilityIds = ['bastion:land-waster'];
    state.actors[heroId].chapter = 3;
    state.actors[heroId].traitIds.push('wright:trait:chain-reaction');

    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:land-waster', targetIds: [foe.id] }, scriptedDice(15, 3, 5));
    expect(result.state.actors[heroId].resources.aether).toBe(1);
    expect(result.state.actors[heroId].ruleState['chain-reaction-used']).toBe(true);
  });

  it('isBloodied tracks the after-wounds half of maximum HP', () => {
    const { state, hero } = conditionEncounter({ allyAt: null });
    const actor = state.actors[hero.id];
    actor.hp = Math.floor(actor.baseMaxHp / 2);
    expect(isBloodied(actor)).toBe(true);
    actor.hp = Math.floor(actor.baseMaxHp / 2) + 1;
    expect(isBloodied(actor)).toBe(false);
  });
});

const slayFixtureProgram: RuleProgram = {
  schemaVersion: RULE_PROGRAM_SCHEMA_VERSION,
  rulesVersion: '1.5',
  id: 'test:slay-fixture',
  sourceId: 'test:slay-fixture',
  source: { page: 95, sectionId: 'triggers' },
  name: 'Slay fixture',
  classification: 'encounter',
  dependencies: [],
  actions: [{
    id: 'default',
    name: 'Slay fixture',
    timing: 'use',
    costs: [],
    tags: [],
    range: null,
    area: null,
    choices: [],
    steps: [
      { id: 'damage', timing: 'use', effects: [{ kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'constant', value: 999 }, damageType: 'normal', delivery: 'effect', ignoreCover: true }] },
      { id: 'on-slay', timing: 'use', trigger: 'slay', effects: [{ kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 1 } }] },
    ],
  }],
};

function slayFixtureContext(state: EncounterState, hero: EncounterActor, foe: EncounterActor): RuleExecutionContext {
  return {
    state: encounterRuleState(state),
    actorId: hero.id,
    sourceId: 'test:slay-fixture',
    actionId: 'default',
    timing: 'use',
    input: { actorIds: { target: [foe.id] } },
    dice: scriptedDice(),
    triggers: new Set(),
  };
}

const triggerOrderFixtureProgram: RuleProgram = {
  schemaVersion: RULE_PROGRAM_SCHEMA_VERSION,
  rulesVersion: '1.5',
  id: 'test:trigger-order-fixture',
  sourceId: 'test:trigger-order-fixture',
  source: { page: 95, sectionId: 'triggers' },
  name: 'Trigger order fixture',
  classification: 'encounter',
  dependencies: [],
  actions: [{
    id: 'default',
    name: 'Trigger order fixture',
    timing: 'use',
    costs: [],
    tags: [],
    range: null,
    area: null,
    choices: [],
    steps: [
      { id: 'base', timing: 'use', effects: [
        { kind: 'move', target: { kind: 'input', key: 'target' }, movement: 'shove', distance: { kind: 'constant', value: 1 } },
        { kind: 'damage', target: { kind: 'input', key: 'target' }, amount: { kind: 'constant', value: 999 }, damageType: 'normal', delivery: 'effect', ignoreCover: true },
      ] },
      { id: 'comeback', timing: 'use', trigger: 'comeback', effects: [{ kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 1 } }] },
      { id: 'charge', timing: 'use', trigger: 'charge', effects: [{ kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 2 } }] },
      { id: 'collide', timing: 'use', trigger: 'collide', effects: [{ kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 3 } }] },
      { id: 'slay', timing: 'use', trigger: 'slay', effects: [{ kind: 'resource', target: { kind: 'self' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 4 } }] },
    ],
  }],
};

describe('trigger ordering (p.85, p.107 §4)', () => {
  it('resolves simultaneous triggers in source-listing order, reactive triggers after the base pass', () => {
    const { state, hero, foe } = conditionEncounter({ heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, allyAt: null });
    state.actors[hero.id].ruleState['slow-turn'] = true; // charge
    state.actors[hero.id].hp = Math.floor(state.actors[hero.id].baseMaxHp / 2); // comeback
    state.grid.terrain.push({ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 }); // collide
    const context: RuleExecutionContext = {
      state: encounterRuleState(state),
      actorId: hero.id,
      sourceId: 'test:trigger-order-fixture',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      dice: scriptedDice(),
      triggers: new Set(['charge', 'comeback']),
    };

    const result = executeRuleProgramWithReactiveTriggers(triggerOrderFixtureProgram, context, {}, state);
    expect(result.selectedSteps.map(({ id }) => id)).toEqual(['base', 'comeback', 'charge', 'collide', 'slay']);
    // Base effects (shove + slaying damage) precede every trigger effect.
    expect(result.mutations[0]).toMatchObject({ kind: 'move', movement: 'shove' });
    expect(result.mutations[1]).toMatchObject({ kind: 'damage', amount: 999 });
    const aetherGains = result.mutations
      .filter((mutation): mutation is Extract<RuleMutation, { kind: 'resource' }> => mutation.kind === 'resource' && mutation.resourceId === 'aether' && mutation.operation === 'gain')
      .map((mutation) => mutation.amount);
    expect(aetherGains).toEqual([1, 2, 3, 4]); // comeback, charge, collide, slay
    // Determinism: identical inputs produce the identical mutation sequence.
    const again = executeRuleProgramWithReactiveTriggers(triggerOrderFixtureProgram, context, {}, state);
    expect(again.mutations).toEqual(result.mutations);
  });
});

const roundEndCondition = (ownerId: string): EncounterCondition => ({ id: `condition:${ownerId}`, sourceId: 'test', ownerId, potency: 'normal', duration: { kind: 'round-end' } });

describe('cross-character effect ordering (p.107)', () => {
  it('resolves non-turn effects before the turn character’s and hostile before beneficial', () => {
    const { state, hero, foe, ally } = conditionEncounter({ foeAt: { x: 5, y: 1 }, allyAt: { x: 2, y: 1 } });
    const allyId = ally!.id;
    const pending = [
      { actorId: hero.id, ownerId: hero.id, kind: 'condition' as const, record: roundEndCondition(hero.id), order: 0, boundaryKind: 'round-end' as const },
      { actorId: foe.id, ownerId: foe.id, kind: 'condition' as const, record: roundEndCondition(foe.id), order: 1, boundaryKind: 'round-end' as const },
      { actorId: allyId, ownerId: allyId, kind: 'condition' as const, record: roundEndCondition(allyId), order: 2, boundaryKind: 'round-end' as const },
    ];
    // The round rolls over on the ally's turn, so the ally is the turn
    // character: the foe's hostile effect resolves first, then the hero's
    // beneficial effect, then the turn character's own effect.
    const ordered = orderCrossCharacterEffects(state, allyId, pending);
    expect(ordered.map(({ ownerId }) => ownerId)).toEqual([foe.id, hero.id, allyId]);
  });

  it('expires round-end durations for every actor when the round rolls over', () => {
    const { state, hero, foe, ally } = conditionEncounter({ foeAt: { x: 5, y: 1 }, allyAt: { x: 2, y: 1 } });
    const heroId = hero.id;
    const foeId = foe.id;
    const allyId = ally!.id;
    for (const id of [heroId, foeId, allyId]) state.actors[id].conditions.push(roundEndCondition(id));

    const afterHero = endTurnTo(state, foeId, scriptedDice());
    const afterFoe = endTurnTo(afterHero, allyId, scriptedDice());
    const afterRound = endTurnOnly(afterFoe, scriptedDice());
    expect(afterRound.round).toBe(2);
    for (const id of [heroId, foeId, allyId]) {
      expect(afterRound.actors[id].conditions.some(({ duration }) => duration?.kind === 'round-end')).toBe(false);
    }
  });
});

function awaitablePredicate(context: RuleExecutionContext, foeId: string) {
  return evaluatePredicate({ kind: 'target-state', target: { kind: 'trigger-targets' }, key: 'causal-hit', equals: true }, { ...context, triggerTargetIds: [foeId] });
}

describe('durable resolution facts (p.95, replay)', () => {
  it('records monotonic trigger and causal target facts for continuation consumers', () => {
    const { state, hero, foe } = conditionEncounter({ heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, allyAt: null });
    state.grid.terrain.push({ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 });
    const context: RuleExecutionContext = {
      state: encounterRuleState(state), actorId: hero.id,
      sourceId: 'test:trigger-order-fixture', actionId: 'default', timing: 'use',
      input: { actorIds: { target: [foe.id] } }, dice: scriptedDice(),
      triggers: new Set(),
    };
    const result = executeRuleProgramWithReactiveTriggers(triggerOrderFixtureProgram, context, {}, state);
    expect(result.resolutionFacts).toMatchObject({ collidedActorIds: [foe.id] });
    expect(result.continuation?.executedStepIds).toEqual(['base', 'collide', 'slay']);
    expect(result.continuation?.derivedTriggers).toContain('collide');
  });

  it('target-state predicates evaluate selected causal targets explicitly', () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    foe.ruleState['causal-hit'] = true;
    const context: RuleExecutionContext = { state: encounterRuleState(state), actorId: hero.id, sourceId: 'test:predicate', actionId: 'default', timing: 'use', input: {}, dice: scriptedDice(), triggers: new Set(), resolutionFacts: { triggers: [], attackTargets: [], collidedActorIds: [], slainActorIds: [foe.id] } };
    expect((awaitablePredicate(context, foe.id))).toBe(true);
  });

  it('resolution-targets consumes recorded causal IDs rather than current-state scans', () => {
    const program: RuleProgram = {
      schemaVersion: RULE_PROGRAM_SCHEMA_VERSION, rulesVersion: '1.5', id: 'test:resolution-targets',
      sourceId: 'test:resolution-targets', source: { page: 1, sectionId: 'test' }, name: 'targets', dependencies: [], classification: 'encounter',
      actions: [{ id: 'default', name: 'default', timing: 'use', costs: [], tags: [], range: null, area: null, choices: [], steps: [
        { id: 'slain', timing: 'use', trigger: 'slay', effects: [{ kind: 'resolution-targets', outcome: 'slain', effects: [{ kind: 'resource', target: { kind: 'trigger-targets' }, resourceId: 'aether', operation: 'gain', amount: { kind: 'constant', value: 1 } }] }] },
      ] }],
    };
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    const context: RuleExecutionContext = { state: encounterRuleState(state), actorId: hero.id, sourceId: program.sourceId, actionId: 'default', timing: 'use', input: {}, dice: scriptedDice(), triggers: new Set(['slay']), resolutionFacts: { triggers: ['slay'], attackTargets: [], collidedActorIds: [], slainActorIds: [foe.id] } };
    const result = executeRuleProgram(program, context);
    expect(result.mutations).toEqual([{ kind: 'resource', sourceId: program.sourceId, actorId: foe.id, resourceId: 'aether', operation: 'gain', amount: 1, minimum: null, maximum: null }]);
  });
});

describe('state-derived reactive triggers (p.95)', () => {
  it('Collide is derived when a shove is stopped by an obstruction', () => {
    const { state, hero, foe } = conditionEncounter({ heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, allyAt: null });
    state.actors[hero.id].abilityIds = ['bastion:battering-ram'];
    state.actors[hero.id].chapter = 3;
    state.grid.terrain.push({ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:battering-ram', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].position).toEqual({ x: 2, y: 1 }); // blocked at the first step
    expect(result.state.actors[foe.id].statuses).toContain('slashed');
    expect(result.state.actors[hero.id].actionsRemaining).toBe(2); // Collide refunds the action
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Slay is derived when damage reduces a character to 0 HP', () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    const result = executeRuleProgramWithReactiveTriggers(slayFixtureProgram, slayFixtureContext(state, hero, foe), {}, state);
    expect(result.selectedSteps.map(({ id }) => id)).toContain('on-slay');
    expect(result.mutations.some((mutation) => mutation.kind === 'resource' && mutation.operation === 'gain' && mutation.resourceId === 'aether')).toBe(true);
  });

  it('Slay does not fire when no character is reduced to 0 HP', () => {
    const { state, hero, foe } = conditionEncounter({ allyAt: null });
    const result = executeRuleProgramWithReactiveTriggers(slayFixtureProgram, { ...slayFixtureContext(state, hero, foe), input: {} }, {}, state);
    expect(result.selectedSteps.map(({ id }) => id)).not.toContain('on-slay');
    expect(result.mutations.some((mutation) => mutation.kind === 'resource' && mutation.resourceId === 'aether')).toBe(false);
  });
});
