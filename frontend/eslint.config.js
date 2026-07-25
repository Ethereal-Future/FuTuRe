import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
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
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        XMLSerializer: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        Image: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        alert: 'readonly',
        prompt: 'readonly',
        axios: 'readonly',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'no-shadow': ['error', { builtinGlobals: false, hoist: 'all', allow: [] }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'react/prop-types': 'off',
    },
  },
  prettier,
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**'],
  },
];
