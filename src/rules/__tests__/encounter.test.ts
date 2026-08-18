import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, createFoeFromProfile, executeCommand, migrateEncounter, replayEncounter, RuleViolation } from '../encounter.js';
import { scriptedDice, validCharacter } from './fixtures.js';

function activeEncounter() {
  let state = createEncounter('Golden fixture');
  const hero = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
  const foe = createFoe('Relict', { x: 3, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe };
}

describe('ICON encounter reducer', () => {
  it('starts with a hero and alternates to a foe', () => {
    const { state, hero, foe } = activeEncounter();
    expect(state.activeActorId).toBe(hero.id);
    const ended = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(ended.activeActorId).toBe(foe.id);
    expect(ended.round).toBe(1);
  });

  it('rejects diagonal paths and occupied destinations', () => {
    const { state, hero } = activeEncounter();
    expect(() => executeCommand(state, { type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 2 }], mode: 'standard' })).toThrow(RuleViolation);
  });

  it('applies Slashed once when an ability moves its target', () => {
    const { state, hero } = activeEncounter();
    state.actors[hero.id].statuses.push('slashed');
    const moved = executeCommand(state, { type: 'MOVE', actorId: hero.id, path: [{ x: 1, y: 2 }], mode: 'standard' }).state;
    expect(moved.actors[hero.id].hp).toBe(38);
    expect(moved.actors[hero.id].slashedTriggeredThisTurn).toBe(true);
  });

  it('resolves a light attack with armor and deterministic dice', () => {
    const { state, hero, foe } = activeEncounter();
    state.actors[foe.id].armor = 2;
    const result = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 5));
    const attack = result.events.find((event) => event.type === 'ATTACK_RESOLVED');
    expect(attack).toMatchObject({ hit: true, rawDamage: 9, appliedDamage: 7 });
    expect(result.state.actors[foe.id].hp).toBe(25);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
  });

  it('applies Vulnerable before armor as part of defender-side damage order', () => {
    const { state, hero, foe } = activeEncounter();
    state.actors[foe.id].armor = 2;
    state.actors[foe.id].statuses.push('vulnerable');
    const result = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 1));
    expect(result.events.find((event) => event.type === 'ATTACK_RESOLVED')).toMatchObject({ rawDamage: 5, appliedDamage: 4 });
  });

  it('enforces one attack ability per turn', () => {
    const { state, hero, foe } = activeEncounter();
    const first = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 5)).state;
    expect(() => executeCommand(first, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 5))).toThrow(/one attack/);
  });

  it('resolves an equipped job attack from structured source mechanics', () => {
    const { state, hero, foe } = activeEncounter();
    const abilityId = hero.abilityIds[0];
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId, targetIds: [foe.id] }, scriptedDice(12, 5));
    const event = result.events.find((candidate) => candidate.type === 'ABILITY_RESOLVED');
    expect(event).toMatchObject({
      abilityId: 'bastion:heracule',
      actionCost: 1,
      attack: { hit: true, rawDamage: 9, appliedDamage: 9 },
    });
    expect(result.state.actors[foe.id].hp).toBe(23);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(result.state.actors[hero.id].attackedThisTurn).toBe(true);
  });

  it('rejects unequipped abilities and repeated paid abilities', () => {
    const { state, hero, foe } = activeEncounter();
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:rook', targetIds: [foe.id] })).toThrow(/not in this actor/);
    const first = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: hero.abilityIds[0], targetIds: [foe.id] }, scriptedDice(12, 5)).state;
    expect(() => executeCommand(first, { type: 'USE_ABILITY', actorId: hero.id, abilityId: hero.abilityIds[0], targetIds: [foe.id] })).toThrow(/cannot be repeated/);
  });

  it('migrates v1 actors into the versioned ability state model', () => {
    const original = createEncounter('Old save');
    const hero = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    const legacyActor = { ...hero } as Record<string, unknown>;
    for (const key of ['chapter', 'abilityIds', 'usedAbilityIds', 'interruptUses', 'interruptUsedThisTurn']) delete legacyActor[key];
    const migrated = migrateEncounter({ ...original, schemaVersion: 1, actors: { [hero.id]: legacyActor } });
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.actors[hero.id]).toMatchObject({ chapter: 1, abilityIds: [], usedAbilityIds: [], interruptUses: {}, interruptUsedThisTurn: false, slashedTriggeredThisTurn: false, conditions: [], resources: {}, activeEffects: [], marks: [], stance: null, onBattlefield: true });
  });

  it('creates typed foes from source profiles and inherits variant abilities', () => {
    const bouncer = createFoeFromProfile('scavenger:bouncer:367', { x: 2, y: 2 });
    expect(bouncer).toMatchObject({ name: 'Bouncer', foeProfileId: 'scavenger:bouncer:367', hp: 40, defense: 6, armor: 2 });
    expect(bouncer.abilityIds).toHaveLength(4);

    const legend = createFoeFromProfile('jotunn:i-rider-of-the-primal-storm:459', { x: 4, y: 4 }, 3);
    expect(legend.hp).toBe(150);
    expect(legend.abilityIds).toHaveLength(10);
    expect(() => createFoeFromProfile('basic:basic-mob:300', { x: 0, y: 0 })).toThrow(/member-level state/);
  });

  it('executes a fully compiled foe source program as replayable atomic mutations', () => {
    let state = createEncounter('Compiled foe ability');
    const hero = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    const soldier = createFoeFromProfile('basic:soldier:300', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: soldier }).state;
    state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
    state = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: soldier.id,
      sourceId: 'basic:soldier:300:slash',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: hero.id,
    }, scriptedDice(12, 5));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ type: 'RULE_MUTATIONS_APPLIED', sourceId: 'basic:soldier:300:slash', tags: expect.arrayContaining(['attack']) });
    expect(result.state.actors[hero.id]).toMatchObject({ hp: 33, statuses: ['slashed'] });
    expect(result.state.actors[soldier.id]).toMatchObject({ actionsRemaining: 1, attackedThisTurn: true });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('executes Interact and Rescue as costed basic abilities', () => {
    let state = createEncounter('Rescue fixture');
    const first = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const second = actorFromCharacter(validCharacter('Bryn'), { x: 2, y: 1 });
    const foe = createFoe('Relict', { x: 4, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: first }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = applyEvents(state, [{ type: 'ACTOR_DEFEATED', actorId: second.id, woundGained: true }]);
    state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
    state = executeCommand(state, { type: 'INTERACT', actorId: first.id, position: first.position, description: 'Pull the lever' }).state;
    expect(state.actors[first.id].actionsRemaining).toBe(1);
    state = executeCommand(state, { type: 'RESCUE', actorId: first.id, targetId: second.id }).state;
    expect(state.actors[first.id].actionsRemaining).toBe(0);
    expect(state.actors[second.id].defeated).toBe(false);
    expect(state.actors[second.id].hp).toBe(30);
  });

  it('replays emitted events to the exact same state', () => {
    const initial = createEncounter('Replay');
    const hero = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    const foe = createFoe('Relict', { x: 3, y: 1 });
    const events = [
      executeCommand(initial, { type: 'ADD_ACTOR', actor: hero }).events,
      [{ type: 'ACTOR_ADDED', actor: foe } as const],
      [{ type: 'ENCOUNTER_STARTED', firstActorId: hero.id } as const],
    ].flat();
    const direct = applyEvents(initial, events);
    expect(replayEncounter(initial, events)).toEqual(direct);
  });
});
