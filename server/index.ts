import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage } from '../src/rules/protocol.js';
import { PHASE_THREE_READY } from '../src/rules/catalog.js';
import { loadConfig } from './config.js';
import { sendDiscordNotice } from './discord.js';
import { RoomManager, type AuthenticatedClient } from './rooms.js';

const config = loadConfig();
const app = express();
const server = http.createServer(app);
const rooms = new RoomManager(config);

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Origin is not allowed.'));
  },
}));
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'icon-realtime', rulesVersion: '1.5', ...rooms.status() });
});

app.post('/api/discord/test', async (request, response) => {
  const secret = request.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!config.allowDevAuth || secret !== process.env.DISCORD_TEST_TOKEN) {
    response.status(403).json({ error: 'forbidden' });
    return;
  }
  try {
    const result = await sendDiscordNotice(config.discordWebhookUrl, { title: 'Connection verified', description: 'The ICON activity service can post to this channel.' });
    response.json(result);
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Webhook failed.' });
  }
});

const sockets = new WebSocketServer({ server, path: '/realtime', maxPayload: 128 * 1024 });
const MAX_PROTOCOL_FAILURES_PER_WINDOW = 5;
const PROTOCOL_FAILURE_WINDOW_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
// Admission limits apply before a room has authenticated/hydrated. Room-level
// limits alone are too late to protect Render from an upgrade or identity
// provider flood.
const MAX_OPEN_REALTIME_SOCKETS = 500;
const MAX_PENDING_JOINS = 100;
let pendingJoins = 0;
type HeartbeatSocket = WebSocket & { isAlive?: boolean };

// TCP can remain half-open after a laptop sleeps or a network path dies. A
// bounded heartbeat releases those ghost clients, which in turn releases room
// fan-out and permits the normal checkpoint eviction path to run.
const heartbeat = setInterval(() => {
  for (const candidate of sockets.clients) {
    const socket = candidate as HeartbeatSocket;
    if (socket.readyState !== socket.OPEN) continue;
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS);
sockets.on('close', () => clearInterval(heartbeat));

sockets.on('connection', (socket, request) => {
  if (sockets.clients.size > MAX_OPEN_REALTIME_SOCKETS) {
    socket.close(1013, 'Realtime service is at connection capacity.');
    return;
  }
  const heartbeatSocket = socket as HeartbeatSocket;
  heartbeatSocket.isAlive = true;
  socket.on('pong', () => { heartbeatSocket.isAlive = true; });
  const origin = request.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) {
    socket.close(1008, 'Origin is not allowed.');
    return;
  }
  let client: AuthenticatedClient | null = null;
  let joining = false;
  let socketClosed = false;
  let joinTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingJoinSlot = false;
  let protocolFailures: number[] = [];
  const send = (message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const leaveClient = () => {
    if (!client) return;
    rooms.leave(client);
    client = null;
  };
  const releasePendingJoinSlot = () => {
    if (!pendingJoinSlot) return;
    pendingJoinSlot = false;
    pendingJoins = Math.max(0, pendingJoins - 1);
  };
  const closeSocket = (code: number, reason: string) => {
    if (socketClosed) return;
    // Set this before closing so a pending asynchronous join cannot attach a
    // client after this socket has been rejected.
    socketClosed = true;
    if (joinTimeout !== null) {
      clearTimeout(joinTimeout);
      joinTimeout = null;
    }
    releasePendingJoinSlot();
    leaveClient();
    if (socket.readyState === socket.OPEN) socket.close(code, reason);
  };
  const rejectProtocolMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Invalid message.';
    send({ type: 'error', code: 'message.invalid', message });
    const now = Date.now();
    protocolFailures = protocolFailures.filter((timestamp) => timestamp > now - PROTOCOL_FAILURE_WINDOW_MS);
    protocolFailures.push(now);
    if (protocolFailures.length >= MAX_PROTOCOL_FAILURES_PER_WINDOW) {
      closeSocket(1008, 'Too many invalid realtime messages.');
    }
  };
  const rejectJoin = () => {
    // Do not disclose whether an access token, encounter, or membership check
    // failed. More importantly, do not leave a socket available to repeatedly
    // drive expensive authentication work before its join timeout expires.
    send({ type: 'error', code: 'authentication.failed', message: 'Could not join this encounter.' });
    closeSocket(1008, 'Authentication failed.');
  };
  const rejectPhaseGate = () => {
    send({ type: 'error', code: 'phase.gated', message: 'Multiplayer is unavailable until the ICON rules coverage gate passes.' });
    closeSocket(1008, 'Multiplayer phase gate is active.');
  };
  joinTimeout = setTimeout(() => closeSocket(1008, 'Join message timed out.'), 10_000);

  socket.on('message', async (raw) => {
    if (socketClosed) return;
    let message: ReturnType<typeof parseClientMessage>;
    try {
      message = parseClientMessage(raw.toString());
      if (message.type === 'join') {
        // The client UI is not the authority for a release gate. Prevent raw
        // WebSocket use from turning incomplete automation into a production
        // multiplayer path; test/development preview must opt in server-side.
        if (!PHASE_THREE_READY && !config.allowIncompleteVtt) {
          rejectPhaseGate();
          return;
        }
        // `await rooms.join()` yields for token verification. Claim the socket
        // synchronously so two frames in the same websocket turn cannot join
        // two rooms and leave an orphaned subscriber behind on close.
        if (client || joining) throw new Error('This socket is already joining or joined an encounter.');
        if (pendingJoins >= MAX_PENDING_JOINS) {
          send({ type: 'error', code: 'server.busy', message: 'Realtime sign-in capacity is temporarily full. Please retry shortly.' });
          closeSocket(1013, 'Realtime join capacity is full.');
          return;
        }
        pendingJoins += 1;
        pendingJoinSlot = true;
        joining = true;
        try {
          const joinedClient = await rooms.join(socket, message.encounterId, message.token);
          if (socketClosed) {
            rooms.leave(joinedClient);
            return;
          }
          client = joinedClient;
          if (joinTimeout !== null) {
            clearTimeout(joinTimeout);
            joinTimeout = null;
          }
        } catch {
          if (!socketClosed) rejectJoin();
        } finally {
          releasePendingJoinSlot();
          joining = false;
        }
        return;
      }
      if (!client) throw new Error(joining ? 'Wait for the join acknowledgement before sending commands.' : 'Join an encounter before sending commands.');
      if (message.encounterId !== client.encounterId) throw new Error('This socket joined a different encounter.');
      if (message.type === 'ping') {
        await rooms.ping(client, message.position);
        return;
      }
      if (message.type === 'save') {
        await rooms.hardSave(client, message.expectedRevision);
        return;
      }
      await rooms.command(client, message.expectedRevision, message.command);
    } catch (error) {
      rejectProtocolMessage(error);
    }
  });
  socket.on('close', () => closeSocket(1000, 'Socket closed.'));
  socket.on('error', () => closeSocket(1011, 'Socket error.'));
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`ICON realtime service listening on :${config.port}`);
});
