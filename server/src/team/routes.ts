import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireUser, rid } from '../lib/http.js';
import { recordActivity } from './activity.js';
import { notifyUser } from './push.js';

/**
 * Team layer v1: notifications feed, page comments, and per-member progress
 * roll-ups for assigned learning paths.
 */

/** GET /notifications — stored notifications + synthesized due-soon entries. */
export async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const stored = await q(
      `SELECT n.*, s.name AS space_name FROM notifications n
       JOIN spaces s ON s.id = n.space_id
       WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 50`,
      [user.id]
    );

    // synthesized due-soon: paths assigned to me, not fully done, due within 7 days
    const dueSoon = await q(
      `SELECT lp.id AS path_id, lp.title, lp.due_date, lp.space_id, s.name AS space_name,
        (SELECT count(*)::int FROM jsonb_array_elements(lp.items)) AS total,
        (SELECT count(*)::int FROM path_progress pp WHERE pp.path_id = lp.id AND pp.user_id = $1 AND pp.done) AS done
       FROM learning_paths lp
       JOIN spaces s ON s.id = lp.space_id
       JOIN memberships m ON m.space_id = lp.space_id AND m.user_id = $1
       WHERE lp.assignees ? ($1::text)
         AND lp.due_date IS NOT NULL
         AND lp.due_date BETWEEN current_date AND current_date + 7`,
      [user.id]
    );

    return {
      notifications: [
        ...stored.map((n: any) => ({
          id: n.id,
          type: n.type,
          payload: n.payload,
          spaceName: n.space_name,
          read: n.read,
          createdAt: n.created_at,
          synthesized: false,
        })),
        ...dueSoon.map((d: any) => ({
          id: `due-${d.path_id}`,
          type: 'due_soon',
          payload: { pathId: d.path_id, title: d.title, dueDate: d.due_date, done: d.done, total: d.total, spaceId: d.space_id },
          spaceName: d.space_name,
          read: true,
          createdAt: d.due_date,
          synthesized: true,
        })),
      ],
      unread: stored.filter((n: any) => !n.read).length,
    };
  });

  app.post('/notifications/read', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await q(`UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`, [user.id]);
    return { ok: true };
  });
}

/** Page comments — discussion threads under any page. */
export async function commentRoutes(app: FastifyInstance) {
  app.get('/pages/:id/comments', async (req, reply) => {
    const id = rid((req.params as any).id);
    const user = await requireUser(req, reply);
    if (!user) return;
    const page = await one<{ space_id: string }>(`SELECT space_id FROM pages WHERE id = $1`, [id]);
    if (!page) return reply.code(404).send({ error: 'Not found' });
    const { getRole } = await import('../lib/http.js');
    if (!(await getRole(user.id, page.space_id))) return reply.code(404).send({ error: 'Not found' });
    const rows = await q(
      `SELECT c.id, c.body, c.created_at, u.name AS author_name, u.id AS author_id
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.page_id = $1 ORDER BY c.created_at`,
      [id]
    );
    return { comments: rows };
  });

  app.post('/pages/:id/comments', async (req, reply) => {
    const id = rid((req.params as any).id);
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z.object({ body: z.string().min(1).max(4000) }).parse(req.body);
    const page = await one<{ space_id: string; title: string }>(`SELECT space_id, title FROM pages WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!page) return reply.code(404).send({ error: 'Not found' });
    const { getRole } = await import('../lib/http.js');
    const role = await getRole(user.id, page.space_id);
    if (!role) return reply.code(404).send({ error: 'Not found' });
    if (role === 'viewer') return reply.code(403).send({ error: 'Requires editor access' });
    const comment = await one<any>(
      `INSERT INTO comments (page_id, user_id, body) VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [id, user.id, body.body]
    );
    // @mentions: match @Name (or @FirstName) against space members — takes precedence
    const members = await q<{ user_id: string; name: string }>(
      `SELECT m.user_id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.space_id = $1`,
      [page.space_id]
    );
    const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentioned = new Set<string>();
    for (const m of members) {
      if (m.user_id === user.id) continue;
      const first = m.name.split(/\s+/)[0];
      const re = new RegExp('@\\[?' + escapeRe(m.name) + '\\]?(?![\\w])', 'i');
      const reFirst = new RegExp('@\\[?' + escapeRe(first) + '\\]?(?![\\w])', 'i');
      if (re.test(body.body) || reFirst.test(body.body)) mentioned.add(m.user_id);
    }

    // notify page owner + other commenters (excluding self); mentioned members get 'mention'
    const recipients = await q<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM comments WHERE page_id = $1 AND user_id <> $2
       UNION SELECT created_by FROM pages WHERE id = $1 AND created_by <> $2`,
      [id, user.id]
    );
    for (const r of recipients) {
      const type = mentioned.has(r.user_id) ? 'mention' : 'comment';
      await q(`INSERT INTO notifications (user_id, space_id, type, payload) VALUES ($1, $2, $3, $4)`, [
        r.user_id,
        page.space_id,
        type,
        JSON.stringify({ pageId: id, pageTitle: page.title, fromName: user.name, commentId: comment!.id }),
      ]);
      void notifyUser(r.user_id, {
        title: type === 'mention' ? `${user.name} mentioned you` : `${user.name} commented`,
        body: `${page.title}`,
        url: `/app/space/${page.space_id}/page/${id}`,
      });
    }
    for (const uid of mentioned) {
      if (recipients.some((r) => r.user_id === uid)) continue;
      await q(`INSERT INTO notifications (user_id, space_id, type, payload) VALUES ($1, $2, 'mention', $3)`, [
        uid,
        page.space_id,
        JSON.stringify({ pageId: id, pageTitle: page.title, fromName: user.name, commentId: comment!.id }),
      ]);
      void notifyUser(uid, {
        title: `${user.name} mentioned you`,
        body: `${page.title}`,
        url: `/app/space/${page.space_id}/page/${id}`,
      });
    }
    void recordActivity(page.space_id, user.id, 'comment', { pageId: id, pageTitle: page.title });
    return { comment: { ...comment, author_name: user.name, author_id: user.id } };
  });

  app.delete('/comments/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const user = await requireUser(req, reply);
    if (!user) return;
    await q(`DELETE FROM comments WHERE id = $1 AND user_id = $2`, [id, user.id]);
    return { ok: true };
  });
}

/** Per-member progress roll-up for a path (owner view). */
export async function pathProgressRoutes(app: FastifyInstance) {
  app.get('/paths/:id/progress/all', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'learning_paths', id);
    if (!ctx) return;
    const path = await one<any>(`SELECT assignees, items FROM learning_paths WHERE id = $1`, [id]);
    const total = (path?.items ?? []).length;
    const assignees: string[] = path?.assignees ?? [];
    const members = await q<{ user_id: string; name: string }>(
      `SELECT m.user_id, u.name FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.space_id = $1 AND m.user_id = ANY($2::uuid[])`,
      [ctx.spaceId, assignees]
    );
    const progressRows = await q<{ user_id: string; done: number }>(
      `SELECT user_id, count(*)::int AS done FROM path_progress WHERE path_id = $1 AND done GROUP BY user_id`,
      [id]
    );
    const doneMap = new Map(progressRows.map((p) => [p.user_id, p.done]));
    return {
      total,
      members: members.map((m) => ({ userId: m.user_id, name: m.name, done: doneMap.get(m.user_id) ?? 0, total })),
    };
  });
}
