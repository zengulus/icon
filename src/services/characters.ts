import type { IconCharacter } from '../rules/index.js';
import { migrateCharacter } from '../rules/index.js';
import { supabase } from './supabase.js';

export const LOCAL_CHARACTER_STORAGE_KEY = 'icon.characters.v1';
export const LOCAL_CHARACTER_QUARANTINE_PREFIX = `${LOCAL_CHARACTER_STORAGE_KEY}.quarantine.`;

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

interface LocalCharacterReadResult extends CharacterListResult {
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

function readLocalCharacters(): LocalCharacterReadResult {
  const storage = localStorageForCharacters();
  let rawPayload: string | null;
  try {
    rawPayload = storage.getItem(LOCAL_CHARACTER_STORAGE_KEY);
  } catch (reason) {
    throw localStorageError('Could not read local characters', reason);
  }
  if (rawPayload === null) return { characters: [], issues: [], safeToWrite: true };

  let parsed: unknown;
  const records: LocalCharacterQuarantine['records'] = [];
  const issues: CharacterLoadIssue[] = [];
  try {
    parsed = JSON.parse(rawPayload);
  } catch (reason) {
    const message = `The local character roster is not valid JSON (${reasonMessage(reason, 'parse failed.')})`;
    records.push({ index: null, reason: message, raw: rawPayload });
    issues.push({ source: 'local', index: null, message });
    parsed = [];
  }

  const characters: IconCharacter[] = [];
  if (Array.isArray(parsed)) {
    parsed.forEach((record, index) => {
      try {
        characters.push(migrateCharacter(record));
      } catch (reason) {
        const message = `Character record ${index + 1} could not be loaded: ${reasonMessage(reason, 'record is invalid.')}`;
        records.push({ index, reason: message, raw: record });
        issues.push({ source: 'local', index, message });
      }
    });
  } else {
    const message = 'The local character roster must be an array of character records.';
    records.push({ index: null, reason: message, raw: rawPayload });
    issues.push({ source: 'local', index: null, message });
  }

  if (!records.length) return { characters, issues, safeToWrite: true };

  let recoveryKey: string | undefined;
  try {
    recoveryKey = preserveLocalRecovery(storage, {
      version: 1,
      capturedAt: new Date().toISOString(),
      sourceKey: LOCAL_CHARACTER_STORAGE_KEY,
      originalPayload: rawPayload,
      records,
    });
    // Recovery is written first. If this write fails, the source roster stays
    // intact and later saves are blocked below rather than losing its records.
    storage.setItem(LOCAL_CHARACTER_STORAGE_KEY, JSON.stringify(characters));
  } catch (reason) {
    issues.push({
      source: 'local',
      index: null,
      message: `Unreadable local records were left in place because recovery could not be completed: ${reasonMessage(reason, 'storage rejected the repair.')}`,
      ...(recoveryKey ? { quarantineKey: recoveryKey } : {}),
    });
    return { characters, issues, safeToWrite: false };
  }

  return {
    characters,
    issues: issues.map((issue) => ({ ...issue, quarantineKey: recoveryKey })),
    safeToWrite: true,
  };
}

function writeLocal(characters: IconCharacter[]) {
  try {
    localStorageForCharacters().setItem(LOCAL_CHARACTER_STORAGE_KEY, JSON.stringify(characters));
  } catch (reason) {
    throw localStorageError('Could not save local characters', reason);
  }
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

export async function listCharactersWithReport(userId: string | null): Promise<CharacterListResult> {
  if (!supabase || !userId) {
    const { characters, issues } = readLocalCharacters();
    return { characters, issues };
  }
  const { data, error } = await supabase.from('characters').select('data').order('updated_at', { ascending: false });
  if (error) throw error;
  if (data !== null && !Array.isArray(data)) throw new CharacterPersistenceError('Cloud character storage returned an invalid list response.');

  const characters: IconCharacter[] = [];
  const issues: CharacterLoadIssue[] = [];
  for (const [index, row] of (data ?? []).entries()) {
    try {
      characters.push(migrateCharacter(row?.data));
    } catch (reason) {
      issues.push({
        source: 'supabase',
        index,
        message: `Cloud character record ${index + 1} could not be loaded: ${reasonMessage(reason, 'record is invalid.')}`,
      });
    }
  }
  return { characters, issues };
}

export async function listCharacters(userId: string | null): Promise<IconCharacter[]> {
  return (await listCharactersWithReport(userId)).characters;
}

export async function saveCharacter(character: IconCharacter, userId: string | null): Promise<IconCharacter> {
  const updated = migrateCharacter({ ...character, ownerId: userId, updatedAt: new Date().toISOString() });
  if (!supabase || !userId) {
    const local = readLocalCharacters();
    if (!local.safeToWrite) {
      throw new CharacterPersistenceError('Local character recovery could not be completed, so this save was cancelled to protect existing records.');
    }
    const characters = local.characters;
    const index = characters.findIndex(({ id }) => id === updated.id);
    if (index >= 0) characters[index] = updated;
    else characters.unshift(updated);
    writeLocal(characters);
    return updated;
  }
  const { error } = await supabase.from('characters').upsert({
    id: updated.id,
    owner_id: userId,
    name: updated.name || 'Unnamed Icon',
    rules_version: updated.rulesVersion,
    schema_version: updated.schemaVersion,
    data: updated,
    updated_at: updated.updatedAt,
  });
  if (error) throw error;
  return updated;
}

export async function deleteCharacter(id: string, userId: string | null) {
  if (!supabase || !userId) {
    const local = readLocalCharacters();
    if (!local.safeToWrite) {
      throw new CharacterPersistenceError('Local character recovery could not be completed, so this archive action was cancelled to protect existing records.');
    }
    writeLocal(local.characters.filter((character) => character.id !== id));
    return;
  }
  const { error } = await supabase.from('characters').delete().eq('id', id);
  if (error) throw error;
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
