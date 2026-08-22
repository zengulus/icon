import { describe, expect, it } from 'vitest';
import { ENCOUNTER_SCHEMA_VERSION } from '../types.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, createFoeFromProfile, executeCommand, hasCoverFrom, MAX_ENCOUNTER_EVENT_LOG, migrateEncounter, replayEncounter, RuleViolation } from '../encounter.js';
import { ABILITIES, JOBS } from '../catalog.js';
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

  it('rejects browser-only actor token URLs even when a caller bypasses the websocket parser', () => {
    const state = createEncounter('Durable token boundary');
    const actor = createFoe('Temporary token', { x: 1, y: 1 });
    actor.tokenUrl = 'blob:https://app.example/temporary-token';
    expect(() => executeCommand(state, { type: 'ADD_ACTOR', actor })).toThrow(/browser-only blob URL/i);
  });

  it('keeps setup actors and terrain inside the authoritative grid', () => {
    const state = createEncounter('Grid boundary');
    const offBoardActor = createFoe('Off board', { x: state.grid.width, y: 0 });
    try {
      executeCommand(state, { type: 'ADD_ACTOR', actor: offBoardActor });
      throw new Error('Expected off-grid actor to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'actor.position' });
    }
    try {
      executeCommand(state, {
        type: 'SET_TERRAIN',
        cell: { position: { x: -1, y: 0 }, type: 'basic', elevation: 0 },
      });
      throw new Error('Expected off-grid terrain to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'terrain.position' });
    }
  });

  it('canonicalizes legacy actor ownership fields at the reducer boundary', () => {
    const state = createEncounter('Legacy actor command');
    const actor = createFoe('Legacy actor', { x: 1, y: 1 }) as unknown as Record<string, unknown>;
    delete actor.foeProfileId;
    actor.conditions = [{ id: 'stealth', sourceId: 'legacy-source', potency: 'normal', duration: null }];
    const result = executeCommand(state, { type: 'ADD_ACTOR', actor: actor as never });
    const added = result.state.actors[(actor.id as string)];
    expect(added).toMatchObject({ foeProfileId: null, conditions: [{ ownerId: null }] });
  });

  it('keeps a bounded recent event history without changing applied mechanics', () => {
    const events = Array.from({ length: MAX_ENCOUNTER_EVENT_LOG + 5 }, (_, index) => ({
      type: 'TERRAIN_SET' as const,
      cell: { position: { x: index, y: 0 }, type: 'basic' as const, elevation: 0 },
    }));
    const state = applyEvents(createEncounter('Bounded history'), events);

    expect(state.revision).toBe(events.length);
    expect(state.eventLog).toHaveLength(MAX_ENCOUNTER_EVENT_LOG);
    expect(state.eventLog[0]).toEqual(events[5]);
    expect(state.eventLog.at(-1)).toEqual(events.at(-1));
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

  it('derives cover and line of sight from terrain instead of trusting a client attack flag', () => {
    const { state, hero, foe } = activeEncounter();
    state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'basic', elevation: 1 });
    expect(hasCoverFrom(state, state.actors[foe.id], state.actors[hero.id])).toBe(true);
    const covered = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 5));
    expect(covered.events.find((event) => event.type === 'ATTACK_RESOLVED')).toMatchObject({ rawDamage: 9, appliedDamage: 5 });

    const blocked = activeEncounter();
    blocked.state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'impassable', elevation: 1 });
    expect(() => executeCommand(blocked.state, { type: 'BASIC_ATTACK', actorId: blocked.hero.id, targetId: blocked.foe.id, weight: 'light' })).toThrow(/line of sight/);
  });

  it('enforces one attack ability per turn', () => {
    const { state, hero, foe } = activeEncounter();
    const first = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 5)).state;
    expect(() => executeCommand(first, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(12, 5))).toThrow(/one attack/);
  });

  it('enforces Unstoppable immunity when a normal status is applied', () => {
    const { state, hero, foe } = activeEncounter();
    state.actors[foe.id].conditions.push({ id: 'unstoppable', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    try {
      executeCommand(state, { type: 'APPLY_STATUS', actorId: hero.id, targetId: foe.id, status: 'stunned' });
      throw new Error('Expected Unstoppable to reject a status.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'status.immune' });
    }
    expect(state.actors[foe.id].statuses).not.toContain('stunned');
  });

  it('executes every job ability through a reviewed resolver, never a generic approximation', () => {
    // The job-ability sweep is complete: every catalogued job ability is
    // independently executable through a hand-authored typed program.
    expect(ABILITIES.every((ability) => ability.automation === 'executable')).toBe(true);
    // Structured source units outside the executable set are still refused by
    // the generic VM rather than heuristically applied.
    const { state, hero, foe } = activeEncounter();
    try {
      executeCommand(state, {
        type: 'EXECUTE_RULE',
        actorId: hero.id,
        sourceId: 'mendicant:trait:diaga',
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

  it('rejects unequipped abilities before reporting unresolved catalogued rules', () => {
    const { state, hero, foe } = activeEncounter();
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:rook', targetIds: [foe.id] })).toThrow(/not in this actor/);
    // An ability from the (now fully executable) catalog that the actor does
    // not own is refused the same way, before any resolution attempt.
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:sow', targetIds: [foe.id] })).toThrow(/not in this actor/);
  });

  it('migrates v1 actors into the versioned ability state model', () => {
    const original = createEncounter('Old save');
    const hero = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    const legacyActor = { ...hero } as Record<string, unknown>;
    for (const key of ['chapter', 'abilityIds', 'usedAbilityIds', 'interruptUses', 'interruptUsedThisTurn', 'dangerousTerrainTriggeredThisTurn']) delete legacyActor[key];
    const migrated = migrateEncounter({ ...original, schemaVersion: 1, actors: { [hero.id]: legacyActor } });
    expect(migrated.schemaVersion).toBe(ENCOUNTER_SCHEMA_VERSION);
    expect(migrated.actors[hero.id]).toMatchObject({ chapter: 1, abilityIds: [], usedAbilityIds: [], interruptUses: {}, interruptUsedThisTurn: false, slashedTriggeredThisTurn: false, dangerousTerrainTriggeredThisTurn: false, conditions: [], resources: {}, activeEffects: [], marks: [], stance: null, onBattlefield: true });

    const v3Migrated = migrateEncounter({ ...original, schemaVersion: 3, actors: { [hero.id]: legacyActor } });
    expect(v3Migrated).toMatchObject({ schemaVersion: ENCOUNTER_SCHEMA_VERSION, actors: { [hero.id]: { dangerousTerrainTriggeredThisTurn: false } } });
  });

  it('rejects oversized historical event history rather than silently truncating it', () => {
    const legacy = createEncounter('Historical audit trail');
    legacy.schemaVersion = 1 as never;
    legacy.eventLog = Array.from({ length: MAX_ENCOUNTER_EVENT_LOG + 1 }, (_, index) => ({
      type: 'ACTOR_REMOVED' as const,
      actorId: `historical-${index}`,
    }));

    expect(() => migrateEncounter(legacy)).toThrow(/event history exceeds/i);
  });

  it('rejects an encounter from an unmapped ICON rules version rather than relabelling it', () => {
    const futureRules = createEncounter('Future rules');
    futureRules.rulesVersion = '2.0' as never;
    expect(() => migrateEncounter(futureRules)).toThrow(/Unsupported ICON rules version/i);
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

  it('does not execute a heuristic foe compilation through authoritative rule commands', () => {
    // Impaler Spike is source-indexed but has no reviewed FoeRecipe yet, so it
    // stays a heuristic compilation — never an authority permit (contrast the
    // reviewed Soldier Slash recipe, which now executes).
    let state = createEncounter('Compiled foe ability');
    const hero = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    const impaler = createFoeFromProfile('basic:impaler:300', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: impaler }).state;
    state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
    state = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    try {
      executeCommand(state, {
        type: 'EXECUTE_RULE',
        actorId: impaler.id,
        sourceId: 'basic:impaler:300:spike',
        actionId: 'default',
        timing: 'use',
        input: {},
        attackTargetId: hero.id,
      }, scriptedDice(12, 5));
      throw new Error('Expected heuristic foe program to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'rule.not-executable' });
    }
  });

  it('executes the explicitly reviewed Skirmisher program with source ownership', () => {
    const { state, hero } = activeEncounter();
    state.actors[hero.id].traitIds.push('vagabond:trait:skirmisher');
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'vagabond:trait:skirmisher',
      actionId: 'default',
      timing: 'passive',
      input: {},
    });
    expect(result.state.actors[hero.id]?.conditions).toMatchObject([
      { id: 'skirmisher', sourceId: 'vagabond:trait:skirmisher', ownerId: hero.id },
    ]);
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
