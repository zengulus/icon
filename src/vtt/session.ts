import { type DiceSource } from '../rules/dice.js';
import type { EncounterCommand, Position } from '../rules/types.js';
import {
  applyRoomEvents,
  assertValidVttRoomState,
  createVttRoom,
  executeRoomCommand,
  type RoomCommand,
  type RoomEvent,
  type TableCommand,
  type VttRoomState,
} from '../rules/vtt-room.js';
import { RealtimeEncounterClient } from '../services/realtime.js';
import { restorePersistedVttRoom } from './persistence.js';

/** The only shared-state controller shape consumed by tactical React views. */
export interface EncounterSession {
  readonly state: VttRoomState | null;
  readonly role: 'gm' | 'player';
  readonly userId: string;
  readonly status: EncounterSessionStatus;
  readonly durability: EncounterSessionDurability;
  readonly error: string | null;
  encounter(command: EncounterCommand): void;
  table(command: TableCommand): void;
  ping(position: Position): void;
  save(): void;
  subscribe(listener: EncounterSessionListener): () => void;
  close(): void;
}

export type EncounterSessionStatus = 'local' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'save-error' | 'error';
export type EncounterSessionDurability = 'saved' | 'unsaved' | 'save-error' | 'local';

export interface EncounterSessionSnapshot {
  state: VttRoomState | null;
  role: 'gm' | 'player';
  userId: string;
  status: EncounterSessionStatus;
  durability: EncounterSessionDurability;
  error: string | null;
}

export type EncounterSessionListener = (snapshot: EncounterSessionSnapshot) => void;

/** Browser persistence for offline/local engineering rooms only. */
export interface LocalRoomPersistence {
  load(roomId: string): VttRoomState | null;
  save(roomId: string, state: VttRoomState): void;
  remove(roomId: string): void;
}

export function browserRoomPersistence(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  namespace = 'icon.vtt.room.v1',
): LocalRoomPersistence {
  const keyFor = (roomId: string) => `${namespace}:${roomId}`;
  const preserveCorruptRecord = (key: string, raw: string) => {
    // Keep the original bytes recoverable before a later local save replaces
    // the active key with a new room. Never overwrite the first forensic copy.
    const backupKey = `${key}.corrupt`;
    if (storage.getItem(backupKey) === null) storage.setItem(backupKey, raw);
  };
  return {
    load(roomId) {
      const key = keyFor(roomId);
      const raw = storage.getItem(key);
      if (!raw) return null;
      try {
        return restorePersistedVttRoom(JSON.parse(raw));
      } catch {
        // A corrupt browser cache must never be elevated over a valid new room,
        // nor silently lost when that room is next saved.
        try {
          preserveCorruptRecord(key, raw);
        } catch {
          // Storage can itself be unavailable or full. The original active
          // value remains untouched in that case.
        }
        return null;
      }
    },
    save(roomId, state) {
      assertValidVttRoomState(state);
      storage.setItem(keyFor(roomId), JSON.stringify(state));
    },
    remove(roomId) {
      storage.removeItem(keyFor(roomId));
    },
  };
}

export interface LocalEncounterSessionOptions {
  roomId: string;
  initialState?: VttRoomState;
  role?: 'gm' | 'player';
  userId?: string;
  persistence?: LocalRoomPersistence;
  /** Invoked for each accepted local command; tests can inject deterministic dice. */
  diceForCommand?: (command: RoomCommand, state: VttRoomState) => DiceSource | undefined;
}

/**
 * Local/offline implementation of the same controller contract as Render.
 * It executes the shared room reducer and persists only completed durable room
 * states—not pointer previews, pan/zoom, selection, or pings.
 */
export class LocalEncounterSession implements EncounterSession {
  private readonly listeners = new Set<EncounterSessionListener>();
  private current: VttRoomState;
  private currentError: string | null = null;

  readonly role: 'gm' | 'player';
  readonly userId: string;
  readonly status: EncounterSessionStatus = 'local';
  readonly durability: EncounterSessionDurability = 'local';

  constructor(private readonly options: LocalEncounterSessionOptions) {
    this.role = options.role ?? 'gm';
    this.userId = options.userId ?? 'local-user';
    const persisted = options.persistence?.load(options.roomId);
    this.current = persisted
      ? restorePersistedVttRoom(persisted)
      : (options.initialState ? restorePersistedVttRoom(options.initialState) : createVttRoom());
  }

  get state(): VttRoomState {
    return structuredClone(this.current);
  }

  get error(): string | null {
    return this.currentError;
  }

  encounter(command: EncounterCommand): void {
    this.commit({ domain: 'encounter', command });
  }

  table(command: TableCommand): void {
    this.commit({ domain: 'table', command });
  }

  ping(_position: Position): void {
    // Pings are intentionally local-transient in an offline room. They never
    // advance revision or enter browser persistence.
  }

  save(): void {
    try {
      assertValidVttRoomState(this.current);
      this.options.persistence?.save(this.options.roomId, this.current);
      this.currentError = null;
      this.publish();
    } catch (error) {
      this.currentError = error instanceof Error ? error.message : 'Local room save failed.';
      this.publish();
      throw error;
    }
  }

  importRoom(input: unknown): void {
    this.current = restorePersistedVttRoom(input);
    this.save();
    this.publish();
  }

  exportRoom(): VttRoomState {
    return structuredClone(this.current);
  }

  /** Useful for a local replay harness; it never changes the event source. */
  replay(events: RoomEvent[]): VttRoomState {
    return applyRoomEvents(this.current, events);
  }

  subscribe(listener: EncounterSessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
  }

  private commit(command: RoomCommand): void {
    try {
      const result = executeRoomCommand(this.current, command, this.options.diceForCommand?.(command, this.current));
      this.current = result.state;
      assertValidVttRoomState(this.current);
      this.options.persistence?.save(this.options.roomId, this.current);
      this.currentError = null;
      this.publish();
    } catch (error) {
      this.currentError = error instanceof Error ? error.message : 'The local room command failed.';
      this.publish();
      throw error;
    }
  }

  private snapshot(): EncounterSessionSnapshot {
    return {
      state: this.state,
      role: this.role,
      userId: this.userId,
      status: this.status,
      durability: this.durability,
      error: this.currentError,
    };
  }

  private publish(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export interface RealtimeEncounterSessionOptions {
  url: string;
  encounterId: string;
  userId: string;
  accessToken(): Promise<string>;
  initialState?: VttRoomState;
  onPing?(userId: string, position: Position): void;
}

/**
 * Render-backed implementation. It holds no optimistic shared copy: every
 * accepted server payload replaces the state supplied to tactical components.
 */
export class RealtimeEncounterSession implements EncounterSession {
  private readonly listeners = new Set<EncounterSessionListener>();
  private readonly client: RealtimeEncounterClient;
  private current: VttRoomState | null;
  private currentRole: 'gm' | 'player' = 'player';
  private currentStatus: EncounterSessionStatus = 'connecting';
  private currentDurability: EncounterSessionDurability = 'unsaved';
  private currentError: string | null = null;

  constructor(private readonly options: RealtimeEncounterSessionOptions) {
    this.current = options.initialState ? restorePersistedVttRoom(options.initialState) : null;
    this.client = new RealtimeEncounterClient({
      url: options.url,
      encounterId: options.encounterId,
      accessToken: options.accessToken,
      onState: (state) => {
        this.current = state;
        this.currentError = null;
        this.publish();
      },
      onJoined: (role) => {
        this.currentRole = role;
        this.publish();
      },
      onStatus: (status) => {
        this.currentStatus = status === 'closed' ? 'closed' : status;
        this.publish();
      },
      onError: (message) => {
        this.currentError = message;
        this.currentStatus = 'error';
        this.publish();
      },
      onPing: options.onPing,
      onSaveStatus: (status) => {
        this.currentDurability = status;
        if (status === 'save-error') this.currentStatus = 'save-error';
        this.publish();
      },
    });
  }

  get state(): VttRoomState | null { return this.current ? structuredClone(this.current) : null; }
  get role(): 'gm' | 'player' { return this.currentRole; }
  get userId(): string { return this.options.userId; }
  get status(): EncounterSessionStatus { return this.currentStatus; }
  get durability(): EncounterSessionDurability { return this.currentDurability; }
  get error(): string | null { return this.currentError; }

  connect(): Promise<void> {
    return this.client.connect();
  }

  encounter(command: EncounterCommand): void { this.client.encounter(command); }
  table(command: TableCommand): void { this.client.table(command); }
  ping(position: Position): void { this.client.ping(position); }
  save(): void { this.client.save(); }

  subscribe(listener: EncounterSessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.client.disconnect();
    this.listeners.clear();
  }

  private snapshot(): EncounterSessionSnapshot {
    return {
      state: this.state,
      role: this.role,
      userId: this.userId,
      status: this.status,
      durability: this.durability,
      error: this.error,
    };
  }

  private publish(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
