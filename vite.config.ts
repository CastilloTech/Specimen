/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built site works from a sub-folder such as GitHub Pages' /Specimen/.
  base: './',
  plugins: [react(), tailwindcss()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
