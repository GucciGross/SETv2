import type { FastifyInstance } from 'fastify';
import { q } from '../db.js';
import { requireSpace } from '../lib/http.js';
import { bus } from '../lib/events.js';

/** Fire-and-forget activity recording; never breaks the parent request. */
export async function recordActivity(spaceId: string, userId: string, type: string, payload: Record<string, any> = {}) {
  try {
    await q(`INSERT INTO activities (space_id, user_id, type, payload) VALUES ($1, $2, $3, $4)`, [
      spaceId,
      userId,
      type,
      JSON.stringify(payload),
    ]);
    bus.publish({ spaceId, type: 'activity', payload: { type } });
  } catch {
    /* activity is best-effort */
  }
}

export async function activityRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/activity', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const limit = Math.min(Number((req.query as any).limit ?? 50), 200);
    const rows = await q(
      `SELECT a.id, a.type, a.payload, a.created_at, u.name AS actor_name
       FROM activities a JOIN users u ON u.id = a.user_id
       WHERE a.space_id = $1 ORDER BY a.created_at DESC LIMIT $2`,
      [spaceId, limit]
    );
    return { activities: rows };
  });
}

