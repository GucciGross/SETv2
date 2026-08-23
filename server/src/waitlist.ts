import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one } from './db.js';

const wlHits: { n: number; reset: number } | null = null as any;
const wl = new Map<string, { n: number; reset: number }>();
function wlLimited(ip: string): boolean {
  const now = Date.now();
  const h = wl.get(ip);
  if (!h || h.reset < now) { wl.set(ip, { n: 1, reset: now + 60_000 }); return false; }
  h.n += 1;
  return h.n > 5;
}
void wlHits;

/** Public waitlist for the hosted SET cloud offering. */
export async function waitlistRoutes(app: FastifyInstance) {
  app.post('/waitlist', async (req, reply) => {
    if (wlLimited(req.ip)) return reply.code(429).send({ error: 'Too many requests' });
    const body = z
      .object({
        email: z.string().email().max(200),
        note: z.string().max(500).optional(),
      })
      .parse(req.body);
    const existing = await one<{ id: string }>(`SELECT id FROM waitlist WHERE email = $1`, [body.email.toLowerCase()]);
    if (existing) return { ok: true, already: true };
    await one(
      `INSERT INTO waitlist (email, note) VALUES ($1, $2) RETURNING id`,
      [body.email.toLowerCase(), body.note ?? null]
    );
    return { ok: true, already: false };
  });
}
