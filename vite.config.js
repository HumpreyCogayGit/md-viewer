import { defineConfig } from 'vite';
import { SECURITY_HEADERS } from './security-headers.js';

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  build: {
    chunkSizeWarningLimit: 800,
  },
  preview: {
    headers: SECURITY_HEADERS,
  },
  worker: {
    format: 'es',
  },
  test: {
    // Quoted glob is expanded by Vitest, so nested folders are always discovered.
    include: ['src/**/*.test.{js,jsx}'],
    environment: 'node',
    setupFiles: ['./src/test/setup.js'],
    restoreMocks: true,
  },
});
