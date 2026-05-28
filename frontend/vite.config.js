import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => ({
  // CDN base URL: set VITE_CDN_URL in .env to serve assets from CDN
  base: process.env.VITE_CDN_URL ?? '/',
  plugins: [
    react(),
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
          vendor:        ['react', 'react-dom'],
          motion:        ['framer-motion'],
          stellar:       ['@stellar/stellar-sdk'],
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
}));
