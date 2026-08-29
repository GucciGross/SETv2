import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';
import { docToMd, extractWikiTargets, mdToDoc, nodeToMd, type TNode } from '../lib/markdown.js';
import { bus } from '../lib/events.js';
import { recordActivity } from '../team/activity.js';

function normalizeTitle(t: string) {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Re-resolve [[wiki links]] in a page's markdown against space pages. */
export async function syncLinks(pageId: string, spaceId: string, markdown: string) {
  await q(`DELETE FROM links WHERE source_id = $1`, [pageId]);
  const targets = [...new Set(extractWikiTargets(markdown))];
  if (!targets.length) return;
  const pages = await q<{ id: string; title: string }>(
    `SELECT id, title FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND is_template = false`,
    [spaceId]
  );
  const byTitle = new Map(pages.map((p) => [normalizeTitle(p.title), p.id]));
  for (const target of targets) {
    const targetId = byTitle.get(normalizeTitle(target));
    if (!targetId || targetId === pageId) continue;
    await q(
      `INSERT INTO links (space_id, source_id, target_id, text) VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_id, target_id, text) DO NOTHING`,
      [spaceId, pageId, targetId, target]
    );
  }
}

export async function savePageContent(pageId: string, spaceId: string, patch: { content?: any; markdown?: string }) {
  let markdown = patch.markdown;
  let content = patch.content;
  if (content !== undefined && markdown === undefined) markdown = docToMd(content as TNode);
  if (markdown !== undefined && content === undefined) content = mdToDoc(markdown);
  await q(
    `UPDATE pages SET content = $2, markdown = $3, updated_at = now() WHERE id = $1`,
    [pageId, JSON.stringify(content ?? null), markdown ?? '']
  );
  await syncLinks(pageId, spaceId, markdown ?? '');
  bus.publish({ spaceId, type: 'page_updated', payload: { pageId } });
}

/**
 * Wiki links are resolved at write time — but a [[target]] may point to a page that
 * doesn't exist yet (forward links). Re-resolve the whole space when
 * pages are created or renamed so forward links materialize.
 */
export async function relinkSpace(spaceId: string) {
  const pagesToRelink = await q<{ id: string; markdown: string }>(
    `SELECT id, markdown FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND is_template = false`,
    [spaceId]
  );
  for (const p of pagesToRelink) await syncLinks(p.id, spaceId, p.markdown ?? '');
}

export async function pageRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/pages', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT id, parent_id, title, icon, is_daily, daily_date, is_template, sort_order, created_at, updated_at
       FROM pages WHERE space_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at`,
      [spaceId]
    );
    return { pages: rows };
  });

  app.post('/pages', async (req, reply) => {
    const body = z
      .object({
        spaceId: z.string(),
        parentId: z.string().nullable().optional(),
        title: z.string().optional(),
        icon: z.string().optional(),
        markdown: z.string().optional(),
        templateId: z.string().optional(),
        isDaily: z.boolean().optional(),
      })
      .parse(req.body);
    if (!(await requireSpace(req, reply, body.spaceId, 'editor'))) return;
    let title = body.title ?? 'Untitled';
    let markdown = body.markdown ?? '';
    if (body.templateId) {
      const tpl = await one<{ title: string; markdown: string }>(
        `SELECT title, markdown FROM pages WHERE id = $1 AND space_id = $2 AND is_template = true`,
        [body.templateId, body.spaceId]
      );
      if (tpl) {
        title = body.title ?? tpl.title.replace(/^Template:\s*/i, '');
        markdown = tpl.markdown;
      }
    }
    const page = await one<any>(
      `INSERT INTO pages (space_id, parent_id, title, icon, markdown, content, is_daily, daily_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        body.spaceId,
        body.parentId ?? null,
        title,
        body.icon ?? null,
        markdown,
        JSON.stringify(mdToDoc(markdown)),
        body.isDaily ?? false,
        body.isDaily ? new Date().toISOString().slice(0, 10) : null,
        req.user!.id,
      ]
    );
    await syncLinks(page!.id, body.spaceId, markdown);
    await relinkSpace(body.spaceId); // forward links: [[targets]] that now resolve
    void recordActivity(body.spaceId, req.user!.id, 'page_created', { pageId: page!.id, title: page!.title });
    bus.publish({ spaceId: body.spaceId, type: 'page_created', payload: { pageId: page!.id } });
    const { telemetry } = await import('../telemetry/index.js');
    telemetry.track(body.isDaily ? 'daily_note_created' : 'page_created');
    return { page };
  });

  app.get('/pages/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'pages', id);
    if (!ctx) return;
    const page = await one<any>(`SELECT * FROM pages WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return { page };
  });

  app.patch('/pages/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'pages', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({
        title: z.string().optional(),
        icon: z.string().nullable().optional(),
        content: z.any().optional(),
        markdown: z.string().optional(),
        parentId: z.string().nullable().optional(),
        sortOrder: z.number().optional(),
      })
      .parse(req.body);

    if (body.content !== undefined || body.markdown !== undefined) {
      await savePageContent(id, ctx.spaceId, { content: body.content, markdown: body.markdown });
    }
    const sets: string[] = [];
    const vals: any[] = [id];
    let n = 1;
    for (const key of ['title', 'icon', 'parent_id', 'sort_order'] as const) {
      const map = { title: 'title', icon: 'icon', parent_id: 'parentId', sort_order: 'sortOrder' } as any;
      const bodyKey = map[key];
      if ((body as any)[bodyKey] !== undefined) {
        vals.push((body as any)[bodyKey]);
        sets.push(`${key} = $${++n}`);
      }
    }
    if (sets.length) {
      sets.push('updated_at = now()');
      await q(`UPDATE pages SET ${sets.join(', ')} WHERE id = $1`, vals);
    }
    if (body.title !== undefined) {
      await syncLinks(id, ctx.spaceId, (await one<any>(`SELECT markdown FROM pages WHERE id = $1`, [id]))!.markdown);
      await relinkSpace(ctx.spaceId); // renames can create/destroy resolutions
    }
    bus.publish({ spaceId: ctx.spaceId, type: 'page_updated', payload: { pageId: id } });
    const page = await one<any>(`SELECT * FROM pages WHERE id = $1`, [id]);
    return { page };
  });

  app.delete('/pages/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'pages', id, 'editor');
    if (!ctx) return;
    await q(`UPDATE pages SET deleted_at = now() WHERE id = $1`, [id]);
    bus.publish({ spaceId: ctx.spaceId, type: 'page_deleted', payload: { pageId: id } });
    return { ok: true };
  });

  app.post('/pages/:id/restore', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'pages', id, 'editor');
    if (!ctx) return;
    await q(`UPDATE pages SET deleted_at = NULL, parent_id = NULL WHERE id = $1`, [id]);
    bus.publish({ spaceId: ctx.spaceId, type: 'page_created', payload: { pageId: id } });
    return { ok: true };
  });

  app.get('/spaces/:spaceId/trash', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT id, title, icon, deleted_at FROM pages WHERE space_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
      [spaceId]
    );
    return { pages: rows };
  });

  app.get('/pages/:id/backlinks', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'pages', id);
    if (!ctx) return;
    const back = await q(
      `SELECT p.id, p.title, p.icon, l.text FROM links l JOIN pages p ON p.id = l.source_id
       WHERE l.target_id = $1 AND p.deleted_at IS NULL`,
      [id]
    );
    const outgoing = await q(
      `SELECT p.id, p.title, p.icon, l.text FROM links l JOIN pages p ON p.id = l.target_id
       WHERE l.source_id = $1 AND p.deleted_at IS NULL`,
      [id]
    );
    return { backlinks: back, outgoing };
  });

  app.get('/pages/:id/mentions', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'pages', id);
    if (!ctx) return;
    const page = await one<{ title: string }>(`SELECT title FROM pages WHERE id = $1`, [id]);
    if (!page || page.title.length < 3) return { mentions: [] };
    const rows = await q<{ id: string; title: string; icon: string | null }>(
      `SELECT id, title, icon FROM pages
       WHERE space_id = $1 AND id <> $2 AND deleted_at IS NULL
         AND (markdown ILIKE '%' || $3 || '%' OR title ILIKE '%' || $3 || '%')
         AND NOT EXISTS (SELECT 1 FROM links WHERE source_id = pages.id AND target_id = $2)`,
      [ctx.spaceId, id, page.title]
    );
    return { mentions: rows };
  });

  app.post('/spaces/:spaceId/daily', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const today = new Date().toISOString().slice(0, 10);
    const existing = await one<any>(`SELECT * FROM pages WHERE space_id = $1 AND is_daily AND daily_date = $2`, [spaceId, today]);
    if (existing) return { page: existing };
    const settings = await one<{ data: any }>(`SELECT data FROM settings WHERE space_id = $1`, [spaceId]);
    let markdown = `# Daily — ${today}\n\n## Notes\n\n`;
    if (settings?.data?.dailyTemplateId) {
      const tpl = await one<{ markdown: string }>(
        `SELECT markdown FROM pages WHERE id = $1 AND space_id = $2 AND is_template = true`,
        [settings.data.dailyTemplateId, spaceId]
      );
      if (tpl) markdown = tpl.markdown;
    }
    const page = await one<any>(
      `INSERT INTO pages (space_id, title, icon, markdown, content, is_daily, daily_date, created_by)
       VALUES ($1, $2, '', $3, $4, true, $5, $6) RETURNING *`,
      [spaceId, today, markdown, JSON.stringify(mdToDoc(markdown)), today, req.user!.id]
    );
    await syncLinks(page!.id, spaceId, markdown);
    return { page };
  });

  app.get('/spaces/:spaceId/graph', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const nodes = await q(
      `SELECT id, title, icon, is_daily, updated_at FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND is_template = false`,
      [spaceId]
    );
    const edges = await q<{ source: string; target: string }>(
      `SELECT l.source_id AS source, l.target_id AS target FROM links l
       JOIN pages s ON s.id = l.source_id
       JOIN pages t ON t.id = l.target_id
       WHERE l.space_id = $1
         AND s.deleted_at IS NULL AND s.is_template = false
         AND t.deleted_at IS NULL AND t.is_template = false`,
      [spaceId]
    );
    return { nodes, edges };
  });

  app.get('/spaces/:spaceId/search', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const term = String((req.query as any).q ?? '').trim();
    if (term.length < 2) return { pages: [], notebooks: [], databases: [] };
    const like = `%${term}%`;
    const [pages, notebooks, databases] = await Promise.all([
      q(
        `SELECT id, title, icon, updated_at FROM pages
         WHERE space_id = $1 AND deleted_at IS NULL AND (title ILIKE $2 OR markdown ILIKE $2) LIMIT 20`,
        [spaceId, like]
      ),
      q(`SELECT id, title FROM notebooks WHERE space_id = $1 AND title ILIKE $2 LIMIT 10`, [spaceId, like]),
      q(`SELECT id, name FROM databases WHERE space_id = $1 AND name ILIKE $2 LIMIT 10`, [spaceId, like]),
    ]);
    return { pages, notebooks, databases };
  });

  // Markdown import (front-matter aware)
  app.post('/spaces/:spaceId/import-md', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const files = req.files ? await req.files() : [];
    const created: any[] = [];
    for await (const file of files) {
      if (!file.filename.endsWith('.md') && !file.filename.endsWith('.markdown')) continue;
      let md = await file.toBuffer().then((b) => b.toString('utf8'));
      let title = file.filename.replace(/\.(md|markdown)$/i, '');
      const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
      if (fm) {
        const t = fm[1].match(/^title:\s*(.+)$/m);
        if (t) title = t[1].trim();
      }
      const page = await one<any>(
        `INSERT INTO pages (space_id, title, markdown, content, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [spaceId, title, md, JSON.stringify(mdToDoc(md)), req.user!.id]
      );
      await syncLinks(page!.id, spaceId, md);
      created.push(page);
    }
    return { pages: created };
  });

  app.get('/pages/:id/export.md', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'pages', id);
    if (!ctx) return;
    const page = await one<{ title: string; markdown: string }>(`SELECT title, markdown FROM pages WHERE id = $1`, [id]);
    reply.header('content-type', 'text/markdown; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(page!.title)}.md"`);
    return page!.markdown;
  });

  app.get('/spaces/:spaceId/export.md', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const pages = await q<{ title: string; markdown: string }>(
      `SELECT title, markdown FROM pages WHERE space_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [spaceId]
    );
    reply.header('content-type', 'text/markdown; charset=utf-8');
    return pages.map((p) => `# ${p.title}\n\n${p.markdown}`).join('\n\n---\n\n');
  });

  // Block-level references: find a block by its permanent id within a space
  app.get('/spaces/:spaceId/blocks/:blockId', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const blockId = String((req.params as any).blockId);
    const pages = await q<{ id: string; title: string; content: any }>(
      `SELECT id, title, content FROM pages WHERE space_id = $1 AND deleted_at IS NULL`,
      [spaceId]
    );
    for (const p of pages) {
      const stack = [...((p.content as TNode)?.content ?? [])];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.attrs?.blockId === blockId) {
          return { pageId: p.id, pageTitle: p.title, text: inlineTextOf(node), markdown: nodeToMdOf(node) };
        }
        if (node.content) stack.push(...node.content);
      }
    }
    reply.code(404).send({ error: 'Block not found' });
  });

  app.get('/spaces/:spaceId/templates', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT id, title, icon, markdown FROM pages WHERE space_id = $1 AND is_template = true AND deleted_at IS NULL`
    );
    return { templates: rows };
  });

  app.post('/spaces/:spaceId/templates', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z.object({ title: z.string(), markdown: z.string().optional() }).parse(req.body);
    const tpl = await one<any>(
      `INSERT INTO pages (space_id, title, icon, markdown, content, is_template, created_by)
       VALUES ($1, $2, '', $3, $4, true, $5) RETURNING *`,
      [spaceId, body.title, body.markdown ?? '', JSON.stringify(mdToDoc(body.markdown ?? '')), req.user!.id]
    );
    return { template: tpl };
  });
}

function inlineTextOf(node: TNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(inlineTextOf).join('');
}
function nodeToMdOf(node: TNode): string {
  return nodeToMd(node);
}
