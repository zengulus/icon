import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS, EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { isInterruptWindowKind, windowHeldDamage } from '../automation/kernels/decision-window.js';
import { encounterConditionSet } from '../automation/kernels/encounter-adapter.js';
import { ABILITIES, JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo, interruptUses, interruptUsedThisTurn, slashedTriggeredThisTurn} from './fixtures.js';
import { oneInterruptPerTurnWindowKey } from '../automation/kernels/use-ledger.js';

/**
 * Source-derived golden fixtures for the independently executable Bastion
 * ability set (ICON p.122–124). Every scenario resolves through the shared
 * encounter reducer, and every accepted command must replay to the exact same
 * state through applyEvents.
 *
 * Mutation order documents the deterministic VM pipeline: action costs are
 * emitted first, then named-resolver effects, then step effects (attack roll
 * before its damage), matching the order executeRuleProgram produces.
 */

interface BastionFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor;
  ally: EncounterActor;
}

function bastionEncounter(options: { foe?: Position; second?: Position; ally?: Position | null } = {}): BastionFixture {
  let state = createEncounter('Bastion fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
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

describe('Bastion ability automation (p.122–124)', () => {
  it('marks the reviewed job abilities executable in the catalog and audit', () => {
    // 143 of 144 catalogued job abilities are executable; colossus:raging-wolf
    // is deliberately unresolved (Ultra Part 1), so the allowlist is 143.
    expect(EXECUTABLE_JOB_ABILITY_IDS.size).toBe(144 - DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS.size);
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const bastionIds = JOBS.find((job) => job.id === 'bastion')!.abilities.map(({ id }) => id);
    for (const abilityId of bastionIds) expect([122, 123, 124]).toContain(findAbility(abilityId)!.source.page);
  });

  it('Heracule: true-strike attack, weakened, and a second-foe shove', () => {
    const { state, hero, foe, second } = bastionEncounter({ second: { x: 6, y: 1 }, ally: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(mutationsOf(result.events, 'bastion:heracule')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'weakened' },
      { kind: 'move', actorId: foe.id, movement: 'shove' },
      { kind: 'move', actorId: second.id, movement: 'shove' },
      { kind: 'attack', d20: 12, hit: true, critical: false },
      { kind: 'damage', actorId: foe.id, amount: 8 },
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(result.state.actors[hero.id].attackedThisTurn).toBe(true);
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(result.state.actors[foe.id].statuses).toContain('weakened');
    expect(result.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(result.state.actors[second.id].position).toEqual({ x: 7, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Heracule: a miss still resolves its effects with only fray damage', () => {
    const { state, hero, foe, second } = bastionEncounter();
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [foe.id] }, scriptedDice(5));
    expect(mutationsOf(result.events, 'bastion:heracule')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'weakened' },
      { kind: 'move', actorId: foe.id, movement: 'shove' },
      { kind: 'move', actorId: second.id, movement: 'shove' },
      { kind: 'attack', d20: 5, hit: false },
      { kind: 'damage', actorId: foe.id, amount: 4 },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(28);
  });

  it('Heracule: a critical adds a damage die', () => {
    const { state, hero, foe, second } = bastionEncounter();
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:heracule', targetIds: [foe.id] }, scriptedDice(20, 4, 6));
    expect(mutationsOf(result.events, 'bastion:heracule')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'weakened' },
      { kind: 'move', actorId: foe.id, movement: 'shove' },
      { kind: 'move', actorId: second.id, movement: 'shove' },
      { kind: 'attack', d20: 20, hit: true, critical: true },
      { kind: 'damage', actorId: foe.id, amount: 8 },
      { kind: 'damage', actorId: foe.id, amount: 6 },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(18);
  });

  it('Battering Ram: shoves an adjacent character and refunds on Collide', () => {
    const { state, hero, foe } = bastionEncounter({ foe: { x: 2, y: 1 }, ally: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:battering-ram', targetIds: [foe.id] }, scriptedDice());
    expect(mutationsOf(result.events, 'bastion:battering-ram')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: foe.id, movement: 'shove', distance: 2 },
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(result.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });

    const colliding = bastionEncounter({ foe: { x: 2, y: 1 }, ally: null });
    const collide = executeCommand(colliding.state, {
      type: 'EXECUTE_RULE',
      actorId: colliding.hero.id,
      sourceId: 'bastion:battering-ram',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [colliding.foe.id] } },
      triggers: ['collide'],
    }, scriptedDice());
    const foeAfter = collide.state.actors[colliding.foe.id];
    expect(foeAfter.statuses).toContain('slashed');
    expect(foeAfter.position).toEqual({ x: 4, y: 1 });
    expect(collide.state.actors[colliding.hero.id].actionsRemaining).toBe(2); // refunded
  });

  it('Land Waster: burst-area fray damage and away-from-target shoves', () => {
    const { state, hero, foe, second } = bastionEncounter({ foe: { x: 2, y: 1 }, second: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:land-waster', targetIds: [foe.id] }, scriptedDice(15, 3, 5));
    const mutations = mutationsOf(result.events, 'bastion:land-waster');
    expect(mutations).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'damage', actorId: foe.id, amount: 4, delivery: 'area' },
      { kind: 'damage', actorId: second.id, amount: 4, delivery: 'area' },
      { kind: 'move', actorId: second.id, movement: 'shove' },
      { kind: 'move', actorId: foe.id, movement: 'shove' },
      { kind: 'attack', d20: 15, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 12 },
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(16);
    expect(result.state.actors[second.id].hp).toBe(28);
    expect(result.state.actors[foe.id].position).toEqual({ x: 3, y: 1 });
    expect(result.state.actors[second.id].position).toEqual({ x: 4, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Valiant: two rushes shove adjacent characters after each rush', () => {
    const { state, hero, foe } = bastionEncounter({ foe: { x: 3, y: 1 }, second: { x: 6, y: 1 }, ally: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:valiant', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(result.state.actors[foe.id].position).toEqual({ x: 5, y: 1 });
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);

    const colliding = bastionEncounter({ foe: { x: 3, y: 1 }, second: { x: 7, y: 1 }, ally: null });
    const collide = executeCommand(colliding.state, {
      type: 'EXECUTE_RULE',
      actorId: colliding.hero.id,
      sourceId: 'bastion:valiant',
      actionId: 'default',
      timing: 'use',
      input: {},
      triggers: ['collide'],
    }, scriptedDice());
    expect(collide.state.actors[colliding.hero.id].position).toEqual({ x: 4, y: 1 });
    expect(collide.state.actors[colliding.foe.id].position).toEqual({ x: 6, y: 1 });
  });

  it('Endless Battlement: enters the stance and grants the chosen ally aura 1', () => {
    const { state, hero, ally } = bastionEncounter({ ally: { x: 4, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:endless-battlement', targetIds: [ally.id] }, scriptedDice());
    const heroAfter = result.state.actors[hero.id];
    const allyAfter = result.state.actors[ally.id];
    expect(heroAfter.stance).toMatchObject({ stanceId: 'endless-battlement', state: { allyId: ally.id } });
    expect(heroAfter.ruleState['endless-battlement:ally-id']).toBe(ally.id);
    expect(heroAfter.actionsRemaining).toBe(1);
    expect(allyAfter.activeEffects.some(({ effectId, modifiers }) => effectId === 'aura' && modifiers.some(({ stat, value }) => stat === 'aura' && typeof value === 'object' && value !== null && value.kind === 'constant' && value.value === 1))).toBe(true);

    const refreshed = executeCommand(result.state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'bastion:endless-battlement',
      actionId: 'stance-refresh',
      timing: 'stance-refresh',
      input: {},
    }, scriptedDice());
    expect(refreshed.events.find((event) => event.type === 'RULE_MUTATIONS_APPLIED')).toBeDefined();
    expect(refreshed.state.actors[ally.id].activeEffects.some(({ effectId }) => effectId === 'aura')).toBe(true);
  });

  /** A foe ability that costs 1 action and deals `amount` normal damage. */
  const foeAbilityDamage = (foeId: string, targetId: string, amount: number) => ({
    type: 'RULE_MUTATIONS_APPLIED' as const,
    actorId: foeId,
    sourceId: 'fixture:foe-ability',
    actionId: 'default',
    timing: 'use' as const,
    tags: [],
    mutations: [
      { kind: 'actions' as const, sourceId: 'fixture:foe-ability', actorId: foeId, operation: 'spend' as const, amount: 1 },
      { kind: 'damage' as const, sourceId: 'fixture:foe-ability', sourceActorId: foeId, actorId: targetId, amount, damageType: 'normal' as const, instance: 1, delivery: 'hit' as const, ignoreCover: false },
    ],
  });

  it('Heroic Intervention: holds a foe ability targeting the armored ally until the interrupt resolves (p.107/p.122)', () => {
    const { state, hero, foe, ally } = bastionEncounter({ foe: { x: 4, y: 1 }, ally: { x: 3, y: 1 } });
    const stanced = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:endless-battlement', targetIds: [ally.id] }, scriptedDice()).state;
    expect(stanced.actors[hero.id].stance?.stanceId).toBe('endless-battlement');

    // A foe ability that damages the armored ally: the action cost pays
    // immediately, the damage is held in a uses-ability window.
    const deferred = applyEvents(stanced, [foeAbilityDamage(foe.id, ally.id, 6)]);
    expect(deferred.actors[ally.id].hp).toBe(40); // held, not applied
    const window = deferred.decisionWindows.find((candidate) => candidate.actorId === hero.id && candidate.kind === 'uses-ability');
    expect(window).toBeDefined();
    expect(window!.heldEffects).toHaveLength(1); // the cost was separated out
    expect(window!.heldEffects![0]).toMatchObject({ kind: 'damage', actorId: ally.id, amount: 6 });

    // Heroic Intervention resolves before the ability: the hero soars out and
    // returns in the aura (the adjacent foe takes 2), then the held damage
    // lands on the ally.
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'bastion:endless-battlement',
      actionId: 'heroic-intervention',
      timing: 'interrupt',
      input: { positions: { 'return-position': [{ x: 3, y: 2 }] } },
    }, scriptedDice());
    expect(interrupt.state.actors[hero.id].position).toEqual({ x: 3, y: 2 });
    expect(interrupt.state.actors[foe.id].hp).toBe(30); // 32 - 2 from the interrupt's return
    expect(interrupt.state.actors[ally.id].hp).toBe(36); // 40 - (6 normal - armor 2), the held effects
    expect(interrupt.state.decisionWindows.some((candidate) => candidate.actorId === hero.id && candidate.kind === 'uses-ability')).toBe(false);
    expect(interruptUses(interrupt.state.actors[hero.id], 'bastion:endless-battlement')).toBe(1);
    expect(interruptUsedThisTurn(interrupt.state.actors[hero.id])).toBe(true);
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('Heroic Intervention: an unanswered uses-ability window resolves its held effects at the end of the turn', () => {
    const { state, hero, foe, ally } = bastionEncounter({ foe: { x: 4, y: 1 }, ally: { x: 3, y: 1 } });
    const stanced = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:endless-battlement', targetIds: [ally.id] }, scriptedDice()).state;
    const deferred = applyEvents(stanced, [foeAbilityDamage(foe.id, ally.id, 6)]);
    expect(deferred.actors[ally.id].hp).toBe(40);
    expect(deferred.decisionWindows.some((candidate) => candidate.kind === 'uses-ability')).toBe(true);

    const ended = endTurnTo(deferred, foe.id, scriptedDice());
    expect(ended.actors[ally.id].hp).toBe(36); // the held effects resolved at the boundary
    expect(ended.decisionWindows).toHaveLength(0);
  });

  it('Heroic Intervention: no window opens when the interrupt was already used this turn', () => {
    const { state, hero, foe, ally } = bastionEncounter({ foe: { x: 4, y: 1 }, ally: { x: 3, y: 1 } });
    const stanced = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:endless-battlement', targetIds: [ally.id] }, scriptedDice()).state;
    stanced.actors[hero.id].ruleState[oneInterruptPerTurnWindowKey()] = true;
    const resolved = applyEvents(stanced, [foeAbilityDamage(foe.id, ally.id, 6)]);
    expect(resolved.actors[ally.id].hp).toBe(36); // applied immediately
    expect(resolved.decisionWindows.some((candidate) => candidate.kind === 'uses-ability')).toBe(false);
  });

  it('Perseus: holds an allied area effect that includes the user until the interrupt grants immunity (p.123)', () => {
    const { state, hero, foe, ally } = bastionEncounter({ foe: { x: 4, y: 1 }, ally: { x: 2, y: 1 } });
    // The ally's area ability includes the hero (and a foe) in an 8-damage blast.
    const deferred = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: ally.id,
      sourceId: 'fixture:ally-area',
      actionId: 'default',
      timing: 'use',
      tags: ['area'],
      mutations: [
        { kind: 'damage', sourceId: 'fixture:ally-area', sourceActorId: ally.id, actorId: hero.id, amount: 8, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false },
        { kind: 'damage', sourceId: 'fixture:ally-area', sourceActorId: ally.id, actorId: foe.id, amount: 8, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false },
      ],
    }]);
    expect(deferred.actors[hero.id].hp).toBe(40); // held: the whole area effect has not resolved
    expect(deferred.actors[foe.id].hp).toBe(32);
    const window = deferred.decisionWindows.find((candidate) => candidate.actorId === hero.id && candidate.kind === 'area-inclusion');
    expect(window).toBeDefined();
    expect(window!.heldEffects).toHaveLength(2);

    // Perseus resolves first: the hero releases the aura and becomes immune,
    // then the held area effect lands — the hero's share is skipped, the
    // foe's share applies.
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'bastion:perseus',
      actionId: 'default',
      timing: 'interrupt',
      input: {},
    }, scriptedDice());
    expect(interrupt.state.actors[hero.id].ruleState['damage-immune']).toBe(true);
    expect(interrupt.state.actors[hero.id].activeEffects.some(({ effectId }) => effectId === 'aura')).toBe(true);
    expect(interrupt.state.actors[hero.id].hp).toBe(40); // immune to the held blast
    expect(interrupt.state.actors[foe.id].hp).toBe(24); // 32 - 8, the held area resolved
    expect(interruptUses(interrupt.state.actors[hero.id], 'bastion:perseus')).toBe(1);
    expect(interrupt.state.decisionWindows.some((candidate) => candidate.actorId === hero.id && candidate.kind === 'area-inclusion')).toBe(false);
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('Catapult: an interrupt shoves an ally and tracks its usage', () => {
    const { state, hero, ally } = bastionEncounter({ foe: { x: 5, y: 1 }, second: { x: 6, y: 1 }, ally: { x: 2, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:catapult', targetIds: [ally.id] }, scriptedDice());
    expect(result.state.actors[ally.id].position).toEqual({ x: 4, y: 1 });
    expect(interruptUses(result.state.actors[hero.id], 'bastion:catapult')).toBe(1);
    expect(interruptUsedThisTurn(result.state.actors[hero.id])).toBe(true);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(2);
    expect(() => executeCommand(result.state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:catapult', targetIds: [ally.id] }, scriptedDice())).toThrow(/repeat/i);

    const colliding = bastionEncounter({ foe: { x: 5, y: 1 }, second: { x: 6, y: 1 }, ally: { x: 2, y: 1 } });
    const collide = executeCommand(colliding.state, {
      type: 'EXECUTE_RULE',
      actorId: colliding.hero.id,
      sourceId: 'bastion:catapult',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [colliding.ally.id] } },
      triggers: ['collide'],
    }, scriptedDice());
    expect(collide.state.actors[colliding.ally.id].vigor).toBe(2);
  });

  it('Perseus: grants aura and immunity to the triggering ability', () => {
    const { state, hero } = bastionEncounter();
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:perseus', targetIds: [] }, scriptedDice());
    const heroAfter = result.state.actors[hero.id];
    expect(heroAfter.activeEffects.some(({ effectId, modifiers }) => effectId === 'aura' && modifiers.some(({ value }) => typeof value === 'object' && value !== null && value.kind === 'constant' && value.value === 1))).toBe(true);
    expect(heroAfter.ruleState['damage-immune']).toBe(true);
    expect(interruptUses(heroAfter, 'bastion:perseus')).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rook: attack damage, a shove, and an aura until the end of the next turn', () => {
    const { state, hero, foe } = bastionEncounter({ foe: { x: 2, y: 1 }, ally: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:rook', targetIds: [foe.id] }, scriptedDice(10, 6));
    const heroAfter = result.state.actors[hero.id];
    expect(mutationsOf(result.events, 'bastion:rook')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'move', actorId: foe.id, movement: 'shove' },
      { kind: 'persistent', actorId: hero.id, effectId: 'aura' },
      { kind: 'attack', d20: 10, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 10 },
    ]);
    expect(heroAfter.actionsRemaining).toBe(0);
    expect(heroAfter.attackedThisTurn).toBe(true);
    expect(heroAfter.activeEffects.some(({ effectId, duration }) => effectId === 'aura' && duration.kind === 'turn-end')).toBe(true);
    expect(result.state.actors[foe.id].hp).toBe(22);
    expect(result.state.actors[foe.id].position).toEqual({ x: 3, y: 1 });
  });

  it('Rook talent 1: the bearer has counter while Rook\'s aura is active (and loses it when it clears)', () => {
    const { state, hero, foe } = bastionEncounter({ foe: { x: 2, y: 1 }, ally: null });
    state.actors[hero.id].talents = { ...state.actors[hero.id].talents, 'bastion:rook': 1 };
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:rook', targetIds: [foe.id] }, scriptedDice(10, 6));
    const heroAfter = result.state.actors[hero.id];
    // The bearer is always a member of its own aura: while Rook's aura is
    // active the reviewed aura definition (jobs/aura-recipes.ts) projects
    // counter onto Rook, gated on the equipped talent (replay-safe, derived
    // from the durable activeEffects record). The condition read needs the
    // spatial state so the aura-membership projection is included.
    expect(heroAfter.activeEffects.some(({ effectId }) => effectId === 'aura')).toBe(true);
    expect(encounterConditionSet(heroAfter, result.state).has('counter')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);

    // Control: without Rook talent 1, the active aura grants no counter.
    const plain = bastionEncounter({ foe: { x: 2, y: 1 }, ally: null });
    const plainResult = executeCommand(plain.state, { type: 'USE_ABILITY', actorId: plain.hero.id, abilityId: 'bastion:rook', targetIds: [plain.foe.id] }, scriptedDice(10, 6));
    expect(encounterConditionSet(plainResult.state.actors[plain.hero.id], plainResult.state).has('counter')).toBe(false);
  });

  it('Great Giorgios: marks the foe, ends the turn, and resolves the delayed rush on the foe’s turn end', () => {
    const { state, hero, foe } = bastionEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const afterUse = used.state;
    expect(afterUse.actors[foe.id].marks.some(({ markId }) => markId === 'great-giorgios')).toBe(true);
    expect(afterUse.actors[hero.id].actionsRemaining).toBe(1);
    // The ability ended the hero's turn; the scheduler awaits the GM's choice
    // of the marked foe (ICON p.87) rather than auto-selecting it.
    expect(afterUse.activeActorId).toBeNull();
    expect(afterUse.eligibleSide).toBe('foes');
    expect(afterUse.actors[hero.id].turnTaken).toBe(true);
    expect(applyEvents(state, used.events)).toEqual(afterUse);

    const foeTurn = executeCommand(afterUse, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    // U13: "you may rush 4" is a genuine decision — the window opens at the
    // marked foe's turn end (the mark is consumed either way; nothing has
    // moved yet) and the user answers it. The engine never chooses "yes".
    expect(ended.actors[foe.id].marks).toEqual([]);
    const rushWindow = ended.decisionWindows.find((window) => window.kind === 'choice');
    expect(rushWindow).toBeDefined();
    expect(rushWindow!.choice!.key).toBe('rush');
    expect(ended.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(ended.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(ended.actors[foe.id].hp).toBe(32);
    // Accepting records the decision at the command boundary and resolves the
    // rush against then-current state.
    const answered = executeCommand(ended, { type: 'ANSWER_DECISION_WINDOW', windowId: rushWindow!.id, input: { booleans: { rush: true } } }, scriptedDice());
    expect(answered.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(answered.state.actors[foe.id].position).toEqual({ x: 6, y: 1 });
    expect(answered.state.actors[foe.id].hp).toBe(28);
    // The rush's own damage opened a when-damaged interrupt window for the
    // foe (the blow was not HELD — the foe has no when-damaged interrupt, so
    // it applied directly); the boundary drain closes it at the next turn end.
    const residue = answered.state.decisionWindows.filter((window) => isInterruptWindowKind(window.kind));
    expect(residue).toHaveLength(1);
    expect(residue[0]).toMatchObject({ kind: 'when-damaged', actorId: foe.id });
    expect(windowHeldDamage(residue[0])).toBeUndefined();
    expect(applyEvents(ended, answered.events)).toEqual(answered.state);
  });

  it('Great Giorgios determines its delayed raw damage through the shared damage kernel', () => {
    const { state, hero, foe } = bastionEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null });
    state.actors[foe.id].armor = 2;
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    // The window opened at the foe's turn end (the mark is gone); accepting
    // the "may rush" resolves the delay. The rush travels two spaces, so the
    // source damage is 4: armor reduces it through the common p.93
    // determination before application.
    const rushWindow = ended.decisionWindows.find((window) => window.kind === 'choice');
    expect(rushWindow).toBeDefined();
    const answered = executeCommand(ended, { type: 'ANSWER_DECISION_WINDOW', windowId: rushWindow!.id, input: { booleans: { rush: true } } }, scriptedDice());
    expect(answered.state.actors[foe.id].hp).toBe(30);
    expect(applyEvents(ended, answered.events)).toEqual(answered.state);
  });

  it('Great Giorgios routes its delayed self-rush through the Slashed ability-move gate', () => {
    const { state, hero, foe } = bastionEncounter({ foe: { x: 4, y: 1 }, second: { x: 7, y: 1 }, ally: null });
    state.actors[hero.id].statuses.push('slashed');

    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    // Accepting the "may rush" decision resolves the delayed rush. Great
    // Giorgios's delayed rush is still a self ability move: the single raw
    // Slashed instance is determined by the shared kernel, so Armor 2 turns
    // its 4 normal damage into exactly 2 applied HP damage.
    const rushWindow = ended.decisionWindows.find((window) => window.kind === 'choice');
    expect(rushWindow).toBeDefined();
    const answered = executeCommand(ended, { type: 'ANSWER_DECISION_WINDOW', windowId: rushWindow!.id, input: { booleans: { rush: true } } }, scriptedDice());
    expect(answered.state.actors[hero.id]).toMatchObject({ hp: 38 });
    expect(slashedTriggeredThisTurn(answered.state.actors[hero.id])).toBe(true);
    expect(applyEvents(ended, answered.events)).toEqual(answered.state);
  });

  it('Great Giorgios: Collide adds hatred of the user', () => {
    const { state, hero, foe } = bastionEncounter({ foe: { x: 3, y: 1 }, ally: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'bastion:great-giorgios',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      triggers: ['collide'],
    }, scriptedDice());
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'great-giorgios')).toBe(true);
    expect(result.state.actors[foe.id].statuses).toContain('hatred');
  });

  it('executes every reviewed job ability through a resolver, never a generic approximation', () => {
    // The job-ability sweep is complete except the documented
    // `colossus:raging-wolf` exception (Ultras Part 1 keeps it unresolved).
    expect(ABILITIES.filter((ability) => !DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS.has(ability.id)).every((ability) => ability.automation === 'executable')).toBe(true);
    expect(DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS.size).toBeGreaterThan(0);
    // Structured source units outside the executable set are still refused by
    // the generic VM rather than heuristically applied.
    const { state, hero, foe } = bastionEncounter();
    try {
      executeCommand(state, {
        type: 'EXECUTE_RULE',
        actorId: hero.id,
        // Diaga is independently executable now; Fortify remains a
        // reducer-consumed passive and must not take the generic VM path.
        sourceId: 'stalwart:trait:fortify',
        actionId: 'default',
        timing: 'use',
        input: {},
        attackTargetId: foe.id,
      });
      throw new Error('Expected a structured rule to remain unresolved.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'rule.not-executable' });
    }
    expect(state.actors[foe.id].hp).toBe(32);
    expect(state.actors[hero.id].actionsRemaining).toBe(2);
    expect(state.actors[hero.id].attackedThisTurn).toBe(false);
  });
});
