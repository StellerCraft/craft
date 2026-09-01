import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    sequence: { shuffle: false },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@craft/types': path.resolve(__dirname, '../../packages/types/src'),
    },
  },
});
