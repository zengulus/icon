import { expect, test, type Page } from '@playwright/test';

const roomId = 'browser-acceptance-room';
const realtimePort = Number(process.env.E2E_REALTIME_PORT ?? 48781);
const realtimeUrl = `ws://127.0.0.1:${realtimePort}/realtime`;

function roomPath(userId: string, role: 'gm' | 'player') {
  return `/#/vtt/${roomId}?e2eUser=${encodeURIComponent(userId)}&e2eRole=${role}`;
}

async function joinRoom(page: Page, userId: string, role: 'gm' | 'player') {
  await page.goto(roomPath(userId, role));
  const status = page.getByLabel('Room status');
  await expect(status).toContainText('CONNECTION connected');
  await expect(status).toContainText(`ROLE ${role}`);
  await expect(status).toContainText('ROOM REV 0');
}

/**
 * The normal shared marker is exercised through the UI. This protocol-level
 * fixture creates a deliberately hidden annotation so the rendered player
 * projection can prove that secret state never reached its browser. It uses
 * the same test-only token gate as the routed client, never a production
 * endpoint or backend mutation hook.
 */
async function addHiddenAnnotation(page: Page, expectedRevision: number, secret: string) {
  await page.evaluate(async ({ endpoint, encounterId, revision, text }) => {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoint);
      const timer = window.setTimeout(() => {
        socket.close();
        reject(new Error('Timed out while adding the hidden E2E fixture.'));
      }, 8_000);
      const finish = (error?: Error) => {
        window.clearTimeout(timer);
        socket.close();
        if (error) reject(error);
        else resolve();
      };
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'join', encounterId, token: 'dev:gm-browser:gm' }));
      });
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === 'error') {
          finish(new Error(`${message.code}: ${message.message}`));
          return;
        }
        if (message.type === 'joined') {
          if (message.state.revision !== revision) {
            finish(new Error(`Expected revision ${revision}, received ${message.state.revision}.`));
            return;
          }
          socket.send(JSON.stringify({
            type: 'command',
            encounterId,
            expectedRevision: revision,
            command: {
              domain: 'table',
              command: {
                type: 'UPSERT_ANNOTATION',
                annotation: {
                  id: 'e2e-hidden-note',
                  kind: 'note',
                  points: [{ x: 4, y: 2 }],
                  color: '#f44336',
                  text,
                  hidden: true,
                },
              },
            },
          }));
          return;
        }
        if (message.type === 'events' && message.state.revision === revision + 1) finish();
      });
      socket.addEventListener('error', () => finish(new Error('The hidden E2E fixture websocket failed.')));
    });
  }, { endpoint: realtimeUrl, encounterId: roomId, revision: expectedRevision, text: secret });
}

test('GM and player render the authoritative shared room without leaking hidden state', async ({ browser }) => {
  const gmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const gm = await gmContext.newPage();
  const player = await playerContext.newPage();
  const secret = 'E2E GM-only route through the ruins';

  try {
    await joinRoom(gm, 'gm-browser', 'gm');
    await joinRoom(player, 'player-browser', 'player');

    // A GM table action travels through Render, advances one shared revision,
    // and is rendered from the returned server state in both browser contexts.
    await expect(gm.getByRole('button', { name: 'Fog', exact: true })).toBeVisible();
    await expect(player.getByRole('button', { name: 'Fog', exact: true })).toHaveCount(0);
    await gm.getByRole('button', { name: 'Mark', exact: true }).click();
    await gm.getByRole('button', { name: 'Grid 1, 1' }).click();
    await expect(gm.getByLabel('Room status')).toContainText('ROOM REV 1');
    await expect(player.getByLabel('Room status')).toContainText('ROOM REV 1');
    await expect(gm.locator('.vtt-annotation')).toHaveCount(1);
    await expect(player.locator('.vtt-annotation')).toHaveCount(1);

    // Pointer pings are observable by both peers but leave the room revision
    // unchanged, which distinguishes transient collaboration from durable VTT
    // table actions.
    await player.getByRole('button', { name: 'Grid 2, 2' }).click();
    await expect(gm.getByText('A participant pinged (2, 2)')).toBeVisible();
    await expect(player.getByText('You pinged (2, 2)')).toBeVisible();
    await expect(gm.getByLabel('Room status')).toContainText('ROOM REV 1');

    await addHiddenAnnotation(gm, 1, secret);
    await expect(gm.locator('body')).toContainText(secret);
    await expect(player.getByLabel('Room status')).toContainText('ROOM REV 2');
    await expect(player.locator('body')).not.toContainText(secret);
    await expect(player.locator('.vtt-annotation')).toHaveCount(1);
  } finally {
    await gmContext.close();
    await playerContext.close();
  }
});
