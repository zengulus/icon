import { expect, test } from '@playwright/test';

const localRoomKey = 'icon.browser-vtt.room.v1';

/**
 * This is deliberately a browser-only Lab acceptance path. The `#/lab` route
 * mounts outside CharacterProvider and uses no Render or Supabase authority:
 * every durable change below must come from the shared room reducer, replay
 * locally, and survive a browser-storage reload.
 */
test('Lab remains browser-local and never opens an authenticated room connection', async ({ page }) => {
  const cloudRequests: string[] = [];
  const roomSockets: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/src/services/supabase.') || /supabase\.co|\/realtime(?:[/?]|$)/i.test(url)) cloudRequests.push(url);
  });
  page.on('websocket', (socket) => {
    if (/\/realtime(?:[/?]|$)/i.test(socket.url())) roomSockets.push(socket.url());
  });

  await page.goto('/#/lab');
  await expect(page.getByText('Lab // browser-local human testing', { exact: true })).toBeVisible();

  expect(cloudRequests).toEqual([]);
  expect(roomSockets).toEqual([]);
});

test('Lab persists table and encounter reducer operations across a reload', async ({ page }) => {
  await page.goto('/#/lab');

  await expect(page.getByText('Lab // browser-local human testing', { exact: true })).toBeVisible();
  await expect(page.locator('.vtt-token')).toHaveCount(2);
  await expect(page.locator('.battle-status')).toContainText('ROOM REV 3');

  // Durable tabletop operations use the same room reducer as a shared room.
  await page.getByRole('button', { name: 'Mark', exact: true }).click();
  await page.getByRole('button', { name: 'Grid 1, 1', exact: true }).click();
  await expect(page.locator('.vtt-annotation')).toHaveCount(1);

  await page.getByRole('button', { name: 'Area', exact: true }).click();
  await page.getByLabel('Shape').selectOption('cone');
  await page.getByLabel('Length').fill('3');
  await page.getByRole('button', { name: 'Grid 4, 2', exact: true }).click();
  await expect(page.locator('.vtt-template')).toHaveCount(1);

  await page.getByRole('button', { name: 'Fog', exact: true }).click();
  await page.getByRole('button', { name: 'Grid 0, 0', exact: true }).click();
  await expect(page.locator('.vtt-fog-cell')).toHaveCount(1);

  // The fixture hero starts at (2, 4); a one-cell move puts the Bastion's
  // range-3 light attack in range of the foe at (6, 4). Both operations are
  // submitted to the encounter reducer, never to a UI-local actor copy.
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('button', { name: /^Move/ }).click();
  await page.getByRole('button', { name: 'Grid 3, 4', exact: true }).click();
  await expect(page.getByText('✓ deterministic room replay matches', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Light attack/ }).click();
  // The target token is visually above its grid button. Force is appropriate
  // here because the UI intentionally routes targeting through the grid cell.
  await page.getByRole('button', { name: 'Grid 6, 4', exact: true }).click({ force: true });
  await expect(page.getByText('ATTACK RESOLVED', { exact: true })).toBeVisible();
  await expect(page.locator('.battle-status')).toContainText('ROOM REV 8');

  const persisted = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, localRoomKey);
  expect(persisted).toMatchObject({
    schemaVersion: 2,
    revision: 8,
    encounter: {
      revision: 5,
      actors: {
        'actor:browser-vtt-hero': { position: { x: 3, y: 4 }, actionsRemaining: 1 },
      },
    },
    table: {
      fog: [{ cells: [{ x: 0, y: 0 }] }],
      annotations: [{ kind: 'marker', points: [{ x: 1, y: 1 }] }],
      templates: [{ kind: 'cone', origin: { x: 4, y: 2 }, length: 3 }],
    },
  });

  await page.reload();
  await expect(page.locator('.battle-status')).toContainText('ROOM REV 8');
  await expect(page.locator('.vtt-annotation')).toHaveCount(1);
  await expect(page.locator('.vtt-template')).toHaveCount(1);
  await expect(page.locator('.vtt-fog-cell')).toHaveCount(1);
  await expect(page.getByText('ATTACK RESOLVED', { exact: true })).toBeVisible();
});

test('Lab preserves a malformed cached room before offering a new fixture', async ({ page }) => {
  const corrupt = '{not valid room json';
  await page.addInitScript(({ key, payload }) => localStorage.setItem(key, payload), {
    key: localRoomKey,
    payload: corrupt,
  });
  await page.goto('/#/lab');

  await expect(page.locator('.battle-error')).toContainText('A recovery copy was kept in local storage.');
  const backups = await page.evaluate((key) => Object.entries(localStorage)
    .filter(([entry]) => entry.startsWith(`${key}.corrupt`))
    .map(([, value]) => value), localRoomKey);
  expect(backups).toContain(corrupt);
});
