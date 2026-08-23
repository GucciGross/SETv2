import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one } from './db.js';

/** Public waitlist for the hosted SET cloud offering. */
export async function waitlistRoutes(app: FastifyInstance) {
  app.post('/waitlist', async (req, reply) => {
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
