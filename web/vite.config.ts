import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The Comptoir, the client pages, and three alternative public sites (Le Film, L’Atelier, En direct).
// LX_ONLY=film,direct builds a subset (each site can be checked on its own while the others change).
const ALL = { comptoir: 'comptoir/index.html', client: 'client/index.html', film: 'film/index.html', atelier: 'atelier/index.html', direct: 'direct/index.html' } as const;
function entries() {
  const only = (process.env.LX_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
  const keys = (only.length ? only : Object.keys(ALL)) as (keyof typeof ALL)[];
  return Object.fromEntries(keys.map((k) => [k, here(ALL[k])]));
}

// Small apps built next to the static site.
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
      input: entries()
    }
  },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } }
});
