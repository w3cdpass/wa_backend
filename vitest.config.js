import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globals: true,
    setupFiles: ['./tests/setup.js'],
    testTimeout: 10000,
  },
});