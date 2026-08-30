import type { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, createEncounter, createFoe } from '../../src/rules/encounter.js';
import { ENCOUNTER_SCHEMA_VERSION } from '../../src/rules/types.js';
import { heldDamageContinuation } from '../../src/rules/automation/primitives/continuation.js';
import type { RuleMutation } from '../../src/rules/automation/primitives/types.js';
import { parseClientMessage, type ServerMessage } from '../../src/rules/protocol.js';
import { createVttRoom, currentStateForPersistence, type RoomCommand, type VttRoomState } from '../../src/rules/vtt-room.js';
import type { ServerConfig } from '../config.js';
import type { VttCheckpoint } from '../checkpoints.js';
import {
  RoomManager,
  SupabaseCheckpointPersistence,
  decodeStoredCheckpoint,
  migrateAndValidateVttRoom,
  type AuthenticatedClient,
  type RoomCheckpointPersistence,
} from '../rooms.js';
import { validCharacter } from '../../src/rules/__tests__/fixtures.js';

const config: ServerConfig = {
  port: 0,
  allowedOrigins: ['http://localhost:5173'],
  supabaseUrl: '',
  supabaseServiceRoleKey: '',
  discordWebhookUrl: '',
  allowDevAuth: true,
  allowIncompleteVtt: true,
  connectPepper: '',
};

class RecordingCheckpointPersistence implements RoomCheckpointPersistence {
  readonly writes: VttCheckpoint<VttRoomState>[] = [];
  readonly loads: string[] = [];
  private readonly records = new Map<string, VttCheckpoint<VttRoomState>>();

  constructor(initial: VttCheckpoint<VttRoomState> | null = null) {
    if (initial) this.records.set(initial.roomId, structuredClone(initial));
  }

  async load(roomId: string) {
    this.loads.push(roomId);
    const checkpoint = this.records.get(roomId);
    if (!checkpoint) return null;
    return {
      state: structuredClone(checkpoint.state),
      cursor: {
        roomRevision: checkpoint.roomRevision,
        encounterRevision: checkpoint.encounterRevision,
        checkpointedAt: Date.parse(checkpoint.createdAt),
      },
    };
  }

  async write(checkpoint: VttCheckpoint<VttRoomState>): Promise<void> {
    this.writes.push(structuredClone(checkpoint));
    const previous = this.records.get(checkpoint.roomId);
    if (!previous || checkpoint.roomRevision >= previous.roomRevision) this.records.set(checkpoint.roomId, structuredClone(checkpoint));
  }
}

class FakeSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  readonly messages: ServerMessage[] = [];
  closeCode: number | null = null;

  send(raw: string): void {
    this.messages.push(JSON.parse(raw) as ServerMessage);
  }

  close(code?: number): void {
    this.closeCode = code ?? null;
    this.readyState = 3;
  }
}

function socket(): FakeSocket {
  return new FakeSocket();
}

function persistedRoom(roomId: string, revision: number): VttCheckpoint<VttRoomState> {
  const state: VttRoomState = {
    schemaVersion: 2,
    revision,
    encounter: {
      ...actorlessEncounter(roomId),
      revision,
    },
    table: {
      map: { backgroundUrl: '', scale: 1, offset: { x: 0, y: 0 }, cellSize: 64, showGrid: true, showCoordinates: false },
      actorPresentation: {},
      fog: [],
      annotations: [],
      templates: [],
      clocks: [],
    },
  };
  return {
    roomId,
    roomRevision: revision,
    encounterRevision: revision,
    schemaVersion: state.schemaVersion,
    reason: 'semantic',
    createdAt: '2026-08-22T00:00:00.000Z',
    state,
  };
}

function actorlessEncounter(id: string) {
  return {
    ...createEncounter('Hydrated room'),
    id,
  };
}

async function join(manager: RoomManager, encounterId: string, token: string) {
  const fake = socket();
  const client = await manager.join(fake as unknown as WebSocket, encounterId, token);
  return { client, socket: fake };
}

function last<MessageType extends ServerMessage['type']>(socket: FakeSocket, type: MessageType): Extract<ServerMessage, { type: MessageType }> {
  const message = [...socket.messages].reverse().find((candidate) => candidate.type === type);
  if (!message) throw new Error(`Expected a ${type} message.`);
  return message as Extract<ServerMessage, { type: MessageType }>;
}

async function settleAndLeave(manager: RoomManager, gm: AuthenticatedClient, clients: AuthenticatedClient[]) {
  const state = manager.inspect(gm.encounterId);
  if (state) await manager.hardSave(gm, state.revision);
  for (const client of clients) manager.leave(client);
  await Promise.resolve();
  await Promise.resolve();
}

describe('VTT persistence projection', () => {
  it('persists current state without replay history', () => {
    const room = createVttRoom();
    room.encounter.eventLog = [{ type: 'ENCOUNTER_STARTED', firstActorId: 'actor:test' }];
    const persisted = currentStateForPersistence(room);
    expect(persisted.encounter.eventLog).toEqual([]);
    expect(room.encounter.eventLog).toHaveLength(1);
  });
});

describe('RoomManager authoritative VTT integration', () => {
  it('validates the checkpoint envelope before hydrating a room', () => {
    const checkpoint = persistedRoom('room-checkpoint-envelope', 12);
    expect(decodeStoredCheckpoint({
      room_revision: checkpoint.roomRevision,
      encounter_revision: checkpoint.encounterRevision,
      schema_version: checkpoint.schemaVersion,
      state: checkpoint.state,
      created_at: checkpoint.createdAt,
    })).toMatchObject({ state: { revision: 12 }, cursor: { roomRevision: 12, encounterRevision: 12 } });
    expect(() => decodeStoredCheckpoint({
      room_revision: 13,
      encounter_revision: checkpoint.encounterRevision,
      schema_version: checkpoint.schemaVersion,
      state: checkpoint.state,
      created_at: checkpoint.createdAt,
    })).toThrow(/does not match/i);
    expect(() => decodeStoredCheckpoint({
      room_revision: checkpoint.roomRevision,
      encounter_revision: checkpoint.encounterRevision,
      schema_version: checkpoint.schemaVersion,
      state: checkpoint.state,
      created_at: checkpoint.createdAt,
    }, 'different-room')).toThrow(/encounter id/i);
  });

  it('does not silently rewrite a malformed current-schema checkpoint', () => {
    const checkpoint = persistedRoom('room-current-corruption', 12);
    checkpoint.state.table.annotations.push({
      id: 'invalid-current-annotation',
      kind: 'note',
      points: [],
      color: '#000',
      text: 'This must not be quietly dropped during hydration.',
    });

    expect(() => decodeStoredCheckpoint({
      room_revision: checkpoint.roomRevision,
      encounter_revision: checkpoint.encounterRevision,
      schema_version: checkpoint.schemaVersion,
      state: checkpoint.state,
      created_at: checkpoint.createdAt,
    }, checkpoint.roomId)).toThrow(/must not be empty/i);
  });

  it('does not normalize a malformed current-schema legacy parent snapshot', () => {
    const checkpoint = persistedRoom('room-current-parent-corruption', 0);
    const actor = createFoe('Missing current flag', { x: 1, y: 1 }) as unknown as Record<string, unknown>;
    delete actor.dangerousTerrainTriggeredThisTurn;
    checkpoint.state.encounter.actors = { current: actor as never };

    expect(() => migrateAndValidateVttRoom(checkpoint.state)).toThrow(/dangerousTerrainTriggeredThisTurn is required/i);
  });

  it('migrates condition ownership before a historical checkpoint becomes live authority', () => {
    const checkpoint = persistedRoom('room-condition-provenance', 12);
    const source = createFoe('Legacy source', { x: 1, y: 1 });
    source.abilityIds = ['legacy:source'];
    const target = createFoe('Legacy target', { x: 2, y: 1 });
    target.conditions = [{ id: 'stealth', sourceId: 'legacy:source', potency: 'normal', duration: null } as never];
    checkpoint.state.encounter = {
      ...checkpoint.state.encounter,
      schemaVersion: 4 as never,
      actors: { [source.id]: source, [target.id]: target },
    };

    const loaded = decodeStoredCheckpoint({
      room_revision: checkpoint.roomRevision,
      encounter_revision: checkpoint.encounterRevision,
      schema_version: checkpoint.schemaVersion,
      state: checkpoint.state,
      created_at: checkpoint.createdAt,
    }, checkpoint.roomId);

    expect(loaded.state.encounter.schemaVersion).toBe(ENCOUNTER_SCHEMA_VERSION);
    expect(loaded.state.encounter.actors[target.id]?.conditions).toMatchObject([
      { sourceId: 'legacy:source', ownerId: source.id },
    ]);
  });

  it('rebases a validated historical checkpoint above a corrupt durable head', async () => {
    const historical = persistedRoom('room-corrupt-head', 99);
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const persistence = new SupabaseCheckpointPersistence({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({
                data: [
                  {
                    room_revision: 100,
                    encounter_revision: 99,
                    schema_version: 2,
                    // A database row can survive an interrupted/manual bad
                    // write even though its JSON cannot hydrate a room.
                    state: {},
                    created_at: historical.createdAt,
                  },
                  {
                    room_revision: historical.roomRevision,
                    encounter_revision: historical.encounterRevision,
                    schema_version: historical.schemaVersion,
                    state: historical.state,
                    created_at: historical.createdAt,
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { data: null, error: null };
      },
    } as never);

    const recovered = await persistence.load('room-corrupt-head');

    expect(recovered).toMatchObject({
      state: { revision: 101, encounter: { id: 'room-corrupt-head', revision: 99 } },
      cursor: { roomRevision: 101, encounterRevision: 99 },
    });
    expect(historical.state.revision).toBe(99);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      name: 'append_encounter_checkpoint',
      args: {
        p_encounter_id: 'room-corrupt-head',
        p_room_revision: 101,
        p_encounter_revision: 99,
        p_reason: 'recovery',
        p_state: { revision: 101, encounter: { id: 'room-corrupt-head', revision: 99 } },
      },
    });
  });

  it('hydrates a cold room from the latest durable checkpoint before admitting a client', async () => {
    const checkpoint = persistedRoom('room-cold-hydration', 50);
    const persistence = new RecordingCheckpointPersistence(checkpoint);
    const manager = new RoomManager(config, { persistence });
    const { socket: gmSocket } = await join(manager, 'room-cold-hydration', 'dev:gm-user:gm');

    expect(persistence.loads).toEqual(['room-cold-hydration']);
    expect(last(gmSocket, 'joined')).toMatchObject({
      state: {
        revision: 50,
        encounter: { id: 'room-cold-hydration', revision: 50, name: 'Hydrated room' },
      },
      saveStatus: 'saved',
    });
  });

  it('joins an active room from live Render state rather than reloading a stale checkpoint', async () => {
    const checkpoint = persistedRoom('room-live-join', 50);
    const persistence = new RecordingCheckpointPersistence(checkpoint);
    const manager = new RoomManager(config, { persistence });
    const { client: gm } = await join(manager, 'room-live-join', 'dev:gm-user:gm');
    for (let revision = 50; revision < 55; revision += 1) {
      await manager.command(gm, revision, {
        domain: 'table',
        command: { type: 'UPSERT_CLOCK', clock: { id: 'live-progress', name: 'Live progress', segments: 6, filled: Math.min(6, revision - 49) } },
      });
    }
    expect(manager.inspect('room-live-join')?.revision).toBe(55);

    const player = await join(manager, 'room-live-join', 'dev:player-user:player');
    expect(persistence.loads).toEqual(['room-live-join']);
    expect(last(player.socket, 'joined')).toMatchObject({
      state: { revision: 55, table: { clocks: [{ id: 'live-progress', filled: 5 }] } },
    });

    await settleAndLeave(manager, gm, [gm, player.client]);
  });

  it('accepts revisioned room commands, rejects stale revisions, and keeps pings ephemeral', async () => {
    const persistence = new RecordingCheckpointPersistence();
    const manager = new RoomManager(config, { persistence });
    const { client: gm, socket: gmSocket } = await join(manager, 'room-authority', 'dev:gm-user:gm');

    expect(last(gmSocket, 'joined')).toMatchObject({
      encounterId: 'room-authority',
      role: 'gm',
      state: { revision: 0, encounter: { id: 'room-authority' } },
      saveStatus: 'unsaved',
    });

    const clockCommand: RoomCommand = {
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id: 'alarm', name: 'Alarm', segments: 4, filled: 1 } },
    };
    await manager.command(gm, 0, clockCommand);
    expect(manager.inspect('room-authority')).toMatchObject({ revision: 1, encounter: { revision: 0 }, table: { clocks: [{ id: 'alarm', filled: 1 }] } });
    expect(last(gmSocket, 'events')).toMatchObject({
      encounterId: 'room-authority',
      events: [{ domain: 'table', event: { type: 'CLOCK_UPSERTED' } }],
      state: { revision: 1 },
      saveStatus: 'unsaved',
    });

    await manager.command(gm, 0, {
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id: 'stale', name: 'Stale', segments: 4, filled: 1 } },
    });
    expect(last(gmSocket, 'error')).toMatchObject({
      code: 'revision.conflict',
      state: { revision: 1 },
    });
    expect(manager.inspect('room-authority')?.table.clocks.map(({ id }) => id)).toEqual(['alarm']);

    await manager.ping(gm, { x: 6, y: 4 });
    expect(last(gmSocket, 'ping')).toEqual({ type: 'ping', encounterId: 'room-authority', userId: 'gm-user', position: { x: 6, y: 4 } });
    expect(manager.inspect('room-authority')?.revision).toBe(1);
    expect(persistence.writes).toHaveLength(0);

    await settleAndLeave(manager, gm, [gm]);
  });

  it('bounds durable command and ping fan-out per authenticated user and room', async () => {
    let now = 10_000;
    const manager = new RoomManager(config, {
      persistence: new RecordingCheckpointPersistence(),
      now: () => now,
      rateLimit: {
        durableCommandLimit: 2,
        durableCommandWindowMs: 1_000,
        pingLimit: 1,
        pingWindowMs: 1_000,
      },
    });
    const { client: gm, socket: gmSocket } = await join(manager, 'room-rate-limit', 'dev:gm-user:gm');
    const clock = (id: string): RoomCommand => ({
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id, name: id, segments: 4, filled: 1 } },
    });

    await manager.command(gm, 0, clock('one'));
    await manager.command(gm, 1, clock('two'));
    await manager.command(gm, 2, clock('three'));
    expect(last(gmSocket, 'error')).toMatchObject({ code: 'rate.limited' });
    expect(manager.inspect('room-rate-limit')?.revision).toBe(2);

    await manager.ping(gm, { x: 1, y: 1 });
    await manager.ping(gm, { x: 2, y: 2 });
    expect(last(gmSocket, 'error')).toMatchObject({ code: 'rate.limited' });
    expect(manager.inspect('room-rate-limit')?.revision).toBe(2);

    // A disconnect must not reset the same authenticated user's room budget.
    manager.leave(gm);
    const rejoined = await join(manager, 'room-rate-limit', 'dev:gm-user:gm');
    await manager.command(rejoined.client, 2, clock('three'));
    expect(last(rejoined.socket, 'error')).toMatchObject({ code: 'rate.limited' });
    expect(manager.inspect('room-rate-limit')?.revision).toBe(2);

    now += 1_001;
    await manager.command(rejoined.client, 2, clock('three'));
    expect(manager.inspect('room-rate-limit')?.revision).toBe(3);

    await settleAndLeave(manager, rejoined.client, [rejoined.client]);
  });

  it('rechecks an open socket after the authorization TTL and closes a demoted role', async () => {
    let now = 0;
    let role: 'gm' | 'player' = 'gm';
    const persistence = new RecordingCheckpointPersistence();
    const manager = new RoomManager(config, {
      persistence,
      now: () => now,
      authorizationTtlMs: 1_000,
    });
    manager.authenticate = async () => ({ userId: 'membership-user', role });
    const { client, socket: gmSocket } = await join(manager, 'room-membership-ttl', 'opaque-token');
    expect(last(gmSocket, 'joined')).toMatchObject({ role: 'gm' });

    now = 1_001;
    role = 'player';
    await manager.command(client, 0, { domain: 'table', command: { type: 'SET_MAP', map: { showGrid: false } } });

    expect(last(gmSocket, 'error')).toMatchObject({ code: 'authorization.revoked' });
    expect(gmSocket.closeCode).toBe(1008);
    expect(persistence.writes.every((checkpoint) => checkpoint.roomRevision === 0)).toBe(true);
    expect(manager.status().connections).toBe(0);
  });

  it('rechecks an idle GM before a later room broadcast can expose new state', async () => {
    let now = 0;
    let formerGmRole: 'gm' | 'player' = 'gm';
    const manager = new RoomManager(config, {
      persistence: new RecordingCheckpointPersistence(),
      now: () => now,
      authorizationTtlMs: 1_000,
    });
    manager.authenticate = async (token) => token === 'former-gm-token'
      ? { userId: 'former-gm', role: formerGmRole }
      : { userId: 'active-gm', role: 'gm' };
    const formerGm = await join(manager, 'room-passive-membership-ttl', 'former-gm-token');
    const activeGm = await join(manager, 'room-passive-membership-ttl', 'active-gm-token');

    now = 1_001;
    formerGmRole = 'player';
    await manager.command(activeGm.client, 0, {
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id: 'private-progress', name: 'Private progress', segments: 4, filled: 1 } },
    });

    expect(formerGm.socket.messages.filter((message) => message.type === 'events')).toEqual([]);
    expect(last(formerGm.socket, 'error')).toMatchObject({ code: 'authorization.revoked' });
    expect(formerGm.socket.closeCode).toBe(1008);
    expect(last(activeGm.socket, 'events')).toMatchObject({ state: { revision: 1 } });
    expect(manager.status().connections).toBe(1);

    await settleAndLeave(manager, activeGm.client, [activeGm.client]);
  });

  it('delivers delayed authorization fan-out in authoritative revision order', async () => {
    let now = 0;
    let delayStaleRefresh = false;
    let releaseRefresh!: () => void;
    let signalRefresh!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { signalRefresh = resolve; });
    const refreshReleased = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const manager = new RoomManager(config, {
      persistence: new RecordingCheckpointPersistence(),
      now: () => now,
      authorizationTtlMs: 1_000,
    });
    manager.authenticate = async (token) => {
      if (token === 'stale-gm-token') {
        if (delayStaleRefresh) {
          signalRefresh();
          await refreshReleased;
        }
        return { userId: 'stale-gm', role: 'gm' };
      }
      return { userId: 'active-gm', role: 'gm' };
    };
    const staleGm = await join(manager, 'room-ordered-fanout', 'stale-gm-token');
    const activeGm = await join(manager, 'room-ordered-fanout', 'active-gm-token');

    now = 1_001;
    delayStaleRefresh = true;
    const first = manager.command(activeGm.client, 0, {
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id: 'order', name: 'First', segments: 4, filled: 1 } },
    });
    await refreshStarted;
    const second = manager.command(activeGm.client, 1, {
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id: 'order', name: 'Second', segments: 4, filled: 2 } },
    });
    releaseRefresh();
    await Promise.all([first, second]);

    const events = activeGm.socket.messages.filter((message): message is Extract<ServerMessage, { type: 'events' }> => message.type === 'events');
    expect(events.map((message) => message.state.revision)).toEqual([1, 2]);
    expect(events.map((message) => message.state.table.clocks[0]?.name)).toEqual(['First', 'Second']);

    await settleAndLeave(manager, activeGm.client, [staleGm.client, activeGm.client]);
  });

  it('refreshes independent stale fan-out recipients concurrently', async () => {
    let now = 0;
    let holdStaleRefreshes = false;
    let staleRefreshes = 0;
    let releaseStaleRefreshes!: () => void;
    const staleRefreshesReleased = new Promise<void>((resolve) => { releaseStaleRefreshes = resolve; });
    const manager = new RoomManager(config, {
      persistence: new RecordingCheckpointPersistence(),
      now: () => now,
      authorizationTtlMs: 1_000,
    });
    manager.authenticate = async (token) => {
      if (holdStaleRefreshes && token.startsWith('stale-')) {
        staleRefreshes += 1;
        await staleRefreshesReleased;
      }
      return { userId: token, role: 'gm' };
    };
    const firstStale = await join(manager, 'room-parallel-fanout', 'stale-one');
    const secondStale = await join(manager, 'room-parallel-fanout', 'stale-two');
    const active = await join(manager, 'room-parallel-fanout', 'active-gm');

    now = 1_001;
    holdStaleRefreshes = true;
    const command = manager.command(active.client, 0, {
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id: 'parallel', name: 'Parallel', segments: 4, filled: 1 } },
    });
    // With serial fan-out this remains 1 until the first refresh is released.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(staleRefreshes).toBe(2);
    releaseStaleRefreshes();
    await command;

    expect(last(active.socket, 'events')).toMatchObject({ state: { revision: 1 } });
    await settleAndLeave(manager, active.client, [firstStale.client, secondStale.client, active.client]);
  });

  it('does not let a client that leaves during authorization mutate a room', async () => {
    let now = 0;
    let holdRefresh = false;
    let releaseRefresh!: () => void;
    let signalRefresh!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { signalRefresh = resolve; });
    const refreshReleased = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const manager = new RoomManager(config, {
      persistence: new RecordingCheckpointPersistence(),
      authorizationTtlMs: 1_000,
      now: () => now,
    });
    manager.authenticate = async () => {
      if (holdRefresh) {
        signalRefresh();
        await refreshReleased;
      }
      return { userId: 'leaving-user', role: 'gm' };
    };
    // The initial join happens before the refresh gate is enabled.
    holdRefresh = false;
    const { client, socket: gmSocket } = await join(manager, 'room-detached-client', 'opaque-token');
    now = 2_000;
    holdRefresh = true;

    const command = manager.command(client, 0, {
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id: 'never-applied', name: 'Never applied', segments: 4, filled: 1 } },
    });
    await refreshStarted;
    manager.leave(client);
    releaseRefresh();
    await command;

    expect(manager.inspect('room-detached-client')?.revision ?? 0).toBe(0);
    expect(gmSocket.messages.filter((message) => message.type === 'events')).toEqual([]);
    expect(manager.status().connections).toBe(0);
  });

  it('bounds a single user to a small number of live room sockets', async () => {
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence() });
    const joined = [] as Array<Awaited<ReturnType<typeof join>>>;
    for (let index = 0; index < 4; index += 1) {
      joined.push(await join(manager, 'room-user-connection-limit', 'dev:many-tabs:player'));
    }
    await expect(join(manager, 'room-user-connection-limit', 'dev:many-tabs:player')).rejects.toThrow(/connection limit/i);
    expect(manager.status().connections).toBe(4);

    // A GM can still perform the final acknowledged save before all test
    // sockets leave; the connection cap is per authenticated principal.
    const gm = await join(manager, 'room-user-connection-limit', 'dev:gm-user:gm');
    await settleAndLeave(manager, gm.client, [gm.client, ...joined.map(({ client }) => client)]);
  });

  it('preserves player ownership when a parsed GM table update replaces an artifact', async () => {
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence() });
    const { client: gm } = await join(manager, 'room-gm-owner-preservation', 'dev:gm-user:gm');
    const player = await join(manager, 'room-gm-owner-preservation', 'dev:player-one:player');

    await manager.command(player.client, 0, {
      domain: 'table',
      command: {
        type: 'UPSERT_ANNOTATION',
        annotation: { id: 'player-note', kind: 'note', points: [{ x: 1, y: 1 }], color: '#4488ff', text: 'Player note' },
      },
    });
    const parsedAnnotation = parseClientMessage(JSON.stringify({
      type: 'command', encounterId: 'room-gm-owner-preservation', expectedRevision: 1,
      command: {
        domain: 'table',
        command: {
          type: 'UPSERT_ANNOTATION',
          annotation: { id: 'player-note', kind: 'note', points: [{ x: 2, y: 1 }], color: '#000000', text: 'GM revision' },
        },
      },
    }));
    if (parsedAnnotation.type !== 'command') throw new Error('Expected parsed command.');
    await manager.command(gm, 1, parsedAnnotation.command);
    expect(manager.inspect('room-gm-owner-preservation')?.table.annotations).toMatchObject([
      { id: 'player-note', authorId: 'player-one', text: 'GM revision' },
    ]);

    await manager.command(player.client, 2, {
      domain: 'table',
      command: {
        type: 'UPSERT_TEMPLATE',
        template: { id: 'player-template', kind: 'burst', origin: { x: 1, y: 1 }, rotation: 0, length: 1, width: 1, label: 'Player template', color: '#4488ff' },
      },
    });
    const parsedTemplate = parseClientMessage(JSON.stringify({
      type: 'command', encounterId: 'room-gm-owner-preservation', expectedRevision: 3,
      command: {
        domain: 'table',
        command: {
          type: 'UPSERT_TEMPLATE',
          template: { id: 'player-template', kind: 'burst', origin: { x: 2, y: 1 }, rotation: 0, length: 2, width: 1, label: 'GM template', color: '#000000' },
        },
      },
    }));
    if (parsedTemplate.type !== 'command') throw new Error('Expected parsed command.');
    await manager.command(gm, 3, parsedTemplate.command);
    expect(manager.inspect('room-gm-owner-preservation')?.table.templates).toMatchObject([
      { id: 'player-template', authorId: 'player-one', label: 'GM template' },
    ]);

    await manager.command(player.client, 4, { domain: 'table', command: { type: 'REMOVE_ANNOTATION', annotationId: 'player-note' } });
    await manager.command(player.client, 5, { domain: 'table', command: { type: 'REMOVE_TEMPLATE', templateId: 'player-template' } });
    expect(manager.inspect('room-gm-owner-preservation')?.table.annotations).toEqual([]);
    expect(manager.inspect('room-gm-owner-preservation')?.table.templates).toEqual([]);

    await settleAndLeave(manager, gm, [gm, player.client]);
  });

  it('bounds each player’s persistent annotation budget', async () => {
    const checkpoint = persistedRoom('room-player-table-budget', 0);
    checkpoint.state.table.annotations = Array.from({ length: 100 }, (_, index) => ({
      id: `existing-note-${index}`,
      authorId: 'player-one',
      kind: 'note' as const,
      points: [{ x: index, y: 0 }],
      color: '#4488ff',
      text: `Existing note ${index}`,
    }));
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence(checkpoint) });
    const { client: gm } = await join(manager, 'room-player-table-budget', 'dev:gm-user:gm');
    const player = await join(manager, 'room-player-table-budget', 'dev:player-one:player');

    await manager.command(player.client, 0, {
      domain: 'table',
      command: { type: 'UPSERT_ANNOTATION', annotation: { id: 'over-budget', kind: 'note', points: [{ x: 0, y: 1 }], color: '#4488ff', text: 'Over budget' } },
    });
    expect(last(player.socket, 'error')).toMatchObject({ code: 'permission.denied' });
    expect(manager.inspect('room-player-table-budget')?.revision).toBe(0);

    await settleAndLeave(manager, gm, [gm, player.client]);
  });

  it('rejects a direct oversized actor before it becomes durable room state', async () => {
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence() });
    const { client: gm, socket: gmSocket } = await join(manager, 'room-oversized-actor', 'dev:gm-user:gm');
    const oversized = createFoe('Oversized resources', { x: 1, y: 1 });
    oversized.resources = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`resource-${index}`, index]));

    await manager.command(gm, 0, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: oversized } });
    expect(last(gmSocket, 'error')).toMatchObject({ code: 'command.failed' });
    expect(manager.inspect('room-oversized-actor')?.revision).toBe(0);

    await settleAndLeave(manager, gm, [gm]);
  });

  it('enforces player actor control and table ownership while allowing public table annotations', async () => {
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence() });
    const { client: gm } = await join(manager, 'room-permissions', 'dev:gm-user:gm');
    const hero = actorFromCharacter(validCharacter('Player Icon'), { x: 1, y: 1 }, 'player-one');
    const foe = { ...createFoe('Guard', { x: 3, y: 1 }), controllerId: 'unrelated-player' };

    await manager.command(gm, 0, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: hero } });
    await manager.command(gm, 1, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: foe } });
    await manager.command(gm, 2, { domain: 'encounter', command: { type: 'START_ENCOUNTER' } });

    const owner = await join(manager, 'room-permissions', 'dev:player-one:player');
    const outsider = await join(manager, 'room-permissions', 'dev:player-two:player');

    await manager.command(outsider.client, 3, { domain: 'encounter', command: { type: 'END_TURN', actorId: hero.id } });
    expect(last(outsider.socket, 'error')).toMatchObject({ code: 'permission.denied' });
    expect(manager.inspect('room-permissions')?.revision).toBe(3);

    // Combat starts awaiting the player side's TAKE_TURN choice (ICON p.87):
    // the controlling player selects the hero, then ends its turn.
    await manager.command(owner.client, 3, { domain: 'encounter', command: { type: 'TAKE_TURN', actorId: hero.id } });
    expect(manager.inspect('room-permissions')).toMatchObject({ revision: 4, encounter: { activeActorId: hero.id } });

    await manager.command(owner.client, 4, { domain: 'encounter', command: { type: 'END_TURN', actorId: hero.id } });
    // END_TURN never selects the next actor (ICON p.87): the room awaits the
    // GM's TAKE_TURN choice of the eligible foe.
    expect(manager.inspect('room-permissions')).toMatchObject({ revision: 5, encounter: { activeActorId: null, eligibleSide: 'foes' } });

    await manager.command(owner.client, 5, { domain: 'table', command: { type: 'SET_MAP', map: { showGrid: false } } });
    expect(last(owner.socket, 'error')).toMatchObject({ code: 'permission.denied' });

    await manager.command(owner.client, 5, {
      domain: 'table',
      command: {
        type: 'UPSERT_ANNOTATION',
        annotation: { id: 'player-note', kind: 'note', points: [{ x: 2, y: 2 }], color: '#4488ff', text: 'We go here.' },
      },
    });
    expect(manager.inspect('room-permissions')).toMatchObject({
      revision: 6,
      table: { annotations: [{ id: 'player-note', authorId: 'player-one' }] },
    });

    await manager.command(outsider.client, 6, { domain: 'table', command: { type: 'REMOVE_ANNOTATION', annotationId: 'player-note' } });
    expect(last(outsider.socket, 'error')).toMatchObject({ code: 'permission.denied' });

    await manager.command(owner.client, 6, {
      domain: 'table',
      command: {
        type: 'UPSERT_ANNOTATION',
        annotation: { id: 'hidden-player-note', kind: 'note', points: [{ x: 2, y: 2 }], color: '#4488ff', text: 'Not allowed', hidden: true },
      },
    });
    expect(last(owner.socket, 'error')).toMatchObject({ code: 'permission.denied' });
    expect(manager.inspect('room-permissions')?.revision).toBe(6);

    // A GM may hide a previously player-owned artifact. The owner must not be
    // able to discover, unhide, or delete it through a stale known ID.
    await manager.command(gm, 6, {
      domain: 'table',
      command: {
        type: 'UPSERT_ANNOTATION',
        annotation: { id: 'player-note', authorId: 'player-one', kind: 'note', points: [{ x: 2, y: 2 }], color: '#000000', text: 'GM-only revision', hidden: true },
      },
    });
    await manager.command(owner.client, 7, {
      domain: 'table',
      command: {
        type: 'UPSERT_ANNOTATION',
        annotation: { id: 'player-note', kind: 'note', points: [{ x: 2, y: 2 }], color: '#4488ff', text: 'Attempted overwrite' },
      },
    });
    expect(last(owner.socket, 'error')).toMatchObject({ code: 'permission.denied' });
    await manager.command(owner.client, 7, { domain: 'table', command: { type: 'REMOVE_ANNOTATION', annotationId: 'player-note' } });
    expect(last(owner.socket, 'error')).toMatchObject({ code: 'permission.denied' });

    await manager.command(gm, 7, {
      domain: 'table',
      command: {
        type: 'UPSERT_TEMPLATE',
        template: { id: 'player-template', authorId: 'player-one', kind: 'burst', origin: { x: 2, y: 2 }, rotation: 0, length: 1, width: 1, label: 'GM-only template', color: '#000000', hidden: true },
      },
    });
    await manager.command(owner.client, 8, { domain: 'table', command: { type: 'REMOVE_TEMPLATE', templateId: 'player-template' } });
    expect(last(owner.socket, 'error')).toMatchObject({ code: 'permission.denied' });
    await manager.command(owner.client, 8, {
      domain: 'table',
      command: {
        type: 'UPSERT_TEMPLATE',
        template: { id: 'player-template', kind: 'burst', origin: { x: 2, y: 2 }, rotation: 0, length: 1, width: 1, label: 'Attempted overwrite', color: '#4488ff' },
      },
    });
    expect(last(owner.socket, 'error')).toMatchObject({ code: 'permission.denied' });

    await manager.command(owner.client, 8, {
      domain: 'encounter',
      command: {
        type: 'EXECUTE_RULE',
        actorId: hero.id,
        sourceId: 'vagabond:trait:skirmisher',
        actionId: 'default',
        timing: 'passive',
        input: {},
      },
    });
    expect(last(owner.socket, 'error')).toMatchObject({ code: 'permission.denied' });
    expect(manager.inspect('room-permissions')?.revision).toBe(8);

    await settleAndLeave(manager, gm, [gm, owner.client, outsider.client]);
  });

  it('redacts GM-hidden state and never sends hidden replay events to players', async () => {
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence() });
    const { client: gm, socket: gmSocket } = await join(manager, 'room-hidden', 'dev:gm-user:gm');
    const secret = createFoe('Secret Sentinel', { x: 4, y: 4 });

    await manager.command(gm, 0, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: secret } });
    await manager.command(gm, 1, {
      domain: 'table',
      command: { type: 'SET_ACTOR_PRESENTATION', actorId: secret.id, presentation: { hidden: true, label: 'Secret Sentinel' } },
    });

    const player = await join(manager, 'room-hidden', 'dev:player-one:player');
    const joined = last(player.socket, 'joined');
    expect(joined.state.encounter.actors[secret.id]).toBeUndefined();
    expect(joined.state.table.actorPresentation[secret.id]).toBeUndefined();
    expect(JSON.stringify(joined)).not.toContain('Secret Sentinel');

    await manager.command(gm, 2, {
      domain: 'table',
      command: {
        type: 'UPSERT_ANNOTATION',
        annotation: { id: 'gm-only', kind: 'note', points: [{ x: 4, y: 4 }], color: '#000000', text: 'GM only clue', hidden: true },
      },
    });
    const playerEvents = last(player.socket, 'events');
    expect(playerEvents.events).toEqual([]);
    expect(playerEvents.state.table.annotations).toEqual([]);
    expect(JSON.stringify(playerEvents)).not.toContain('GM only clue');
    expect(last(gmSocket, 'events')).toMatchObject({ events: [{ domain: 'table', event: { type: 'ANNOTATION_UPSERTED', annotation: { text: 'GM only clue' } } }] });

    await settleAndLeave(manager, gm, [gm, player.client]);
  });

  it('does not allow a player to act through an intentionally hidden controlled token', async () => {
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence() });
    const { client: gm } = await join(manager, 'room-hidden-control', 'dev:gm-user:gm');
    const hiddenHero = actorFromCharacter(validCharacter('Hidden Icon'), { x: 1, y: 1 }, 'player-one');
    const foe = createFoe('Visible foe', { x: 3, y: 1 });
    await manager.command(gm, 0, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: hiddenHero } });
    await manager.command(gm, 1, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: foe } });
    await manager.command(gm, 2, {
      domain: 'table',
      command: { type: 'SET_ACTOR_PRESENTATION', actorId: hiddenHero.id, presentation: { hidden: true } },
    });
    await manager.command(gm, 3, { domain: 'encounter', command: { type: 'START_ENCOUNTER' } });

    const player = await join(manager, 'room-hidden-control', 'dev:player-one:player');
    expect(last(player.socket, 'joined').state.encounter.actors[hiddenHero.id]).toBeUndefined();
    await manager.command(player.client, 4, { domain: 'encounter', command: { type: 'END_TURN', actorId: hiddenHero.id } });
    expect(last(player.socket, 'error')).toMatchObject({ code: 'permission.denied' });
    expect(manager.inspect('room-hidden-control')?.revision).toBe(4);

    await settleAndLeave(manager, gm, [gm, player.client]);
  });

  it('authorizes a same-owner ordering-window answer by the owner’s controller only (T6.2)', async () => {
    // Seed a room whose encounter already carries two same-instant windows and
    // the U13 ordering decision window over them (the same seam the reducer
    // opens automatically on a simultaneous double-damage event).
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 }, 'player-one');
    const foe = createFoe('Relict', { x: 4, y: 1 });
    const checkpoint = persistedRoom('room-ordering-auth', 3);
    checkpoint.state.encounter.phase = 'active';
    checkpoint.state.encounter.activeActorId = hero.id;
    checkpoint.state.encounter.actors = { [hero.id]: hero, [foe.id]: foe };
    const windowIds = ['when-damaged:hero:0', 'when-damaged:hero:1'];
    const openedBy = { factKind: 'when-damaged', instanceId: undefined };
    const provenance = { sourceId: 'fixture:foe-blast', sourceActorId: foe.id };
    // The room validator requires every durable window key to be present
    // (absent = undefined), so seed the full key surface explicitly.
    const windowBase = {
      openedBy,
      provenance,
      resolvedOrder: undefined,
      retarget: undefined,
      retargetProgramId: undefined,
      ordering: undefined,
      resume: undefined,
      choice: undefined,
      heldPayload: undefined,
      heldEffects: [] as RuleMutation[],
    } as const;
    const heldDamage = (id: string, instance: number) => heldDamageContinuation({
      id: `held:${id}`,
      programId: 'fixture',
      ownerActorId: hero.id,
      targetId: hero.id,
      amount: 4,
      damageType: 'normal',
      sourceActorId: foe.id,
      sourceId: 'fixture',
      instance,
      delivery: 'hit',
      ignoreCover: false,
      windowId: id,
    });
    checkpoint.state.encounter.decisionWindows = [
      { id: windowIds[0]!, kind: 'when-damaged', actorId: hero.id, triggeredAt: 3, order: 0, ...windowBase, heldPayload: heldDamage(windowIds[0]!, 1) },
      { id: windowIds[1]!, kind: 'when-damaged', actorId: hero.id, triggeredAt: 3, order: 1, ...windowBase, heldPayload: heldDamage(windowIds[1]!, 2) },
      {
        id: 'choice:hero:2',
        kind: 'choice',
        actorId: hero.id,
        triggeredAt: 3,
        order: 2,
        ...windowBase,
        openedBy: { factKind: 'ordering', instanceId: undefined },
        choice: {
          key: 'ordering',
          label: 'Order your simultaneous effects',
          kind: 'ordering',
          required: true,
          candidateIds: windowIds,
          chooser: { kind: 'role', role: 'owner' },
        },
      },
    ];
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence(checkpoint) });
    await join(manager, 'room-ordering-auth', 'dev:gm-user:gm');
    const owner = await join(manager, 'room-ordering-auth', 'dev:player-one:player');
    const outsider = await join(manager, 'room-ordering-auth', 'dev:player-two:player');

    // A wrong player (not the owner's controller) cannot answer the ordering.
    await manager.command(outsider.client, 3, {
      domain: 'encounter',
      command: { type: 'ANSWER_DECISION_WINDOW', windowId: 'choice:hero:2', input: { actorIds: { ordering: windowIds } } },
    });
    expect(last(outsider.socket, 'error')).toMatchObject({ code: 'permission.denied' });
    expect(manager.inspect('room-ordering-auth')?.revision).toBe(3);

    // The entitled chooser (the owner's controller) may record their order.
    await manager.command(owner.client, 3, {
      domain: 'encounter',
      command: { type: 'ANSWER_DECISION_WINDOW', windowId: 'choice:hero:2', input: { actorIds: { ordering: [windowIds[1]!, windowIds[0]!] } } },
    });
    // eslint-disable-next-line no-console
    console.log('ERR', JSON.stringify(owner.socket.messages.filter((message) => message.type === 'error')));
    expect(manager.inspect('room-ordering-auth')?.revision).toBe(4);
    expect(manager.inspect('room-ordering-auth')?.encounter.decisionWindows).toMatchObject([
      { id: windowIds[0]!, resolvedOrder: 1 },
      { id: windowIds[1]!, resolvedOrder: 0 },
    ]);
    // The ordering window closed; the recorded ranks ride the durable event.
    const answered = manager.inspect('room-ordering-auth')!;
    expect(answered.encounter.decisionWindows.find((window) => window.kind === 'choice')).toBeUndefined();
    expect(answered.encounter.revision).toBe(4);

    await settleAndLeave(manager, owner.client, [owner.client, outsider.client]);
  });

  it('rejects player targets omitted from the player-visible projection without leaking their rule details', async () => {
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence() });
    const { client: gm } = await join(manager, 'room-hidden-target', 'dev:gm-user:gm');
    const hero = actorFromCharacter(validCharacter('Visible Icon'), { x: 1, y: 1 }, 'player-one');
    const secret = createFoe('Secret Sentinel', { x: 3, y: 1 });
    await manager.command(gm, 0, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: hero } });
    await manager.command(gm, 1, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: secret } });
    await manager.command(gm, 2, {
      domain: 'table',
      command: { type: 'SET_ACTOR_PRESENTATION', actorId: secret.id, presentation: { hidden: true, label: 'Secret Sentinel' } },
    });
    await manager.command(gm, 3, { domain: 'encounter', command: { type: 'START_ENCOUNTER' } });

    const player = await join(manager, 'room-hidden-target', 'dev:player-one:player');
    const joined = last(player.socket, 'joined');
    expect(joined.state.encounter.actors[secret.id]).toBeUndefined();
    await manager.command(player.client, 4, {
      domain: 'encounter',
      command: { type: 'BASIC_ATTACK', actorId: hero.id, targetId: secret.id, weight: 'light' },
    });
    const error = last(player.socket, 'error');
    expect(error).toMatchObject({ code: 'permission.denied' });
    expect(error.message).not.toContain('Secret Sentinel');
    expect(manager.inspect('room-hidden-target')?.revision).toBe(4);

    await settleAndLeave(manager, gm, [gm, player.client]);
  });

  it('does not disclose a hidden movement obstruction through reducer errors', async () => {
    const manager = new RoomManager(config, { persistence: new RecordingCheckpointPersistence() });
    const { client: gm } = await join(manager, 'room-hidden-movement', 'dev:gm-user:gm');
    const hero = actorFromCharacter(validCharacter('Visible Walker'), { x: 1, y: 1 }, 'player-one');
    const secret = createFoe('Secret Blocker', { x: 2, y: 1 });
    await manager.command(gm, 0, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: hero } });
    await manager.command(gm, 1, { domain: 'encounter', command: { type: 'ADD_ACTOR', actor: secret } });
    await manager.command(gm, 2, {
      domain: 'table',
      command: { type: 'SET_ACTOR_PRESENTATION', actorId: secret.id, presentation: { hidden: true, label: 'Secret Blocker' } },
    });
    await manager.command(gm, 3, { domain: 'encounter', command: { type: 'START_ENCOUNTER' } });

    const player = await join(manager, 'room-hidden-movement', 'dev:player-one:player');
    // Combat starts awaiting the player side's choice (ICON p.87): the
    // controlling player selects the hero before moving.
    await manager.command(player.client, 4, { domain: 'encounter', command: { type: 'TAKE_TURN', actorId: hero.id } });
    expect(manager.inspect('room-hidden-movement')?.revision).toBe(5);
    await manager.command(player.client, 5, {
      domain: 'encounter',
      command: { type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }], mode: 'standard' },
    });
    const error = last(player.socket, 'error');
    expect(error).toMatchObject({ code: 'command.unavailable' });
    expect(error.message).not.toMatch(/foe|object|secret blocker/i);
    expect(manager.inspect('room-hidden-movement')?.revision).toBe(5);

    await settleAndLeave(manager, gm, [gm, player.client]);
  });

  it('does not reveal a hidden terrain effect through a legal move consequence', async () => {
    const roomId = 'room-hidden-terrain-effect';
    const hero = actorFromCharacter(validCharacter('Careful Walker'), { x: 1, y: 1 }, 'player-one');
    const hiddenOwner = createFoe('Hidden Hazard Owner', { x: 7, y: 7 });
    const state = createVttRoom(createEncounter('Hidden terrain fixture'));
    state.encounter.id = roomId;
    state.encounter.actors = { [hero.id]: hero, [hiddenOwner.id]: hiddenOwner };
    state.encounter.phase = 'active';
    state.encounter.round = 1;
    state.encounter.activeActorId = hero.id;
    state.encounter.terrainEffects = [{
      id: 'secret-danger',
      sourceId: 'hidden-hazard',
      ownerId: hiddenOwner.id,
      terrain: 'dangerous',
      positions: [{ x: 2, y: 1 }],
      height: null,
      duration: { kind: 'combat' },
    }];
    state.table.actorPresentation[hiddenOwner.id] = { hidden: true };
    const persistence = new RecordingCheckpointPersistence({
      roomId,
      roomRevision: 0,
      encounterRevision: 0,
      schemaVersion: state.schemaVersion,
      reason: 'hard-save',
      createdAt: '2026-08-22T00:00:00.000Z',
      state,
    });
    const manager = new RoomManager(config, { persistence });
    const player = await join(manager, roomId, 'dev:player-one:player');

    expect(last(player.socket, 'joined').state.encounter.terrainEffects).toEqual([]);
    await manager.command(player.client, 0, {
      domain: 'encounter',
      command: { type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }], mode: 'standard' },
    });
    expect(last(player.socket, 'error')).toMatchObject({ code: 'command.unavailable' });
    expect(manager.inspect(roomId)).toMatchObject({
      revision: 0,
      encounter: { actors: { [hero.id]: { position: { x: 1, y: 1 }, hp: hero.hp } } },
    });

    manager.leave(player.client);
  });

  it('only acknowledges a GM hard save after the latest room checkpoint is written', async () => {
    const persistence = new RecordingCheckpointPersistence();
    const manager = new RoomManager(config, { persistence });
    const { client: gm, socket: gmSocket } = await join(manager, 'room-save', 'dev:gm-user:gm');
    const player = await join(manager, 'room-save', 'dev:player-one:player');

    await manager.command(gm, 0, {
      domain: 'table',
      command: { type: 'UPSERT_CLOCK', clock: { id: 'progress', name: 'Progress', segments: 6, filled: 2 } },
    });
    await manager.hardSave(gm, 1);
    expect(persistence.writes).toHaveLength(1);
    expect(persistence.writes[0]).toMatchObject({ roomId: 'room-save', roomRevision: 1, encounterRevision: 0, reason: 'hard-save', state: { revision: 1 } });
    expect(last(gmSocket, 'save-complete')).toEqual({ type: 'save-complete', encounterId: 'room-save', revision: 1 });
    expect(last(gmSocket, 'save-status')).toMatchObject({ status: 'saved', revision: 1 });

    await manager.hardSave(player.client, 1);
    expect(last(player.socket, 'error')).toMatchObject({ code: 'permission.denied' });
    expect(persistence.writes).toHaveLength(1);

    await manager.hardSave(gm, 0);
    expect(last(gmSocket, 'error')).toMatchObject({ code: 'revision.conflict', state: { revision: 1 } });

    await settleAndLeave(manager, gm, [gm, player.client]);
  });

  it('writes a revision-zero room before acknowledging the first GM hard save', async () => {
    const persistence = new RecordingCheckpointPersistence();
    const manager = new RoomManager(config, { persistence });
    const { client: gm, socket: gmSocket } = await join(manager, 'room-first-save', 'dev:gm-user:gm');

    expect(last(gmSocket, 'joined')).toMatchObject({ saveStatus: 'unsaved', state: { revision: 0 } });
    await manager.hardSave(gm, 0);
    expect(persistence.writes).toHaveLength(1);
    expect(persistence.writes[0]).toMatchObject({ roomId: 'room-first-save', roomRevision: 0, encounterRevision: 0, reason: 'hard-save' });
    expect(last(gmSocket, 'save-complete')).toEqual({ type: 'save-complete', encounterId: 'room-first-save', revision: 0 });
    expect(last(gmSocket, 'save-status')).toMatchObject({ status: 'saved', revision: 0 });

    await settleAndLeave(manager, gm, [gm]);
  });
});
