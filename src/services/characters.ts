import type { IconCharacter } from '../rules/index.js';
import { migrateCharacter } from '../rules/index.js';
import type { CloudCharacterTransport, CloudCharacterWrite, LocalCharacterRecord } from './character-sync.js';
import { createLocalCharacterRecord, loadOrCreateCreatorInstanceId } from './character-sync.js';
import { supabase } from './supabase.js';

export const LOCAL_CHARACTER_STORAGE_KEY = 'icon.characters.v1';
export const LOCAL_CHARACTER_QUARANTINE_PREFIX = `${LOCAL_CHARACTER_STORAGE_KEY}.quarantine.`;

/**
 * The durable local envelope. `version` is the payload container version (2 =
 * record envelope). Historical (v1) payloads were a bare array of
 * `IconCharacter`; `readLocalCharacters` migrates them to records with a fresh
 * revision and no cloud acknowledgement.
 */
interface LocalCharacterStorePayload {
  version: 2;
  records: LocalCharacterRecord[];
}

export interface CharacterLoadIssue {
  /** Where the unreadable record was found. Cloud records are never mutated. */
  source: 'local' | 'supabase';
  /** Index in the source list when one was available. */
  index: number | null;
  /** A safe, user-facing explanation of why the record was not loaded. */
  message: string;
  /**
   * Local records are copied to this recovery entry before the active roster
   * is repaired. It is absent for cloud records because they stay in place.
   */
  quarantineKey?: string;
}

export interface CharacterListResult {
  characters: IconCharacter[];
  records: LocalCharacterRecord[];
  issues: CharacterLoadIssue[];
}

export interface LocalCharacterQuarantine {
  version: 1;
  capturedAt: string;
  sourceKey: typeof LOCAL_CHARACTER_STORAGE_KEY;
  /** Exact payload from before the active roster was repaired. */
  originalPayload: string;
  records: Array<{
    index: number | null;
    reason: string;
    raw: unknown;
  }>;
}

/**
 * Returned when a local repair cannot be safely committed. The active payload
 * is deliberately left untouched in this case, so a subsequent save cannot
 * silently discard unreadable records.
 */
export class CharacterPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterPersistenceError';
  }
}

interface LocalCharacterReadResult {
  records: LocalCharacterRecord[];
  issues: CharacterLoadIssue[];
  safeToWrite: boolean;
}

function localStorageForCharacters(): Storage {
  if (typeof localStorage === 'undefined') {
    throw new CharacterPersistenceError('Local character storage is not available in this browser.');
  }
  return localStorage;
}

function reasonMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function localStorageError(action: string, reason: unknown) {
  return new CharacterPersistenceError(`${action}: ${reasonMessage(reason, 'local storage rejected the operation.')}`);
}

function quarantineKey(storage: Storage) {
  const timestamp = Date.now();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const key = `${LOCAL_CHARACTER_QUARANTINE_PREFIX}${timestamp}-${attempt}`;
    if (storage.getItem(key) === null) return key;
  }
  throw new CharacterPersistenceError('Could not reserve a local character recovery entry.');
}

function preserveLocalRecovery(storage: Storage, payload: LocalCharacterQuarantine): string {
  const key = quarantineKey(storage);
  storage.setItem(key, JSON.stringify(payload));
  return key;
}

/**
 * Exposes locally quarantined data to an eventual recovery/export UI without
 * treating it as an active character. Bad recovery entries are left in place
 * and omitted rather than being overwritten during inspection.
 */
export function listLocalCharacterQuarantines(): Array<{ key: string; recovery: LocalCharacterQuarantine }> {
  const storage = localStorageForCharacters();
  const quarantines: Array<{ key: string; recovery: LocalCharacterQuarantine }> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(LOCAL_CHARACTER_QUARANTINE_PREFIX)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try {
      const recovery = JSON.parse(raw) as LocalCharacterQuarantine;
      if (recovery?.version !== 1
        || typeof recovery.capturedAt !== 'string'
        || recovery.sourceKey !== LOCAL_CHARACTER_STORAGE_KEY
        || !Array.isArray(recovery.records)
        || typeof recovery.originalPayload !== 'string') continue;
      quarantines.push({ key, recovery });
    } catch {
      // A recovery entry is itself evidence. Never replace or remove it while
      // merely listing recoverable payloads.
    }
  }
  return quarantines.sort((left, right) => right.recovery.capturedAt.localeCompare(left.recovery.capturedAt));
}

/**
 * Coerce any parsed local payload into the durable envelope. A legacy (v1)
 * bare `IconCharacter[]` becomes one record per character with a fresh
 * revision and no cloud acknowledgement; malformed entries raise issues and
 * are quarantined rather than guessed.
 */
function toRecords(parsed: unknown, rawPayload: string, issues: CharacterLoadIssue[]): LocalCharacterRecord[] {
  const quarantineRecords: LocalCharacterQuarantine['records'] = [];
  const instanceId = loadOrCreateCreatorInstanceId();
  const records: LocalCharacterRecord[] = [];
  const handleFailure = (index: number | null, message: string, raw: unknown) => {
    quarantineRecords.push({ index, reason: message, raw });
    issues.push({ source: 'local', index, message });
  };

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { version?: unknown }).version === 2) {
    const envelope = parsed as { records?: unknown };
    if (!Array.isArray(envelope.records)) {
      handleFailure(null, 'The local character envelope has no records array.', parsed);
      return records;
    }
    envelope.records.forEach((record, index) => {
      const candidate = record as LocalCharacterRecord;
      if (!candidate || typeof candidate !== 'object' || typeof candidate.character !== 'object') {
        handleFailure(index, `Character record ${index + 1} could not be loaded: the envelope is malformed.`, record);
        return;
      }
      try {
        const character = migrateCharacter(candidate.character);
        records.push({
          character,
          localRevision: Number.isSafeInteger(candidate.localRevision) ? candidate.localRevision : 1,
          cloudRevision: Number.isSafeInteger(candidate.cloudRevision) ? candidate.cloudRevision : null,
          cloudState: candidate.cloudState === 'synced' ? 'synced' : 'pending',
          creatorInstanceId: typeof candidate.creatorInstanceId === 'string' ? candidate.creatorInstanceId : instanceId,
        });
      } catch (reason) {
        handleFailure(index, `Character record ${index + 1} could not be loaded: ${reasonMessage(reason, 'record is invalid.')}`, record);
      }
    });
    return records;
  }

  // Legacy v1 payload: bare IconCharacter[].
  if (Array.isArray(parsed)) {
    parsed.forEach((record, index) => {
      try {
        const character = migrateCharacter(record);
        records.push(createLocalCharacterRecord(character, instanceId));
      } catch (reason) {
        handleFailure(index, `Character record ${index + 1} could not be loaded: ${reasonMessage(reason, 'record is invalid.')}`, record);
      }
    });
    return records;
  }

  handleFailure(null, 'The local character roster must be an envelope or an array of character records.', rawPayload);
  return records;
}

function readLocalCharacters(): LocalCharacterReadResult {
  const storage = localStorageForCharacters();
  let rawPayload: string | null;
  try {
    rawPayload = storage.getItem(LOCAL_CHARACTER_STORAGE_KEY);
  } catch (reason) {
    throw localStorageError('Could not read local characters', reason);
  }
  if (rawPayload === null) return { records: [], issues: [], safeToWrite: true };

  let parsed: unknown;
  const issues: CharacterLoadIssue[] = [];
  try {
    parsed = JSON.parse(rawPayload);
  } catch (reason) {
    const message = `The local character roster is not valid JSON (${reasonMessage(reason, 'parse failed.')})`;
    issues.push({ source: 'local', index: null, message });
    parsed = [];
  }

  let records: LocalCharacterRecord[];
  const consumedIssues: CharacterLoadIssue[] = [];
  records = toRecords(parsed, rawPayload, consumedIssues);
  issues.push(...consumedIssues);

  if (!issues.length) return { records, issues, safeToWrite: true };

  let recoveryKey: string | undefined;
  try {
    recoveryKey = preserveLocalRecovery(storage, {
      version: 1,
      capturedAt: new Date().toISOString(),
      sourceKey: LOCAL_CHARACTER_STORAGE_KEY,
      originalPayload: rawPayload,
      records: issues.map((issue) => ({
        index: issue.index,
        reason: issue.message,
        raw: issue.index === null ? rawPayload : (Array.isArray(parsed) ? parsed[issue.index] : parsed),
      })),
    });
    // Recovery is written first. If this write fails, the source roster stays
    // intact and later saves are blocked below rather than losing its records.
    storage.setItem(LOCAL_CHARACTER_STORAGE_KEY, JSON.stringify({ version: 2, records } satisfies LocalCharacterStorePayload));
  } catch (reason) {
    issues.push({
      source: 'local',
      index: null,
      message: `Unreadable local records were left in place because recovery could not be completed: ${reasonMessage(reason, 'storage rejected the repair.')}`,
      ...(recoveryKey ? { quarantineKey: recoveryKey } : {}),
    });
    return { records, issues, safeToWrite: false };
  }

  return {
    records,
    issues: issues.map((issue) => ({ ...issue, quarantineKey: recoveryKey })),
    safeToWrite: true,
  };
}

function writeLocalRecordsUnchecked(records: LocalCharacterRecord[]) {
  try {
    localStorageForCharacters().setItem(LOCAL_CHARACTER_STORAGE_KEY, JSON.stringify({ version: 2, records } satisfies LocalCharacterStorePayload));
  } catch (reason) {
    throw localStorageError('Could not save local characters', reason);
  }
}

/** Read the durable local envelope as records (for the sync controller). */
export function loadLocalRecords(): LocalCharacterRecord[] {
  return readLocalCharacters().records;
}

/** Durable-write the local envelope (used by the sync controller). */
export function writeLocalRecords(records: LocalCharacterRecord[]): void {
  writeLocalRecordsUnchecked(records);
}

export function characterLoadNotice(issues: CharacterLoadIssue[]) {
  const local = issues.filter(({ source }) => source === 'local');
  const remote = issues.filter(({ source }) => source === 'supabase');
  const notices: string[] = [];
  if (local.length) {
    const recovery = local.find(({ quarantineKey }) => quarantineKey)?.quarantineKey;
    notices.push(`Some local character records could not be read${recovery ? ` and were moved to recovery storage (${recovery})` : ''}.`);
  }
  if (remote.length) notices.push('Some cloud character records could not be read; they were left unchanged in cloud storage.');
  return notices.join(' ');
}

/**
 * The roster is the local envelope, regardless of authentication. Cloud rows
 * are imported into the local envelope on list (see `importCloudCharacters`)
 * so a freshly-authenticated user never sees a different, disconnected roster.
 */
export async function listCharactersWithReport(userId: string | null): Promise<CharacterListResult> {
  const local = readLocalCharacters();
  const characters = local.records.map((record) => record.character);
  const issues = local.issues;
  if (!supabase || !userId) {
    return { characters, records: local.records, issues };
  }
  const { data, error } = await supabase.from('characters').select('data,revision').order('updated_at', { ascending: false });
  if (error) throw error;
  if (data !== null && !Array.isArray(data)) throw new CharacterPersistenceError('Cloud character storage returned an invalid list response.');

  const cloudIssues: CharacterLoadIssue[] = [];
  const merged = new Map<string, LocalCharacterRecord>(local.records.map((record) => [record.character.id, record]));
  for (const [index, row] of (data ?? []).entries()) {
    try {
      const character = migrateCharacter(row?.data);
      const localRecord = merged.get(character.id);
      const cloudRevision = Number.isSafeInteger(row?.revision) ? Number(row.revision) : 0;
      if (localRecord) {
        // Cloud never replaces a newer local revision; if cloud is strictly
        // newer, pull it into the local roster as an explicitly acknowledged
        // record so we never regress local edits.
        if (cloudRevision > localRecord.localRevision) {
          merged.set(character.id, {
            character,
            localRevision: localRecord.localRevision,
            cloudRevision,
            cloudState: 'pending',
            creatorInstanceId: localRecord.creatorInstanceId,
          });
        }
      } else {
        merged.set(character.id, {
          character,
          localRevision: cloudRevision || 1,
          cloudRevision: cloudRevision || null,
          cloudState: cloudRevision ? 'synced' : 'pending',
          creatorInstanceId: loadOrCreateCreatorInstanceId(),
        });
      }
    } catch (reason) {
      cloudIssues.push({
        source: 'supabase',
        index,
        message: `Cloud character record ${index + 1} could not be loaded: ${reasonMessage(reason, 'record is invalid.')}`,
      });
    }
  }
  const records = [...merged.values()];
  writeLocalRecordsUnchecked(records);
  return {
    characters: records.map((record) => record.character),
    records,
    issues: [...issues, ...cloudIssues],
  };
}

export async function listCharacters(userId: string | null): Promise<IconCharacter[]> {
  return (await listCharactersWithReport(userId)).characters;
}

/**
 * Local-first save. This commits durably to the local envelope (blue) and
 * never performs an eager network write; the sync controller owns debounced
 * cloud replication. It returns the freshly-migrated character.
 */
export async function saveCharacter(character: IconCharacter, _userId: string | null): Promise<IconCharacter> {
  const updated = migrateCharacter({ ...character, updatedAt: new Date().toISOString() });
  const local = readLocalCharacters();
  if (!local.safeToWrite) {
    throw new CharacterPersistenceError('Local character recovery could not be completed, so this save was cancelled to protect existing records.');
  }
  const records = local.records;
  const index = records.findIndex((record) => record.character.id === updated.id);
  if (index >= 0) {
    const existing = records[index]!;
    records[index] = {
      ...existing,
      character: updated,
      localRevision: existing.localRevision + 1,
      cloudState: 'pending',
    };
  } else {
    records.unshift(createLocalCharacterRecord(updated, loadOrCreateCreatorInstanceId()));
  }
  writeLocalRecordsUnchecked(records);
  return updated;
}

export async function deleteCharacter(id: string, _userId: string | null) {
  const local = readLocalCharacters();
  if (!local.safeToWrite) {
    throw new CharacterPersistenceError('Local character recovery could not be completed, so this archive action was cancelled to protect existing records.');
  }
  writeLocalRecordsUnchecked(local.records.filter((record) => record.character.id !== id));
}

/**
 * Local-first cloud transport backed by the `save_character_cas` RPC.
 * `available()` is true only when an authenticated identity exists AND the
 * RPC is reachable; otherwise records stay durably local + pending. The write
 * is compare-and-set on `revision` (accepted only when it never moves the
 * durable row backward), which gives idempotent, stale-safe replication.
 */
export class SupabaseCharacterTransport implements CloudCharacterTransport {
  constructor(private readonly currentUserId: () => string | null) {}

  available(): boolean {
    return supabase !== null && this.currentUserId() !== null;
  }

  async write(input: CloudCharacterWrite): Promise<number> {
    if (!supabase) throw new Error('Cloud storage is not configured.');
    const ownerId = this.currentUserId();
    if (!ownerId) throw new Error('No authenticated identity for cloud storage.');
    const { id, name, rulesVersion, schemaVersion } = input.character;
    const { data, error } = await supabase.rpc('save_character_cas', {
      target_id: id,
      // The server/DB boundary derives ownership from the session and requires
      // this creator instance to be bound to that owner; the client never
      // asserts an owner id.
      target_creator_instance_id: input.creatorInstanceId,
      target_name: name,
      target_rules_version: rulesVersion,
      target_schema_version: schemaVersion,
      target_data: input.character,
      target_revision: input.revision,
    });
    if (error) throw error;
    return Number(data);
  }
}

export function downloadCharacter(character: IconCharacter) {
  const blob = new Blob([`${JSON.stringify(character, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${character.name || 'icon-character'}.icon.json`.replace(/[^a-z0-9._-]+/gi, '-');
  anchor.click();
  URL.revokeObjectURL(url);
}