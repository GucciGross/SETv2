import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface JwtUser {
  id: string;
  email: string;
  name: string;
}

export function signToken(u: JwtUser): string {
  return jwt.sign(u, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token: string): JwtUser | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    if (!payload?.id) return null;
    return { id: payload.id, email: payload.email, name: payload.name };
  } catch {
    return null;
  }
}

/**
 * Fixed identity for internal service processes (channels listener). It is a
 * JWT subject, not a real user row — guards check for it explicitly and it
 * never passes requireSpace membership checks.
 */
export const SERVICE_IDENTITY: JwtUser = { id: 'set-service', email: 'service@set.local', name: 'SET Service' };

export function signServiceToken(): string {
  return jwt.sign({ ...SERVICE_IDENTITY, kind: 'service' }, config.jwtSecret, { expiresIn: '1h' });
}

export interface InvitePayload {
  spaceId: string;
  email: string;
  role: 'editor' | 'viewer';
}

export function signInviteToken(i: InvitePayload): string {
  return jwt.sign({ ...i, kind: 'invite' }, config.jwtSecret, { expiresIn: '7d' });
}

export function verifyInviteToken(token: string): InvitePayload | null {
  try {
    const p = jwt.verify(token, config.jwtSecret) as any;
    if (p?.kind !== 'invite' || !p?.spaceId || !p?.email) return null;
    return { spaceId: p.spaceId, email: String(p.email).toLowerCase(), role: p.role === 'viewer' ? 'viewer' : 'editor' };
  } catch {
    return null;
  }
}
