import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command }) => ({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: command === 'serve'
      ? { '@nimiq/mini-app-sdk': resolve(__dirname, 'src/nimiq/stub-sdk.js') }
      : {},
  },
  optimizeDeps: {
    exclude: ['@nimiq/hub-api']
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    }
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  }
}));
