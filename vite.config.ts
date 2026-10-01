/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { serviceWorker } from './sw-plugin.ts';

export default defineConfig({
  // Relative asset paths, so the built site works from a sub-folder such as GitHub Pages' /Specimen/.
  base: './',
  plugins: [react(), tailwindcss(), serviceWorker()],
  // The match server (server/, run with wrangler) writes its own build output under .wrangler/: not ours to
  // watch or scan, and its files churn while it runs.
  server: { watch: { ignored: ['**/.wrangler/**'] } },
  optimizeDeps: { entries: ['index.html'] },
  test: {
    include: ['tests/**/*.test.ts'],
    // Many tests play whole matches: generous limits so a busy machine gives slow results, not false failures.
    testTimeout: 30000,
    environment: 'node',
  },
});
