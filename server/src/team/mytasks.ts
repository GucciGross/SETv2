import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace } from '../lib/http.js';
import { savePageContent } from '../pages/routes.js';

interface PageTask {
  pageId: string;
  pageTitle: string;
  index: number; // nth checkbox in the page markdown
  text: string;
  checked: boolean;
}

/**
 * My Tasks: one view across everything assigned to or actionable by the user —
 * assigned learning paths plus every open checkbox task found in space pages.
 */
export async function myTasksRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/mytasks', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const userId = req.user!.id;

    // assigned paths with progress
    const paths = await q(
      `SELECT lp.id, lp.title, lp.due_date,
        (SELECT count(*)::int FROM jsonb_array_elements(lp.items)) AS total,
        (SELECT count(*)::int FROM path_progress pp WHERE pp.path_id = lp.id AND pp.user_id = $2 AND pp.done) AS done
       FROM learning_paths lp
       WHERE lp.space_id = $1 AND lp.assignees ? ($2::text)
       ORDER BY lp.due_date NULLS LAST, lp.created_at`,
      [spaceId, userId]
    );

    // checkbox tasks across all pages (markdown "- [ ]" / "- [x]")
    const pages = await q<{ id: string; title: string; markdown: string }>(
      `SELECT id, title, markdown FROM pages
       WHERE space_id = $1 AND deleted_at IS NULL AND is_template = false AND markdown LIKE '%[ ]%' OR (space_id = $1 AND deleted_at IS NULL AND is_template = false AND markdown LIKE '%[x]%')`,
      [spaceId]
    );
    const tasks: PageTask[] = [];
    for (const p of pages) {
      let idx = 0;
      for (const m of p.markdown.matchAll(/^(\s*[-*]\s+\[)([ xX])(\])/gm)) {
        const after = p.markdown.slice(m.index! + m[0].length, m.index! + m[0].length + 140).trim();
        if (after) {
          tasks.push({ pageId: p.id, pageTitle: p.title, index: idx, text: after, checked: m[2].toLowerCase() === 'x' });
        }
        idx++;
      }
    }

    return { paths, tasks: tasks.filter((t) => !t.checked), completedToday: tasks.filter((t) => t.checked).length };
  });

  // toggle the nth checkbox of a page from the My Tasks view
  app.post('/spaces/:spaceId/mytasks/toggle', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z.object({ pageId: z.string(), index: z.number().int().min(0), checked: z.boolean() }).parse(req.body);
    const page = await one<{ markdown: string }>(
      `SELECT markdown FROM pages WHERE id = $1 AND space_id = $2 AND deleted_at IS NULL`,
      [body.pageId, spaceId]
    );
    if (!page) return reply.code(404).send({ error: 'Page not found' });
    let idx = 0;
    let updated = page.markdown;
    let replaced = false;
    updated = updated.replace(/^(\s*[-*]\s+\[)([ xX])(\])/gm, (full, pre, mark, post) => {
      if (idx++ === body.index) {
        replaced = true;
        return pre + (body.checked ? 'x' : ' ') + post;
      }
      return full;
    });
    if (!replaced) return reply.code(409).send({ error: 'Task not found (page changed?)' });
    await savePageContent(body.pageId, spaceId, { markdown: updated });
    return { ok: true };
  });
}

/** Template kits: export a space's templates as JSON, import to clone them into another space. */
export async function kitRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/templates/export', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const templates = await q(`SELECT title, markdown FROM pages WHERE space_id = $1 AND is_template = true AND deleted_at IS NULL`, [spaceId]);
    reply.header('content-type', 'application/json');
    reply.header('content-disposition', 'attachment; filename="set-template-kit.json"');
    return {
      kind: 'set-template-kit',
      version: 1,
      exportedAt: new Date().toISOString(),
      templates,
    };
  });

  app.post('/spaces/:spaceId/templates/import', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z
      .object({
        kind: z.literal('set-template-kit'),
        templates: z.array(z.object({ title: z.string().min(1), markdown: z.string().max(200000) })).min(1).max(100),
      })
      .parse(req.body);
    const { mdToDoc } = await import('../lib/markdown.js');
    let created = 0;
    for (const t of body.templates) {
      const exists = await one(`SELECT id FROM pages WHERE space_id = $1 AND is_template = true AND title = $2`, [spaceId, t.title]);
      if (exists) continue;
      await q(
        `INSERT INTO pages (space_id, title, icon, markdown, content, is_template, created_by) VALUES ($1, $2, NULL, $3, $4, true, $5)`,
        [spaceId, t.title, t.markdown, JSON.stringify(mdToDoc(t.markdown)), req.user!.id]
      );
      created++;
    }
    return { created };
  });
}
