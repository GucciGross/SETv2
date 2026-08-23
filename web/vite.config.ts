import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS_DEV=1 npm run dev  → https (required for iOS to honor the PWA manifest —
// iOS ignores display:standalone over plain http on LAN IPs).
// npm run dev              → plain http (local dev / tooling).
export default defineConfig({
  plugins: [react(), ...(process.env.HTTPS_DEV === '1' ? [basicSsl()] : [])],
  server: {
    host: true, // expose on the LAN for phone / other-device testing
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 4000 },
});
