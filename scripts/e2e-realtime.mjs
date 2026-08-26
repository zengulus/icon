import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://localhost:5173';
const roomId = 'acceptance-room';
const timeoutMs = 10_000;

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function findAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (!address || typeof address === 'string') {
        listener.close();
        reject(new Error('Could not reserve an ephemeral port for realtime acceptance.'));
        return;
      }
      listener.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

function startService(port, overrides = {}) {
  const service = spawn(process.execPath, ['dist-server/server/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      ALLOW_DEV_AUTH: 'true',
      ALLOWED_ORIGINS: origin,
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      DISCORD_WEBHOOK_URL: '',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  service.stdout.on('data', (chunk) => { output += chunk.toString(); });
  service.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { service, output: () => output };
}

async function waitForHealth(port, service, output) {
  const endpoint = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (service.exitCode !== null) throw new Error(`Realtime service exited before health check.\n${output()}`);
    try {
      const response = await fetch(endpoint);
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.ok, true);
        assert.equal(health.service, 'icon-realtime');
        return;
      }
    } catch {
      // The child process has not bound its HTTP listener yet.
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for the realtime health endpoint.\n${output()}`);
}

function connect(url) {
  return new Promise((resolveClient, reject) => {
    const socket = new WebSocket(url, { origin });
    const client = { socket, messages: [], errors: [] };
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out opening a realtime websocket.'));
    }, timeoutMs);
    socket.on('message', (raw) => {
      try {
        client.messages.push(JSON.parse(raw.toString()));
      } catch (error) {
        client.errors.push(error);
      }
    });
    socket.once('open', () => {
      clearTimeout(timer);
      resolveClient(client);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      client.errors.push(error);
      reject(error);
    });
  });
}

function send(client, message) {
  assert.equal(client.socket.readyState, WebSocket.OPEN, 'Realtime websocket must be open before sending.');
  client.socket.send(JSON.stringify(message));
}

async function nextMessage(client, predicate, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (client.errors.length > 0) throw client.errors[0];
    const index = client.messages.findIndex(predicate);
    if (index >= 0) return client.messages.splice(index, 1)[0];
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${description}. Received: ${JSON.stringify(client.messages)}`);
}

async function closeClient(client) {
  if (!client || client.socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolveClose) => {
    const timer = setTimeout(() => {
      client.socket.terminate();
      resolveClose();
    }, 1_000);
    client.socket.once('close', () => {
      clearTimeout(timer);
      resolveClose();
    });
    client.socket.close(1000, 'Acceptance complete.');
  });
}

async function waitForClose(client, description) {
  if (client.socket.readyState === WebSocket.CLOSED) return { code: 0, reason: '' };
  return new Promise((resolveClose, rejectClose) => {
    const timer = setTimeout(() => {
      client.socket.terminate();
      rejectClose(new Error(`Timed out waiting for ${description} to close.`));
    }, timeoutMs);
    client.socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolveClose({ code, reason: reason.toString() });
    });
  });
}

async function stopService(service) {
  if (!service || service.exitCode !== null) return;
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      service.kill('SIGKILL');
      resolveStop();
    }, 3_000);
    service.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
    service.kill('SIGTERM');
  });
}

async function main() {
  const port = await findAvailablePort();
  const launched = startService(port);
  const phaseGatePort = await findAvailablePort();
  const phaseGateService = startService(phaseGatePort, {
    NODE_ENV: 'production',
    ALLOW_DEV_AUTH: 'false',
  });
  let gm;
  let player;
  let racingClient;
  let rejectedClient;
  let abusiveClient;
  let phaseGatedClient;
  try {
    await waitForHealth(port, launched.service, launched.output);
    await waitForHealth(phaseGatePort, phaseGateService.service, phaseGateService.output);
    const websocketUrl = `ws://127.0.0.1:${port}/realtime`;
    gm = await connect(websocketUrl);
    player = await connect(websocketUrl);

    send(gm, { type: 'join', encounterId: roomId, token: 'dev:gm-user:gm' });
    const gmJoined = await nextMessage(gm, (message) => message.type === 'joined', 'the GM join acknowledgement');
    assert.equal(gmJoined.role, 'gm');
    assert.equal(gmJoined.state.revision, 0);

    send(player, { type: 'join', encounterId: roomId, token: 'dev:player-user:player' });
    const playerJoined = await nextMessage(player, (message) => message.type === 'joined', 'the player join acknowledgement');
    assert.equal(playerJoined.role, 'player');
    assert.equal(playerJoined.state.revision, 0);

    send(gm, {
      type: 'command',
      encounterId: roomId,
      expectedRevision: 0,
      command: {
        domain: 'table',
        command: { type: 'UPSERT_CLOCK', clock: { id: 'progress', name: 'Progress', segments: 6, filled: 2 } },
      },
    });
    const gmClock = await nextMessage(gm, (message) => message.type === 'events' && message.state.revision === 1, 'the GM clock event');
    const playerClock = await nextMessage(player, (message) => message.type === 'events' && message.state.revision === 1, 'the player clock projection');
    assert.equal(gmClock.events.length, 1);
    assert.deepEqual(playerClock.events, []);
    assert.deepEqual(playerClock.state.table.clocks, [{ id: 'progress', name: 'Progress', segments: 6, filled: 2 }]);

    const hiddenText = 'GM-only route through the ruins';
    send(gm, {
      type: 'command',
      encounterId: roomId,
      expectedRevision: 1,
      command: {
        domain: 'table',
        command: {
          type: 'UPSERT_ANNOTATION',
          annotation: { id: 'secret-route', kind: 'note', points: [{ x: 4, y: 2 }], color: '#112233', text: hiddenText, hidden: true },
        },
      },
    });
    const gmHidden = await nextMessage(gm, (message) => message.type === 'events' && message.state.revision === 2, 'the GM hidden annotation event');
    const playerHidden = await nextMessage(player, (message) => message.type === 'events' && message.state.revision === 2, 'the player hidden annotation projection');
    assert.equal(JSON.stringify(gmHidden).includes(hiddenText), true);
    assert.equal(JSON.stringify(playerHidden).includes(hiddenText), false);
    assert.deepEqual(playerHidden.events, []);
    assert.deepEqual(playerHidden.state.table.annotations, []);

    send(player, {
      type: 'command',
      encounterId: roomId,
      expectedRevision: 1,
      command: {
        domain: 'table',
        command: {
          type: 'UPSERT_ANNOTATION',
          annotation: { id: 'stale-note', kind: 'note', points: [{ x: 1, y: 1 }], color: '#445566', text: 'Stale command' },
        },
      },
    });
    const stale = await nextMessage(player, (message) => message.type === 'error' && message.code === 'revision.conflict', 'a stale revision rejection');
    assert.equal(stale.state.revision, 2);

    send(player, { type: 'ping', encounterId: roomId, position: { x: 3, y: 5 } });
    const gmPing = await nextMessage(gm, (message) => message.type === 'ping' && message.userId === 'player-user', 'the GM ping');
    const playerPing = await nextMessage(player, (message) => message.type === 'ping' && message.userId === 'player-user', 'the player ping echo');
    assert.deepEqual(gmPing.position, { x: 3, y: 5 });
    assert.deepEqual(playerPing.position, { x: 3, y: 5 });

    send(gm, { type: 'save', encounterId: roomId, expectedRevision: 2 });
    const saved = await nextMessage(gm, (message) => message.type === 'save-complete', 'the durable GM save acknowledgement');
    assert.equal(saved.revision, 2);

    const health = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json());
    assert.equal(health.rooms, 1);
    assert.equal(health.connections, 2);

    // A second join frame can arrive while async authentication for the first
    // is still pending. The server must reserve the socket immediately, not
    // register it twice and leave a ghost room subscriber on disconnect.
    racingClient = await connect(websocketUrl);
    send(racingClient, { type: 'join', encounterId: 'join-race-room', token: 'dev:race-user:gm' });
    send(racingClient, { type: 'join', encounterId: 'join-race-room', token: 'dev:race-user:gm' });
    const raceJoined = await nextMessage(racingClient, (message) => message.type === 'joined', 'the first join acknowledgement');
    const raceRejected = await nextMessage(racingClient, (message) => message.type === 'error' && message.code === 'message.invalid', 'the duplicate join rejection');
    assert.equal(raceJoined.encounterId, 'join-race-room');
    assert.match(raceRejected.message, /already joining or joined/i);

    // Authentication failures are terminal. This keeps an unauthenticated
    // socket from repeatedly driving token/campaign checks for its full join
    // timeout window, and deliberately does not reveal which check failed.
    rejectedClient = await connect(websocketUrl);
    const rejectedClosed = waitForClose(rejectedClient, 'the rejected authentication client');
    send(rejectedClient, { type: 'join', encounterId: 'auth-failure-room', token: 'not-a-valid-dev-token' });
    const authenticationError = await nextMessage(rejectedClient, (message) => message.type === 'error' && message.code === 'authentication.failed', 'the terminal authentication rejection');
    assert.equal(authenticationError.message, 'Could not join this encounter.');
    assert.equal((await rejectedClosed).code, 1008);

    // The client UI is not the release authority. Even a raw websocket sent
    // to a production-like server cannot bypass an incomplete rules gate.
    phaseGatedClient = await connect(`ws://127.0.0.1:${phaseGatePort}/realtime`);
    const phaseGatedClosed = waitForClose(phaseGatedClient, 'the phase-gated client');
    send(phaseGatedClient, { type: 'join', encounterId: 'phase-gated-room', token: 'dev:phase-gate:gm' });
    const phaseGateError = await nextMessage(phaseGatedClient, (message) => message.type === 'error' && message.code === 'phase.gated', 'the server-side phase gate');
    assert.match(phaseGateError.message, /phase-three release gate/i);
    assert.equal((await phaseGatedClosed).code, 1008);

    // Parsing and session-envelope errors are separate from RoomManager's
    // command buckets, so bound them at the socket. Mix malformed JSON with
    // a valid-shaped frame for another encounter to cover both bypass paths.
    abusiveClient = await connect(websocketUrl);
    send(abusiveClient, { type: 'join', encounterId: 'ingress-limit-room', token: 'dev:ingress-user:player' });
    await nextMessage(abusiveClient, (message) => message.type === 'joined', 'the ingress-limit client join acknowledgement');
    const ingressClosed = waitForClose(abusiveClient, 'the protocol-abusive client');
    const invalidMessage = nextMessage(abusiveClient, (message) => message.type === 'error' && message.code === 'message.invalid', 'an invalid protocol message rejection');
    abusiveClient.socket.send('{malformed-json');
    abusiveClient.socket.send('{malformed-json');
    for (let index = 0; index < 3; index += 1) {
      send(abusiveClient, { type: 'ping', encounterId: 'another-encounter', position: { x: index, y: 0 } });
    }
    await invalidMessage;
    assert.equal((await ingressClosed).code, 1008);

    console.log('Realtime transport acceptance passed: join, authoritative revisions, player redaction, hard save, and bounded ingress failures.');
  } finally {
    await closeClient(abusiveClient);
    await closeClient(phaseGatedClient);
    await closeClient(rejectedClient);
    await closeClient(racingClient);
    await closeClient(gm);
    await closeClient(player);
    await stopService(launched.service);
    await stopService(phaseGateService.service);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
