import { defineConfig } from 'vitest/config';

// Backend-focused mutation config — runs backend service tests with Node environment and ESM support
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'backend/src/services/**/*.test.js',
      'backend/tests/**/*.test.js',
    ],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
