import type { EncounterCommand, Position } from '../rules/types.js';
import type { ClientMessage, ServerMessage } from '../rules/protocol.js';
import type { RoomCommand, TableCommand, VttRoomState } from '../rules/vtt-room.js';

interface RealtimeOptions {
  url: string;
  encounterId: string;
  accessToken(): Promise<string>;
  onState(state: VttRoomState): void;
  /** Server-derived role; never infer this from the browser's controls. */
  onJoined?(role: 'gm' | 'player'): void;
  onStatus(status: 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'save-error'): void;
  onError(message: string): void;
  onPing?(userId: string, position: Position): void;
  onSaveStatus?(status: 'saved' | 'unsaved' | 'save-error', revision: number): void;
}

export class RealtimeEncounterClient {
  private socket: WebSocket | null = null;
  private state: VttRoomState | null = null;
  private closed = false;
  private retry = 0;
  private retryTimer: number | null = null;
  /**
   * Every connection attempt owns a generation.  Access-token acquisition is
   * asynchronous, so event handlers must not let an older attempt mutate the
   * socket selected by a newer one.
   */
  private connectionGeneration = 0;

  constructor(private readonly options: RealtimeOptions) {}

  async connect() {
    const generation = ++this.connectionGeneration;
    this.closed = false;
    this.clearRetryTimer();

    // A caller can explicitly reconnect while a previous socket is still
    // alive.  Invalidate it before closing so its close event cannot schedule
    // a retry for this newer connection.
    const previousSocket = this.socket;
    this.socket = null;
    previousSocket?.close(1000, 'Replacing realtime connection.');

    this.options.onStatus(this.retry ? 'reconnecting' : 'connecting');
    const token = await this.options.accessToken();

    // `disconnect()` or a later `connect()` can happen while awaiting the
    // access token.  Do not construct a ghost websocket in that case.
    if (!this.isCurrentGeneration(generation)) return;

    const socket = new WebSocket(this.options.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (!this.isCurrentSocket(generation, socket)) return;
      this.sendOnSocket(socket, { type: 'join', encounterId: this.options.encounterId, token });
    });
    socket.addEventListener('message', (event) => {
      if (this.isCurrentSocket(generation, socket)) this.receive(String(event.data));
    });
    socket.addEventListener('close', () => {
      if (!this.isCurrentSocket(generation, socket)) return;
      this.socket = null;
      this.reconnect(generation);
    });
    socket.addEventListener('error', () => {
      if (this.isCurrentSocket(generation, socket)) this.options.onError('The realtime connection failed.');
    });
  }

  command(command: RoomCommand) {
    if (!this.state) throw new Error('Encounter state has not synchronized yet.');
    this.send({ type: 'command', encounterId: this.options.encounterId, expectedRevision: this.state.revision, command });
  }

  encounter(command: EncounterCommand) {
    this.command({ domain: 'encounter', command });
  }

  table(command: TableCommand) {
    this.command({ domain: 'table', command });
  }

  ping(position: Position) {
    this.send({ type: 'ping', encounterId: this.options.encounterId, position });
  }

  save() {
    if (!this.state) throw new Error('Encounter state has not synchronized yet.');
    this.send({ type: 'save', encounterId: this.options.encounterId, expectedRevision: this.state.revision });
  }

  disconnect() {
    this.closed = true;
    ++this.connectionGeneration;
    this.clearRetryTimer();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'Client closed.');
    this.options.onStatus('closed');
  }

  private send(message: ClientMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Realtime socket is not open.');
    this.sendOnSocket(this.socket, message);
  }

  private sendOnSocket(socket: WebSocket, message: ClientMessage) {
    if (socket.readyState !== WebSocket.OPEN) throw new Error('Realtime socket is not open.');
    socket.send(JSON.stringify(message));
  }

  private receive(raw: string) {
    const message = JSON.parse(raw) as ServerMessage;
    if (message.type === 'joined') {
      this.retry = 0;
      this.state = message.state;
      this.options.onState(message.state);
      this.options.onJoined?.(message.role);
      this.options.onStatus('connected');
      this.options.onSaveStatus?.(message.saveStatus, message.state.revision);
    } else if (message.type === 'events') {
      this.state = message.state;
      this.options.onState(message.state);
      this.options.onSaveStatus?.(message.saveStatus, message.state.revision);
    } else if (message.type === 'error') {
      if (message.state) {
        this.state = message.state;
        this.options.onState(message.state);
      }
      this.options.onError(message.message);
      // Render deliberately closes a socket after an authentication or
      // authorization failure. Treat those messages as terminal locally too:
      // reconnecting with the same revoked/invalid identity would otherwise
      // turn one rejected join into an indefinite authentication loop.
      if (isTerminalAuthorizationError(message.code)) this.stopForTerminalAuthorizationError();
    } else if (message.type === 'ping') {
      this.options.onPing?.(message.userId, message.position);
    } else if (message.type === 'save-status') {
      this.options.onSaveStatus?.(message.status, message.revision);
      if (message.status === 'save-error') this.options.onStatus('save-error');
    } else if (message.type === 'save-complete') {
      this.options.onSaveStatus?.('saved', message.revision);
    }
  }

  private reconnect(generation: number) {
    if (!this.isCurrentGeneration(generation)) return;
    this.retry += 1;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.retry, 5));
    this.options.onStatus('reconnecting');
    const retryTimer = window.setTimeout(() => {
      if (this.retryTimer === retryTimer) this.retryTimer = null;
      if (!this.isCurrentGeneration(generation)) return;
      void this.connect().catch((error) => this.options.onError(error instanceof Error ? error.message : 'Reconnect failed.'));
    }, delay);
    this.retryTimer = retryTimer;
  }

  private clearRetryTimer() {
    if (this.retryTimer === null) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private stopForTerminalAuthorizationError() {
    this.closed = true;
    ++this.connectionGeneration;
    this.retry = 0;
    this.clearRetryTimer();
    const socket = this.socket;
    this.socket = null;
    // The server normally closes immediately after this error. Closing our
    // side as well prevents commands from being sent in the short gap before
    // that close frame arrives.
    socket?.close(1000, 'Authorization rejected.');
    this.options.onStatus('closed');
  }

  private isCurrentGeneration(generation: number) {
    return !this.closed && generation === this.connectionGeneration;
  }

  private isCurrentSocket(generation: number, socket: WebSocket) {
    return this.isCurrentGeneration(generation) && this.socket === socket;
  }
}

function isTerminalAuthorizationError(code: string): boolean {
  return code === 'authentication.failed' || code === 'authorization.revoked' || code === 'phase.gated';
}
