import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/icon/' : '/',
  plugins: [react()],
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
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('node_modules/react')) return 'react';
        },
      },
    },
  },
  test: {
    environment: 'node',
    exclude: ['node_modules/**', 'dist/**', 'dist-server/**'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/rules/**/*.ts'],
    },
  },
}));
