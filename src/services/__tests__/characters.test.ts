import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharacter, type IconCharacter } from '../../rules/index.js';

const supabaseState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('../supabase.js', () => ({
  get supabase() {
    return supabaseState.client;
  },
}));

import {
  CharacterPersistenceError,
  LOCAL_CHARACTER_QUARANTINE_PREFIX,
  LOCAL_CHARACTER_STORAGE_KEY,
  listCharactersWithReport,
  listLocalCharacterQuarantines,
  saveCharacter,
} from '../characters.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  failWrites: ((key: string) => boolean) | null = null;

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    if (this.failWrites?.(key)) throw new Error(`write blocked for ${key}`);
    this.values.set(key, value);
  }
}

function character(id: string): IconCharacter {
  return { ...createCharacter('2026-08-22T00:00:00.000Z'), id, name: id };
}

describe('character persistence recovery', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    supabaseState.client = null;
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(Date, 'now').mockReturnValue(1_777_777_777_777);
  });

  afterEach(() => {
    supabaseState.client = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps valid local records, quarantines only invalid records, and safely saves afterward', async () => {
    const preserved = character('preserved');
    const malformed = { schemaVersion: 999, id: 'bad-record' };
    const originalPayload = JSON.stringify([preserved, malformed]);
    storage.setItem(LOCAL_CHARACTER_STORAGE_KEY, originalPayload);

    const result = await listCharactersWithReport(null);

    expect(result.characters.map(({ id }) => id)).toEqual(['preserved']);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ source: 'local', index: 1 });
    expect(result.issues[0]?.quarantineKey).toBe(`${LOCAL_CHARACTER_QUARANTINE_PREFIX}1777777777777-0`);
    const storedAfterRepair = JSON.parse(storage.getItem(LOCAL_CHARACTER_STORAGE_KEY) ?? 'null');
    expect(storedAfterRepair).toMatchObject({ version: 2 });
    expect(storedAfterRepair.records.map(({ character }: { character: IconCharacter }) => character.id)).toEqual(['preserved']);
    expect(storedAfterRepair.records[0]).toMatchObject({ localRevision: 1, cloudRevision: null, cloudState: 'pending' });

    const recoveries = listLocalCharacterQuarantines();
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]?.recovery).toMatchObject({
      version: 1,
      originalPayload,
      records: [{ index: 1, raw: malformed }],
    });

    await saveCharacter(character('new-record'), null);
    const storedAfterSave = JSON.parse(storage.getItem(LOCAL_CHARACTER_STORAGE_KEY) ?? '[]');
    expect(storedAfterSave).toMatchObject({ version: 2 });
    expect(storedAfterSave.records.map(({ character }: { character: IconCharacter }) => character.id)).toEqual(['new-record', 'preserved']);
    expect(listLocalCharacterQuarantines()).toHaveLength(1);
  });

  it('preserves an unreadable whole payload before resetting the active local roster', async () => {
    const originalPayload = '{definitely not JSON';
    storage.setItem(LOCAL_CHARACTER_STORAGE_KEY, originalPayload);

    const result = await listCharactersWithReport(null);

    expect(result.characters).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(JSON.parse(storage.getItem(LOCAL_CHARACTER_STORAGE_KEY) ?? 'null')).toMatchObject({ version: 2, records: [] });
    expect(listLocalCharacterQuarantines()[0]?.recovery).toMatchObject({
      originalPayload,
      records: [{ index: null, raw: originalPayload }],
    });
  });

  it('refuses a save when it cannot first quarantine unreadable local data', async () => {
    const originalPayload = JSON.stringify([character('preserved'), { schemaVersion: 999 }]);
    storage.setItem(LOCAL_CHARACTER_STORAGE_KEY, originalPayload);
    storage.failWrites = (key) => key.startsWith(LOCAL_CHARACTER_QUARANTINE_PREFIX);

    const result = await listCharactersWithReport(null);
    expect(result.characters.map(({ id }) => id)).toEqual(['preserved']);
    expect(result.issues.at(-1)?.message).toContain('left in place');

    await expect(saveCharacter(character('new-record'), null)).rejects.toBeInstanceOf(CharacterPersistenceError);
    expect(storage.getItem(LOCAL_CHARACTER_STORAGE_KEY)).toBe(originalPayload);
  });

  it('isolates malformed Supabase rows without changing cloud storage or hiding valid rows', async () => {
    const preserved = character('cloud-preserved');
    const order = vi.fn().mockResolvedValue({
      data: [{ data: preserved }, { data: { schemaVersion: 999, id: 'cloud-bad' } }],
      error: null,
    });
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    supabaseState.client = { from };

    const result = await listCharactersWithReport('user-1');

    expect(from).toHaveBeenCalledWith('characters');
    expect(result.characters.map(({ id }) => id)).toEqual(['cloud-preserved']);
    expect(result.issues).toEqual([expect.objectContaining({ source: 'supabase', index: 1 })]);
    // Local-first: the single valid cloud row is imported into the local
    // envelope (and left acknowledged in cloud storage). Malformed rows are
    // isolated and cloud storage is untouched.
    const envelope = JSON.parse(storage.getItem(LOCAL_CHARACTER_STORAGE_KEY) ?? 'null');
    expect(envelope).toMatchObject({ version: 2 });
    expect(envelope.records.map(({ character }: { character: IconCharacter }) => character.id)).toEqual(['cloud-preserved']);
  });
});
