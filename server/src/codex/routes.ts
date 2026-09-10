import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/http.js';
import { codexOAuthEnabled } from './policy.js';

/**
 * Capability surface for self-hosted Codex sign-in.
 * The actual app-server account session is intentionally kept behind the
 * deployment gate and can be expanded without changing the cloud product.
 */
export async function codexRoutes(app: FastifyInstance) {
  app.get('/codex/capabilities', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    reply.header('Cache-Control', 'no-store');
    return { available: codexOAuthEnabled(), personalOnly: true };
  });

  app.post('/codex/login', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    reply.header('Cache-Control', 'no-store');
    if (!codexOAuthEnabled()) return reply.code(404).send({ error: 'Codex sign-in is unavailable on this deployment.' });
    return reply.code(501).send({ error: 'Codex app-server sign-in is enabled but requires a server-side Codex app-server session provider.' });
  });
}
