import { expect, test } from '@playwright/test';

/**
 * icon_connect.json is a PUBLIC binding artifact / instance descriptor. This
 * flow is deliberately offline-capable: exporting and importing the file never
 * touches the network, never authenticates anybody, and never overwrites the
 * local identity. The E2E server has no Supabase configuration, so the
 * username/password form is absent and only the file actions are exercised.
 */
test('Dashboard exports and validates icon_connect.json offline without touching identity', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Your Icons', { exact: true })).toBeVisible();

  // The local instance/keypair is generated in the browser (fully offline).
  const downloadButton = page.getByRole('button', { name: 'Download connect file', exact: true });
  await expect(downloadButton).toBeEnabled();

  // Export the descriptor.
  const downloadPromise = page.waitForEvent('download');
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('icon_connect.json');
  const file = await download.path();
  const text = (await import('node:fs')).readFileSync(file, 'utf8');
  const artifact = JSON.parse(text) as Record<string, unknown>;

  // The file contains ONLY identity + public key + version metadata: never a
  // username, password, token, or private key.
  expect(artifact.kind).toBe('icon-connect');
  expect(artifact.schemaVersion).toBe(1);
  expect(artifact.instanceId).toMatch(/^[0-9a-f-]{36}$/);
  expect(artifact.publicKey).toMatchObject({ kty: 'EC', crv: 'P-256' });
  expect(Object.keys(artifact).sort()).toEqual(['createdAt', 'instanceId', 'kind', 'publicKey', 'schemaVersion']);
  expect(text).not.toMatch(/username|password|access_token|refresh_token|session|secret/i);
  expect(text).not.toContain('"d"');

  // Importing the same file is accepted as a matching descriptor and changes
  // nothing.
  const importInput = page.locator('input[type="file"][accept=".json,application/json"]');
  await importInput.setInputFiles({ name: 'icon_connect.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
  await expect(page.getByText(/This connect file matches this device/)).toBeVisible();

  // A valid artifact describing a DIFFERENT instance must not overwrite the
  // locked local identity.
  const localInstanceId = await page.evaluate(() => localStorage.getItem('icon.creatorInstanceId'));
  expect(localInstanceId).toMatch(/^[0-9a-f-]{36}$/);
  const foreign = {
    ...artifact,
    instanceId: '99999999-8888-7777-6666-555555555555',
    createdAt: new Date().toISOString(),
  };
  await importInput.setInputFiles({
    name: 'icon_connect.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(foreign, null, 2), 'utf8'),
  });
  await expect(page.getByText(/describes a different device/)).toBeVisible();
  const stillLocal = await page.evaluate(() => localStorage.getItem('icon.creatorInstanceId'));
  expect(stillLocal).toBe(localInstanceId);

  // Malformed connect files fail closed with a useful error and no mutation.
  await importInput.setInputFiles({
    name: 'icon_connect.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...artifact, schemaVersion: 99 }, null, 2), 'utf8'),
  });
  await expect(page.getByText(/Unsupported icon_connect schema version 99/)).toBeVisible();
  const afterBad = await page.evaluate(() => localStorage.getItem('icon.creatorInstanceId'));
  expect(afterBad).toBe(localInstanceId);

  // Reload: the local identity is stable across sessions and the file actions
  // still work offline.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Download connect file', exact: true })).toBeEnabled();
  const afterReload = await page.evaluate(() => localStorage.getItem('icon.creatorInstanceId'));
  expect(afterReload).toBe(localInstanceId);
});
