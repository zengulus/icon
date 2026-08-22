import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Temporary preview config: the 9p-mounted workspace cannot serve chokidar
// fs.watch, so the dev server runs with watching disabled.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: '127.0.0.1', watch: null },
});
