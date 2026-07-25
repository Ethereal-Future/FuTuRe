export default {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['react', 'prettier', '@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:prettier/recommended'],
  settings: {
    react: {
      version: 'detect',
    },
  },
  rules: {
    'no-shadow': 'error',
    'no-unused-vars': 'error',
    'no-console': 'warn',
    'prettier/prettier': 'error',
    'react/prop-types': 'off',
  },
  ignorePatterns: ['node_modules/', 'dist/', 'build/', 'coverage/'],
  overrides: [
    {
      files: ['frontend/**/*.{ts,tsx,js,jsx}'],
      env: {
        browser: true,
      },
    },
    {
      files: ['backend/**/*.{ts,tsx,js,jsx}'],
      env: {
        node: true,
      },
    },
  ],
};
