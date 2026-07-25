import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['contracts/**/*.test.js'],
    testTimeout: 60000,
    server: {
      deps: {
        // Don't transform backend source — it's native ESM run by Node directly
        external: ['backend/**', /backend\//],
      },
    },
  },
});
