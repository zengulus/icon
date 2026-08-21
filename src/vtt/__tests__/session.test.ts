import { describe, expect, it } from 'vitest';
import { createVttRoom } from '../../rules/vtt-room.js';
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
});
