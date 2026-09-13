import type { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { one, q } from '../db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface SessionIdentity { userId: string; version: number; sessionId: string; expires: number }
export function readSession(raw: string, asset = false): SessionIdentity | null {
  try {
    const p = jwt.verify(raw, config.jwtSecret, { algorithms: ['HS256'], ...(asset ? { audience: 'set-assets' } : {}) }) as jwt.JwtPayload;
    const userId = asset ? p.sub : p.id;
    if (!userId || !UUID.test(userId) || !Number.isFinite(p.exp)) return null;
    if (asset ? p.kind !== 'asset' : !!p.kind) return null;
    const version = p.ver ?? 0;
    if (!Number.isInteger(version) || version < 0) return null;
    return { userId, version, sessionId: (asset ? p.sid : p.jti) || createHash('sha256').update(raw).digest('hex'), expires: p.exp! };
  } catch { return null; }
}
export function presentedSession(req: FastifyRequest): SessionIdentity | null {
  const header = req.headers.authorization;
  const query = (req.query as any)?.token;
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : typeof query === 'string' ? query : '';
  if (raw) return readSession(raw);
  if (!/^\/api\/(files|captures)\//.test(req.url)) return null;
  const cookie = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('set_asset_session='))?.slice('set_asset_session='.length);
  return cookie ? readSession(cookie, true) : null;
}
export async function sessionActive(identity: SessionIdentity): Promise<boolean> {
  return !!(await one(
    `SELECT 1 FROM users u WHERE u.id = $1 AND u.session_version = $2
     AND NOT EXISTS (SELECT 1 FROM revoked_sessions r WHERE r.session_id = $3 AND r.expires_at > now())`,
    [identity.userId, identity.version, identity.sessionId]));
}
export async function revokeSession(identity: SessionIdentity): Promise<void> {
  await q(`INSERT INTO revoked_sessions(session_id, user_id, expires_at) VALUES ($1, $2, $3)
           ON CONFLICT (session_id) DO NOTHING`, [identity.sessionId, identity.userId, new Date(identity.expires * 1000)]);
}
export function installSessionGuard(app: FastifyInstance, active = sessionActive): void {
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (path === '/health' || path === '/ready' || path === '/api/health' || path === '/api/ready' || path === '/api/meta') return;
    // An old bearer sent by the client must not prevent signing in again or resetting a password.
    if (/^\/api\/auth\/(login|register|forgot|reset|logout|oidc(?:\/.*)?)$/.test(path)) return;
    if (/^\/api\/sessions\/[0-9a-f-]{36}(?:\/messages)?$/.test(path)) return; // requireResourceSpace already scopes by space membership
    const identity = presentedSession(req);
    if (!identity) return; // Existing route guards still reject missing/invalid credentials.
    try {
      if (!(await active(identity))) return reply.code(401).header('Cache-Control', 'no-store').send({ error: 'Session expired or revoked' });
    } catch {
      return reply.code(503).send({ error: 'Authentication is temporarily unavailable' });
    }
  });
}
