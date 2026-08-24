import { describe, expect, it } from 'vitest';
import { actorFromCharacter, createEncounter, createFoe } from '../../rules/encounter.js';
import { scriptedDice, validCharacter } from '../../rules/__tests__/fixtures.js';
import { createVttRoom, executeRoomCommand, type RoomCommand, type RoomEvent } from '../../rules/vtt-room.js';
import { LocalEncounterSession, type LocalRoomPersistence } from '../session.js';

function memoryPersistence(): LocalRoomPersistence & { records: Map<string, unknown> } {
  const records = new Map<string, unknown>();
  return {
    records,
    load(roomId) {
      const state = records.get(roomId);
      return state ? structuredClone(state) as ReturnType<typeof createVttRoom> : null;
    },
    save(roomId, state) {
      records.set(roomId, structuredClone(state));
    },
    remove(roomId) {
      records.delete(roomId);
    },
  };
}

describe('EncounterSession local controller', () => {
  it('uses the room reducer for durable operations and excludes ephemeral pings', () => {
    const persistence = memoryPersistence();
    const session = new LocalEncounterSession({
      roomId: 'offline-fixture',
      initialState: createVttRoom(),
      persistence,
    });
    const snapshots: number[] = [];
    session.subscribe((snapshot) => snapshots.push(snapshot.state?.revision ?? -1));

    session.table({ type: 'UPSERT_CLOCK', clock: { id: 'threat', name: 'Threat', segments: 6, filled: 2 } });
    expect(session.state).toMatchObject({ revision: 1, table: { clocks: [{ id: 'threat', filled: 2 }] } });
    expect(persistence.records.get('offline-fixture')).toMatchObject({ revision: 1 });

    session.ping({ x: 4, y: 3 });
    expect(session.state?.revision).toBe(1);
    expect(snapshots).toEqual([0, 1]);
  });

  it('migrates imported local rooms before persistence', () => {
    const persistence = memoryPersistence();
    const session = new LocalEncounterSession({ roomId: 'import-fixture', persistence });
    const legacy = createVttRoom().encounter;
    legacy.revision = 7;

    session.importRoom(legacy);
    expect(session.state).toMatchObject({ schemaVersion: 2, revision: 7, encounter: { revision: 7 } });
    expect(persistence.records.get('import-fixture')).toMatchObject({ schemaVersion: 2, revision: 7 });
  });

  it('keeps local encounter, table, persistence, and event replay on the same room reducer path', () => {
    const persistence = memoryPersistence();
    const hero = actorFromCharacter(validCharacter('Local Hero'), { x: 1, y: 1 });
    const foe = createFoe('Local Foe', { x: 4, y: 1 });
    const initial = createVttRoom(createEncounter('Local reducer integration'));
    const commands: RoomCommand[] = [
      { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: hero } },
      { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: foe } },
      { domain: 'encounter', command: { type: 'SET_TERRAIN', cell: { position: { x: 2, y: 1 }, type: 'difficult', elevation: 0 } } },
      { domain: 'encounter', command: { type: 'START_ENCOUNTER' } },
      // Combat starts awaiting the player side's choice (ICON p.87): the
      // controller selects the hero before moving.
      { domain: 'encounter', command: { type: 'TAKE_TURN', actorId: hero.id } },
      { domain: 'encounter', command: { type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }], mode: 'standard' } },
      { domain: 'encounter', command: { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' } },
      { domain: 'table', command: { type: 'UPSERT_CLOCK', clock: { id: 'pressure', name: 'Pressure', segments: 6, filled: 2 } } },
    ];

    let expected = initial;
    const events: RoomEvent[] = [];
    for (const command of commands) {
      const result = executeRoomCommand(expected, command, scriptedDice(12, 5));
      expected = result.state;
      events.push(...result.events);
    }

    const session = new LocalEncounterSession({
      roomId: 'reducer-integration',
      initialState: initial,
      persistence,
      diceForCommand: () => scriptedDice(12, 5),
    });
    for (const command of commands) {
      if (command.domain === 'encounter') session.encounter(command.command);
      else session.table(command.command);
    }

    expect(session.state).toEqual(expected);
    expect(persistence.records.get('reducer-integration')).toEqual(expected);

    // A reload uses the persisted canonical room, while replay uses only the
    // emitted reducer events. Both must reconstruct the exact same result.
    const reloaded = new LocalEncounterSession({ roomId: 'reducer-integration', persistence });
    expect(reloaded.state).toEqual(expected);
    const replay = new LocalEncounterSession({ roomId: 'reducer-replay', initialState: initial });
    expect(replay.replay(events)).toEqual(expected);
    expect(replay.state).toEqual(initial);
  });
});
