import type { EncounterCommand, EncounterState } from '../rules/types.js';
import type { ClientMessage, ServerMessage } from '../rules/protocol.js';

interface RealtimeOptions {
  url: string;
  encounterId: string;
  accessToken(): Promise<string>;
  onState(state: EncounterState): void;
  onStatus(status: 'connecting' | 'connected' | 'reconnecting' | 'closed'): void;
  onError(message: string): void;
}

export class RealtimeEncounterClient {
  private socket: WebSocket | null = null;
  private state: EncounterState | null = null;
  private closed = false;
  private retry = 0;
  private retryTimer: number | null = null;

  constructor(private readonly options: RealtimeOptions) {}

  async connect() {
    this.closed = false;
    this.options.onStatus(this.retry ? 'reconnecting' : 'connecting');
    const token = await this.options.accessToken();
    const socket = new WebSocket(this.options.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.retry = 0;
      this.send({ type: 'join', encounterId: this.options.encounterId, token });
    });
    socket.addEventListener('message', (event) => this.receive(String(event.data)));
    socket.addEventListener('close', () => this.reconnect());
    socket.addEventListener('error', () => this.options.onError('The realtime connection failed.'));
  }

  command(command: EncounterCommand) {
    if (!this.state) throw new Error('Encounter state has not synchronized yet.');
    this.send({ type: 'command', encounterId: this.options.encounterId, expectedRevision: this.state.revision, command });
  }

  disconnect() {
    this.closed = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.socket?.close(1000, 'Client closed.');
    this.socket = null;
    this.options.onStatus('closed');
  }

  private send(message: ClientMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Realtime socket is not open.');
    this.socket.send(JSON.stringify(message));
  }

  private receive(raw: string) {
    const message = JSON.parse(raw) as ServerMessage;
    if (message.type === 'joined') {
      this.state = message.state;
      this.options.onState(message.state);
      this.options.onStatus('connected');
    } else if (message.type === 'events') {
      this.state = message.state;
      this.options.onState(message.state);
    } else if (message.type === 'error') {
      if (message.state) {
        this.state = message.state;
        this.options.onState(message.state);
      }
      this.options.onError(message.message);
    }
  }

  private reconnect() {
    this.socket = null;
    if (this.closed) return;
    this.retry += 1;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.retry, 5));
    this.options.onStatus('reconnecting');
    this.retryTimer = window.setTimeout(() => void this.connect().catch((error) => this.options.onError(error instanceof Error ? error.message : 'Reconnect failed.')), delay);
  }
}
