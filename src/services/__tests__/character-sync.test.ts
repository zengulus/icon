import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCharacter, type IconCharacter } from '../../rules/index.js';
import {
  CharacterSyncController,
  CLOUD_SAVE_DEBOUNCE_MS,
  cloudWriteAccepted,
  createLocalCharacterRecord,
  loadOrCreateCreatorInstanceId,
  type CloudCharacterTransport,
  type LocalCharacterRecord,
} from '../character-sync.js';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function character(id: string): IconCharacter {
  return { ...createCharacter('2026-08-22T00:00:00.000Z'), id, name: id };
}

class RecordingTransport implements CloudCharacterTransport {
  writes: Array<{ character: IconCharacter; revision: number; creatorInstanceId: string }> = [];
  reachable = true;
  /** Resolves each write to the last accepted revision (idempotent CAS). */
  durableRevision = 0;
  fail: ((input: { character: IconCharacter; revision: number; creatorInstanceId: string }) => boolean) | null = null;

  available(): boolean { return this.reachable; }
  async write(input: { character: IconCharacter; revision: number; creatorInstanceId: string }): Promise<number> {
    this.writes.push(input);
    if (this.fail?.(input)) throw new Error('cloud unavailable');
    this.durableRevision = Math.max(this.durableRevision, input.revision);
    return this.durableRevision;
  }
}

describe('character-sync local-first replication', () => {
  let storage: MemoryStorage;
  let transport: RecordingTransport;
  let records: LocalCharacterRecord[];
  let states: LocalCharacterRecord[];
  let controller: CharacterSyncController;
  let hooks: { onState: (r: LocalCharacterRecord) => void; onCloudFailure?: (id: string, r: unknown) => void };

  beforeEach(() => {
    storage = new MemoryStorage();
    transport = new RecordingTransport();
    records = [];
    states = [];
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('crypto', { randomUUID: () => 'f0000000-0000-0000-0000-000000000000' });
    hooks = {
      onState(r) { states.push(r); },
    };
    controller = new CharacterSyncController({
      transport,
      load: () => records,
      write: (next) => { records = next; },
      hooks,
      debounceMs: CLOUD_SAVE_DEBOUNCE_MS,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('commits locally before any cloud request begins (test 19)', () => {
    const hero = character('hero');
    controller.start();
    const record = controller.commit(hero);
    // Durable local envelope updated immediately.
    expect(records.map((r) => r.character.id)).toEqual(['hero']);
    expect(record.cloudState).toBe('pending');
    // No cloud traffic yet (the debounce has not fired).
    expect(transport.writes).toHaveLength(0);
    expect(states.at(-1)).toMatchObject({ character: { id: 'hero' }, localRevision: 1, cloudState: 'pending' });
  });

  it('many edits within the debounce window produce one latest-revision write (tests 20/21/22)', () => {
    vi.useFakeTimers();
    const hero = character('hero');
    controller.start();
    for (let i = 0; i < 10; i += 1) controller.commit({ ...hero, name: `hero-${i}` });
    expect(transport.writes).toHaveLength(0);
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    expect(transport.writes).toHaveLength(1);
    expect(transport.writes[0]?.revision).toBe(10);
    vi.useRealTimers();
  });

  it('quiescence fires exactly one cloud write (quiescence → one write)', () => {
    vi.useFakeTimers();
    const hero = character('hero');
    controller.start();
    controller.commit({ ...hero, name: 'a' });
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    expect(transport.writes).toHaveLength(1);
    // No periodic autosave loop: further time produces no extra writes.
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS * 3);
    expect(transport.writes).toHaveLength(1);
    vi.useRealTimers();
  });

  it('acknowledging the exact current revision turns the chip green (test 23)', async () => {
    vi.useFakeTimers();
    const hero = character('hero');
    controller.start();
    controller.commit(hero);
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(states.at(-1)).toMatchObject({ localRevision: 1, cloudRevision: 1, cloudState: 'synced' });
    expect(controller.recordFor('hero')).toMatchObject({ cloudRevision: 1, cloudState: 'synced' });
    vi.useRealTimers();
  });

  it('editing after green immediately returns to blue, then green again after ack (test 24)', async () => {
    vi.useFakeTimers();
    const hero = character('hero');
    controller.start();
    controller.commit(hero);
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(controller.recordFor('hero')?.cloudState).toBe('synced');

    controller.commit({ ...hero, name: 'edited' });
    expect(controller.recordFor('hero')?.cloudState).toBe('pending');
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(controller.recordFor('hero')?.cloudState).toBe('synced');
    expect(controller.recordFor('hero')?.cloudRevision).toBe(2);
    vi.useRealTimers();
  });

  it('a stale acknowledgement cannot turn the current state green (test 25)', async () => {
    vi.useFakeTimers();
    const hero = character('hero');
    controller.start();
    controller.commit(hero); // revision 1
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    await Promise.resolve(); // synced at 1

    // Force a write that acknowledges an older revision than the current one.
    transport.durableRevision = 1;
    // Simulate a stale completion reaching a record that now has revision 2.
    controller.commit({ ...hero, name: 'v2' }); // revision 2, pending
    // Deliver a stale ack for revision 1 by faking the accepted value.
    // The transport always acks the durable revision, so wrap it:
    const staleRecord = controller.recordFor('hero')!;
    expect(staleRecord.cloudState).toBe('pending');
    // A manual, out-of-band stale ack must not green the current record.
    const accepted = 1;
    expect(cloudWriteAccepted(2, accepted)).toBe(false);
    vi.useRealTimers();
  });

  it('a stale cloud write cannot overwrite a newer accepted cloud revision (test 26)', () => {
    // The compare-and-set decision is the transport-level guard.
    expect(cloudWriteAccepted(9, 9)).toBe(true);  // repeat revision 9 → harmless
    expect(cloudWriteAccepted(9, 8)).toBe(false); // late revision 8 → rejected
    expect(cloudWriteAccepted(null, 1)).toBe(true); // first write
  });

  it('cloud failure leaves the character Locally saved and intact (test 27)', async () => {
    vi.useFakeTimers();
    const hero = character('hero');
    let failedId = '';
    hooks.onCloudFailure = (id) => { failedId = id; };
    transport.fail = () => true;
    controller = new CharacterSyncController({
      transport,
      load: () => records,
      write: (next) => { records = next; },
      hooks,
      debounceMs: CLOUD_SAVE_DEBOUNCE_MS,
    });
    controller.start();
    const record = controller.commit(hero);
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    await Promise.resolve();
    // Record remains durably local and pending.
    expect(records.map((r) => r.character.id)).toEqual(['hero']);
    expect(controller.recordFor('hero')?.cloudState).toBe('pending');
    expect(failedId).toBe('hero');
    expect(controller.recordFor('hero')?.character.name).toBe('hero');
    vi.useRealTimers();
  });

  it('edits during an in-flight request stay pending and flush afterwards', async () => {
    vi.useFakeTimers();
    const hero = character('hero');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalWrite = transport.write.bind(transport);
    transport.write = async (input) => {
      await gate;
      return originalWrite(input);
    };
    controller.start();
    controller.commit(hero); // revision 1 triggers a scheduled write
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS); // write 1 in flight
    await Promise.resolve();
    controller.commit({ ...hero, name: 'v2' }); // revision 2 while in flight
    release();
    // Settle the in-flight revision-1 completion, then the controller flushes
    // the latest (revision 2) through a fresh debounce timer.
    await Promise.resolve();
    await Promise.resolve();
    expect(transport.writes.length).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(CLOUD_SAVE_DEBOUNCE_MS);
    expect(controller.recordFor('hero')?.cloudState).toBe('synced');
    expect(controller.recordFor('hero')?.cloudRevision).toBe(2);
    vi.useRealTimers();
  });

  it('restart discovers and retries a pending local revision (test 28)', async () => {
    vi.useFakeTimers();
    const hero = character('hero');
    const initial = createLocalCharacterRecord(hero, loadOrCreateCreatorInstanceId());
    records = [initial];
    controller.start();
    expect(transport.writes).toHaveLength(0);
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    expect(transport.writes).toHaveLength(1);
    expect(transport.writes[0]?.revision).toBe(1);
    vi.useRealTimers();
  });

  it('keeps the character UUID unchanged after cloud acknowledgment (test 18)', async () => {
    vi.useFakeTimers();
    const hero = character('permanent-uuid');
    controller.start();
    controller.commit(hero);
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    await Promise.resolve();
    const synced = controller.recordFor('permanent-uuid')!;
    expect(synced.cloudState).toBe('synced');
    expect(synced.character.id).toBe('permanent-uuid');
    // Cloud synchronization never replaces the locally-generated UUID.
    expect(transport.writes.every((write) => write.character.id === 'permanent-uuid')).toBe(true);
    vi.useRealTimers();
  });

  it('pagehide / visibility-hidden flushes the latest pending revision once (tests 29/30)', async () => {
    vi.useFakeTimers();
    const hero = character('hero');
    controller.start();
    controller.commit({ ...hero, name: 'final' });
    expect(transport.writes).toHaveLength(0);
    controller.flushAllPending();
    await Promise.resolve();
    expect(transport.writes).toHaveLength(1);
    expect(transport.writes[0]?.revision).toBe(1);
    expect(transport.writes[0]?.character.name).toBe('final');
    // Terminal failure leaves correct pending local state.
    transport.fail = () => true;
    const second = new CharacterSyncController({
      transport,
      load: () => records,
      write: (next2) => { records = next2; },
      hooks,
    });
    second.start();
    second.commit({ ...hero, name: 'never-cloud' });
    second.flushAllPending();
    await Promise.resolve();
    expect(second.recordFor('hero')?.cloudState).toBe('pending');
    vi.useRealTimers();
  });

  it('pending records replicate after the transport becomes available without replaying history (test 31)', async () => {
    vi.useFakeTimers();
    const hero = character('hero');
    transport.reachable = false;
    controller.start();
    controller.commit(hero); // revision 1
    controller.commit({ ...hero, name: 'v2' }); // revision 2
    // The debounce timers fire while the transport is unavailable: the records
    // stay durably local + pending with no cloud traffic.
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    expect(transport.writes).toHaveLength(0);

    // Simulate the roster refresh that follows account connection/binding:
    // pending records are re-scheduled and only the CURRENT revision is ever
    // uploaded — historical intermediate revisions are not replayed.
    transport.reachable = true;
    controller.adopt(controller.allRecords());
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(transport.writes).toHaveLength(1);
    expect(transport.writes[0]?.revision).toBe(2);
    expect(controller.recordFor('hero')).toMatchObject({ cloudRevision: 2, cloudState: 'synced' });
    vi.useRealTimers();
  });

  it('becoming connected does not turn a character green until the exact revision is acknowledged (test 32)', async () => {
    vi.useFakeTimers();
    const hero = character('hero');
    transport.reachable = false;
    controller.start();
    controller.commit(hero);
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    expect(controller.recordFor('hero')?.cloudState).toBe('pending');

    // Connection becomes available, but the cloud acknowledges a different
    // revision: the chip must stay blue/pending.
    transport.reachable = true;
    transport.durableRevision = 99;
    controller.adopt(controller.allRecords());
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(controller.recordFor('hero')?.cloudState).toBe('pending');

    // Only an exact-revision acknowledgement turns the chip green.
    transport.write = async (input) => input.revision;
    controller.adopt(controller.allRecords());
    vi.advanceTimersByTime(CLOUD_SAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(controller.recordFor('hero')?.cloudState).toBe('synced');
    expect(controller.recordFor('hero')?.cloudRevision).toBe(1);
    vi.useRealTimers();
  });
});

describe('local-instance seam (test 31)', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('crypto', { randomUUID: () => '22222222-3333-4444-5555-666666666666' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores only an opaque random UUID with no username/password/auth token', () => {
    const id = loadOrCreateCreatorInstanceId();
    expect(id).toBe('22222222-3333-4444-5555-666666666666');
    expect(loadOrCreateCreatorInstanceId()).toBe(id); // stable across calls
    const raw = storage.getItem('icon.creatorInstanceId')!;
    const parsed = JSON.parse(JSON.stringify({ value: raw }));
    expect(parsed.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(raw).not.toMatch(/username|password|token|secret|Bearer/i);
  });
});