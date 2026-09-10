import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, SERVICE_IDENTITY } from '../lib/tokens.js';
import { codexOAuthEnabled, CodexError } from './policy.js';
import { codexSessions } from './service.js';

/** No generic RPC endpoint, imported token, client ID, or client-selected user/home. */
export async function codexRoutes(app: FastifyInstance, sessions: Pick<typeof codexSessions, 'status' | 'login' | 'cancelLogin' | 'disconnect' | 'select' | 'close'> = codexSessions) {
  await app.register(async api => {
    api.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store');
      // Bearer header only: query-string tokens cannot authorize account operations.
      const header = req.headers.authorization;
      const user = header?.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
      if (!user || user.id === SERVICE_IDENTITY.id) return reply.code(401).send({ error: 'A personal SET session is required.' });
      req.user = user;
      if (req.url.split('?')[0].endsWith('/capabilities')) return;
      if (!codexOAuthEnabled()) return reply.code(404).send({ error: 'Codex account sign-in is unavailable on this deployment.' });
    });
    api.setErrorHandler((error, _req, reply) => {
      if (error instanceof CodexError) return reply.code(error.statusCode).send({ error: error.message });
      if (error.validation) return reply.code(400).send({ error: 'Invalid Codex account request.' });
      // Neither raw app-server responses nor filesystem paths are public errors.
      return reply.code(503).send({ error: 'Codex is unavailable. Check its installation and the self-hosted server configuration.' });
    });
    api.get('/capabilities', async () => ({ available: codexOAuthEnabled(), personalOnly: true }));
    api.get('/account', async req => sessions.status(req.user!.id));
    const emptyBody = { schema: { body: { type: 'object', additionalProperties: false, properties: {} } } };
    api.post('/login', emptyBody, async req => sessions.login(req.user!.id));
    api.post('/login/cancel', emptyBody, async req => sessions.cancelLogin(req.user!.id));
    api.post('/logout', emptyBody, async req => sessions.disconnect(req.user!.id));
    api.put('/selection', { schema: { body: {
      type: 'object', required: ['enabled'], additionalProperties: false,
      properties: { enabled: { type: 'boolean' } },
    } } }, async req => sessions.select(req.user!.id, (req.body as { enabled: boolean }).enabled));
  }, { prefix: '/codex' });
  app.addHook('onClose', async () => sessions.close());
}
