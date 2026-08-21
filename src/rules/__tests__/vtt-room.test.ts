import { describe, expect, it } from 'vitest';
import { createEncounter, createFoe } from '../encounter.js';
import {
  applyRoomEvents,
  assertValidVttRoomState,
  createDefaultTableState,
  createVttRoom,
  executeRoomCommand,
  MAX_TABLE_GEOMETRY_POINTS,
  MAX_TABLE_POINTS_PER_ARTIFACT,
  MAX_VTT_ROOM_SERIALIZED_BYTES,
  migrateVttRoom,
  roomVisibleToRole,
  VttRoomViolation,
} from '../vtt-room.js';

describe('versioned VTT room reducer', () => {
  it('wraps legacy bare encounters without losing encounter events, actors, or revision', () => {
    let encounter = createEncounter('Legacy battlefield');
    encounter.grid.backgroundUrl = 'https://assets.example/legacy-map.webp';
    encounter = {
      ...encounter,
      actors: { foe: createFoe('Legacy foe', { x: 3, y: 2 }) },
      revision: 17,
      eventLog: [{ type: 'ACTOR_ADDED', actor: createFoe('Historical foe', { x: 1, y: 1 }) }],
    };

    const room = migrateVttRoom(encounter);
    expect(room).toMatchObject({ schemaVersion: 2, revision: 17, encounter: { name: 'Legacy battlefield', revision: 17 } });
    expect(room.encounter.actors.foe.name).toBe('Legacy foe');
    expect(room.encounter.eventLog).toHaveLength(1);
    expect(room.table.map.backgroundUrl).toBe('https://assets.example/legacy-map.webp');
  });

  it('migrates the first room schema and rejects unknown future room schemas', () => {
    const encounter = createEncounter('Room migration');
    const migrated = migrateVttRoom({
      schemaVersion: 1,
      encounter,
      revision: 4,
      table: { map: { backgroundUrl: 'https://assets.example/map.png' } },
    });
    expect(migrated).toMatchObject({ schemaVersion: 2, revision: 4, table: { map: { scale: 1, cellSize: 64, backgroundUrl: 'https://assets.example/map.png' } } });
    expect(() => migrateVttRoom({ schemaVersion: 99, encounter })).toThrow(/Unsupported VTT room schema/);
  });

  it('rejects an explicitly malformed historical map instead of silently defaulting it', () => {
    const encounter = createEncounter('Malformed historical map');
    expect(() => migrateVttRoom({
      schemaVersion: 1,
      revision: 0,
      encounter,
      table: { map: 'discard-me' },
    })).toThrow(/Historical map state must be an object/i);
    expect(() => migrateVttRoom({
      schemaVersion: 1,
      revision: 0,
      encounter,
      table: { map: { offset: 'discard-me' } },
    })).toThrow(/Historical map offset must be an object/i);
  });

  it('rejects invalid historical table artifacts instead of dropping them during migration', () => {
    const encounter = createEncounter('Historical table preservation');
    expect(() => migrateVttRoom({
      schemaVersion: 1,
      encounter,
      revision: 0,
      table: {
        annotations: [{ id: 'bad-note', kind: 'note', points: [], color: '#000', text: 'Do not discard me' }],
      },
    })).toThrow(/cannot be migrated without losing data/i);
  });

  it('keeps tabletop revisions independent from encounter revisions', () => {
    const initial = createVttRoom(createEncounter('Revision fixture'));
    const tableResult = executeRoomCommand(initial, {
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id: 'doom', name: 'Doom', segments: 6, filled: 2 } },
    });
    expect(tableResult.state.revision).toBe(initial.revision + 1);
    expect(tableResult.state.encounter.revision).toBe(initial.encounter.revision);
    expect(initial.table.clocks).toEqual([]);

    const encounterResult = executeRoomCommand(tableResult.state, {
      domain: 'encounter',
      command: { type: 'ADD_ACTOR', actor: createFoe('Room foe', { x: 1, y: 1 }) },
    });
    expect(encounterResult.state.revision).toBe(tableResult.state.revision + 1);
    expect(encounterResult.state.encounter.revision).toBe(tableResult.state.encounter.revision + 1);
    expect(encounterResult.state.table.clocks).toHaveLength(1);
  });

  it('replays durable table events through the same reducer state', () => {
    const initial = createVttRoom();
    const result = executeRoomCommand(initial, {
      domain: 'table',
      command: {
        type: 'UPSERT_TEMPLATE',
        template: { id: 'blast', kind: 'burst', origin: { x: 4, y: 7 }, rotation: 0, length: 3, width: 3, label: 'Burst 3', color: '#a4e' },
      },
    });
    expect(applyRoomEvents(initial, result.events)).toEqual(result.state);
  });

  it('does not permit browser-only asset URLs in durable table state', () => {
    const table = createDefaultTableState();
    expect(() => executeRoomCommand({ ...createVttRoom(), table }, {
      domain: 'table',
      command: { type: 'SET_MAP', map: { backgroundUrl: 'blob:local-preview' } },
    })).toThrow(VttRoomViolation);
    expect(() => executeRoomCommand({ ...createVttRoom(), table }, {
      domain: 'table',
      command: { type: 'SET_MAP', map: { backgroundUrl: '  BlOb:local-preview' } },
    })).toThrow(VttRoomViolation);
  });

  it('bounds aggregate fog and annotation geometry before it becomes room state', () => {
    const points = Array.from({ length: MAX_TABLE_POINTS_PER_ARTIFACT }, (_, index) => ({ x: index, y: 0 }));
    let room = executeRoomCommand(createVttRoom(), {
      domain: 'table',
      command: { type: 'PAINT_FOG', region: { id: 'dense-fog', cells: points } },
    }).state;
    room = executeRoomCommand(room, {
      domain: 'table',
      command: { type: 'UPSERT_ANNOTATION', annotation: { id: 'dense-line', kind: 'line', points, color: '#000', text: 'Dense route' } },
    }).state;
    expect(MAX_TABLE_GEOMETRY_POINTS).toBe(points.length * 2);
    expect(() => executeRoomCommand(room, {
      domain: 'table',
      command: { type: 'UPSERT_ANNOTATION', annotation: { id: 'one-too-many', kind: 'marker', points: [{ x: 0, y: 1 }], color: '#000', text: 'Overflow' } },
    })).toThrow(/total points/i);
  });

  it('keeps historical migration permissive but rejects malformed canonical checkpoint state', () => {
    const room = createVttRoom(createEncounter('Checkpoint validation'));
    expect(() => assertValidVttRoomState(room)).not.toThrow();

    const malformed = structuredClone(room) as unknown as Record<string, unknown>;
    const encounter = malformed.encounter as Record<string, unknown>;
    encounter.actors = { incomplete: { id: 'incomplete' } };
    const migrated = migrateVttRoom(malformed);
    // Migration can supply compatibility defaults for old exports, but only a
    // fully formed canonical result is safe to hydrate as Render authority.
    expect(migrated.encounter.actors.incomplete).toMatchObject({ id: 'incomplete', actorKind: 'foe' });
    expect(() => assertValidVttRoomState(migrated)).toThrow(/name is required/i);
  });

  it('rejects out-of-grid mechanics in a canonical checkpoint', () => {
    const room = createVttRoom(createEncounter('Grid checkpoint validation'));
    const actor = createFoe('Off board', { x: room.encounter.grid.width, y: 0 });
    room.encounter.actors[actor.id] = actor;
    expect(() => assertValidVttRoomState(room)).toThrow(/inside the encounter grid/i);
  });

  it('rejects browser-only URLs in actor and legacy-grid checkpoint fields', () => {
    const room = createVttRoom(createEncounter('Checkpoint assets'));
    const actor = createFoe('Temporary actor asset', { x: 1, y: 1 });
    actor.tokenUrl = 'blob:https://app.example/actor';
    room.encounter.actors[actor.id] = actor;
    expect(() => assertValidVttRoomState(room)).toThrow(/blob URL/i);

    const legacy = createEncounter('Legacy map asset');
    legacy.grid.backgroundUrl = 'blob:https://app.example/map';
    expect(() => assertValidVttRoomState(migrateVttRoom(legacy))).toThrow(/blob URL/i);
  });

  it('rejects a malformed historical actor event as an invalid checkpoint', () => {
    const room = createVttRoom(createEncounter('Malformed actor event'));
    room.encounter.eventLog.push({ type: 'ACTOR_ADDED', actor: null } as never);
    expect(() => assertValidVttRoomState(room)).toThrow(VttRoomViolation);
  });

  it('enforces a byte budget for durable realtime room snapshots', () => {
    const room = createVttRoom(createEncounter('Bounded serialized room'));
    room.table.annotations = Array.from({ length: 500 }, (_, index) => ({
      id: `note-${index}`,
      kind: 'note' as const,
      points: [{ x: 1, y: 1 }],
      color: '#000',
      text: 'x'.repeat(1_000),
    }));
    expect(JSON.stringify(room).length).toBeGreaterThan(MAX_VTT_ROOM_SERIALIZED_BYTES);
    expect(() => assertValidVttRoomState(room)).toThrow(/realtime durability budget/i);
  });

  it('omits GM-hidden presentation and mechanical data from player payloads', () => {
    const room = createVttRoom();
    room.encounter.actors.secret = createFoe('Mechanically present foe', { x: 1, y: 1 });
    room.encounter.actors.visible = createFoe('Visible foe', { x: 3, y: 1 });
    room.encounter.actors.visible.marks.push({
      id: 'secret-mark',
      sourceId: 'secret-source',
      ownerId: 'secret',
      markId: 'hidden-mark',
      duration: null,
      state: {},
    });
    room.encounter.actors.visible.activeEffects.push({
      id: 'secret-effect',
      sourceId: 'secret-source',
      effectId: 'hidden-effect',
      ownerId: 'secret',
      duration: { kind: 'combat' },
      modifiers: [],
      triggers: [],
      state: {},
    });
    room.encounter.actors.visible.conditions.push({
      id: 'stealth',
      sourceId: 'secret-source',
      ownerId: 'secret',
      potency: 'normal',
      duration: null,
    });
    room.encounter.actors.visible.stance = {
      id: 'secret-stance',
      sourceId: 'secret-source',
      ownerId: 'secret',
      stanceId: 'hidden-stance',
      state: {},
    };
    room.encounter.actors.visible.ruleState = { 'secret-flag': true, 'legacy-unknown-source': true };
    room.encounter.actors.visible.ruleStateOwners = { 'secret-flag': 'secret', 'legacy-unknown-source': null };
    room.encounter.terrainEffects.push({
      id: 'secret-terrain',
      sourceId: 'secret-source',
      ownerId: 'secret',
      terrain: 'dangerous',
      positions: [{ x: 2, y: 1 }],
      height: null,
      duration: { kind: 'combat' },
    });
    room.encounter.eventLog.push({
      type: 'ACTOR_MOVED',
      actorId: 'visible',
      from: { x: 3, y: 1 },
      to: { x: 4, y: 1 },
      gmSecret: 'Do not disclose this diagnostic note',
    } as never);
    room.table.actorPresentation.secret = { hidden: true, label: 'Secret token' };
    room.table.annotations.push({ id: 'gm-note', kind: 'note', points: [{ x: 1, y: 1 }], color: '#000', text: 'Hidden', hidden: true });
    room.table.clocks.push({ id: 'visible-clock', name: 'Visible', segments: 4, filled: 1 });
    const player = roomVisibleToRole(room, 'player');

    expect(player.encounter.actors.secret).toBeUndefined();
    expect(player.encounter.activeActorId).toBeNull();
    expect(player.table.actorPresentation.secret).toBeUndefined();
    expect(player.table.annotations).toEqual([]);
    expect(player.table.clocks).toHaveLength(1);
    expect(player.encounter.actors.visible.marks).toEqual([]);
    expect(player.encounter.actors.visible.activeEffects).toEqual([]);
    expect(player.encounter.actors.visible.conditions).toEqual([]);
    expect(player.encounter.actors.visible.stance).toBeNull();
    expect(player.encounter.actors.visible.ruleState).toEqual({});
    expect(player.encounter.actors.visible.ruleStateOwners).toEqual({});
    expect(player.encounter.terrainEffects).toEqual([]);
    expect(player.encounter.eventLog).toEqual([]);
    expect(JSON.stringify(player)).not.toContain('secret-source');
    expect(JSON.stringify(player)).not.toContain('Do not disclose this diagnostic note');
    expect(room.table.actorPresentation.secret).toBeDefined();
  });
});
