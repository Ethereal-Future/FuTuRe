import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./testing/vitest.privacy.setup.js', './frontend/src/setupTests.js'],
    include: ['**/*.{test,spec}.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
      exclude: [
        'node_modules/**',
        'coverage/**',
        '**/*.config.{js,ts}',
        '**/dist/**',
        '**/build/**',
        'migration-logs/**',
        'test-reports/**',
        'mobile-tests/**',
        'backend/load-tests/**',
        'scripts/**',
        'testing/**',
        '**/*.test.{js,jsx}',
        '**/*.spec.{js,jsx}',
        '**/tests/helpers/**',
        'frontend/src/main.jsx',
        'frontend/src/setupTests.js',
      ],
      include: [
        'backend/src/**/*.js',
        'frontend/src/**/*.{js,jsx}',
      ],
    },
  },
});
