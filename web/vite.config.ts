import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve as pathResolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const nodeRequire = createRequire(import.meta.url);

// CopilotKit v2's stylesheet is Tailwind v4 output (@layer …). Our Tailwind v3
// PostCSS pipeline rejects it, and even ?raw imports of .css go through the
// vite:css plugin — so serve it as a virtual string module instead; main.tsx
// injects it as a <style> tag at runtime.
function copilotkitRawStyles() {
  const pkgDir = nodeRequire.resolve('@copilotkit/react-core/package.json').replace(/package\.json$/, '');
  const pkgCss = `${pkgDir}dist/v2/index.css`;
  return {
    name: 'copilotkit-raw-styles',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (source === 'virtual:copilotkit-v2-styles') return '\0virtual:copilotkit-v2-styles';
      // Match the stylesheet however it arrives: the package's own relative
      // self-import ("./index.css" from dist/v2/), or the ABSOLUTE path the
      // dep optimizer rewrites it to after pre-bundling — without the second
      // form, dep-optimized dev runs push the v4 css into vite:css → postcss
      // explodes on @layer. Compare resolved paths, not specifier strings.
      const candidate = source.startsWith('.') && importer
        ? pathResolve(importer, '..', source)
        : source;
      if (candidate === pkgCss) return '\0virtual:copilotkit-v2-styles';
      return null;
    },
    load(id: string) {
      if (id === '\0virtual:copilotkit-v2-styles') {
        const css = readFileSync(pkgCss, 'utf8');
        return `export default ${JSON.stringify(css)}`;
      }
      return null;
    },
  };
}

// HTTPS_DEV=1 npm run dev  → https (required for iOS to honor the PWA manifest —
// iOS ignores display:standalone over plain http on LAN IPs).
// npm run dev              → plain http (local dev / tooling).
export default defineConfig({
  plugins: [react(), copilotkitRawStyles(), ...(process.env.HTTPS_DEV === '1' ? [basicSsl()] : [])],
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
