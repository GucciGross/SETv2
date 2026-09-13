import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { bus } from '../lib/events.js';

export function installHealth(app: FastifyInstance, probe: () => Promise<boolean> = async () => {
  await pool.query({ text: 'SELECT 1', query_timeout: 1500 });
  return bus.ready();
}) {
  let started = false;
  let draining = false;
  app.get('/health', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { ok: true, name: 'SET', version: '2.1.0' };
  });
  const readiness = async (_req: any, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    if (!started || draining) return reply.code(503).send({ ok: false, state: draining ? 'draining' : 'starting' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ok = await Promise.race([probe(), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 2000); timer.unref?.(); })]);
      return reply.code(ok ? 200 : 503).send({ ok, state: ok ? 'ready' : 'dependency_unavailable' });
    } catch { return reply.code(503).send({ ok: false, state: 'dependency_unavailable' }); }
    finally { if (timer) clearTimeout(timer); }
  };
  app.get('/ready', readiness);
  app.get('/api/ready', readiness);
  return { started() { started = true; }, drain() { draining = true; } };
}
