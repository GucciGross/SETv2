import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db.js';
import { getRole, getUser } from '../lib/http.js';
import { verifyToken } from '../lib/tokens.js';

const COOKIE = 'set_asset_session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_PATH = /^\/api\/files\/([0-9a-f-]{36})$/i;
const SHARE = /^[A-Za-z0-9_-]{16,64}$/;
const SAFE_INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

// The boundary prevents treating a suffix of an external URL as a local URL.
const REFERENCES = /(^|[\s"'(<])((?:https?:\/\/|\/\/)[^\s"'<>()[\]]+|\/api\/files\/[0-9a-f-]{36}(?:\?[^\s"'<>()[\]]*)?)/gi;
function localFileId(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin) return null;
    const id = FILE_PATH.exec(url.pathname)?.[1];
    return id && UUID.test(id) ? id.toLowerCase() : null;
  } catch { return null; }
}
export function referencedFileIds(markdown: string, origin = config.appUrl || 'http://localhost:5173'): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(new RegExp(REFERENCES))) {
    const id = localFileId(match[2], origin);
    if (id) ids.push(id);
  }
  return ids;
}
export function sharedFileLinks(markdown: string, token: string, origin = config.appUrl || 'http://localhost:5173'): string {
  return markdown.replace(new RegExp(REFERENCES), (full, prefix: string, value: string) => {
    const id = localFileId(value, origin);
    // Drop legacy query tokens rather than publishing a user's bearer token.
    return id ? `${prefix}/api/files/${id}?share=${encodeURIComponent(token)}` : full;
  });
}

function assetUser(req: FastifyRequest): string | null {
  // Keep existing explicit bearer/query readers working. Cookies authorize
  // only the two asset read routes below, never ordinary API operations.
  if (req.headers.authorization || (req.query as any)?.token) {
    const id = getUser(req)?.id;
    return id && UUID.test(id) ? id : null;
  }
  const cookie = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!cookie) return null;
  try {
    const value = jwt.verify(cookie, config.jwtSecret, { algorithms: ['HS256'], audience: 'set-assets' }) as jwt.JwtPayload;
    return value.kind === 'asset' && value.sub && UUID.test(value.sub) ? value.sub : null;
  } catch { return null; }
}

export interface Asset {
  id: string; spaceId: string; path: string; name: string; mime: string;
}
export interface AssetStore {
  find(kind: 'file' | 'capture', key: string): Promise<Asset | null>;
  member(userId: string, spaceId: string): Promise<boolean>;
  shared(token: string, file: Asset): Promise<boolean>;
}
const defaultStore: AssetStore = {
  async find(kind, key) {
    if (kind === 'capture') {
      const row = await one<{ id: string; space_id: string; file: string }>('SELECT id, space_id, file FROM captures WHERE file = $1', [key]);
      return row ? { id: row.id, spaceId: row.space_id, path: join(config.dataDir, 'captures', row.file), name: row.file, mime: 'image/png' } : null;
    }
    const row = await one<{ id: string; space_id: string; path: string; name: string; mime: string }>('SELECT id, space_id, path, name, mime FROM files WHERE id = $1', [key]);
    return row ? { id: row.id, spaceId: row.space_id, path: row.path, name: row.name, mime: row.mime } : null;
  },
  async member(userId, spaceId) { return !!(await getRole(userId, spaceId)); },
  async shared(token, file) {
    const page = await one<{ markdown: string }>(
      `SELECT p.markdown FROM share_links s JOIN pages p ON p.id = s.page_id
       WHERE s.token = $1 AND s.revoked_at IS NULL AND p.deleted_at IS NULL AND p.space_id = $2`,
      [token, file.spaceId]);
    return !!page && referencedFileIds(page.markdown || '').includes(file.id.toLowerCase());
  },
};

/** Install on the root instance before routes. No authentication policy changes
 * for write APIs: the short-lived, HttpOnly cookie has no normal JWT `id` claim.
 */
export function installAssetAccess(app: FastifyInstance, store: AssetStore = defaultStore): void {
  app.addHook('onRequest', async (req, reply) => {
    const header = req.headers.authorization;
    if (!req.url.startsWith('/api/') || !header?.startsWith('Bearer ')) return;
    const raw = header.slice(7);
    const user = verifyToken(raw);
    if (!user || !UUID.test(user.id)) return;
    const decoded = jwt.decode(raw) as jwt.JwtPayload | null;
    const ttl = Math.min(300, Math.max(0, (decoded?.exp || 0) - Math.floor(Date.now() / 1000)));
    if (ttl <= 0) return;
    const token = jwt.sign({ kind: 'asset' }, config.jwtSecret, { algorithm: 'HS256', subject: user.id, audience: 'set-assets', expiresIn: ttl });
    const secure = config.appUrl.startsWith('https://') || req.protocol === 'https';
    reply.header('Set-Cookie', `${COOKIE}=${token}; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=${ttl}${secure ? '; Secure' : ''}`);
    reply.header('Cache-Control', 'private, no-store');
  });
  app.delete('/api/assets/session', async (req, reply) => {
    const secure = config.appUrl.startsWith('https://') || req.protocol === 'https';
    reply.header('Set-Cookie', `${COOKIE}=; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
    reply.header('Cache-Control', 'no-store');
    return { ok: true };
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const token = /^\/api\/share\/([A-Za-z0-9_-]{16,64})$/.exec(req.url.split('?')[0])?.[1];
    if (!token || reply.statusCode !== 200 || typeof payload !== 'string') return payload;
    try {
      const body = JSON.parse(payload);
      if (typeof body?.page?.markdown !== 'string') return payload;
      body.page.markdown = sharedFileLinks(body.page.markdown, token);
      reply.header('Cache-Control', 'no-store');
      return JSON.stringify(body);
    } catch { return payload; }
  });

  for (const kind of ['file', 'capture'] as const) {
    app.get(kind === 'file' ? '/api/files/:key' : '/api/captures/:key', async (req, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      reply.header('Vary', 'Cookie, Authorization');
      const key = String((req.params as any).key || '');
      if (kind === 'file' ? !UUID.test(key) : !/^[a-f0-9-]+\.png$/.test(key)) return reply.code(400).send({ error: 'Invalid asset' });
      const userId = assetUser(req);
      const share = typeof (req.query as any)?.share === 'string' ? (req.query as any).share as string : '';
      if (!userId && !(kind === 'file' && SHARE.test(share))) return reply.code(401).send({ error: 'Unauthorized' });
      const asset = await store.find(kind, key);
      if (!asset) return reply.code(404).send({ error: 'Not found' });
      const allowed = (userId && await store.member(userId, asset.spaceId)) ||
        (kind === 'file' && SHARE.test(share) && await store.shared(share, asset));
      if (!allowed || !fs.existsSync(asset.path)) return reply.code(404).send({ error: 'Not found' });
      const mime = (asset.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
      reply.header('Content-Type', mime);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Security-Policy', "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'");
      const name = encodeURIComponent(asset.name).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
      reply.header('Content-Disposition', SAFE_INLINE.has(mime) ? 'inline' : `attachment; filename*=UTF-8''${name}`);
      return fs.createReadStream(asset.path);
    });
  }
}
