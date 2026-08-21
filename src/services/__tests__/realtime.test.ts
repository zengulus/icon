import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeEncounterClient } from '../realtime.js';

type FakeEvent = { data?: unknown };

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('Socket is not open.');
    this.sent.push(data);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }

  message(data: unknown) {
    this.emit('message', { data });
  }

  closed() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  private emit(type: string, event: FakeEvent = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function restoreGlobalProperty(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete (globalThis as Record<string, unknown>)[name];
}

describe('RealtimeEncounterClient connection ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: FakeWebSocket });
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis });
  });

  afterEach(() => {
    restoreGlobalProperty('WebSocket', originalWebSocket);
    restoreGlobalProperty('window', originalWindow);
    vi.useRealTimers();
  });

  it('does not construct a websocket when disconnect wins the access-token race', async () => {
    const token = deferred<string>();
    const client = new RealtimeEncounterClient({
      url: 'ws://example.test/realtime',
      encounterId: 'race-room',
      accessToken: () => token.promise,
      onState: vi.fn(),
      onStatus: vi.fn(),
      onError: vi.fn(),
    });

    const connecting = client.connect();
    client.disconnect();
    token.resolve('token-after-disconnect');
    await connecting;

    expect(FakeWebSocket.instances).toEqual([]);
  });

  it('ignores stale socket events after a newer connection owns the client', async () => {
    const firstToken = deferred<string>();
    const secondToken = deferred<string>();
    const accessToken = vi.fn()
      .mockReturnValueOnce(firstToken.promise)
      .mockReturnValueOnce(secondToken.promise);
    const onState = vi.fn();
    const onJoined = vi.fn();
    const client = new RealtimeEncounterClient({
      url: 'ws://example.test/realtime',
      encounterId: 'race-room',
      accessToken,
      onState,
      onJoined,
      onStatus: vi.fn(),
      onError: vi.fn(),
    });

    const firstConnecting = client.connect();
    firstToken.resolve('first-token');
    await firstConnecting;
    const first = FakeWebSocket.instances[0]!;
    first.open();
    expect(first.sent.map((raw) => JSON.parse(raw))).toEqual([
      { type: 'join', encounterId: 'race-room', token: 'first-token' },
    ]);

    const secondConnecting = client.connect();
    secondToken.resolve('second-token');
    await secondConnecting;
    const second = FakeWebSocket.instances[1]!;
    second.open();
    expect(second.sent.map((raw) => JSON.parse(raw))).toEqual([
      { type: 'join', encounterId: 'race-room', token: 'second-token' },
    ]);

    // A queued open/message/close from the replaced socket must not send a
    // second join through the current socket, install stale state, or schedule
    // another retry.
    first.open();
    first.message(JSON.stringify({
      type: 'joined',
      encounterId: 'race-room',
      state: { revision: 99 },
      role: 'gm',
      saveStatus: 'saved',
    }));
    first.closed();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(second.sent.map((raw) => JSON.parse(raw))).toEqual([
      { type: 'join', encounterId: 'race-room', token: 'second-token' },
    ]);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(onState).not.toHaveBeenCalled();
    expect(onJoined).not.toHaveBeenCalled();

    client.disconnect();
  });

  it.each(['authentication.failed', 'authorization.revoked', 'phase.gated'] as const)('stops retrying after terminal server error %s', async (code) => {
    const accessToken = vi.fn().mockResolvedValue('valid-until-revoked');
    const onStatus = vi.fn();
    const onError = vi.fn();
    const client = new RealtimeEncounterClient({
      url: 'ws://example.test/realtime',
      encounterId: 'terminal-room',
      accessToken,
      onState: vi.fn(),
      onStatus,
      onError,
    });

    await client.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    socket.message(JSON.stringify({ type: 'error', code, message: 'Access is no longer valid.' }));

    expect(onError).toHaveBeenCalledWith('Access is no longer valid.');
    expect(onStatus).toHaveBeenLastCalledWith('closed');
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    // A deliberate reconnect after the application refreshes credentials is
    // still permitted; only automatic retry is suppressed.
    await client.connect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(accessToken).toHaveBeenCalledTimes(2);
    client.disconnect();
  });
});
