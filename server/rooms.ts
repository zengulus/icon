import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WebSocket } from 'ws';
import {
  VttCheckpointRuntime,
  type VttCheckpoint,
  type VttCheckpointCursor,
  type VttCheckpointReason,
  type VttCheckpointStore,
} from './checkpoints.js';
import { createEncounter, RuleViolation } from '../src/rules/encounter.js';
import { planMovementPath } from '../src/rules/movement.js';
import { ENCOUNTER_SCHEMA_VERSION, type EncounterCommand, type Position } from '../src/rules/types.js';
import type { ServerMessage } from '../src/rules/protocol.js';
import {
  createVttRoom,
  executeRoomCommand,
  assertValidVttRoomState,
  assertValidEncounterState,
  currentStateForPersistence,
  migrateVttRoom,
  roomVisibleToRole,
  VTT_ROOM_SCHEMA_VERSION,
  type RoomCommand,
  type TableCommand,
  type VttRoomState,
} from '../src/rules/vtt-room.js';
import { sendDiscordNotice } from './discord.js';
import type { ServerConfig } from './config.js';

export interface AuthenticatedClient {
  socket: WebSocket;
  userId: string;
  role: 'gm' | 'player';
  encounterId: string;
  /** Server-only token retained for short, periodic authorization refreshes. */
  accessToken: string;
  authorizedAt: number;
}

interface LoadedCheckpoint {
  state: VttRoomState;
  cursor: VttCheckpointCursor;
}

/** Shape returned by the Supabase checkpoint query before runtime validation. */
interface StoredCheckpointRow {
  room_revision: number | string;
  encounter_revision: number | string;
  schema_version: number | string;
  state: unknown;
  created_at: string;
}

/**
 * Validate the durable envelope as well as the serialized VTT state. This is
 * intentionally stricter than `migrateVttRoom` alone: a valid JSON snapshot
 * at the wrong revision must never be treated as the checkpoint it claims to
 * be.
 */
export function decodeStoredCheckpoint(row: StoredCheckpointRow, expectedRoomId?: string): LoadedCheckpoint {
  const roomRevision = Number(row.room_revision);
  const encounterRevision = Number(row.encounter_revision);
  const schemaVersion = Number(row.schema_version);
  const checkpointedAt = Date.parse(row.created_at);
  if (!Number.isSafeInteger(roomRevision) || roomRevision < 0
    || !Number.isSafeInteger(encounterRevision) || encounterRevision < 0
    || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1
    || !Number.isFinite(checkpointedAt)) {
    throw new Error('Checkpoint metadata is malformed.');
  }
  if (!row.state || typeof row.state !== 'object' || Array.isArray(row.state)) {
    throw new Error('Checkpoint state is not a VTT room object.');
  }
  const rawState = row.state as Record<string, unknown>;
  if (rawState.schemaVersion !== schemaVersion
    || rawState.revision !== roomRevision
    || !rawState.encounter || typeof rawState.encounter !== 'object'
    || (rawState.encounter as Record<string, unknown>).revision !== encounterRevision) {
    throw new Error('Checkpoint metadata does not match its serialized VTT room.');
  }
  const state = migrateAndValidateVttRoom(row.state);
  // Migration may upgrade a historical room schema, but it must preserve both
  // authoritative revisions exactly.
  if (state.revision !== roomRevision || state.encounter.revision !== encounterRevision) {
    throw new Error('Checkpoint migration changed an authoritative revision.');
  }
  if (expectedRoomId && state.encounter.id !== expectedRoomId) {
    throw new Error('Checkpoint encounter id does not match its durable room id.');
  }
  return {
    state,
    cursor: { roomRevision, encounterRevision, checkpointedAt },
  };
}

/**
 * Convert an explicitly historical room only after preserving its current
 * payload boundary. This is shared by append-only checkpoint hydration and
 * the one-time legacy `encounters.state` fallback; neither may quietly repair
 * a row already claiming the current VTT/encounter schemas.
 */
export function migrateAndValidateVttRoom(input: unknown): VttRoomState {
  const rawState = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  const rawEncounter = rawState?.encounter;
  const encounterCandidate = rawEncounter !== null && typeof rawEncounter === 'object' && !Array.isArray(rawEncounter)
    ? rawEncounter
    : rawState;
  // An encounter already labelled current must pass its raw mechanical shape
  // even when it is nested in an older VTT wrapper (or has no wrapper at all).
  // Otherwise migration would quietly invent current actor flags/provenance.
  if (encounterCandidate && typeof encounterCandidate === 'object'
    && (encounterCandidate as Record<string, unknown>).schemaVersion === ENCOUNTER_SCHEMA_VERSION) {
    assertValidEncounterState(encounterCandidate);
  }
  const currentSchemaPayload = rawState?.schemaVersion === VTT_ROOM_SCHEMA_VERSION
    && rawEncounter !== null
    && typeof rawEncounter === 'object'
    && !Array.isArray(rawEncounter)
    && (rawEncounter as Record<string, unknown>).schemaVersion === ENCOUNTER_SCHEMA_VERSION;
  // A row already marked with both current schemas is not an import. Validate
  // that exact payload before it can become authority: migration is purposely
  // forgiving for historical exports and may otherwise fill a missing flag or
  // discard a bad table item without an operator ever seeing the corruption.
  const state = currentSchemaPayload
    ? (() => {
      assertValidVttRoomState(rawState);
      return structuredClone(rawState) as unknown as VttRoomState;
    })()
    : migrateVttRoom(input);
  assertValidVttRoomState(state);
  return state;
}

/** The only persistence interface used by an active Render room. */
export interface RoomCheckpointPersistence extends VttCheckpointStore<VttRoomState> {
  load(roomId: string): Promise<LoadedCheckpoint | null>;
}

interface Room {
  id: string;
  campaignId: string | null;
  state: VttRoomState;
  clients: Set<AuthenticatedClient>;
  checkpoints: VttCheckpointRuntime<VttRoomState>;
  eviction: Promise<void> | null;
  /** Ordered outbound delivery prevents state/event pairs from crossing. */
  outbound: Promise<void>;
  /** Number of queued delivery callbacks retained for this room. */
  outboundPending: number;
  /**
   * Terminal hard-save acknowledgements that have passed admission but have
   * not yet been put on `outbound`. They reserve their eventual queue slot so
   * a shared checkpoint resolving many callers cannot overflow the bound.
   */
  pendingHardSaveAcknowledgements: number;
}

interface Identity {
  userId: string;
  role: 'gm' | 'player';
}

export interface RoomManagerDependencies {
  /** Useful for server integration tests and local hosts without Supabase. */
  persistence?: RoomCheckpointPersistence;
  /** Injectable only so transport safeguards can be tested deterministically. */
  now?: () => number;
  /** Per authenticated user/room limits; shared across that user's tabs. */
  rateLimit?: Partial<RoomRateLimitPolicy>;
  /** Bound stale membership/token authority for an already-open websocket. */
  authorizationTtlMs?: number;
}

export interface RoomRateLimitPolicy {
  durableCommandLimit: number;
  durableCommandWindowMs: number;
  pingLimit: number;
  pingWindowMs: number;
  saveLimit: number;
  saveWindowMs: number;
}

const DEFAULT_ROOM_RATE_LIMIT: Readonly<RoomRateLimitPolicy> = {
  // Durable commands trigger reducer work, fan-out, and eventually a
  // checkpoint. This remains generous for normal drawing/setup gestures,
  // which the browser already coalesces on pointer-up.
  durableCommandLimit: 60,
  durableCommandWindowMs: 10_000,
  // Pings are deliberately transient, but must not become an unbounded room
  // broadcast amplification path.
  pingLimit: 20,
  pingWindowMs: 1_000,
  saveLimit: 6,
  saveWindowMs: 10_000,
};
const DEFAULT_AUTHORIZATION_TTL_MS = 30_000;
// A room is collaborative, not an unbounded broadcast relay. These limits
// keep a single authenticated principal (or a stalled peer) from retaining
// arbitrarily many full-state serializations in the Render process.
const MAX_ROOM_CLIENTS = 100;
const MAX_CLIENTS_PER_USER_PER_ROOM = 4;
const MAX_OUTBOUND_DELIVERIES = 256;
const MAX_SOCKET_BUFFERED_BYTES = 512 * 1024;
const MAX_REALTIME_MESSAGE_BYTES = 512 * 1024;
const AUTHORIZATION_REFRESH_TIMEOUT_MS = 10_000;
const MAX_PLAYER_TABLE_ARTIFACTS_PER_KIND = 100;

type RateLimitBucket = 'durableCommands' | 'pings' | 'saves';
interface RateLimitState extends Record<RateLimitBucket, number[]> {
  /** Most recent accepted or rejected request; used for lazy TTL cleanup. */
  lastSeenAt: number;
}

class MemoryCheckpointPersistence implements RoomCheckpointPersistence {
  private readonly records = new Map<string, VttCheckpoint<VttRoomState>>();

  async load(roomId: string): Promise<LoadedCheckpoint | null> {
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
    const persisted = { ...checkpoint, state: currentStateForPersistence(checkpoint.state) };
    const existing = this.records.get(checkpoint.roomId);
    if (existing && existing.roomRevision > persisted.roomRevision) return;
    this.records.set(checkpoint.roomId, structuredClone(persisted));
  }
}

export class SupabaseCheckpointPersistence implements RoomCheckpointPersistence {
  constructor(private readonly admin: SupabaseClient) {}

  async load(roomId: string): Promise<LoadedCheckpoint | null> {
    const { data, error } = await this.admin
      .from('encounter_checkpoints')
      .select('room_revision,encounter_revision,schema_version,state,created_at')
      .eq('encounter_id', roomId)
      .order('room_revision', { ascending: false })
      // A malformed newest checkpoint must not make a room unrecoverable when
      // an older valid save point exists. The SQL retention policy bounds a
      // room to 234 rows, so this scan reaches every retained save point.
      .limit(256);
    if (error) throw new Error(`Could not load encounter checkpoint: ${error.message}`);
    const rows = (data ?? []) as StoredCheckpointRow[];
    // `room_revision` is a bigint in Postgres, while the rules engine uses a
    // JavaScript safe integer. Do not manufacture a recovery revision when a
    // corrupt row lies outside that domain; an operator must repair that
    // exceptional database state instead of risking an imprecise revision.
    const newestStoredRevision = Number(rows[0]?.room_revision);
    if (rows.length > 0 && (!Number.isSafeInteger(newestStoredRevision) || newestStoredRevision < 0)) {
      throw new Error('The newest checkpoint has an unsafe room revision and cannot be recovered automatically.');
    }
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      try {
        const loaded = decodeStoredCheckpoint(row, roomId);
        if (index > 0) return this.rebaseRecoveredCheckpoint(roomId, loaded, newestStoredRevision);
        return loaded;
      } catch (reason) {
        console.warn(`Ignoring invalid checkpoint for room ${roomId} at revision ${String(row.room_revision)}:`, reason instanceof Error ? reason.message : reason);
      }
    }
    if (rows.length > 0) throw new Error('No valid durable checkpoint could be recovered for this encounter.');
    return null;
  }

  async write(checkpoint: VttCheckpoint<VttRoomState>): Promise<void> {
    // Supabase stores compact current-state checkpoints only. Replay history
    // belongs to the live/event transport and is deliberately excluded from
    // durable saves to prevent unbounded checkpoint growth.
    const state = currentStateForPersistence(checkpoint.state);
    const { error } = await this.admin.rpc('append_encounter_checkpoint', {
      p_encounter_id: checkpoint.roomId,
      p_room_revision: checkpoint.roomRevision,
      p_encounter_revision: checkpoint.encounterRevision,
      p_schema_version: checkpoint.schemaVersion,
      p_reason: checkpoint.reason,
      p_state: state,
    });
    if (error) throw new Error(`Could not persist encounter checkpoint: ${error.message}`);
  }

  /**
   * Keep the corrupt row immutable for audit, but do not restart at an older
   * revision: that would collide with the corrupt revision on the next save.
   * Instead, append a validated, migrated copy immediately above every row we
   * observed. `append_encounter_checkpoint` makes this compare-and-set safe:
   * a concurrently newer writer causes this hydration to fail rather than
   * overwriting its pointer, and the next join will load that newer authority.
   */
  private async rebaseRecoveredCheckpoint(
    roomId: string,
    checkpoint: LoadedCheckpoint,
    newestStoredRevision: number,
  ): Promise<LoadedCheckpoint> {
    const recoveryRevision = newestStoredRevision + 1;
    if (!Number.isSafeInteger(recoveryRevision)) {
      throw new Error('Checkpoint recovery would exceed the supported room revision range.');
    }
    const state: VttRoomState = { ...structuredClone(checkpoint.state), revision: recoveryRevision };
    const createdAt = new Date().toISOString();
    await this.write({
      roomId,
      roomRevision: recoveryRevision,
      encounterRevision: state.encounter.revision,
      schemaVersion: state.schemaVersion,
      reason: 'recovery',
      createdAt,
      state,
    });
    return {
      state,
      cursor: {
        roomRevision: recoveryRevision,
        encounterRevision: state.encounter.revision,
        checkpointedAt: Date.parse(createdAt),
      },
    };
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly loadingRooms = new Map<string, Promise<Room>>();
  private readonly admin: SupabaseClient | null;
  private readonly persistence: RoomCheckpointPersistence;
  private readonly now: () => number;
  private readonly rateLimit: RoomRateLimitPolicy;
  private readonly rateLimitState = new Map<string, RateLimitState>();
  /** Deduplicates a TTL refresh shared by concurrent command/fan-out paths. */
  private readonly authorizationChecks = new Map<AuthenticatedClient, Promise<boolean>>();
  private readonly authorizationTtlMs: number;
  private lastRateLimitSweepAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly config: ServerConfig, dependencies: RoomManagerDependencies = {}) {
    this.admin = config.supabaseUrl && config.supabaseServiceRoleKey
      ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
    this.persistence = dependencies.persistence ?? (this.admin ? new SupabaseCheckpointPersistence(this.admin) : new MemoryCheckpointPersistence());
    this.now = dependencies.now ?? Date.now;
    this.rateLimit = { ...DEFAULT_ROOM_RATE_LIMIT, ...dependencies.rateLimit };
    validateRoomRateLimit(this.rateLimit);
    this.authorizationTtlMs = dependencies.authorizationTtlMs ?? DEFAULT_AUTHORIZATION_TTL_MS;
    if (!Number.isSafeInteger(this.authorizationTtlMs) || this.authorizationTtlMs < 1_000) {
      throw new Error('Room authorization TTL must be an integer of at least one second.');
    }
  }

  async authenticate(token: string, encounterId: string): Promise<Identity> {
    if (this.config.allowDevAuth && token.startsWith('dev:')) {
      const [, userId = 'local-user', role = 'gm'] = token.split(':');
      return { userId, role: role === 'player' ? 'player' : 'gm' };
    }
    if (!this.admin) throw new Error('Multiplayer persistence is not configured.');
    const { data, error } = await this.admin.auth.getUser(token);
    if (error || !data.user) throw new Error('Authentication failed.');
    const { data: encounter, error: encounterError } = await this.admin.from('encounters').select('campaign_id').eq('id', encounterId).single();
    if (encounterError) throw new Error('Encounter was not found.');
    const { data: membership, error: memberError } = await this.admin.from('campaign_members').select('role').eq('campaign_id', encounter.campaign_id).eq('user_id', data.user.id).single();
    if (memberError || !membership) throw new Error('You are not a member of this campaign.');
    return { userId: data.user.id, role: membership.role === 'gm' ? 'gm' : 'player' };
  }

  async join(socket: WebSocket, encounterId: string, token: string): Promise<AuthenticatedClient> {
    // The websocket handler has its own join deadline, but keep the
    // expensive identity operation bounded here too: callers besides
    // server/index (and a hung Supabase request) must not retain a pending
    // room join forever.
    const identity = await this.authenticateWithinDeadline(token, encounterId);
    const client: AuthenticatedClient = { socket, encounterId, ...identity, accessToken: token, authorizedAt: this.now() };
    // Final eviction awaits persistence. It can remove the resident room in
    // the gap after `getRoom()` resolves but before this join reserves a
    // client. Reserve first, then prove the room is still the map's current
    // authority; if not, discard that stale reservation and hydrate again.
    // This prevents a joining socket from holding an orphaned room object.
    while (true) {
      const room = await this.getRoom(encounterId);
      if (room.clients.size >= MAX_ROOM_CLIENTS) throw new Error('This encounter has reached its connection limit.');
      const existingForUser = [...room.clients].filter((candidate) => candidate.userId === identity.userId).length;
      if (existingForUser >= MAX_CLIENTS_PER_USER_PER_ROOM) throw new Error('This user has reached its connection limit for the encounter.');
      room.clients.add(client);
      if (this.rooms.get(encounterId) !== room) {
        room.clients.delete(client);
        continue;
      }
      this.send(client, {
        type: 'joined',
        encounterId,
        state: roomVisibleToRole(room.state, identity.role),
        role: identity.role,
        saveStatus: room.checkpoints.getState().durability,
      });
      return client;
    }
  }

  leave(client: AuthenticatedClient | null) {
    if (!client) return;
    this.authorizationChecks.delete(client);
    const room = this.rooms.get(client.encounterId);
    if (!room) return;
    room.clients.delete(client);
    // Do not clear a user's counters on disconnect: repeatedly reconnecting
    // must not turn a per-user limit into an unbounded fan-out path. Expired
    // entries are reclaimed lazily by later room activity.
    if (room.clients.size === 0) void this.evictWhenDurable(room);
  }

  async command(client: AuthenticatedClient, expectedRevision: number, incomingCommand: RoomCommand) {
    if (!await this.ensureClientAuthorized(client) || !this.isActiveClient(client)) return;
    if (!this.consumeRateLimit(client, 'durableCommands', this.rateLimit.durableCommandLimit, this.rateLimit.durableCommandWindowMs)) {
      this.send(client, { type: 'error', code: 'rate.limited', message: 'Too many room commands; please wait a moment and try again.' });
      return;
    }
    const room = await this.getRoom(client.encounterId);
    // A close can happen while authentication or cold-room hydration is in
    // flight. Never let that detached client mutate a newly hydrated room.
    if (!this.isActiveClient(client, room)) return;
    // An accepted command creates checkpoint-status and event deliveries.
    // Reject before mutation when a previous stalled fan-out is already at
    // its bounded room budget; reconnect always hydrates the latest state.
    if (!this.hasOutboundCapacity(room, 4)) {
      this.send(client, { type: 'error', code: 'room.busy', message: 'This room is catching up with realtime updates; please retry shortly.' });
      return;
    }
    if (expectedRevision !== room.state.revision) {
      await this.sendRevisionConflict(room, client);
      return;
    }
    if (!this.canRun(client, room, incomingCommand)) {
      this.send(client, { type: 'error', code: 'permission.denied', message: 'That command is not permitted for your role.' });
      return;
    }
    if (this.playerMoveDependsOnHiddenState(client, room, incomingCommand)) {
      this.send(client, {
        type: 'error',
        code: 'command.unavailable',
        message: 'That movement cannot be completed from your current view.',
      });
      return;
    }

    const command = this.stampPlayerOwnedTableCommand(client, room, incomingCommand);
    try {
      const beforePhase = room.state.encounter.phase;
      const beforeRound = room.state.encounter.round;
      const result = executeRoomCommand(room.state, command);
      // Protocol validation limits each inbound shape, while this canonical
      // boundary also catches aggregate/nested limits before a live state can
      // be checkpointed. It protects direct RoomManager integrations too.
      assertValidVttRoomState(result.state);
      room.state = result.state;
      room.checkpoints.markDurableOperation();
      const semanticReason = this.semanticCheckpointReason(command, room.state, beforePhase, beforeRound);
      if (semanticReason) room.checkpoints.requestCheckpoint(semanticReason);
      // Capture phase/lifecycle meaning before any asynchronous authorization
      // refresh can yield to a later command.
      this.maybeNotifyDiscord(room, beforePhase, room.state);
      await this.broadcastRoomEvents(room, result.events);
    } catch (error) {
      const code = error instanceof RuleViolation ? error.code : 'command.failed';
      const message = error instanceof Error ? error.message : 'The command failed.';
      this.send(client, { type: 'error', code, message });
    }
  }

  async hardSave(client: AuthenticatedClient, expectedRevision: number) {
    if (!await this.ensureClientAuthorized(client) || !this.isActiveClient(client)) return;
    if (!this.consumeRateLimit(client, 'saves', this.rateLimit.saveLimit, this.rateLimit.saveWindowMs)) {
      this.send(client, { type: 'error', code: 'rate.limited', message: 'Too many save requests; please wait a moment and try again.' });
      return;
    }
    const room = await this.getRoom(client.encounterId);
    if (!this.isActiveClient(client, room)) return;
    if (!this.hasOutboundCapacity(room, 3)) {
      this.send(client, { type: 'error', code: 'room.busy', message: 'This room is catching up with realtime updates; please retry shortly.' });
      return;
    }
    if (client.role !== 'gm') {
      this.send(client, { type: 'error', code: 'permission.denied', message: 'Only a GM can request a completed save.' });
      return;
    }
    if (expectedRevision !== room.state.revision) {
      await this.sendRevisionConflict(room, client);
      return;
    }
    let acknowledgementReserved = false;
    try {
      // A checkpoint can have many simultaneous hard-save waiters. Reserve
      // this caller's terminal acknowledgement before awaiting persistence so
      // all waiters cannot independently pass the old queue-capacity check
      // and then overflow `outbound` together when one write resolves.
      room.pendingHardSaveAcknowledgements += 1;
      acknowledgementReserved = true;
      const checkpoint = await room.checkpoints.hardSave();
      const revision = checkpoint?.roomRevision ?? room.state.revision;
      // Runtime state changes enqueue save-status messages. Put the terminal
      // acknowledgement on that same ordered stream so a GM never sees
      // "complete" before the corresponding saved status. Recheck both
      // membership and authority after the checkpoint's asynchronous write.
      // Swap the reservation for the actual queue entry synchronously; no
      // other continuation can observe a free slot between these operations.
      room.pendingHardSaveAcknowledgements = Math.max(0, room.pendingHardSaveAcknowledgements - 1);
      acknowledgementReserved = false;
      await this.enqueueOutbound(room, async () => {
        if (!await this.ensureClientAuthorized(client) || !this.isActiveClient(client, room)) return;
        this.send(client, { type: 'save-complete', encounterId: room.id, revision });
      });
    } catch (error) {
      this.send(client, { type: 'error', code: 'save.failed', message: error instanceof Error ? error.message : 'The save could not be acknowledged.' });
    } finally {
      if (acknowledgementReserved) {
        room.pendingHardSaveAcknowledgements = Math.max(0, room.pendingHardSaveAcknowledgements - 1);
      }
    }
  }

  async ping(client: AuthenticatedClient, position: Position) {
    if (!await this.ensureClientAuthorized(client) || !this.isActiveClient(client)) return;
    if (!this.consumeRateLimit(client, 'pings', this.rateLimit.pingLimit, this.rateLimit.pingWindowMs)) {
      this.send(client, { type: 'error', code: 'rate.limited', message: 'Too many pings; please wait a moment and try again.' });
      return;
    }
    const room = await this.getRoom(client.encounterId);
    if (!this.isActiveClient(client, room)) return;
    if (!this.hasOutboundCapacity(room)) {
      this.send(client, { type: 'error', code: 'room.busy', message: 'This room is catching up with realtime updates; please retry shortly.' });
      return;
    }
    await this.broadcastPing(room, client.userId, position);
  }

  status() {
    return {
      rooms: this.rooms.size,
      connections: [...this.rooms.values()].reduce((sum, room) => sum + room.clients.size, 0),
      dirtyRooms: [...this.rooms.values()].filter((room) => room.checkpoints.getState().durability !== 'saved').length,
    };
  }

  /** Test/debug read; callers receive a clone rather than live authority. */
  inspect(roomId: string): VttRoomState | null {
    const room = this.rooms.get(roomId);
    return room ? structuredClone(room.state) : null;
  }

  private canRun(client: AuthenticatedClient, room: Room, command: RoomCommand): boolean {
    if (client.role === 'gm') return true;
    if (command.domain === 'encounter') {
      const encounter = command.command;
      if (['ADD_ACTOR', 'REMOVE_ACTOR', 'SET_TERRAIN', 'START_ENCOUNTER', 'END_ENCOUNTER', 'APPLY_STATUS'].includes(encounter.type)) return false;
      // Generic source-program execution has deliberately stricter ownership
      // requirements than the current actor model can express for every
      // source kind (relics, party trophies, phases, and so on). Keep it an
      // explicit GM/admin path until each executable source carries typed
      // actor/party ownership. Players use the reducer-backed action commands
      // for their controlled actors, rather than gaining a loophole through
      // an arbitrary sourceId/actionId payload.
      if (encounter.type === 'EXECUTE_RULE') return false;
      if (encounter.type === 'ANSWER_DECISION_WINDOW') {
        // T6.2: only the window's responder — the entitled chooser recorded
        // on the window (`actorId`, derived through the U2 role/choice
        // authority at open time) — may answer. A wrong player/actor is
        // rejected here; the reducer still validates the answer itself.
        const window = room.state.encounter.decisionWindows.find((candidate) => candidate.id === encounter.windowId);
        if (!window) return true; // the reducer produces the authoritative error
        const actor = room.state.encounter.actors[window.actorId];
        return Boolean(actor && actor.controllerId === client.userId);
      }
      if (!('actorId' in encounter)) return false;
      const actor = room.state.encounter.actors[encounter.actorId];
      if (!actor || actor.controllerId !== client.userId) return false;
      // A hidden token is absent from the player projection. A client that
      // happens to know its ID must not be able to alter hidden state by
      // submitting commands directly to Render.
      if (room.state.table.actorPresentation[actor.id]?.hidden) return false;
      return !playerCommandReferencesHiddenActor(room, encounter);
    }
    return this.playerCanRunTableCommand(client, room, command.command);
  }

  private playerCanRunTableCommand(client: AuthenticatedClient, room: Room, command: TableCommand) {
    switch (command.type) {
      case 'UPSERT_ANNOTATION': {
        if (command.annotation.hidden) return false;
        const existing = room.state.table.annotations.find(({ id }) => id === command.annotation.id);
        if (existing) return !existing.hidden && existing.authorId === client.userId;
        return room.state.table.annotations.filter(({ authorId }) => authorId === client.userId).length < MAX_PLAYER_TABLE_ARTIFACTS_PER_KIND;
      }
      case 'REMOVE_ANNOTATION':
        return (() => {
          const existing = room.state.table.annotations.find(({ id }) => id === command.annotationId);
          return Boolean(existing && !existing.hidden && existing.authorId === client.userId);
        })();
      case 'UPSERT_TEMPLATE': {
        if (command.template.hidden) return false;
        const existing = room.state.table.templates.find(({ id }) => id === command.template.id);
        if (existing) return !existing.hidden && existing.authorId === client.userId;
        return room.state.table.templates.filter(({ authorId }) => authorId === client.userId).length < MAX_PLAYER_TABLE_ARTIFACTS_PER_KIND;
      }
      case 'REMOVE_TEMPLATE':
        return (() => {
          const existing = room.state.table.templates.find(({ id }) => id === command.templateId);
          return Boolean(existing && !existing.hidden && existing.authorId === client.userId);
        })();
      default:
        return false;
    }
  }

  /**
   * Render resolves movement against the full room, but a hidden actor,
   * object, terrain effect, engagement cost, or damage consequence must not
   * leak through a detailed error or changed resulting state. Compare the
   * complete pure plans against the player projection and allow the reducer
   * only when they are exactly equivalent.
   */
  private playerMoveDependsOnHiddenState(client: AuthenticatedClient, room: Room, command: RoomCommand): boolean {
    if (client.role !== 'player' || command.domain !== 'encounter' || command.command.type !== 'MOVE') return false;
    const fullPlan = planMovementPath(room.state.encounter, command.command.actorId, command.command.path, command.command.mode);
    const visiblePlan = planMovementPath(
      roomVisibleToRole(room.state, 'player').encounter,
      command.command.actorId,
      command.command.path,
      command.command.mode,
    );
    return JSON.stringify(fullPlan) !== JSON.stringify(visiblePlan);
  }

  private stampPlayerOwnedTableCommand(client: AuthenticatedClient, room: Room, command: RoomCommand): RoomCommand {
    if (command.domain !== 'table') return command;
    const tableCommand = command.command;
    if (tableCommand.type === 'UPSERT_ANNOTATION') {
      const existing = room.state.table.annotations.find(({ id }) => id === tableCommand.annotation.id);
      // Transport deliberately rejects authorId, including from a GM. A GM
      // editing a player artifact must therefore preserve its existing owner
      // rather than accidentally orphaning it from future player edits.
      if (client.role === 'gm') {
        return { domain: 'table', command: { type: 'UPSERT_ANNOTATION', annotation: { ...tableCommand.annotation, authorId: existing?.authorId } } };
      }
      return { domain: 'table', command: { type: 'UPSERT_ANNOTATION', annotation: { ...tableCommand.annotation, authorId: existing?.authorId ?? client.userId } } };
    }
    if (tableCommand.type === 'UPSERT_TEMPLATE') {
      const existing = room.state.table.templates.find(({ id }) => id === tableCommand.template.id);
      if (client.role === 'gm') {
        return { domain: 'table', command: { type: 'UPSERT_TEMPLATE', template: { ...tableCommand.template, authorId: existing?.authorId } } };
      }
      return { domain: 'table', command: { type: 'UPSERT_TEMPLATE', template: { ...tableCommand.template, authorId: existing?.authorId ?? client.userId } } };
    }
    return command;
  }

  private semanticCheckpointReason(
    command: RoomCommand,
    state: VttRoomState,
    beforePhase: VttRoomState['encounter']['phase'],
    beforeRound: number,
  ): VttCheckpointReason | null {
    if (command.domain !== 'encounter') return null;
    if (command.command.type === 'START_ENCOUNTER' || (beforePhase !== 'active' && state.encounter.phase === 'active')) return 'encounter-start';
    if (command.command.type === 'END_ENCOUNTER' || (beforePhase !== 'complete' && state.encounter.phase === 'complete')) return 'encounter-end';
    if (state.encounter.round !== beforeRound) return 'round-transition';
    return null;
  }

  private maybeNotifyDiscord(room: Pick<Room, 'id'>, beforePhase: VttRoomState['encounter']['phase'], state: VttRoomState) {
    if (beforePhase === state.encounter.phase) return;
    const activity = state.encounter.phase === 'active' ? 'started' : state.encounter.phase === 'complete' ? 'ended' : '';
    if (!activity) return;
    void sendDiscordNotice(this.config.discordWebhookUrl, {
      title: `Session ${activity}`,
      description: `**${state.encounter.name}** ${activity} at round ${state.encounter.round || 1}.`,
      fields: [
        { name: 'Combatants', value: String(Object.keys(state.encounter.actors).length), inline: true },
        { name: 'Room revision', value: String(state.revision), inline: true },
      ],
    }).catch((error) => console.error('Discord notification failed:', error));
  }

  private broadcastRoomEvents(room: Room, events: ReturnType<typeof executeRoomCommand>['events']): Promise<void> {
    // Snapshot the complete state and recipients before yielding for a TTL
    // authorization refresh. A second command may advance live state while
    // the first delivery waits; each event batch must retain its own revision.
    const state = structuredClone(room.state);
    const eventBatch = structuredClone(events);
    const saveStatus = room.checkpoints.getState().durability;
    const recipients = [...room.clients];
    return this.enqueueOutbound(room, async () => {
      // Refreshes are independent per socket. Do them concurrently rather
      // than serially: one identity-provider outage must cost one bounded
      // deadline, not one deadline per stale recipient, while this ordered
      // room delivery is holding later authoritative revisions behind it.
      for (const client of await this.activeAuthorizedRecipients(room, recipients)) {
        this.send(client, {
          type: 'events',
          encounterId: room.id,
          // The complete player projection is carried in `state`. Do not send
          // replay events to players: an event can contain a GM-hidden token,
          // annotation, or fog payload that is absent from that projection.
          events: client.role === 'gm' ? eventBatch : [],
          state: roomVisibleToRole(state, client.role),
          saveStatus,
        });
      }
    });
  }

  private broadcastSaveStatus(room: Room): Promise<void> {
    // A later events payload carries the current save status, so this
    // coalescible advisory update may be skipped under deliberate queue
    // pressure instead of retaining unbounded stale status closures.
    if (!this.hasOutboundCapacity(room)) return Promise.resolve();
    const runtime = room.checkpoints.getState();
    const revision = room.state.revision;
    const recipients = [...room.clients];
    return this.enqueueOutbound(room, async () => {
      for (const client of await this.activeAuthorizedRecipients(room, recipients)) {
        // Players receive their normal event stream but only a GM gets durability
        // warnings and exact checkpoint state.
        if (client.role === 'gm') {
          this.send(client, { type: 'save-status', encounterId: room.id, status: runtime.durability, revision });
        }
      }
    });
  }

  private broadcastPing(room: Room, userId: string, position: Position): Promise<void> {
    const recipients = [...room.clients];
    const pingPosition = { ...position };
    return this.enqueueOutbound(room, async () => {
      for (const client of await this.activeAuthorizedRecipients(room, recipients)) {
        this.send(client, { type: 'ping', encounterId: room.id, userId, position: pingPosition });
      }
    });
  }

  /**
   * A queued fan-out must still respect changed membership, but independent
   * refreshes cannot be allowed to serialize behind a single slow provider.
   * Rechecking membership after the await also covers a socket that closes
   * while its refresh is in flight.
   */
  private async activeAuthorizedRecipients(room: Room, recipients: readonly AuthenticatedClient[]): Promise<AuthenticatedClient[]> {
    const checked = await Promise.all(recipients.map(async (client) => {
      if (!room.clients.has(client)) return null;
      if (!await this.ensureClientAuthorized(client)) return null;
      return this.isActiveClient(client, room) ? client : null;
    }));
    return checked.filter((client): client is AuthenticatedClient => client !== null);
  }

  private enqueueOutbound(room: Room, delivery: () => Promise<void>): Promise<void> {
    room.outboundPending += 1;
    const boundedDelivery = async () => {
      try {
        await delivery();
      } finally {
        room.outboundPending = Math.max(0, room.outboundPending - 1);
      }
    };
    const queued = room.outbound.then(boundedDelivery, boundedDelivery);
    // Delivery failures must not roll back an already accepted authoritative
    // command. Keep the queue alive and surface the server-side diagnostic.
    room.outbound = queued.catch((error) => {
      console.error(`Could not deliver realtime room update for ${room.id}:`, error);
    });
    return room.outbound;
  }

  private hasOutboundCapacity(room: Room, reserve = 1): boolean {
    return room.outboundPending + room.pendingHardSaveAcknowledgements + reserve <= MAX_OUTBOUND_DELIVERIES;
  }

  /** State-bearing errors share the event queue, so clients never roll back. */
  private sendRevisionConflict(room: Room, client: AuthenticatedClient): Promise<void> {
    const state = structuredClone(room.state);
    return this.enqueueOutbound(room, async () => {
      if (!await this.ensureClientAuthorized(client) || !this.isActiveClient(client, room)) return;
      this.send(client, {
        type: 'error',
        code: 'revision.conflict',
        message: 'Room state changed; the authoritative state has replaced your stale view.',
        state: roomVisibleToRole(state, client.role),
      });
    });
  }

  /** A client is usable only while this exact resident room still owns it. */
  private isActiveClient(client: AuthenticatedClient, room?: Room): boolean {
    const resident = room ?? this.rooms.get(client.encounterId);
    return resident !== undefined
      && this.rooms.get(client.encounterId) === resident
      && resident.clients.has(client);
  }

  private async getRoom(id: string): Promise<Room> {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    const loading = this.loadingRooms.get(id);
    if (loading) return loading;
    const pending = this.buildRoom(id);
    this.loadingRooms.set(id, pending);
    try {
      return await pending;
    } finally {
      this.loadingRooms.delete(id);
    }
  }

  private async buildRoom(id: string): Promise<Room> {
    let campaignId: string | null = null;
    let state: VttRoomState;
    let cursor: VttCheckpointCursor | undefined;
    const checkpoint = await this.persistence.load(id);

    if (this.admin) {
      const { data, error } = await this.admin
        .from('encounters')
        .select('campaign_id,name,state,revision,latest_checkpoint_revision,latest_encounter_revision,updated_at')
        .eq('id', id)
        .single();
      if (error) throw new Error('Encounter was not found.');
      campaignId = data.campaign_id;
      if (checkpoint) {
        state = checkpoint.state;
        cursor = checkpoint.cursor;
      } else if (data.state && typeof data.state === 'object' && Object.keys(data.state).length > 0) {
        // This branch exists only to migrate an old, pre-checkpoint encounter
        // record. A parent snapshot is not an acknowledged checkpoint: reject
        // it if durable metadata claims an append-only row that is missing,
        // validate it as strictly as a real checkpoint, and leave its cursor
        // unset so the first hard/eviction save persists it for real.
        if (Number(data.latest_checkpoint_revision ?? 0) !== 0 || Number(data.latest_encounter_revision ?? 0) !== 0) {
          throw new Error('Encounter checkpoint metadata exists but no matching append-only checkpoint could be loaded.');
        }
        state = migrateAndValidateVttRoom(data.state);
        if (state.encounter.id !== id) throw new Error('Legacy encounter state does not match its encounter record.');
        const legacyRevision = Number(data.revision);
        if (!Number.isSafeInteger(legacyRevision) || legacyRevision < 0 || legacyRevision !== state.encounter.revision) {
          throw new Error('Legacy encounter revision does not match its serialized state.');
        }
        cursor = undefined;
      } else {
        const encounter = createEncounter(data.name);
        encounter.id = id;
        state = createVttRoom(encounter);
        // A revision-zero room has no checkpoint yet. Preserve that fact so a
        // GM's first hard save (or final eviction) actually writes one.
        cursor = undefined;
      }
    } else if (checkpoint) {
      state = checkpoint.state;
      cursor = checkpoint.cursor;
    } else {
      const encounter = createEncounter('Multiplayer encounter');
      encounter.id = id;
      state = createVttRoom(encounter);
      cursor = undefined;
    }

    if (state.encounter.id !== id) throw new Error('Durable VTT room identity does not match its encounter record.');
    let room!: Room;
    const checkpoints = new VttCheckpointRuntime<VttRoomState>({
      roomId: id,
      store: this.persistence,
      initialCheckpoint: cursor,
      snapshotProvider: {
        snapshot: () => ({
          roomRevision: room.state.revision,
          encounterRevision: room.state.encounter.revision,
          schemaVersion: room.state.schemaVersion,
          state: structuredClone(room.state),
        }),
      },
      onStateChange: () => {
        if (room) void this.broadcastSaveStatus(room);
      },
    });
    room = {
      id,
      campaignId,
      state,
      clients: new Set(),
      checkpoints,
      eviction: null,
      outbound: Promise.resolve(),
      outboundPending: 0,
      pendingHardSaveAcknowledgements: 0,
    };
    this.rooms.set(id, room);
    return room;
  }

  private async evictWhenDurable(room: Room) {
    if (room.eviction) return room.eviction;
    room.eviction = (async () => {
      try {
        await room.checkpoints.checkpointBeforeEviction();
        if (room.clients.size === 0 && room.checkpoints.canEvict()) {
          // A join can race an asynchronous final checkpoint. Never let an
          // old room's eviction erase a newer room that was hydrated under
          // the same ID after this one left the map.
          if (this.rooms.get(room.id) === room) this.rooms.delete(room.id);
          room.checkpoints.dispose();
        }
      } catch (error) {
        console.error(`Could not safely evict room ${room.id}:`, error);
      } finally {
        room.eviction = null;
      }
    })();
    return room.eviction;
  }

  private send(client: Pick<AuthenticatedClient, 'socket'>, message: ServerMessage) {
    if (client.socket.readyState !== client.socket.OPEN) return;
    let payload: string;
    try {
      payload = JSON.stringify(message);
    } catch {
      client.socket.close(1011, 'Realtime state could not be serialized.');
      return;
    }
    const payloadBytes = Buffer.byteLength(payload, 'utf8');
    // `ws` otherwise buffers arbitrary output, and its previous guard only
    // looked at the buffer *before* adding a potentially huge snapshot. Cap
    // both the encoded message and the post-send buffer deterministically.
    if (payloadBytes > MAX_REALTIME_MESSAGE_BYTES
      || client.socket.bufferedAmount + payloadBytes > MAX_SOCKET_BUFFERED_BYTES) {
      client.socket.close(1013, 'Realtime client fell behind.');
      return;
    }
    client.socket.send(payload);
  }

  private consumeRateLimit(
    client: AuthenticatedClient,
    bucket: RateLimitBucket,
    limit: number,
    windowMs: number,
  ): boolean {
    const key = rateLimitKey(client);
    const now = this.now();
    this.pruneExpiredRateLimits(now);
    const state = this.rateLimitState.get(key) ?? { durableCommands: [], pings: [], saves: [], lastSeenAt: now };
    const cutoff = now - windowMs;
    const recent = state[bucket].filter((timestamp) => timestamp > cutoff && timestamp <= now);
    state[bucket] = recent;
    state.lastSeenAt = now;
    this.rateLimitState.set(key, state);
    if (recent.length >= limit) return false;
    recent.push(now);
    return true;
  }

  /**
   * Membership changes are external to an open WebSocket. Recheck identity,
   * token validity, and campaign role on a short TTL; a change closes the
   * socket so a newly joined projection cannot retain a former GM's state.
   */
  private ensureClientAuthorized(client: AuthenticatedClient): Promise<boolean> {
    const now = this.now();
    if (now - client.authorizedAt < this.authorizationTtlMs) return Promise.resolve(true);
    const pending = this.authorizationChecks.get(client);
    if (pending) return pending;
    const check = this.refreshClientAuthorization(client, now);
    this.authorizationChecks.set(client, check);
    void check.finally(() => {
      if (this.authorizationChecks.get(client) === check) this.authorizationChecks.delete(client);
    });
    return check;
  }

  private async refreshClientAuthorization(client: AuthenticatedClient, now: number): Promise<boolean> {
    try {
      const current = await this.authenticateWithinDeadline(client.accessToken, client.encounterId);
      if (current.userId !== client.userId || current.role !== client.role) {
        this.revokeClient(client, 'Your campaign role changed. Please reconnect.');
        return false;
      }
      client.authorizedAt = now;
      return true;
    } catch {
      this.revokeClient(client, 'Your campaign access is no longer valid.');
      return false;
    }
  }

  /** A stalled identity provider must not hold the whole room fan-out forever. */
  private async authenticateWithinDeadline(token: string, encounterId: string): Promise<Identity> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Authorization refresh timed out.')), AUTHORIZATION_REFRESH_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.authenticate(token, encounterId), deadline]);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }

  private revokeClient(client: AuthenticatedClient, message: string): void {
    this.send(client, { type: 'error', code: 'authorization.revoked', message });
    this.leave(client);
    if (client.socket.readyState === client.socket.OPEN) client.socket.close(1008, 'Authorization changed.');
  }

  private pruneExpiredRateLimits(now: number): void {
    const ttl = Math.max(
      this.rateLimit.durableCommandWindowMs,
      this.rateLimit.pingWindowMs,
      this.rateLimit.saveWindowMs,
    );
    // Sweep at most once per full TTL window. This keeps the common command
    // path O(1), while entries left by disconnected/reconnecting users cannot
    // accumulate forever on a long-lived room service.
    if (now - this.lastRateLimitSweepAt < ttl) return;
    this.lastRateLimitSweepAt = now;
    for (const [key, state] of this.rateLimitState) {
      if (now - state.lastSeenAt >= ttl) this.rateLimitState.delete(key);
    }
  }
}

function rateLimitKey(client: Pick<AuthenticatedClient, 'encounterId' | 'userId'>): string {
  return JSON.stringify([client.encounterId, client.userId]);
}

function validateRoomRateLimit(policy: RoomRateLimitPolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error(`Room rate limit ${name} must be a positive integer.`);
    }
  }
}

/**
 * Player state is a role-filtered projection. Reject any intent that names an
 * actor omitted from that projection before the reducer can return a detailed
 * rule error (which could disclose the hidden actor's identity or position).
 */
function playerCommandReferencesHiddenActor(room: Room, command: EncounterCommand): boolean {
  const hiddenActorIds = new Set(Object.entries(room.state.table.actorPresentation)
    .filter(([, presentation]) => presentation.hidden)
    .map(([actorId]) => actorId));
  if (hiddenActorIds.size === 0) return false;
  const hasHidden = (actorId: string | undefined) => Boolean(actorId && hiddenActorIds.has(actorId));
  switch (command.type) {
    case 'BASIC_ATTACK':
    case 'RESCUE':
    case 'APPLY_STATUS':
      return hasHidden(command.targetId);
    case 'USE_ABILITY':
      return command.targetIds.some(hasHidden);
    case 'EXECUTE_RULE':
      return hasHidden(command.attackTargetId)
        || hasHidden(command.triggerSourceId)
        || command.triggerTargetIds?.some(hasHidden) === true
        || Object.values(command.input.actorIds ?? {}).some((actorIds) => actorIds.some(hasHidden));
    default:
      return false;
  }
}
