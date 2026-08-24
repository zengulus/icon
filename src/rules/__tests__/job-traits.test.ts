import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { encounterConditionSet } from '../automation/kernels/encounter-adapter.js';
import { JOB_TRAIT_CONDITION_RECIPES_VIEW } from '../automation/content/jobs/trait-condition-recipes.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, endTurnOnly, startEncounterTo} from './fixtures.js';
import { turnEligibleActorIds } from '../turn-scheduler.js';

/**
 * F6 job-trait fixtures (docs/rules-foundations.md §7).
 *
 * Every `wired` row in the closed JOB_TRAIT_RECIPES inventory has a
 * behavioral proof here: condition projections actually change combat,
 * combat-start grants land durably, lifecycle rows fire at their boundary
 * (and replay exactly the recorded participants), the typed resolvers
 * execute through EXECUTE_RULE, and the command/kernel hooks change
 * movement. Documented rows are pinned as closed-registry negatives.
 */

interface TraitFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

function traitEncounter(traits: string[], options: { heroAt?: { x: number; y: number }; foeAt?: { x: number; y: number } } = {}): TraitFixture {
  let state = createEncounter('Job-trait fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), options.heroAt ?? { x: 1, y: 1 });
  hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
  hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
  for (const traitId of traits) hero.traitIds.push(traitId);
  const foe = createFoeFromProfile('basic:knuckle:301', options.foeAt ?? { x: 5, y: 1 }, 4);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe };
}

/** A VM damage mutation with a fixed source amount. */
const vmDamageEvent = (sourceActorId: string, actorId: string, amount: number, delivery: 'hit' | 'miss' | 'area' = 'hit'): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED',
  actorId: sourceActorId,
  sourceId: 'fixture:vm-blow',
  actionId: 'default',
  timing: 'use',
  tags: ['attack'],
  mutations: [{ kind: 'damage', sourceId: 'fixture:vm-blow', sourceActorId, actorId, amount, damageType: 'normal', instance: 1, delivery, ignoreCover: false }],
});

const conditionMutation = (actorId: string, targetId: string, conditionId: string): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED',
  actorId,
  sourceId: 'fixture:condition',
  actionId: 'default',
  timing: 'use',
  tags: [],
  mutations: [{ kind: 'condition', sourceId: 'fixture:condition', sourceActorId: actorId, actorId: targetId, conditionId, operation: 'apply', potency: 'normal' }],
});

/** End every actor's turn in insertion order, advancing through the round.
 * Each boundary leaves the scheduler awaiting a controller choice, so the
 * fixture explicitly selects the next actor in insertion order (ICON p.87). */
function endAllTurns(state: EncounterState, dice = scriptedDice()): EncounterState {
  let next = state;
  for (const id of Object.keys(state.actors)) {
    if (next.activeActorId !== id) {
      if (next.activeActorId !== null) next = executeCommand(next, { type: 'END_TURN', actorId: next.activeActorId }, dice).state;
      const eligible = turnEligibleActorIds(next);
      if (!eligible.includes(id)) throw new Error('endAllTurns: ' + id + ' is not eligible here.');
      next = executeCommand(next, { type: 'TAKE_TURN', actorId: id }, dice).state;
    }
    next = executeCommand(next, { type: 'END_TURN', actorId: id }, dice).state;
  }
  return next;
}

describe('F6 condition projections (passive-projection.ts)', () => {
  it('Sealer martial arts projects dodge on its owner: a missed attack deals no damage', () => {
    const { state, hero, foe } = traitEncounter(['sealer:trait:martial-arts']);
    expect(JOB_TRAIT_CONDITION_RECIPES_VIEW['sealer:trait:martial-arts']).toEqual(['dodge']);
    expect(encounterConditionSet(state.actors[hero.id]).has('dodge')).toBe(true);
    const missed = applyEvents(state, [vmDamageEvent(foe.id, hero.id, 6, 'miss')]);
    expect(missed.actors[hero.id].hp).toBe(hero.hp);
    const hit = applyEvents(state, [vmDamageEvent(foe.id, hero.id, 6)]);
    expect(hit.actors[hero.id].hp).toBeLessThan(hero.hp);
  });

  it('Shade shadow arts projects phasing: movement passes through a foe', () => {
    const { state, hero, foe } = traitEncounter(['shade:trait:shadow-arts'], { heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 } });
    expect(JOB_TRAIT_CONDITION_RECIPES_VIEW['shade:trait:shadow-arts']).toEqual(['phasing']);
    const moved = executeCommand(state, { type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }], mode: 'standard' }, scriptedDice());
    expect(moved.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
  });

  it('Furious Berserk and Embersoul project regeneration: the owner regains 4 vigor at turn end while bloodied', () => {
    for (const traitId of ['colossus:trait:furious-berserk', 'enochian:trait:embersoul']) {
      const { state, hero, foe } = traitEncounter([traitId]);
      expect(JOB_TRAIT_CONDITION_RECIPES_VIEW[traitId]).toEqual(['regeneration']);
      expect(encounterConditionSet(state.actors[hero.id]).has('regeneration')).toBe(true);
      state.actors[hero.id].hp = 1; // bloodied
      const vigorBefore = state.actors[hero.id].vigor;
      const after = endTurnTo(state, foe.id, scriptedDice());
      expect(after.actors[hero.id].vigor).toBe(vigorBefore + 4);
    }
  });

  it('a documented trait projects no condition (closed-registry negative)', () => {
    const { state, hero, foe } = traitEncounter(['bastion:trait:strive']);
    const missed = applyEvents(state, [vmDamageEvent(hero.id, foe.id, 6, 'miss')]);
    expect(missed.actors[foe.id].hp).toBeLessThan(foe.hp); // no dodge
  });
});

describe('F6 combat-start grants (applyCombatStartTraitEffects)', () => {
  it('Embersoul and Furious Berserk start combat with a durable Defiance', () => {
    for (const traitId of ['enochian:trait:embersoul', 'colossus:trait:furious-berserk']) {
      const { state, hero } = traitEncounter([traitId]);
      expect(state.actors[hero.id].conditions.some(({ id, sourceId }) => id === 'defiance' && sourceId === traitId)).toBe(true);
    }
  });

  it('Godly Smite starts combat with the mantra power die at 1', () => {
    const { state, hero } = traitEncounter(['sealer:trait:godly-smite']);
    expect(state.actors[hero.id].ruleState['mantra:die']).toBe(1);
  });
});

describe('F6 lifecycle recipes (turn-transition.ts)', () => {
  it('True Horn keeps the owner sturdy during other actors\u2019 turns and clears it at their own turn start', () => {
    const { state, hero, foe } = traitEncounter(['demon-slayer:trait:true-horn']);
    // Round 1 start: the hero is sturdy (round-start ran at ENCOUNTER_STARTED).
    expect(state.actors[hero.id].conditions.some(({ id, sourceId }) => id === 'sturdy' && sourceId === 'demon-slayer:trait:true-horn')).toBe(true);
    // The hero's turn end hands the round to the foe; sturdy stays (the trait
    // protects the owner during other actors' turns).
    const afterHero = endTurnTo(state, foe.id, scriptedDice());
    expect(afterHero.actors[hero.id].conditions.some(({ id }) => id === 'sturdy')).toBe(true);
    // The foe's turn end advances the round; the hero's own turn start runs
    // the turn-start half, clearing only the trait's durable grant.
    const roundTwo = endTurnTo(afterHero, hero.id, scriptedDice());
    expect(roundTwo.round).toBe(2);
    expect(roundTwo.actors[hero.id].conditions.some(({ id }) => id === 'sturdy')).toBe(false);
  });

  it('Blackheart grants vigilance +1 (and a bonus-damage charge with two statuses) at turn end', () => {
    const { state, hero } = traitEncounter(['knave:trait:blackheart']);
    const oneStatus = applyEvents(state, [conditionMutation(hero.id, hero.id, 'weakened')]);
    const after = endTurnOnly(oneStatus, scriptedDice());
    expect(after.actors[hero.id].resources.vigilance).toBe(1);
    expect(after.actors[hero.id].resources['bonus-damage'] ?? 0).toBe(0); // one status: no charge
    const twoStatuses = applyEvents(state, [conditionMutation(hero.id, hero.id, 'weakened'), conditionMutation(hero.id, hero.id, 'vulnerable')]);
    const charged = endTurnOnly(twoStatuses, scriptedDice());
    expect(charged.actors[hero.id].resources.vigilance).toBe(1);
    expect(charged.actors[hero.id].resources['bonus-damage']).toBe(1);
  });

  it('Mark of Tsumi deals 2 piercing to every foe marked by the owner and blesses at turn end', () => {
    const { state, hero, foe } = traitEncounter(['harvester:trait:mark-of-tsumi']);
    state.actors[foe.id].marks.push({ id: 'mark:1', sourceId: 'fixture', ownerId: hero.id, markId: 'tsumi', duration: null, state: {} });
    const hpBefore = state.actors[foe.id].hp;
    const after = endTurnTo(state, foe.id, scriptedDice());
    expect(after.actors[foe.id].hp).toBe(hpBefore - 2);
    expect(after.actors[hero.id].resources.blessing ?? 0).toBeGreaterThan(0);
  });

  it('Godly Smite ticks the mantra die +1 at the start of every round after round 1, capped at 6', () => {
    const { state, hero, foe } = traitEncounter(['sealer:trait:godly-smite']);
    const roundTwo = endAllTurns(state);
    expect(roundTwo.round).toBe(2);
    expect(roundTwo.actors[hero.id].ruleState['mantra:die']).toBe(2);
    const roundThree = endAllTurns(roundTwo);
    expect(roundThree.round).toBe(3);
    expect(roundThree.actors[hero.id].ruleState['mantra:die']).toBe(3);
  });

  it('Phoenix Rage grants a durable Defiance at the start of the owner\u2019s turn from round 5', () => {
    const { state, hero } = traitEncounter(['enochian:trait:phoenix-rage']);
    let current = state;
    while (current.round < 5) current = endAllTurns(current);
    expect(current.round).toBe(5);
    // The turn-start recipe fires when the player selects the hero (the
    // scheduler awaits the choice, ICON p.87).
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(current.actors[hero.id].conditions.some(({ id, sourceId }) => id === 'defiance' && sourceId === 'enochian:trait:phoenix-rage')).toBe(true);
    expect(current.actors[hero.id].ruleState['phoenix-rage:active']).toBe(true);
  });

  it('Orogenic Rage grants Unstoppable at the start of every round from round 5', () => {
    const { state, hero, foe } = traitEncounter(['geomancer:trait:orogenic-rage']);
    let current = state;
    while (current.round < 5) current = endAllTurns(current);
    // Round 5 begins with the round-start grant already applied (the boundary
    // that advanced to round 5 ran the phase) and the marker set.
    expect(current.round).toBe(5);
    expect(current.actors[hero.id].conditions.some(({ id, sourceId }) => id === 'unstoppable' && sourceId === 'geomancer:trait:orogenic-rage')).toBe(true);
    expect(current.actors[hero.id].ruleState['orogenic-rage:active']).toBe(true);
  });

  it('Storm Hilt Rage sets the rage marker at the start of every round from round 5', () => {
    const { state, hero } = traitEncounter(['spellblade:trait:storm-hilt-rage']);
    let current = state;
    while (current.round < 5) current = endAllTurns(current);
    expect(current.round).toBe(5);
    expect(current.actors[hero.id].ruleState['storm-hilt-rage:active']).toBe(true);
  });

  it('Furious Berserk grants vigilance +1 at turn end while bloodied', () => {
    const { state, hero } = traitEncounter(['colossus:trait:furious-berserk']);
    state.actors[hero.id].hp = 1; // bloodied
    const after = endTurnOnly(state, scriptedDice());
    expect(after.actors[hero.id].resources.vigilance).toBe(1);
  });
});

describe('F6 active resolvers (EXECUTE_RULE)', () => {
  it('Taunt applies Hatred of the user to a foe in range 3', () => {
    const { state, hero, foe } = traitEncounter(['knave:trait:taunt'], { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:trait:taunt',
      actionId: 'default',
      timing: 'use',
      attackTargetId: foe.id,
      input: {},
    }, scriptedDice());
    expect(result.state.actors[foe.id].ruleState['hatred-of']).toBe(hero.id);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(2); // free action
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Taunt rejects a target beyond range 3', () => {
    const { state, hero, foe } = traitEncounter(['knave:trait:taunt'], { heroAt: { x: 1, y: 1 }, foeAt: { x: 6, y: 1 } });
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:trait:taunt',
      actionId: 'default',
      timing: 'use',
      attackTargetId: foe.id,
      input: {},
    }, scriptedDice())).toThrow(/outside this ability.*range/);
  });

  it('Klingenkunst teleports the user to an in-grid space within range 2', () => {
    const { state, hero } = traitEncounter(['spellblade:trait:klingenkunst']);
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:trait:klingenkunst',
      actionId: 'default',
      timing: 'use',
      input: { positions: { destination: [{ x: 3, y: 1 }] } },
    }, scriptedDice());
    expect(result.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('a documented trait cannot execute through the generic VM (closed negative)', () => {
    const { state, hero } = traitEncounter(['bastion:trait:strive']);
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'bastion:trait:strive',
      actionId: 'default',
      timing: 'use',
      input: {},
    }, scriptedDice())).toThrow(/independently verified|not-executable/);
  });
});

describe('F6 command/kernel hooks', () => {
  it('Path of the Aesi waives the Dash action while the owner has Stealth', () => {
    const { state, hero } = traitEncounter(['warden:trait:path-of-the-aesi'], { heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 } });
    const withStealth = applyEvents(state, [conditionMutation(hero.id, hero.id, 'stealth')]);
    const actionsBefore = withStealth.actors[hero.id].actionsRemaining;
    const dashed = executeCommand(withStealth, { type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }], mode: 'dash' }, scriptedDice()).state;
    expect(dashed.actors[hero.id].actionsRemaining).toBe(actionsBefore); // free
    // Without Stealth the same dash costs an action.
    const noStealth = traitEncounter(['warden:trait:path-of-the-aesi'], { heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 } });
    const paid = executeCommand(noStealth.state, { type: 'MOVE', actorId: noStealth.hero.id, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }], mode: 'dash' }, scriptedDice()).state;
    expect(paid.actors[noStealth.hero.id].actionsRemaining).toBe(noStealth.hero.actionsRemaining - 1);
  });

  it('Green Kenning ignores difficult-terrain movement penalties and dangerous-terrain damage', () => {
    const { state, hero, foe } = traitEncounter(['warden:trait:green-kenning'], { heroAt: { x: 1, y: 1 }, foeAt: { x: 6, y: 1 } });
    state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'difficult', elevation: 0 });
    state.grid.terrain.push({ position: { x: 3, y: 1 }, type: 'dangerous', elevation: 0 });
    const hpBefore = state.actors[hero.id].hp;
    // Standard movement of 3 spaces crossing difficult + dangerous terrain:
    // the full speed allows it (no +1 penalty) and no dangerous damage is taken.
    const moved = executeCommand(state, { type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }], mode: 'standard' }, scriptedDice()).state;
    expect(moved.actors[hero.id].position).toEqual({ x: 4, y: 1 });
    expect(moved.actors[hero.id].hp).toBe(hpBefore); // no terrain damage
  });
});
