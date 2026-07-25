import { defineConfig } from 'vitest/config';

// Minimal vitest config for mutation testing — only runs utility unit tests
// to avoid JSX parse errors in App.jsx and backend ESM issues.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'frontend/tests/utils.test.js',
    ],
  },
});
