import { defineConfig } from '@playwright/test';

const realtimePort = Number(process.env.E2E_REALTIME_PORT ?? 48781);
const clientPort = Number(process.env.E2E_CLIENT_PORT ?? 48782);
const realtimeOrigin = `http://127.0.0.1:${realtimePort}`;
const clientOrigin = `http://127.0.0.1:${clientPort}`;

/**
 * Both web servers are deliberately local and isolated. The frontend runs a
 * Vite development server in its explicit `e2e` mode; the websocket service
 * admits `dev:` tokens only because NODE_ENV=test and ALLOW_DEV_AUTH=true are
 * set here together.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: clientOrigin,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node dist-server/server/index.js',
      url: `${realtimeOrigin}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        PORT: String(realtimePort),
        ALLOW_DEV_AUTH: 'true',
        ALLOWED_ORIGINS: clientOrigin,
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        DISCORD_WEBHOOK_URL: '',
      },
    },
    {
      command: `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${clientPort} --strictPort --mode e2e`,
      url: clientOrigin,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        VITE_E2E_AUTH: 'true',
        VITE_REALTIME_URL: `ws://127.0.0.1:${realtimePort}/realtime`,
        VITE_ENABLE_INCOMPLETE_VTT: 'true',
      },
    },
  ],
});
