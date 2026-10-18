import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
