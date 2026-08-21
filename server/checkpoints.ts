/**
 * Checkpoint scheduling for an authoritative VTT room.
 *
 * This module deliberately has no knowledge of WebSockets, Supabase, or the
 * encounter reducer. A room service supplies an immutable snapshot whenever a
 * checkpoint is started and records each accepted durable operation with
 * `markDurableOperation()`.
 */

export type VttCheckpointReason =
  | 'quiet'
  | 'max-dirty-age'
  | 'operation-count'
  | 'semantic'
  | 'encounter-start'
  | 'round-transition'
  | 'encounter-end'
  /** A validated historical checkpoint was rebased above a corrupt head. */
  | 'recovery'
  | 'hard-save'
  | 'eviction'
  | 'retry';

/** A complete, immutable representation of the live room at one revision. */
export interface VttCheckpointSnapshot<State> {
  roomRevision: number;
  encounterRevision: number;
  schemaVersion: number;
  state: State;
}

/**
 * A durable checkpoint. `state` must be a real snapshot, not a reference to
 * mutable room state that can change while the store write is in flight.
 */
export interface VttCheckpoint<State> extends VttCheckpointSnapshot<State> {
  roomId: string;
  reason: VttCheckpointReason;
  createdAt: string;
}

/**
 * Persistence boundary used by the runtime. A Supabase implementation will
 * normally append a checkpoint row and atomically advance the encounter's
 * durable revision as part of `write`.
 */
export interface VttCheckpointStore<State> {
  write(checkpoint: VttCheckpoint<State>): Promise<void>;
}

/** Provides the current immutable room snapshot and its monotonic revisions. */
export interface VttCheckpointSnapshotProvider<State> {
  snapshot(): VttCheckpointSnapshot<State>;
}

/** Injectable clock/timer adapter for deterministic tests and alternate hosts. */
export interface VttCheckpointClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemVttCheckpointClock: VttCheckpointClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface VttCheckpointCursor {
  roomRevision: number;
  encounterRevision: number;
  /** Unix milliseconds. Omit when the prior checkpoint's completion time is unknown. */
  checkpointedAt?: number;
}

export interface VttCheckpointPolicy {
  /** Debounce duration after the most recent durable operation. Default: 2s. */
  quietDebounceMs: number;
  /** Longest ordinary interval a dirty room may go without a checkpoint. Default: 10s. */
  maxDirtyAgeMs: number;
  /** Number of accepted durable operations before an immediate checkpoint. Default: 25. */
  operationCount: number;
  /** Delay after the first failed write. Subsequent delays use exponential backoff. */
  retryInitialMs: number;
  /** Upper bound for persistence retry delay. */
  retryMaxMs: number;
  /** Exponential backoff multiplier. */
  retryBackoffMultiplier: number;
  /** Bound a hung persistence RPC so retry and eviction liveness survive. */
  writeTimeoutMs: number;
}

export const DEFAULT_VTT_CHECKPOINT_POLICY: Readonly<VttCheckpointPolicy> = {
  quietDebounceMs: 2_000,
  maxDirtyAgeMs: 10_000,
  operationCount: 25,
  retryInitialMs: 1_000,
  retryMaxMs: 30_000,
  retryBackoffMultiplier: 2,
  writeTimeoutMs: 15_000,
};

/** User-facing durability state; `checkpointInFlight` supplies finer detail. */
export type VttCheckpointDurability = 'saved' | 'unsaved' | 'save-error';

/** Public persistence metadata. It is intentionally kept outside gameplay state. */
export interface VttCheckpointRuntimeState {
  roomId: string;
  /** The latest room revision acknowledged by the checkpoint store. */
  persistedRoomRevision: number;
  /** Alias for `persistedRoomRevision`, matching the room-runtime vocabulary. */
  lastCheckpointRevision: number;
  persistedEncounterRevision: number;
  lastCheckpointAt: number | null;
  dirtySince: number | null;
  lastDurableOperationAt: number | null;
  durableOperationsSinceCheckpoint: number;
  checkpointInFlight: boolean;
  checkpointRequested: boolean;
  pendingReason: VttCheckpointReason | null;
  retryAt: number | null;
  consecutiveFailures: number;
  lastError: unknown | null;
  durability: VttCheckpointDurability;
  evictionPending: boolean;
}

export interface VttCheckpointRuntimeOptions<State> {
  roomId: string;
  store: VttCheckpointStore<State>;
  snapshotProvider: VttCheckpointSnapshotProvider<State>;
  /**
   * The known durable cursor when hydrating a room. Supplying this prevents a
   * hydrated checkpoint from being treated as unsaved live work.
   */
  initialCheckpoint?: VttCheckpointCursor;
  policy?: Partial<VttCheckpointPolicy>;
  clock?: VttCheckpointClock;
  /** Called after runtime metadata changes; callback failures cannot stop saves. */
  onStateChange?: (state: VttCheckpointRuntimeState) => void;
}

interface InFlightCheckpoint<State> {
  checkpoint: VttCheckpoint<State>;
  operationSequence: number;
  firstOperationAfterSnapshotAt: number | null;
  writeTimeout: unknown | null;
}

interface HardSaveWaiter<State> {
  targetRoomRevision: number;
  resolve: (checkpoint: VttCheckpoint<State> | null) => void;
  reject: (error: Error) => void;
}

interface EvictionWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * A single-room checkpoint runtime.
 *
 * Calling `markDurableOperation()` is part of the room-service contract: call
 * it after an accepted command has advanced the authoritative room revision.
 * Ephemeral messages must never call it. The source's `snapshot()` result must
 * contain an immutable state copy and a monotonic room revision.
 */
export class VttCheckpointRuntime<State> {
  private readonly clock: VttCheckpointClock;
  private readonly policy: VttCheckpointPolicy;
  private readonly hardSaveWaiters: HardSaveWaiter<State>[] = [];
  private readonly evictionWaiters: EvictionWaiter[] = [];

  private persistedRoomRevision: number;
  private persistedEncounterRevision: number;
  private lastCheckpointAt: number | null;
  private dirtySince: number | null = null;
  private lastDurableOperationAt: number | null = null;
  private operationSequence = 0;
  private persistedOperationSequence = 0;
  private checkpointInFlight: InFlightCheckpoint<State> | null = null;
  private checkpointRequested = false;
  private pendingReason: VttCheckpointReason | null = null;
  private ordinaryTimer: unknown | null = null;
  private retryTimer: unknown | null = null;
  private retryAt: number | null = null;
  private consecutiveFailures = 0;
  private lastError: unknown | null = null;
  private lastCheckpoint: VttCheckpoint<State> | null = null;
  /** A cursor can prove a hydrated checkpoint even when its full row was not retained in memory. */
  private hasAcknowledgedCheckpoint: boolean;
  private disposed = false;

  constructor(private readonly options: VttCheckpointRuntimeOptions<State>) {
    this.clock = options.clock ?? systemVttCheckpointClock;
    this.policy = { ...DEFAULT_VTT_CHECKPOINT_POLICY, ...options.policy };
    validatePolicy(this.policy);
    this.persistedRoomRevision = options.initialCheckpoint?.roomRevision ?? 0;
    this.persistedEncounterRevision = options.initialCheckpoint?.encounterRevision ?? 0;
    this.lastCheckpointAt = options.initialCheckpoint?.checkpointedAt ?? null;
    this.hasAcknowledgedCheckpoint = options.initialCheckpoint !== undefined;
  }

  /** A snapshot of persistence metadata suitable for a GM save-status indicator. */
  getState(): VttCheckpointRuntimeState {
    const dirty = this.isDirty();
    return {
      roomId: this.options.roomId,
      persistedRoomRevision: this.persistedRoomRevision,
      lastCheckpointRevision: this.persistedRoomRevision,
      persistedEncounterRevision: this.persistedEncounterRevision,
      lastCheckpointAt: this.lastCheckpointAt,
      dirtySince: this.dirtySince,
      lastDurableOperationAt: this.lastDurableOperationAt,
      durableOperationsSinceCheckpoint: Math.max(0, this.operationSequence - this.persistedOperationSequence),
      checkpointInFlight: this.checkpointInFlight !== null,
      checkpointRequested: this.checkpointRequested,
      pendingReason: this.pendingReason,
      retryAt: this.retryAt,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      durability: this.getDurability(dirty),
      evictionPending: this.evictionWaiters.length > 0,
    };
  }

  /**
   * Record one accepted durable room operation. This starts/resets quiet
   * debounce and can trigger max-age or operation-count checkpoints.
   */
  markDurableOperation(): void {
    this.assertActive();
    const now = this.clock.now();
    this.operationSequence += 1;
    this.markDirtyAt(now);
    this.lastDurableOperationAt = now;
    if (this.checkpointInFlight !== null && this.checkpointInFlight.firstOperationAfterSnapshotAt === null) {
      this.checkpointInFlight.firstOperationAfterSnapshotAt = now;
    }
    this.observeCurrentSnapshot(now);

    if (this.evictionWaiters.length > 0) {
      this.requestImmediateCheckpoint('eviction');
    } else {
      this.evaluateSchedule();
    }
    this.publish();
  }

  /** A concise alias for integrations that already use "dirty" terminology. */
  markDirty(): void {
    this.markDurableOperation();
  }

  /**
   * Ask for a non-blocking semantic checkpoint. It is a no-op when no durable
   * change is outstanding; use `hardSave` when acknowledgement is required.
   */
  requestCheckpoint(reason: VttCheckpointReason = 'semantic'): boolean {
    this.assertActive();
    this.observeCurrentSnapshot(this.clock.now());
    if (!this.isDirty()) {
      this.publish();
      return false;
    }
    this.requestImmediateCheckpoint(reason);
    return true;
  }

  /**
   * Create a hard durability barrier. The returned promise resolves only once
   * the room revision that was live at call time is acknowledged by the store.
   * Temporary store failures leave the promise pending while retry/backoff
   * continues; they never roll back live room state.
   */
  hardSave(): Promise<VttCheckpoint<State> | null> {
    this.assertActive();
    const now = this.clock.now();
    const observed = this.observeCurrentSnapshot(now);
    // A brand-new room has revision 0, but revision 0 is not evidence that a
    // complete room snapshot ever reached durable storage. An explicit Save
    // must create that first checkpoint before the caller is told it finished.
    if (!this.hasAcknowledgedCheckpoint && !this.isDirty()) {
      this.markDirtyAt(now);
      this.lastDurableOperationAt = now;
    }
    const targetRoomRevision = observed?.roomRevision
      ?? (this.isDirty() ? this.persistedRoomRevision + 1 : this.persistedRoomRevision);
    if (!this.isDirty() && targetRoomRevision <= this.persistedRoomRevision) {
      return Promise.resolve(this.lastCheckpoint);
    }

    return new Promise<VttCheckpoint<State> | null>((resolve, reject) => {
      this.hardSaveWaiters.push({ targetRoomRevision, resolve, reject });
      this.requestImmediateCheckpoint('hard-save');
    });
  }

  /**
   * Hard barrier used before a room may be removed from memory. It resolves
   * only after all changes known to this runtime are durable. If new durable
   * operations arrive while a save is in flight, another save is performed
   * before eviction is permitted.
   */
  checkpointBeforeEviction(): Promise<void> {
    this.assertActive();
    const now = this.clock.now();
    this.observeCurrentSnapshot(now);
    // The final client leaving a never-checkpointed room is also a durability
    // boundary. Persist its revision-zero snapshot rather than silently
    // claiming that a reconstructible default was an acknowledged save point.
    if (!this.hasAcknowledgedCheckpoint && !this.isDirty()) {
      this.markDirtyAt(now);
      this.lastDurableOperationAt = now;
    }
    if (!this.isDirty()) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      this.evictionWaiters.push({ resolve, reject });
      this.requestImmediateCheckpoint('eviction');
    });
  }

  /** True only when this runtime has no known outstanding durable state. */
  canEvict(): boolean {
    return !this.isDirty() && this.checkpointInFlight === null && this.evictionWaiters.length === 0;
  }

  /** Cancel timers and reject barriers when the owning room is being abandoned. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearOrdinaryTimer();
    this.clearRetryTimer();
    if (this.checkpointInFlight?.writeTimeout !== null && this.checkpointInFlight?.writeTimeout !== undefined) {
      this.clock.clearTimeout(this.checkpointInFlight.writeTimeout);
    }
    const error = new Error('Checkpoint runtime was disposed before durability was confirmed.');
    for (const waiter of this.hardSaveWaiters.splice(0)) waiter.reject(error);
    for (const waiter of this.evictionWaiters.splice(0)) waiter.reject(error);
  }

  private isDirty(): boolean {
    return this.dirtySince !== null;
  }

  private getDurability(dirty: boolean): VttCheckpointDurability {
    if (this.lastError !== null) return 'save-error';
    return dirty || !this.hasAcknowledgedCheckpoint ? 'unsaved' : 'saved';
  }

  private markDirtyAt(now: number): void {
    if (this.dirtySince === null) this.dirtySince = now;
  }

  /**
   * Observe revisions when a caller already needs current room state. An
   * integration that always calls `markDurableOperation` does not need to do
   * anything else. This extra observation keeps hard barriers conservative.
   */
  private observeCurrentSnapshot(now: number): VttCheckpointSnapshot<State> | null {
    let snapshot: VttCheckpointSnapshot<State>;
    try {
      snapshot = this.options.snapshotProvider.snapshot();
    } catch {
      // A durable command must not be reported as failed merely because an
      // optional observation could not be taken. The next scheduled write will
      // turn a repeated snapshot failure into a retried save error.
      return null;
    }
    if (snapshot.roomRevision > this.persistedRoomRevision) this.markDirtyAt(now);
    return snapshot;
  }

  private evaluateSchedule(): void {
    if (this.disposed || !this.isDirty()) {
      this.clearOrdinaryTimer();
      return;
    }
    if (this.checkpointInFlight !== null) {
      this.checkpointRequested = true;
      return;
    }
    if (this.retryTimer !== null) return;

    if (this.pendingReason !== null) {
      const reason = this.takePendingReason();
      if (reason !== null) this.startCheckpoint(reason);
      return;
    }

    const now = this.clock.now();
    const operationCount = this.operationSequence - this.persistedOperationSequence;
    if (operationCount >= this.policy.operationCount) {
      this.startCheckpoint('operation-count');
      return;
    }

    const lastOperationAt = this.lastDurableOperationAt ?? this.dirtySince ?? now;
    const quietAt = lastOperationAt + this.policy.quietDebounceMs;
    const maxAgeAt = (this.dirtySince ?? now) + this.policy.maxDirtyAgeMs;
    if (now >= maxAgeAt) {
      this.startCheckpoint('max-dirty-age');
      return;
    }
    if (now >= quietAt) {
      this.startCheckpoint('quiet');
      return;
    }
    this.scheduleOrdinaryCheck(Math.min(quietAt, maxAgeAt));
  }

  private requestImmediateCheckpoint(reason: VttCheckpointReason): void {
    if (this.disposed || !this.isDirty()) return;
    this.pendingReason = chooseHigherPriorityReason(this.pendingReason, reason);
    this.checkpointRequested = true;
    this.clearOrdinaryTimer();
    if (this.checkpointInFlight !== null || this.retryTimer !== null) {
      this.publish();
      return;
    }
    const pendingReason = this.takePendingReason();
    this.startCheckpoint(pendingReason ?? reason);
  }

  private scheduleOrdinaryCheck(dueAt: number): void {
    this.clearOrdinaryTimer();
    const delay = Math.max(0, dueAt - this.clock.now());
    this.ordinaryTimer = this.clock.setTimeout(() => {
      this.ordinaryTimer = null;
      this.evaluateSchedule();
      this.publish();
    }, delay);
  }

  private startCheckpoint(reason: VttCheckpointReason): void {
    if (this.disposed || this.checkpointInFlight !== null || this.retryTimer !== null || !this.isDirty()) return;
    this.clearOrdinaryTimer();

    let snapshot: VttCheckpointSnapshot<State>;
    try {
      snapshot = this.options.snapshotProvider.snapshot();
    } catch (error) {
      this.handleFailure(error);
      return;
    }

    const checkpoint: VttCheckpoint<State> = {
      ...snapshot,
      roomId: this.options.roomId,
      reason,
      createdAt: new Date(this.clock.now()).toISOString(),
    };
    const inFlight: InFlightCheckpoint<State> = {
      checkpoint,
      operationSequence: this.operationSequence,
      firstOperationAfterSnapshotAt: null,
      writeTimeout: null,
    };
    this.checkpointInFlight = inFlight;
    this.checkpointRequested = false;
    this.publish();

    let write: Promise<void>;
    try {
      write = this.options.store.write(checkpoint);
    } catch (error) {
      this.handleFailure(error);
      return;
    }
    inFlight.writeTimeout = this.clock.setTimeout(() => {
      inFlight.writeTimeout = null;
      this.handleFailure(new Error(`Checkpoint write timed out after ${this.policy.writeTimeoutMs}ms.`), inFlight);
    }, this.policy.writeTimeoutMs);
    void write.then(
      () => this.handleSuccess(inFlight),
      (error: unknown) => this.handleFailure(error, inFlight),
    );
  }

  private handleSuccess(inFlight: InFlightCheckpoint<State>): void {
    if (this.disposed || this.checkpointInFlight !== inFlight) return;
    this.clearWriteTimeout(inFlight);
    this.checkpointInFlight = null;
    const checkpoint = inFlight.checkpoint;
    if (checkpoint.roomRevision >= this.persistedRoomRevision) {
      this.persistedRoomRevision = checkpoint.roomRevision;
      this.persistedEncounterRevision = checkpoint.encounterRevision;
      this.lastCheckpoint = checkpoint;
    }
    this.hasAcknowledgedCheckpoint = true;
    this.persistedOperationSequence = Math.max(this.persistedOperationSequence, inFlight.operationSequence);
    this.lastCheckpointAt = this.clock.now();
    this.consecutiveFailures = 0;
    this.lastError = null;
    this.retryAt = null;

    let liveSnapshot: VttCheckpointSnapshot<State> | null = null;
    try {
      liveSnapshot = this.options.snapshotProvider.snapshot();
    } catch (error) {
      // We have safely persisted the captured revision, but cannot establish
      // whether newer live state exists. Keep the room dirty and retry.
      this.lastError = error;
      this.consecutiveFailures = 1;
      this.markDirtyAt(this.clock.now());
      this.scheduleRetry();
      this.publish();
      return;
    }

    const currentStateIsDurable =
      liveSnapshot.roomRevision <= this.persistedRoomRevision
      && this.operationSequence <= this.persistedOperationSequence;
    if (currentStateIsDurable) {
      this.dirtySince = null;
      this.lastDurableOperationAt = null;
      this.checkpointRequested = false;
      this.pendingReason = null;
      this.clearOrdinaryTimer();
    } else {
      const hasRecordedOperationsAfterSnapshot = this.operationSequence > inFlight.operationSequence;
      if (hasRecordedOperationsAfterSnapshot) {
        this.dirtySince = inFlight.firstOperationAfterSnapshotAt ?? this.clock.now();
      } else {
        // The provider observed a newer revision even though it was not
        // reported through this runtime. Remain conservative and checkpoint it.
        this.dirtySince = this.clock.now();
        this.lastDurableOperationAt = this.clock.now();
      }
    }

    this.resolveHardSaveWaiters();
    this.resolveEvictionWaitersIfSafe();
    if (this.isDirty()) {
      if (this.evictionWaiters.length > 0) {
        this.pendingReason = chooseHigherPriorityReason(this.pendingReason, 'eviction');
      }
      this.evaluateSchedule();
    }
    this.publish();
  }

  private handleFailure(error: unknown, expectedInFlight?: InFlightCheckpoint<State>): void {
    if (this.disposed) return;
    if (expectedInFlight && this.checkpointInFlight !== expectedInFlight) return;
    if (this.checkpointInFlight) this.clearWriteTimeout(this.checkpointInFlight);
    this.checkpointInFlight = null;
    this.markDirtyAt(this.clock.now());
    this.lastError = error;
    this.consecutiveFailures += 1;
    this.checkpointRequested = true;
    this.clearOrdinaryTimer();
    this.scheduleRetry();
    this.publish();
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.disposed) return;
    const exponent = Math.max(0, this.consecutiveFailures - 1);
    const delay = Math.min(
      this.policy.retryMaxMs,
      this.policy.retryInitialMs * this.policy.retryBackoffMultiplier ** exponent,
    );
    this.retryAt = this.clock.now() + delay;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      this.retryAt = null;
      if (!this.isDirty() || this.disposed) return;
      const reason = this.takePendingReason() ?? 'retry';
      this.startCheckpoint(reason);
      this.publish();
    }, delay);
  }

  private resolveHardSaveWaiters(): void {
    if (this.hardSaveWaiters.length === 0) return;
    const checkpoint = this.lastCheckpoint;
    for (let index = this.hardSaveWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.hardSaveWaiters[index];
      if (this.persistedRoomRevision >= waiter.targetRoomRevision) {
        this.hardSaveWaiters.splice(index, 1);
        waiter.resolve(checkpoint);
      }
    }
  }

  private resolveEvictionWaitersIfSafe(): void {
    if (this.isDirty() || this.checkpointInFlight !== null) return;
    for (const waiter of this.evictionWaiters.splice(0)) waiter.resolve();
  }

  private takePendingReason(): VttCheckpointReason | null {
    const reason = this.pendingReason;
    this.pendingReason = null;
    return reason;
  }

  private clearOrdinaryTimer(): void {
    if (this.ordinaryTimer === null) return;
    this.clock.clearTimeout(this.ordinaryTimer);
    this.ordinaryTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) return;
    this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
  }

  private clearWriteTimeout(inFlight: InFlightCheckpoint<State>): void {
    if (inFlight.writeTimeout === null) return;
    this.clock.clearTimeout(inFlight.writeTimeout);
    inFlight.writeTimeout = null;
  }

  private publish(): void {
    try {
      this.options.onStateChange?.(this.getState());
    } catch {
      // Status reporting must never prevent the authoritative room from saving.
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Checkpoint runtime has been disposed.');
  }
}

function chooseHigherPriorityReason(
  current: VttCheckpointReason | null,
  next: VttCheckpointReason,
): VttCheckpointReason {
  if (current === null) return next;
  return checkpointReasonPriority(next) >= checkpointReasonPriority(current) ? next : current;
}

function checkpointReasonPriority(reason: VttCheckpointReason): number {
  switch (reason) {
    case 'eviction': return 6;
    case 'hard-save': return 5;
    case 'recovery': return 5;
    case 'encounter-start': return 4;
    case 'round-transition': return 4;
    case 'encounter-end': return 4;
    case 'semantic': return 4;
    case 'operation-count': return 3;
    case 'max-dirty-age': return 2;
    case 'quiet': return 1;
    case 'retry': return 0;
  }
}

function validatePolicy(policy: VttCheckpointPolicy): void {
  const positiveNumberKeys: Array<keyof Omit<VttCheckpointPolicy, 'operationCount'>> = [
    'quietDebounceMs',
    'maxDirtyAgeMs',
    'retryInitialMs',
    'retryMaxMs',
    'retryBackoffMultiplier',
    'writeTimeoutMs',
  ];
  for (const key of positiveNumberKeys) {
    if (!Number.isFinite(policy[key]) || policy[key] <= 0) {
      throw new Error(`Checkpoint policy ${key} must be a positive finite number.`);
    }
  }
  if (!Number.isInteger(policy.operationCount) || policy.operationCount < 1) {
    throw new Error('Checkpoint policy operationCount must be a positive integer.');
  }
  if (policy.retryBackoffMultiplier < 1) {
    throw new Error('Checkpoint policy retryBackoffMultiplier must be at least 1.');
  }
  if (policy.retryMaxMs < policy.retryInitialMs) {
    throw new Error('Checkpoint policy retryMaxMs must be at least retryInitialMs.');
  }
}

/** Factory form for consumers that prefer not to reference the class directly. */
export function createVttCheckpointRuntime<State>(
  options: VttCheckpointRuntimeOptions<State>,
): VttCheckpointRuntime<State> {
  return new VttCheckpointRuntime(options);
}
