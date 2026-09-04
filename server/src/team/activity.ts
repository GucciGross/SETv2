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
  /** Feed + audit trail. `?type=` filters to one event type; .csv is the compliance export. */
  app.get('/spaces/:spaceId/activity', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const limit = Math.min(Number((req.query as any).limit ?? 50), 200);
    const type = (req.query as any).type as string | undefined;
    const rows = await q(
      `SELECT a.id, a.type, a.payload, a.created_at, u.name AS actor_name, u.email AS actor_email
       FROM activities a JOIN users u ON u.id = a.user_id
       WHERE a.space_id = $1 AND ($2::text IS NULL OR a.type = $2)
       ORDER BY a.created_at DESC LIMIT $3`,
      [spaceId, type || null, limit]
    );
    return { activities: rows };
  });

  /** Daily counts for the streak heatmap — one activity on a day lights that day. */
  app.get('/spaces/:spaceId/activity/heatmap', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q<{ date: string; events: number }>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date, count(*)::int AS events
       FROM activities
       WHERE space_id = $1 AND created_at > now() - interval '372 days'
       GROUP BY 1 ORDER BY 1`,
      [spaceId]
    );
    const active = new Set((rows as any[]).filter((r) => r.events > 0).map((r) => r.date));
    // Streaks walk the calendar: current counts back from today (or yesterday,
    // so a morning visit doesn't zero yesterday's run), longest scans forward.
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    let currentStreak = 0;
    const cursor = new Date();
    if (!active.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (active.has(dayKey(cursor))) {
      currentStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    let longestStreak = 0;
    let run = 0;
    for (let i = 0; i <= 372; i++) {
      const d = new Date(Date.now() - i * 86400000);
      if (active.has(dayKey(d))) {
        run++;
        longestStreak = Math.max(longestStreak, run);
      } else {
        run = 0;
      }
    }
    return { days: rows, currentStreak, longestStreak };
  });

  app.get('/spaces/:spaceId/activity.csv', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT a.type, a.payload, a.created_at, u.name AS actor_name, u.email AS actor_email
       FROM activities a JOIN users u ON u.id = a.user_id
       WHERE a.space_id = $1 ORDER BY a.created_at DESC LIMIT 5000`,
      [spaceId]
    );
    const cell = (v: unknown) => {
      const s =
        v == null
          ? ''
          : v instanceof Date
            ? v.toISOString()
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['timestamp,actor,email,event,detail'];
    for (const r of rows as any[]) {
      lines.push([r.created_at, r.actor_name, r.actor_email, r.type, r.payload].map(cell).join(','));
    }
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="activity-${spaceId.slice(0, 8)}.csv"`);
    return lines.join('\n');
  });
}

