import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { coreRoot, h5pRoot } from './runtime.js';
import { safeRelativePath } from './domain.js';

/** Serve trusted CODE only, never workspace content, parameters, temporary media or settings.
 * Stable URLs allow a single native editor runtime to survive SPA navigation safely.
 */
export async function h5pNativeAssetRoutes(app: FastifyInstance) {
  app.get('/h5p/assets/native/:kind/*', async (req, reply) => {
    const { kind, '*': path } = req.params as { kind: string; '*': string };
    if (!['core', 'editor', 'libraries'].includes(kind) || !safeRelativePath(path)) return reply.code(404).send({ error: 'H5P code asset not found.' });
    const root = resolve(kind === 'libraries' ? h5pRoot() : coreRoot(), kind);
    let file: string;
    try {
      file = await realpath(resolve(root, path));
      if (!file.startsWith(await realpath(root) + sep) || !(await stat(file)).isFile()) throw new Error();
    } catch { return reply.code(404).send({ error: 'H5P code asset not found.' }); }
    const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.otf': 'font/otf' };
    const type = types[extname(file).toLowerCase()];
    if (!type) return reply.code(404).send({ error: 'H5P code asset not found.' });
    reply.type(type).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=0, must-revalidate');
    if (type === 'text/css') {
      // Scope native editor CSS so upstream .group/.content rules cannot style SET chrome.
      // Relative font/image URLs still resolve next to the original CSS asset.
      const css = await readFile(file, 'utf8');
      return reply.send(`@scope (.set-h5p-native, .set-h5p-native-portal) {\n${css}\n}`);
    }
    return reply.send(createReadStream(file));
  });
}
