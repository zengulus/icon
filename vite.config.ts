import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/icon/' : '/',
  plugins: [
    react(),
    {
      // The browser acceptance server uses a loopback IP rather than
      // `localhost` so it is isolated from a developer's normal service.
      // Keep that CSP relaxation out of every normal/dev and production page.
      name: 'e2e-loopback-websocket-csp',
      transformIndexHtml(html) {
        return mode === 'e2e'
          ? html.replace('ws://localhost:*;', 'ws://localhost:* ws://127.0.0.1:*;')
          : html;
      },
    },
  ],
  build: {
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1_500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('icon-1.5.json')) return 'icon-compendium';
          if (id.includes('foes-1.5.json')) return 'icon-foes';
          if (id.includes('mechanics-1.5.json')) return 'icon-mechanics';
          if (id.includes('rewards-1.5.json')) return 'icon-rewards';
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
  test: {
    environment: 'node',
    // Browser acceptance is owned by Playwright (`npm run test:e2e:browser`),
    // not Vitest's node runner.
    exclude: ['node_modules/**', 'dist/**', 'dist-server/**', 'e2e/**'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/rules/**/*.ts'],
    },
  },
}));
