import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VttCheckpointRuntime,
  type VttCheckpoint,
  type VttCheckpointPolicy,
  type VttCheckpointStore,
} from '../checkpoints.js';

interface TestRoomState {
  roomRevision: number;
  encounterRevision: number;
  marker: number;
}

interface PendingWrite {
  resolve: () => void;
  reject: (error: unknown) => void;
}

class DeferredCheckpointStore implements VttCheckpointStore<TestRoomState> {
  readonly writes: VttCheckpoint<TestRoomState>[] = [];
  private readonly pending: PendingWrite[] = [];

  write(checkpoint: VttCheckpoint<TestRoomState>): Promise<void> {
    this.writes.push(checkpoint);
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  succeedNext(): void {
    const pending = this.pending.shift();
    if (!pending) throw new Error('No checkpoint write is pending.');
    pending.resolve();
  }

  failNext(error = new Error('checkpoint backend unavailable')): void {
    const pending = this.pending.shift();
    if (!pending) throw new Error('No checkpoint write is pending.');
    pending.reject(error);
  }
}

const testPolicy: VttCheckpointPolicy = {
  quietDebounceMs: 2_000,
  maxDirtyAgeMs: 10_000,
  operationCount: 25,
  retryInitialMs: 100,
  retryMaxMs: 1_000,
  retryBackoffMultiplier: 2,
  writeTimeoutMs: 500,
};

function makeHarness(
  store: DeferredCheckpointStore,
  policy: Partial<VttCheckpointPolicy> = {},
  initialRevision = 0,
) {
  let live: TestRoomState = {
    roomRevision: initialRevision,
    encounterRevision: initialRevision,
    marker: initialRevision,
  };
  const runtime = new VttCheckpointRuntime<TestRoomState>({
    roomId: 'room-test',
    store,
    snapshotProvider: {
      // The real room service must return a true immutable snapshot as well.
      snapshot: () => ({
        roomRevision: live.roomRevision,
        encounterRevision: live.encounterRevision,
        schemaVersion: 1,
        state: { ...live },
      }),
    },
    initialCheckpoint: initialRevision > 0
      ? { roomRevision: initialRevision, encounterRevision: initialRevision, checkpointedAt: Date.now() }
      : undefined,
    policy: { ...testPolicy, ...policy },
  });

  return {
    runtime,
    advance() {
      live = {
        roomRevision: live.roomRevision + 1,
        encounterRevision: live.encounterRevision + 1,
        marker: live.marker + 1,
      };
      runtime.markDurableOperation();
    },
    get live() {
      return live;
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('VttCheckpointRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes after the configured quiet debounce, not before it', async () => {
    const store = new DeferredCheckpointStore();
    const { runtime, advance } = makeHarness(store);

    advance();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(store.writes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({ roomRevision: 1, encounterRevision: 1, reason: 'quiet' });
    expect(runtime.getState()).toMatchObject({ durability: 'unsaved', checkpointInFlight: true });

    store.succeedNext();
    await flushPromises();
    expect(runtime.getState()).toMatchObject({
      persistedRoomRevision: 1,
      durableOperationsSinceCheckpoint: 0,
      durability: 'saved',
    });
  });

  it('coalesces a burst of durable operations into one quiet checkpoint', async () => {
    const store = new DeferredCheckpointStore();
    const { runtime, advance } = makeHarness(store);

    for (let index = 0; index < 10; index += 1) {
      advance();
      if (index < 9) await vi.advanceTimersByTimeAsync(100);
    }
    expect(store.writes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(store.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({
      roomRevision: 10,
      reason: 'quiet',
      state: { marker: 10 },
    });

    store.succeedNext();
    await flushPromises();
    expect(runtime.getState().durability).toBe('saved');
  });

  it('uses maximum dirty age even when frequent operations prevent quiet debounce', async () => {
    const store = new DeferredCheckpointStore();
    const { runtime, advance } = makeHarness(store);

    advance();
    for (let index = 0; index < 9; index += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      advance();
    }
    expect(store.writes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({ roomRevision: 10, reason: 'max-dirty-age' });

    store.succeedNext();
    await flushPromises();
    expect(runtime.getState().durability).toBe('saved');
  });

  it('writes immediately at the operation-count breakpoint', async () => {
    const store = new DeferredCheckpointStore();
    const { runtime, advance } = makeHarness(store, { operationCount: 3 });

    advance();
    advance();
    expect(store.writes).toHaveLength(0);
    advance();

    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({ roomRevision: 3, reason: 'operation-count' });
    expect(runtime.getState().checkpointInFlight).toBe(true);
    store.succeedNext();
    await flushPromises();
    expect(runtime.getState().durableOperationsSinceCheckpoint).toBe(0);
  });

  it('keeps later state dirty and schedules a follow-up save when state changes during a write', async () => {
    const store = new DeferredCheckpointStore();
    const { runtime, advance } = makeHarness(store, {}, 19);

    advance(); // revision 20
    runtime.requestCheckpoint('semantic');
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({ roomRevision: 20, reason: 'semantic', state: { marker: 20 } });

    advance();
    advance();
    advance();
    advance(); // revision 24 while revision 20 persists
    expect(store.writes).toHaveLength(1);
    expect(runtime.getState()).toMatchObject({ checkpointInFlight: true, checkpointRequested: true });

    store.succeedNext();
    await flushPromises();
    expect(runtime.getState()).toMatchObject({
      persistedRoomRevision: 20,
      durableOperationsSinceCheckpoint: 4,
      durability: 'unsaved',
    });
    expect(store.writes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.writes).toHaveLength(2);
    expect(store.writes[1]).toMatchObject({ roomRevision: 24, reason: 'quiet', state: { marker: 24 } });

    store.succeedNext();
    await flushPromises();
    expect(runtime.getState()).toMatchObject({ persistedRoomRevision: 24, durability: 'saved' });
  });

  it('retains live state after failures and retries with bounded exponential backoff', async () => {
    const store = new DeferredCheckpointStore();
    const harness = makeHarness(store, { operationCount: 1, retryInitialMs: 100, retryMaxMs: 250 });
    const { runtime, advance } = harness;

    advance();
    const firstError = new Error('database outage');
    store.failNext(firstError);
    await flushPromises();
    expect(runtime.getState()).toMatchObject({
      persistedRoomRevision: 0,
      consecutiveFailures: 1,
      durability: 'save-error',
      lastError: firstError,
    });
    expect(harness.live.roomRevision).toBe(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(store.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.writes).toHaveLength(2);
    expect(store.writes[1].reason).toBe('retry');

    store.failNext(new Error('still unavailable'));
    await flushPromises();
    expect(runtime.getState().consecutiveFailures).toBe(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(store.writes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.writes).toHaveLength(3);

    store.succeedNext();
    await flushPromises();
    expect(runtime.getState()).toMatchObject({
      persistedRoomRevision: 1,
      consecutiveFailures: 0,
      lastError: null,
      durability: 'saved',
    });
  });

  it('times out a hung write, ignores its late completion, and retries current authority', async () => {
    const store = new DeferredCheckpointStore();
    const { runtime, advance } = makeHarness(store, { operationCount: 1, writeTimeoutMs: 250, retryInitialMs: 100 });

    advance();
    expect(store.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(runtime.getState()).toMatchObject({ checkpointInFlight: false, durability: 'save-error', consecutiveFailures: 1 });

    await vi.advanceTimersByTimeAsync(100);
    expect(store.writes).toHaveLength(2);
    // The original RPC can resolve after its timeout; it must not acknowledge
    // or clear the newer retry that now owns the checkpoint flight.
    store.succeedNext();
    await flushPromises();
    expect(runtime.getState().checkpointInFlight).toBe(true);
    store.succeedNext();
    await flushPromises();
    expect(runtime.getState()).toMatchObject({ persistedRoomRevision: 1, durability: 'saved', checkpointInFlight: false });
  });

  it('makes explicit hard save wait for store acknowledgement rather than merely starting a write', async () => {
    const store = new DeferredCheckpointStore();
    const { runtime, advance } = makeHarness(store);

    advance();
    const hardSave = runtime.hardSave();
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({ roomRevision: 1, reason: 'hard-save' });

    let acknowledged = false;
    void hardSave.then(() => { acknowledged = true; });
    await flushPromises();
    expect(acknowledged).toBe(false);

    store.succeedNext();
    await expect(hardSave).resolves.toMatchObject({ roomRevision: 1, reason: 'hard-save' });
    expect(acknowledged).toBe(true);
    expect(runtime.getState().durability).toBe('saved');
  });

  it('persists an uncheckpointed revision-zero room before acknowledging its first hard save', async () => {
    const store = new DeferredCheckpointStore();
    const { runtime } = makeHarness(store);

    const hardSave = runtime.hardSave();
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({ roomRevision: 0, encounterRevision: 0, reason: 'hard-save', state: { marker: 0 } });
    expect(runtime.getState()).toMatchObject({ durability: 'unsaved', checkpointInFlight: true });

    store.succeedNext();
    await expect(hardSave).resolves.toMatchObject({ roomRevision: 0, reason: 'hard-save' });
    expect(runtime.getState().durability).toBe('saved');
  });

  it('holds an eviction barrier until the latest dirty state is acknowledged', async () => {
    const store = new DeferredCheckpointStore();
    const { runtime, advance } = makeHarness(store);

    advance();
    const eviction = runtime.checkpointBeforeEviction();
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({ roomRevision: 1, reason: 'eviction' });
    expect(runtime.canEvict()).toBe(false);

    advance(); // State changes while the eviction checkpoint is pending.
    expect(store.writes).toHaveLength(1);
    store.succeedNext();
    await flushPromises();
    expect(store.writes).toHaveLength(2);
    expect(store.writes[1]).toMatchObject({ roomRevision: 2, reason: 'eviction' });
    expect(runtime.canEvict()).toBe(false);

    store.succeedNext();
    await eviction;
    expect(runtime.canEvict()).toBe(true);
    expect(runtime.getState()).toMatchObject({ persistedRoomRevision: 2, evictionPending: false, durability: 'saved' });
  });
});
