import type { FastifyReply, FastifyRequest } from 'fastify';
import { one } from '../db.js';
import { verifyToken, type JwtUser } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtUser;
  }
}

export function getUser(req: FastifyRequest): JwtUser | null {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ((req.query as any)?.token as string);
  return token ? verifyToken(token) : null;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<JwtUser | null> {
  const user = getUser(req);
  if (!user) {
    reply.code(401).send({ error: 'Unauthorized' });
    return null;
  }
  req.user = user;
  return user;
}

export type Role = 'owner' | 'editor' | 'viewer';

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export async function getRole(userId: string, spaceId: string): Promise<Role | null> {
  const row = await one<{ role: Role }>(
    'SELECT role FROM memberships WHERE user_id = $1 AND space_id = $2',
    [userId, spaceId]
  );
  return row?.role ?? null;
}

/** Guard a space-scoped request. Returns null (and sends the reply) when denied. */
export async function requireSpace(
  req: FastifyRequest,
  reply: FastifyReply,
  spaceId: unknown,
  min: Role = 'viewer'
): Promise<Role | null> {
  if (typeof spaceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(spaceId)) {
    reply.code(400).send({ error: 'Invalid space id' });
    return null;
  }
  const user = await requireUser(req, reply);
  if (!user) return null;
  const role = await getRole(user.id, spaceId);
  if (!role) {
    reply.code(404).send({ error: 'Space not found' });
    return null;
  }
  if (ROLE_RANK[role] < ROLE_RANK[min]) {
    reply.code(403).send({ error: `Requires ${min} access` });
    return null;
  }
  return role;
}

/** Resolve the owning space of a resource (some tables need a join). */
const SPACE_LOOKUP: Record<string, string> = {
  chunks: `SELECT n.space_id FROM chunks c JOIN notebooks n ON n.id = c.notebook_id WHERE c.id = $1`,
  sources: `SELECT n.space_id FROM sources s JOIN notebooks n ON n.id = s.notebook_id WHERE s.id = $1`,
  db_rows: `SELECT d.space_id FROM db_rows r JOIN databases d ON d.id = r.database_id WHERE r.id = $1`,
  db_views: `SELECT d.space_id FROM db_views v JOIN databases d ON d.id = v.database_id WHERE v.id = $1`,
};

/** Resolve the owning space of a resource and check access. */
export async function requireResourceSpace(
  req: FastifyRequest,
  reply: FastifyReply,
  table: string,
  id: unknown,
  min: Role = 'viewer'
): Promise<{ spaceId: string; role: Role } | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    reply.code(400).send({ error: 'Invalid id' });
    return null;
  }
  const user = await requireUser(req, reply);
  if (!user) return null;
  const lookup = SPACE_LOOKUP[table] ?? `SELECT space_id FROM ${table} WHERE id = $1`;
  const row = await one<{ space_id: string }>(lookup, [id]);
  if (!row) {
    reply.code(404).send({ error: 'Not found' });
    return null;
  }
  const role = await getRole(user.id, row.space_id);
  if (!role) {
    reply.code(404).send({ error: 'Not found' });
    return null;
  }
  if (ROLE_RANK[role] < ROLE_RANK[min]) {
    reply.code(403).send({ error: `Requires ${min} access` });
    return null;
  }
  return { spaceId: row.space_id, role };
}

/** Coerce a request param to a uuid string ('' when invalid — guards downstream revalidate). */
export const rid = (v: unknown): string =>
  typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : '';
