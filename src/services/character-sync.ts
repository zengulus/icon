import type { IconCharacter } from '../rules/index.js';

/**
 * LOCAL-FIRST CHARACTER PERSISTENCE + DEBOUNCED CLOUD REPLICATION
 *
 * The durable source of truth for a character is a local record envelope,
 * never a bare `IconCharacter`. Every edit commits locally first and advances
 * a per-character monotonic `localRevision`; cloud writes are debounced and
 * carry that latest revision. `Cloud saved` is green only when the cloud has
 * acknowledged the EXACT current local revision. All transport metadata lives
 * here, outside the rules `IconCharacter` payload.
 *
 * This file owns only the durability/replication semantics. The underlying
 * localStorage envelope (including malformed-record quarantine) lives in
 * `characters.ts`, which exposes `loadLocalRecords`/`writeLocalRecords` for
 * the controller below.
 */

export const CLOUD_SAVE_DEBOUNCE_MS = 2000;
export const LOCAL_INSTANCE_KEY = 'icon.creatorInstanceId';

/** The presentation state a creation/sheet page renders in its save chip. */
export type SaveState = 'editing' | 'local' | 'cloud';

export interface LocalCharacterRecord {
  character: IconCharacter;
  /** Monotonic per-character revision. Every persisted edit advances it. */
  localRevision: number;
  /** The exact revision durably acknowledged by cloud storage, or null. */
  cloudRevision: number | null;
  /** `synced` only when `cloudRevision === localRevision`. */
  cloudState: 'pending' | 'synced';
  /** The neutral local installation id this record was created under. It is
   * opaque, carries no username/password/token, and has no network authority. */
  creatorInstanceId: string;
}

export interface CloudCharacterWrite {
  character: IconCharacter;
  revision: number;
  /** The durable local player instance that created this character. The cloud
   * compare-and-set requires this instance to be bound to the authenticated
   * owner, so a client can never upsert under another account. */
  creatorInstanceId: string;
}

/** Backend-agnostic cloud transport. `write` returns the revision the durable
 * cloud row actually holds after the attempt (idempotent: repeating or stale
 * revisions never move it backward). Throws when the write cannot durably
 * succeed. `available` is false when there is no authenticated identity. */
export interface CloudCharacterTransport {
  available(): boolean;
  write(input: CloudCharacterWrite): Promise<number>;
}

export interface CloudCharacterWriteResult {
  acceptedRevision: number;
  requestedRevision: number;
}

/**
 * Pure compare-and-set decision shared (conceptually) with the Supabase
 * `save_character_cas` RPC: a cloud write is accepted only when it never moves
 * the durable row BACKWARD. Repeating the exact current revision is harmless.
 * A late/stale revision (see test 26) must never overwrite a newer one.
 */
export function cloudWriteAccepted(existingRevision: number | null, incomingRevision: number): boolean {
  if (existingRevision === null || existingRevision === incomingRevision) return true;
  return existingRevision < incomingRevision;
}

export interface CharacterSyncHooks {
  /** Called whenever a record's durable persistence state changes. */
  onState(record: LocalCharacterRecord): void;
  /** Called when a cloud replication attempt fails (record remains locally saved + pending). */
  onCloudFailure?(id: string, reason: unknown): void;
}

export interface CharacterSyncOptions {
  transport: CloudCharacterTransport;
  /** Reads the durable local envelope. */
  load: () => LocalCharacterRecord[];
  /** Persists the durable local envelope. Must be synchronous (localStorage). */
  write: (records: LocalCharacterRecord[]) => void;
  hooks: CharacterSyncHooks;
  debounceMs?: number;
}

/**
 * A neutral local-instance seam for future hardened icon_connect identity
 * work. It is an opaque, securely-random UUID that persists locally and is
 * stable for this installation; it deliberately carries no username, password,
 * auth token, or claim to network authority. Future account identity can bind
 * to it without rewriting character creation.
 */
export function loadOrCreateCreatorInstanceId(): string {
  if (typeof localStorage !== 'undefined') {
    const existing = localStorage.getItem(LOCAL_INSTANCE_KEY);
    if (existing) return existing;
    const fresh = globalThis.crypto?.randomUUID?.();
    if (!fresh) {
      throw new Error('crypto.randomUUID is unavailable; refusing to persist a weak local instance id.');
    }
    localStorage.setItem(LOCAL_INSTANCE_KEY, fresh);
    return fresh;
  }
  const fresh = globalThis.crypto?.randomUUID?.();
  if (!fresh) throw new Error('crypto.randomUUID is unavailable for the local instance id.');
  return fresh;
}

export function recordSaveState(record: LocalCharacterRecord): SaveState {
  if (record.cloudState === 'synced' && record.cloudRevision === record.localRevision) return 'cloud';
  return 'local';
}

/**
 * Constructs a fresh envelope for a newly-created character.
 * `cloudRevision` starts null because the cloud has not yet acknowledged
 * revision 1, so the first commit is inherently `pending`.
 */
export function createLocalCharacterRecord(character: IconCharacter, creatorInstanceId: string): LocalCharacterRecord {
  return {
    character,
    localRevision: 1,
    cloudRevision: null,
    cloudState: 'pending',
    creatorInstanceId,
  };
}

/**
 * Debounced local-first replication controller. Drives the machine:
 *
 *   EDIT → LOCAL COMMIT (blue) → debounce/quiescence → CLOUD WRITE →
 *   exact-revision ack → green.
 *
 * Guarantees:
 * - local commit always precedes any cloud request;
 * - cloud writes are debounced (no per-keypress network traffic);
 * - at most one cloud write per character in flight;
 * - intermediate revisions are never uploaded (only the latest at send time);
 * - a stale async completion can never make the current state green, and can
 *   never regress an already-acknowledged cloud revision;
 * - cloud failure never turns a locally-committed character into "unsaved".
 *
 * Dependency-injected for deterministic tests (mock transport + fake timers).
 */
export class CharacterSyncController {
  private readonly records = new Map<string, LocalCharacterRecord>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inflight = new Map<string, number>();
  private readonly replicateAfterFlight = new Set<string>();
  private started = false;

  constructor(private readonly options: CharacterSyncOptions) {}

  /** Load the durable local envelope into memory and lay pending records that
   * can replicate (transport available) back onto the debounce schedule. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const record of this.options.load()) {
      this.records.set(record.character.id, record);
    }
    // Restart discovers/retries pending local revisions (test 28).
    for (const record of this.records.values()) {
      if (record.cloudState !== 'synced' && this.options.transport.available()) {
        this.schedule(record.character.id);
      }
    }
  }

  dispose(): void {
    this.started = false;
    for (const id of [...this.timers.keys()]) this.cancelTimer(id);
    this.timers.clear();
    this.inflight.clear();
    this.replicateAfterFlight.clear();
    this.options.hooks.onState; // keep reference; no-op dispose
  }

  recordFor(id: string): LocalCharacterRecord | undefined {
    return this.records.get(id);
  }

  allRecords(): LocalCharacterRecord[] {
    return [...this.records.values()];
  }

  /**
   * Adopt an authoritative merged roster (e.g. after `listCharactersWithReport`
   * reconciles local + cloud). Any record not present in the incoming list is
   * dropped; newly-appearing pending records (cloud revision strictly newer)
   * are put back on the debounce schedule. In-flight requests are left alone
   * and their completions still flow through `afterFlight`, which guards
   * against a cloud-merge overwriting a just-committed newer local revision
   * because it only ever consults the current in-memory record.
   */
  adopt(records: LocalCharacterRecord[]): void {
    this.records.clear();
    for (const record of records) this.records.set(record.character.id, record);
    this.persist();
    for (const record of this.records.values()) {
      if (record.cloudState !== 'synced' && this.options.transport.available() && !this.inflight.has(record.character.id)) {
        this.schedule(record.character.id);
      }
    }
  }

  private timersClock() {
    return this.options.debounceMs ?? CLOUD_SAVE_DEBOUNCE_MS;
  }

  private cancelTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /**
   * Local-first commit. Advances the monotonic revision, persists durably,
   * broadcasts the new (blue) state, then resets the debounce timer. This is
   * the ONLY entry point for a persisted character edit.
   */
  commit(character: IconCharacter, creatorInstanceId?: string): LocalCharacterRecord {
    const id = character.id;
    const existing = this.records.get(id);
    const record: LocalCharacterRecord = existing
      ? { ...existing, character, localRevision: existing.localRevision + 1, cloudState: 'pending' }
      : createLocalCharacterRecord(character, creatorInstanceId ?? loadOrCreateCreatorInstanceId());
    this.records.set(id, record);
    this.persist();
    this.options.hooks.onState(record);
    this.schedule(id);
    return record;
  }

  /**
   * Remove a record and cancel any pending schedule. Local removal is the
   * durable transition; a cloud tombstone is out of scope for this tranche.
   */
  remove(id: string): void {
    this.cancelTimer(id);
    this.records.delete(id);
    this.inflight.delete(id);
    this.replicateAfterFlight.delete(id);
    this.persist();
  }

  /** Best-effort immediate replication of a single record (e.g. Save/Done). */
  flush(id: string): void {
    this.cancelTimer(id);
    void this.replicate(id, true);
  }

  /** Best-effort immediate replication of every dirty record (e.g. pagehide). */
  flushAllPending(): void {
    for (const record of this.records.values()) {
      if (record.cloudState !== 'synced') {
        this.cancelTimer(record.character.id);
        void this.replicate(record.character.id, true);
      }
    }
  }

  private schedule(id: string): void {
    this.cancelTimer(id);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.replicate(id, false);
    }, this.timersClock());
    this.timers.set(id, timer);
  }

  private persist(): void {
    this.options.write([...this.records.values()]);
  }

  private async replicate(id: string, force: boolean): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    if (record.cloudState === 'synced' && record.cloudRevision === record.localRevision) return;
    if (this.inflight.has(id)) {
      // An edit landed while a request was in flight: re-run the latest after
      // that request settles rather than stacking concurrent uploads.
      this.replicateAfterFlight.add(id);
      return;
    }
    if (!this.options.transport.available()) {
      // No identity: stay durably local + pending; retried on later availability.
      return;
    }
    const revision = record.localRevision;
    this.inflight.set(id, revision);
    try {
      const accepted = await this.options.transport.write({
        character: record.character,
        revision,
        creatorInstanceId: record.creatorInstanceId,
      });
      this.inflight.delete(id);
      this.afterFlight(id, revision, accepted);
    } catch (reason) {
      this.inflight.delete(id);
      // Cloud failure must never make a locally-committed character "unsaved".
      this.replicateAfterFlight.delete(id);
      this.options.hooks.onCloudFailure?.(id, reason);
    }
  }

  private afterFlight(id: string, requestedRevision: number, acceptedRevision: number): void {
    const record = this.records.get(id);
    if (!record) return;
    // Exact current-revision acknowledgement → green (test 23).
    if (acceptedRevision === record.localRevision && acceptedRevision === requestedRevision) {
      record.cloudRevision = acceptedRevision;
      record.cloudState = 'synced';
    } else {
      // Stale acknowledgement or a newer local edit: keep pending (test 25).
      record.cloudState = 'pending';
    }
    this.persist();
    this.options.hooks.onState(record);
    if (this.replicateAfterFlight.has(id)) {
      // Edits during the in-flight request: flush the latest pending revision.
      this.replicateAfterFlight.delete(id);
      this.schedule(id);
    }
  }
}