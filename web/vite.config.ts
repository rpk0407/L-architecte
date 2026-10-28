import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Two small apps (the Comptoir for the team, the client pages) built next to the static site.
// public/ (the existing site, images, QR script) is copied as-is into dist/.
export default defineConfig({
  root: here('.'),
  base: '/',
  publicDir: here('../public'),
  plugins: [react()],
  build: {
    outDir: here('../dist'),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      input: { comptoir: here('comptoir/index.html'), client: here('client/index.html'), moi: here('moi/index.html') }
    }
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } }
});
