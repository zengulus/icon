import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { WebSocketServer } from 'ws';
import { parseClientMessage, type ServerMessage } from '../src/rules/protocol.js';
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
sockets.on('connection', (socket, request) => {
  const origin = request.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) {
    socket.close(1008, 'Origin is not allowed.');
    return;
  }
  let client: AuthenticatedClient | null = null;
  const send = (message: ServerMessage) => socket.send(JSON.stringify(message));
  const joinTimeout = setTimeout(() => socket.close(1008, 'Join message timed out.'), 10_000);

  socket.on('message', async (raw) => {
    try {
      const message = parseClientMessage(raw.toString());
      if (message.type === 'ping') { send({ type: 'pong' }); return; }
      if (message.type === 'join') {
        if (client) throw new Error('This socket already joined an encounter.');
        client = await rooms.join(socket, message.encounterId, message.token);
        clearTimeout(joinTimeout);
        return;
      }
      if (!client) throw new Error('Join an encounter before sending commands.');
      if (message.encounterId !== client.encounterId) throw new Error('This socket joined a different encounter.');
      await rooms.command(client, message.expectedRevision, message.command);
    } catch (error) {
      send({ type: 'error', code: 'message.invalid', message: error instanceof Error ? error.message : 'Invalid message.' });
    }
  });
  socket.on('close', () => { clearTimeout(joinTimeout); rooms.leave(client); });
  socket.on('error', () => { clearTimeout(joinTimeout); rooms.leave(client); });
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`ICON realtime service listening on :${config.port}`);
});
