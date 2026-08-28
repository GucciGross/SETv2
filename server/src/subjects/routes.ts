import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';

/**
 * Subjects — the top-level container for study material (classes, courses,
 * topics). Notebooks group under a subject; the sidebar and notebook list
 * render the grouping.
 */
export async function subjectRoutes(app: FastifyInstance) {
  // List subjects + a light notebook map for grouping views
  app.get('/spaces/:spaceId/subjects', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const subjects = await q(
      `SELECT s.*, (SELECT count(*) FROM notebooks n WHERE n.subject_id = s.id) AS notebook_count
       FROM subjects s WHERE s.space_id = $1 ORDER BY s.position, s.created_at`,
      [spaceId]
    );
    const notebooks = await q<{ id: string; subject_id: string | null; title: string }>(
      `SELECT id, subject_id, title FROM notebooks WHERE space_id = $1 ORDER BY created_at DESC`,
      [spaceId]
    );
    return { subjects, notebooks };
  });

  app.post('/spaces/:spaceId/subjects', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z.object({ title: z.string().min(1).max(120), color: z.string().max(32).optional() }).parse(req.body);
    const subject = await one<any>(
      `INSERT INTO subjects (space_id, title, color) VALUES ($1, $2, $3) RETURNING *`,
      [spaceId, body.title, body.color ?? '#7aa2ff']
    );
    return { subject };
  });

  app.patch('/subjects/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'subjects', id, 'editor');
    if (!ctx) return;
    const body = z.object({ title: z.string().min(1).max(120).optional(), color: z.string().max(32).optional() }).parse(req.body);
    const subject = await one<any>(
      `UPDATE subjects SET title = COALESCE($2, title), color = COALESCE($3, color) WHERE id = $1 RETURNING *`,
      [id, body.title ?? null, body.color ?? null]
    );
    return { subject };
  });

  app.delete('/subjects/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'subjects', id, 'editor');
    if (!ctx) return;
    // notebooks survive — subject_id clears via ON DELETE SET NULL
    await q(`DELETE FROM subjects WHERE id = $1`, [id]);
    return { ok: true };
  });
}
