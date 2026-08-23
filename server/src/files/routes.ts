import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';
import { config } from '../config.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

/** Binary attachments (images, attachments) for pages. UUID-addressed, unguessable. */
export async function fileRoutes(app: FastifyInstance) {
  app.post('/spaces/:spaceId/files', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const files = req.files ? await req.files() : [];
    const created: any[] = [];
    for await (const file of files) {
      const buf = await file.toBuffer();
      const dir = path.join(config.dataDir, 'files', spaceId);
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(file.filename).toLowerCase() || '';
      const stored = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(dir, stored), buf);
      const row = await one<any>(
        `INSERT INTO files (space_id, name, mime, size_bytes, path) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, mime, size_bytes`,
        [spaceId, file.filename, file.mimetype || MIME_BY_EXT[ext] || 'application/octet-stream', buf.length, path.join(dir, stored)]
      );
      created.push(row);
    }
    return { files: created };
  });

  app.get('/files/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const file = await one<{ name: string; mime: string; path: string; space_id: string }>(
      `SELECT name, mime, path, space_id FROM files WHERE id = $1`,
      [id]
    );
    if (!file || !fs.existsSync(file.path)) return reply.code(404).send({ error: 'File not found' });
    // UUID-addressed attachments are unguessable; no auth gate keeps <img> tags simple.
    reply.header('content-type', file.mime);
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    return fs.createReadStream(file.path);
  });

  app.get('/spaces/:spaceId/files', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT id, name, mime, size_bytes, created_at FROM files WHERE space_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [spaceId]
    );
    return { files: rows };
  });
}
