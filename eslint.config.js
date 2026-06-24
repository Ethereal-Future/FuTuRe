import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  AbortSignal: 'readonly',
  AbortController: 'readonly',
  performance: 'readonly',
  structuredClone: 'readonly',
  queueMicrotask: 'readonly',
  crypto: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  fetch: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  indexedDB: 'readonly',
  URLSearchParams: 'readonly',
  URL: 'readonly',
  performance: 'readonly',
  WebSocket: 'readonly',
  BroadcastChannel: 'readonly',
  Notification: 'readonly',
  XMLSerializer: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  Image: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  alert: 'readonly',
  prompt: 'readonly',
};

export default [
  js.configs.recommended,
  {
    files: ['backend/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'no-shadow': ['error', { builtinGlobals: false, hoist: 'all', allow: [] }],
    },
  },
  {
    files: ['backend/tests/**/*.js', 'testing/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-shadow': ['error', { builtinGlobals: false, hoist: 'all', allow: [] }],
    },
  },
  // Files that use require() (CJS-style imports inside ESM modules)
  {
    files: [
      'backend/src/notifications/channels/email.js',
      'backend/src/notifications/channels/sms.js',
    ],
    languageOptions: {
      globals: { ...nodeGlobals, require: 'readonly' },
    },
  },
  // Frontend source files — browser environment
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'no-shadow': ['error', { builtinGlobals: false, hoist: 'all', allow: [] }],
      // Disable rules from plugins not installed at root scope
      'react-hooks/exhaustive-deps': 'off',
      'jsx-a11y/no-autofocus': 'off',
    },
  },
  prettier,
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**'],
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      // Frontend has its own eslint.config.js; exclude from root backend config
      'frontend/**',
      // Standalone Node.js utility scripts — not part of the app bundle
      'scripts/**',
    ],
  },
];
