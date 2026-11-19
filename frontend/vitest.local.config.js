/**
 * Local vitest config for running the four bug-fix tests without a full npm install.
 * Aliases point at packages installed in /tmp/node_modules_test/node_modules.
 * Run with:
 *   /tmp/node_modules_test/node_modules/.bin/vitest run --config ./vitest.local.config.js
 */
import { defineConfig } from '/tmp/node_modules_test/node_modules/vitest/dist/config.js';
import react from '/tmp/node_modules_test/node_modules/@vitejs/plugin-react/dist/index.js';

const NM = '/tmp/node_modules_test/node_modules';

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: ['/workspace', NM] },
  },
  resolve: {
    alias: [
      { find: 'axios', replacement: `${NM}/axios/index.js` },
      { find: '@testing-library/react', replacement: `${NM}/@testing-library/react/pure.js` },
      { find: '@testing-library/jest-dom', replacement: `${NM}/@testing-library/jest-dom/dist/index.js` },
      { find: 'react/jsx-dev-runtime', replacement: `${NM}/react/jsx-dev-runtime.js` },
      { find: 'react/jsx-runtime', replacement: `${NM}/react/jsx-runtime.js` },
      { find: 'react-dom/client', replacement: `${NM}/react-dom/client.js` },
      { find: 'react-dom', replacement: `${NM}/react-dom/index.js` },
      { find: 'react', replacement: `${NM}/react/index.js` },
      { find: 'jsqr', replacement: `${NM}/jsqr/dist/jsQR.js` },
      { find: 'react-i18next', replacement: `${NM}/react-i18next/dist/commonjs/index.js` },
      { find: 'i18next', replacement: `${NM}/i18next/dist/esm/i18next.js` },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [`${NM}/@testing-library/jest-dom/dist/index.js`],
    include: [
      'src/utils/validateAmount.test.js',
      'src/components/AmountInput.test.jsx',
      'src/api/client.test.js',
      'src/components/QRScanner.test.jsx',
    ],
  },
});
