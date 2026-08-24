import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { one, q } from '../db.js';
import { config } from '../config.js';
import { getUser } from '../lib/http.js';

/**
 * First-party OAuth 2.1 authorization server for MCP (RFC 9728 + 7591 + PKCE S256).
 * Access/refresh tokens are JWTs carrying { sub, space, scope, client_id, jti };
 * the raw values are also stored hashed so operators can revoke them.
 */

export interface McpTokenClaims {
  sub: string;
  space: string;
  scope: string;
  client_id: string;
  jti: string;
  typ: 'access' | 'refresh';
}

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const b64url = (buf: Buffer) => buf.toString('base64url');

export function issuerUrl(req: any): string {
  const proto = req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost:4000';
  return `${proto}://${host}`;
}

export function verifyMcpToken(token: string): McpTokenClaims | null {
  try {
    const claims = jwt.verify(token, config.jwtSecret) as any;
    if (claims.typ !== 'access') return null;
    return claims as McpTokenClaims;
  } catch {
    return null;
  }
}

export async function issueTokenPair(userId: string, spaceId: string, clientId: string, scope: string) {
  const access = jwt.sign({ sub: userId, space: spaceId, scope, client_id: clientId, typ: 'access' }, config.jwtSecret, {
    expiresIn: '12h',
    jwtid: crypto.randomUUID(),
  });
  const refresh = jwt.sign({ sub: userId, space: spaceId, scope, client_id: clientId, typ: 'refresh' }, config.jwtSecret, {
    expiresIn: '30d',
    jwtid: crypto.randomUUID(),
  });
  await q(
    `INSERT INTO mcp_tokens (user_id, space_id, client_id, scope, token_hash, refresh_hash) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, spaceId, clientId, scope, sha(access), sha(refresh)]
  );
  return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 12 * 3600 };
}

export async function touchToken(accessToken: string, userId: string, clientId: string) {
  await q(
    `UPDATE mcp_tokens SET last_used_at = now() WHERE token_hash = $1 AND user_id = $2`,
    [sha(accessToken), userId]
  ).catch(() => {});
  await q(`UPDATE mcp_clients SET last_seen_at = now() WHERE client_id = $1`, [clientId]).catch(() => {});
}

export async function isRevoked(accessToken: string): Promise<boolean> {
  const row = await one<{ status: string }>(`SELECT status FROM mcp_tokens WHERE token_hash = $1`, [sha(accessToken)]);
  return !row || row.status !== 'active';
}

/** In-flight authorization codes (single-process; 10 min TTL). */
const codes = new Map<string, { userId: string; spaceId: string; clientId: string; scope: string; challenge: string; redirectUri: string; expires: number }>();

export function storeCode(userId: string, spaceId: string, clientId: string, scope: string, challenge: string, redirectUri: string) {
  const code = crypto.randomBytes(32).toString('hex');
  codes.set(code, { userId, spaceId, clientId, scope, challenge, redirectUri, expires: Date.now() + 10 * 60_000 });
  return code;
}

export function takeCode(code: string) {
  const rec = codes.get(code);
  codes.delete(code);
  if (!rec || rec.expires < Date.now()) return null;
  return rec;
}

export function pkceMatches(challenge: string, verifier: string): boolean {
  return crypto.createHash('sha256').update(verifier).digest('base64url') === challenge;
}

export const SCOPE_CHOICES = [
  { value: 'mcp:read', label: 'Read-only', desc: 'Search, read pages, databases, notebooks, tasks and activity.' },
  { value: 'mcp:read mcp:write', label: 'Read & write', desc: 'Also create and edit pages, comments, rows, sources and study material.' },
];

export { sha, getUser };
