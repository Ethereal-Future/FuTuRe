import { defineConfig } from 'vitest/config';

// Mutation testing config for both frontend utilities and backend services
// Avoids JSX files (App.jsx) and uses Node environment for backend services
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'frontend/tests/utils.test.js',
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
