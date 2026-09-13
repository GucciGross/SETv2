import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export interface JwtUser {
  id: string;
  email: string;
  name: string;
}

export function signToken(u: JwtUser & { sessionVersion?: number }): string {
  // Never serialize an entire database row (password hash, provider secrets, etc.).
  return jwt.sign({ id: u.id, email: u.email, name: u.name, ver: u.sessionVersion ?? 0 }, config.jwtSecret,
    { algorithm: 'HS256', expiresIn: '30d', jwtid: randomUUID() });
}

export function verifyToken(token: string): JwtUser | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as any;
    if (!payload?.id) return null;
    return { id: payload.id, email: payload.email, name: payload.name };
  } catch { return null; }
}

/** Internal service identities never pass workspace membership checks. */
export const SERVICE_IDENTITY: JwtUser = { id: 'set-service', email: 'service@set.local', name: 'SET Service' };
export function signServiceToken(): string {
  return jwt.sign({ ...SERVICE_IDENTITY, kind: 'service' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
}

export interface InvitePayload {
  spaceId: string;
  email: string;
  role: 'editor' | 'viewer';
}
export function signInviteToken(i: InvitePayload): string {
  return jwt.sign({ ...i, kind: 'invite' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '7d' });
}
export function verifyInviteToken(token: string): InvitePayload | null {
  try {
    const p = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as any;
    if (p?.kind !== 'invite' || !p?.spaceId || !p?.email) return null;
    return { spaceId: p.spaceId, email: String(p.email).toLowerCase(), role: p.role === 'viewer' ? 'viewer' : 'editor' };
  } catch { return null; }
}
