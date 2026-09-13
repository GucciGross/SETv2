import type { FastifyInstance } from 'fastify';
import { one } from '../db.js';
import { requireSpace, requireUser } from '../lib/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLES = { notebookId: 'notebooks', pageId: 'pages', modelId: 'models3d', providerId: 'providers', subjectId: 'subjects' } as const;
export interface ScopeStore {
  belongs(table: string, id: string, spaceId: string): Promise<boolean>;
  ownsSession(id: string, userId: string): Promise<boolean>;
}
const store: ScopeStore = {
  async belongs(table, id, spaceId) {
    if (!Object.values(TABLES).includes(table as any)) return false;
    return !!(await one(`SELECT id FROM ${table} WHERE id = $1 AND space_id = $2`, [id, spaceId]));
  },
  async ownsSession(id, userId) { return !!(await one('SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2', [id, userId])); },
};
/** Enforce resource references before a route can retrieve, write, or begin SSE.
 * This complements the per-route membership checks; it never replaces them.
 */
export function installRequestScope(app: FastifyInstance, data: ScopeStore = store): void {
  app.addHook('preValidation', async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body as any : {};
    const params = (req.params || {}) as any;
    const forwarded = body.forwardedProps && typeof body.forwardedProps === 'object' ? body.forwardedProps : {};
    const spaceId = params.spaceId || body.spaceId || forwarded.spaceId;
    const contexts = [body, body.context, forwarded, forwarded.context].filter(c => c && typeof c === 'object');
    const references = contexts.flatMap(c => Object.entries(TABLES).filter(([key]) => c[key] !== undefined && c[key] !== null).map(([key, table]) => ({ id: c[key], table })));
    if (spaceId && references.length) {
      if (!(await requireSpace(req, reply, spaceId))) return;
      for (const { id, table } of references) {
        if (typeof id !== 'string' || !UUID.test(id)) return reply.code(400).send({ error: 'Invalid resource reference' });
        if (!(await data.belongs(table, id, spaceId))) return reply.code(404).send({ error: 'Resource not found in this workspace' });
      }
    }
    const session = /^\/api\/sessions\/([0-9a-f-]{36})(?:\/messages)?$/.exec(req.url.split('?')[0]);
    if (session) {
      const user = await requireUser(req, reply);
      if (!user) return;
      if (!(await data.ownsSession(session[1], user.id))) return reply.code(404).send({ error: 'Session not found' });
    }
  });
}
