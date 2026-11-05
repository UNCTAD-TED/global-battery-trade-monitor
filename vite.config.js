import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 600,
    emptyOutDir: true,
    rollupOptions: {
      input: { main: 'index.html' },
    },
  },
});
