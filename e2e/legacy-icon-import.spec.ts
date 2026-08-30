import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const douglasIcon = readFileSync(new URL('../Douglas.icon', import.meta.url), 'utf8');

/**
 * The Dashboard's legacy .icon import is a browser-local, fully-offline flow:
 * the E2E Vite server has no Supabase environment, so cloud replication is
 * unavailable and the imported character must persist through the local-first
 * envelope alone.
 */
test('Dashboard imports Douglas.icon offline and persists it across a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Your Icons', { exact: true })).toBeVisible();
  await expect(page.getByText('No Icons recorded yet', { exact: true })).toBeVisible();

  // The character import control accepts only the legacy .icon format (no
  // generic JSON). The separate icon_connect.json descriptor input below is a
  // distinct, intentionally-JSON control.
  const iconInput = page.locator('input[type="file"][accept=".icon"]');
  const accept = await iconInput.getAttribute('accept');
  expect(accept).toBe('.icon');
  await page.getByRole('button', { name: 'Import .icon', exact: true }).click();
  await expect(iconInput).toHaveCount(1);
  await iconInput.setInputFiles({
    name: 'Douglas.icon',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(douglasIcon, 'utf8'),
  });

  await expect(page.getByText('Imported 1 character.', { exact: true })).toBeVisible();
  await expect(page.getByText('Douglas', { exact: true })).toBeVisible();
  await expect(page.getByText(/Thrynn · Yeokin · Dreamer · Freelancer/)).toBeVisible();
  await expect(page.getByText('Ready for expedition', { exact: true })).toBeVisible();

  // Local-first persistence: the character survives a reload with no backend.
  await page.reload();
  await expect(page.getByText('Douglas', { exact: true })).toBeVisible();
  await expect(page.getByText('Imported 1 character.', { exact: true })).toHaveCount(0);
});
