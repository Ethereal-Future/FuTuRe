import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => ({
  // CDN base URL: set VITE_CDN_URL in .env to serve assets from CDN
  base: process.env.VITE_CDN_URL ?? '/',
  plugins: [
    react(),
    // Bundle analysis: generates stats.html after `npm run build`
    visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true }),
    // Sentry: Upload source maps for error reporting (only in production)
    mode === 'production' && process.env.VITE_SENTRY_DSN
      ? sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          release: process.env.VITE_APP_VERSION || 'unknown',
          sourceMaps: { filesToDeleteAfterUpload: ['**/*.map'] },
        })
      : null,
  ].filter(Boolean),
  server: {
    port: 3000,
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: {
    sourcemap: true,
    // Code splitting: vendor chunk + per-route lazy chunks
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:        ['react', 'react-dom'],
          motion:        ['framer-motion'],
          stellar:       ['@stellar/stellar-base'],
          stellar:       ['@stellar/stellar-sdk'],
/**
 * Vite plugin that validates required VITE_* environment variables at build
 * time. Fails the build immediately if any required variable is missing or
 * invalid, rather than shipping a broken production bundle.
 *
 * Keep this list in sync with frontend/src/env.js.
 */
function envValidationPlugin(requiredVars) {
  return {
    name: 'vite-plugin-env-validation',
    // `configResolved` fires after Vite has merged all env sources, so
    // process.env, .env files, and --mode overrides are all visible here.
    configResolved(config) {
      if (config.command !== 'build') return; // only enforce on production builds

      const missing = requiredVars.filter((key) => {
        const value = config.env[key];
        return value === undefined || value === null || value === '';
      });

      if (missing.length > 0) {
        throw new Error(
          `[env-validation] Build aborted — missing required environment variable(s):\n` +
            missing.map((k) => `  • ${k}`).join('\n') +
            '\n\nCopy frontend/.env.example to frontend/.env and fill in the required values.'
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load env so the plugin can inspect variables resolved for this mode
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // CDN base URL: set VITE_CDN_URL in .env to serve assets from CDN
    base: env.VITE_CDN_URL || '/',
    plugins: [
      react(),
      // Fail the build early if required env vars are absent.
      // Keep this list in sync with the ENV_SCHEMA in src/env.js.
      envValidationPlugin(['VITE_API_URL']),
      // Bundle analysis: generates stats.html after `npm run build`
      visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true }),
    ],
    server: {
      port: 3000,
      proxy: { '/api': 'http://localhost:3001' },
    },
    build: {
      // Code splitting: vendor chunk + per-route lazy chunks
      rollupOptions: {
        output: {
          manualChunks: {
            vendor:  ['react', 'react-dom'],
            motion:  ['framer-motion'],
            stellar: ['@stellar/stellar-sdk'],
          },
          // Ensure hashed filenames for immutable CDN caching
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
      // Performance budget: warn if any chunk > 500 kB
      chunkSizeWarningLimit: 500,
    },
  };
});
