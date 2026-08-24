import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';
import { bus } from '../lib/events.js';
import { requireSurface } from '../surfaces.js';
import { recordActivity } from '../team/activity.js';
import { chatCompletion, ensureBootstrapProvider, getProvider } from '../llm/router.js';

const columnSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'person', 'url']),
  config: z.record(z.any()).optional(), // {options:[{value,color}], format}
});

function notify(spaceId: string, databaseId: string) {
  bus.publish({ spaceId, type: 'db_updated', payload: { databaseId } });
}

/** Extract the first JSON array from an LLM reply (tolerates fences/prose). */
function parseJsonArray(text: string | null): any[] | null {
  if (!text) return null;
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(stripped.slice(start, end + 1));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Coerce an LLM-produced value to what the column type actually stores. undefined = skip the cell. */
function coerceCell(value: any, col: { type: string; config?: any }): any {
  const opts = (col.config?.options ?? []).map((o: any) => String(o.value));
  switch (col.type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return value === true || value === 'true';
    case 'date': {
      const m = String(value ?? '').match(/\d{4}-\d{2}-\d{2}/);
      return m ? m[0] : null;
    }
    case 'select': {
      const s = String(value ?? '');
      const hit = opts.find((o: string) => o === s) ?? opts.find((o: string) => o.toLowerCase() === s.toLowerCase());
      return hit ?? null;
    }
    case 'multiSelect': {
      const arr = Array.isArray(value) ? value : String(value ?? '').split(',');
      const hits = arr.map((v: any) => String(v).trim()).filter((v: string) => opts.some((o: string) => o.toLowerCase() === v.toLowerCase()));
      return hits.length ? hits : undefined;
    }
    case 'person':
      return null; // never fabricate people
    default: {
      const s = String(value ?? '').slice(0, 2000);
      return s || undefined;
    }
  }
}

export async function databaseRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/databases', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT d.*, (SELECT count(*) FROM db_rows r WHERE r.database_id = d.id) AS row_count
       FROM databases d WHERE d.space_id = $1 ORDER BY d.created_at`,
      [spaceId]
    );
    return { databases: rows };
  });

  app.post('/databases', async (req, reply) => {
    const body = z
      .object({
        spaceId: z.string(),
        name: z.string().min(1),
        icon: z.string().optional(),
        parentId: z.string().nullable().optional(),
        columns: z.array(columnSchema).optional(),
      })
      .parse(req.body);
    if (!(await requireSpace(req, reply, body.spaceId, 'editor'))) return;
    const db = await one<any>(
      `INSERT INTO databases (space_id, parent_page_id, name, icon, schema) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.spaceId, body.parentId ?? null, body.name, body.icon ?? '', JSON.stringify(body.columns ?? [])]
    );
    await q(
      `INSERT INTO db_views (database_id, name, type) VALUES ($1, 'Table', 'table'), ($1, 'Board', 'kanban')`,
      [db!.id]
    );
    notify(body.spaceId, db!.id);
    return { database: db };
  });

  app.get('/databases/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'databases', id);
    if (!ctx) return;
    const db = await one<any>(`SELECT * FROM databases WHERE id = $1`, [id]);
    const views = await q(`SELECT * FROM db_views WHERE database_id = $1 ORDER BY sort_order`, [id]);
    const rows = await q(
      `SELECT r.*, p.title AS page_title, p.icon AS page_icon
       FROM db_rows r LEFT JOIN pages p ON p.id = r.page_id WHERE r.database_id = $1 ORDER BY r.sort_order, r.created_at`,
      [id]
    );
    return { database: db, views, rows };
  });

  app.patch('/databases/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'databases', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({ name: z.string().optional(), icon: z.string().optional(), schema: z.array(columnSchema).optional() })
      .parse(req.body);
    const sets: string[] = [];
    const vals: any[] = [id];
    if (body.name !== undefined) { vals.push(body.name); sets.push(`name = $${vals.length}`); }
    if (body.icon !== undefined) { vals.push(body.icon); sets.push(`icon = $${vals.length}`); }
    if (body.schema !== undefined) { vals.push(JSON.stringify(body.schema)); sets.push(`schema = $${vals.length}`); }
    if (sets.length) await q(`UPDATE databases SET ${sets.join(', ')} WHERE id = $1`, vals);
    notify(ctx.spaceId, id);
    return { ok: true };
  });

  app.delete('/databases/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'databases', id, 'editor');
    if (!ctx) return;
    await q(`DELETE FROM databases WHERE id = $1`, [id]);
    notify(ctx.spaceId, id);
    return { ok: true };
  });

  app.post('/databases/:id/views', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'databases', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({ name: z.string(), type: z.enum(['table', 'kanban', 'calendar', 'gallery']), config: z.record(z.any()).optional() })
      .parse(req.body);
    const view = await one<any>(
      `INSERT INTO db_views (database_id, name, type, config) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, body.name, body.type, JSON.stringify(body.config ?? {})]
    );
    notify(ctx.spaceId, id);
    return { view };
  });

  app.patch('/views/:viewId', async (req, reply) => {
    const viewId = rid((req.params as any).viewId);
    const view = await one<{ database_id: string }>(`SELECT database_id FROM db_views WHERE id = $1`, [viewId]);
    if (!view) return reply.code(404).send({ error: 'View not found' });
    const ctx = await requireResourceSpace(req, reply, 'db_views', viewId, 'editor');
    if (!ctx) return;
    const body = z.object({ name: z.string().optional(), config: z.record(z.any()).optional() }).parse(req.body);
    if (body.name !== undefined) await q(`UPDATE db_views SET name = $2 WHERE id = $1`, [viewId, body.name]);
    if (body.config !== undefined)
      await q(`UPDATE db_views SET config = $2 WHERE id = $1`, [viewId, JSON.stringify(body.config)]);
    notify(ctx.spaceId, view.database_id);
    return { ok: true };
  });

  app.delete('/views/:viewId', async (req, reply) => {
    const viewId = rid((req.params as any).viewId);
    const ctx = await requireResourceSpace(req, reply, 'db_views', viewId, 'editor');
    if (!ctx) return;
    await q(`DELETE FROM db_views WHERE id = $1`, [viewId]);
    return { ok: true };
  });

  app.post('/databases/:id/rows', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'databases', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({ cells: z.record(z.any()).optional(), title: z.string().optional(), createPage: z.boolean().optional() })
      .parse(req.body);
    let pageId: string | null = null;
    let pageTitle: string | null = null;
    if (body.createPage !== false) {
      const db = await one<{ name: string }>(`SELECT name FROM databases WHERE id = $1`, [id]);
      const page = await one<{ id: string; title: string }>(
        `INSERT INTO pages (space_id, title, markdown, created_by) VALUES ($1, $2, '', $3) RETURNING id, title`,
        [ctx.spaceId, body.title ?? `${db!.name} item`, req.user!.id]
      );
      pageId = page!.id;
      pageTitle = page!.title;
    }
    const row = await one<any>(
      `INSERT INTO db_rows (database_id, page_id, cells) VALUES ($1, $2, $3) RETURNING *`,
      [id, pageId, JSON.stringify(body.cells ?? {})]
    );
    notify(ctx.spaceId, id);
    return { row: { ...row, page_title: pageTitle } };
  });

  /**
   * AI auto-fill: generate schema-aware rows with the space's LLM provider so
   * users don't hand-type structured content (pluely-style assist, in-app).
   */
  app.post('/databases/:id/autofill', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'databases', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({ count: z.number().int().min(1).max(25).default(5), hint: z.string().max(500).optional() })
      .parse(req.body ?? {});
    const db = await one<{ name: string; schema: any[] }>(`SELECT name, schema FROM databases WHERE id = $1`, [id]);
    const columns: { id: string; name: string; type: string; config?: any }[] = db?.schema ?? [];
    if (!columns.length) return reply.code(400).send({ error: 'Add at least one column before auto-filling' });

    await ensureBootstrapProvider(ctx.spaceId);
    const provider = await getProvider(ctx.spaceId);
    if (!provider)
      return reply.code(400).send({ error: 'No AI provider configured — add one under Settings → AI Providers first' });

    const existing = await q<{ cells: any }>(`SELECT cells FROM db_rows WHERE database_id = $1 ORDER BY created_at DESC LIMIT 6`, [id]);
    const colLines = columns.map((c) => {
      const opts = c.config?.options?.length ? `; allowed values: ${c.config.options.map((o: any) => o.value).join(' | ')}` : '';
      return `- "${c.name}" (${c.type}${opts})`;
    });
    const fewShot = existing.length
      ? `Existing rows for style and context — do not repeat them:\n${JSON.stringify(existing.map((r) => r.cells)).slice(0, 1500)}\n`
      : '';
    const hint = body.hint?.trim() ? `The user asks: "${body.hint.trim()}".\n` : '';
    let content: string | null;
    try {
      const res = await chatCompletion(provider, null, {
        messages: [
          { role: 'system', content: 'You fill in databases for a knowledge-management app. Reply with ONLY a JSON array — no markdown fences, no commentary.' },
          {
            role: 'user',
            content: `Database "${db!.name}" columns:\n${colLines.join('\n')}\n${fewShot}${hint}Generate ${body.count} realistic, diverse new rows as JSON: [{"title":"...","cells":{"<column name>": value}}]. Rules: select values must come from the allowed list; multiSelect is an array of allowed values; date is "YYYY-MM-DD"; number is a number; checkbox is true/false; person is null unless certain; other columns are concise strings.`,
          },
        ],
        temperature: 0.8,
        signal: AbortSignal.timeout(120_000),
      });
      content = res.content;
    } catch (e: any) {
      return reply.code(502).send({ error: `LLM call failed: ${e.message}` });
    }

    const rows = parseJsonArray(content);
    if (!rows?.length) return reply.code(502).send({ error: 'The model returned malformed JSON — try again' });

    const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
    let created = 0;
    for (const row of rows.slice(0, body.count)) {
      const title = typeof row?.title === 'string' ? row.title.slice(0, 200) : '';
      const cells: Record<string, any> = {};
      for (const [name, value] of Object.entries(row.cells ?? {})) {
        const col = byName.get(String(name).toLowerCase());
        if (!col) continue;
        const coerced = coerceCell(value, col);
        if (coerced !== undefined) cells[col.id] = coerced;
      }
      if (title && !cells[columns[0].id]) cells[columns[0].id] = title;
      const page = await one<{ id: string }>(
        `INSERT INTO pages (space_id, title, markdown, created_by) VALUES ($1, $2, '', $3) RETURNING id`,
        [ctx.spaceId, title || `${db!.name} item`, req.user!.id]
      );
      await q(`INSERT INTO db_rows (database_id, page_id, cells) VALUES ($1, $2, $3)`, [id, page!.id, JSON.stringify(cells)]);
      created++;
    }
    notify(ctx.spaceId, id);
    void recordActivity(String(ctx.spaceId), req.user!.id, 'autofill', { databaseId: id, created });
    return { created };
  });

  app.patch('/rows/:rowId', async (req, reply) => {
    const rowId = rid((req.params as any).rowId);
    const ctx = await requireResourceSpace(req, reply, 'db_rows', rowId, 'editor');
    if (!ctx) return;
    const body = z.object({ cells: z.record(z.any()).optional(), sortOrder: z.number().optional(), title: z.string().optional() }).parse(req.body);
    if (body.cells !== undefined) {
      await q(`UPDATE db_rows SET cells = cells || $2, updated_at = now() WHERE id = $1`, [rowId, JSON.stringify(body.cells)]);
    }
    if (body.sortOrder !== undefined) await q(`UPDATE db_rows SET sort_order = $2 WHERE id = $1`, [rowId, body.sortOrder]);
    if (body.title !== undefined) {
      const row = await one<{ page_id: string | null }>(`SELECT page_id FROM db_rows WHERE id = $1`, [rowId]);
      if (row?.page_id) await q(`UPDATE pages SET title = $2, updated_at = now() WHERE id = $1`, [row.page_id, body.title]);
    }
    const row = await one<{ database_id: string }>(`SELECT database_id FROM db_rows WHERE id = $1`, [rowId]);
    if (row) notify(ctx.spaceId, row.database_id);
    return { ok: true };
  });

  app.delete('/rows/:rowId', async (req, reply) => {
    const rowId = rid((req.params as any).rowId);
    const ctx = await requireResourceSpace(req, reply, 'db_rows', rowId, 'editor');
    if (!ctx) return;
    const row = await one<{ database_id: string; page_id: string | null }>(`SELECT database_id, page_id FROM db_rows WHERE id = $1`, [rowId]);
    await q(`DELETE FROM db_rows WHERE id = $1`, [rowId]);
    if (row?.page_id) await q(`UPDATE pages SET deleted_at = now() WHERE id = $1`, [row.page_id]);
    if (row) notify(ctx.spaceId, row.database_id);
    return { ok: true };
  });
}

export async function pathRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/paths', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    if (!(await requireSurface(reply, spaceId, 'paths'))) return;
    const rows = await q(
      `SELECT lp.*, 
        (SELECT count(*) FROM jsonb_array_elements(lp.items) items) AS item_count,
        (SELECT count(*) FROM path_progress pp WHERE pp.path_id = lp.id AND pp.user_id = $2 AND pp.done) AS done_count
       FROM learning_paths lp WHERE lp.space_id = $1 ORDER BY lp.created_at`,
      [spaceId, req.user!.id]
    );
    return { paths: rows };
  });

  app.post('/spaces/:spaceId/paths', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    if (!(await requireSurface(reply, spaceId, 'paths'))) return;
    const body = z
      .object({ title: z.string().min(1), description: z.string().optional(), items: z.array(z.object({ pageId: z.string(), note: z.string().optional() })).optional() })
      .parse(req.body);
    const path = await one<any>(
      `INSERT INTO learning_paths (space_id, title, description, items) VALUES ($1, $2, $3, $4) RETURNING *`,
      [spaceId, body.title, body.description ?? '', JSON.stringify(body.items ?? [])]
    );
    return { path };
  });

  app.get('/paths/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'learning_paths', id);
    if (!ctx) return;
    const path = await one<any>(`SELECT * FROM learning_paths WHERE id = $1`, [id]);
    const progress = await q(
      `SELECT item_index, done FROM path_progress WHERE path_id = $1 AND user_id = $2`,
      [id, req.user!.id]
    );
    return { path, progress };
  });

  app.patch('/paths/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'learning_paths', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({ title: z.string().optional(), description: z.string().optional(), items: z.array(z.object({ pageId: z.string(), note: z.string().optional() })).optional() })
      .parse(req.body);
    if (body.title !== undefined) await q(`UPDATE learning_paths SET title = $2 WHERE id = $1`, [id, body.title]);
    if (body.description !== undefined) await q(`UPDATE learning_paths SET description = $2 WHERE id = $1`, [id, body.description]);
    if (body.items !== undefined) await q(`UPDATE learning_paths SET items = $2 WHERE id = $1`, [id, JSON.stringify(body.items)]);
    return { ok: true };
  });

  app.delete('/paths/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'learning_paths', id, 'editor');
    if (!ctx) return;
    await q(`DELETE FROM learning_paths WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.patch('/paths/:id/assign', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'learning_paths', id, 'editor');
    if (!ctx) return;
    if (!(await requireSurface(reply, ctx.spaceId, 'paths'))) return;
    const body = z
      .object({
        assignees: z.array(z.string().uuid()).max(100),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .parse(req.body);
    // assignees must be members of the space
    if (body.assignees.length) {
      const valid = await q<{ user_id: string }>(
        `SELECT user_id FROM memberships WHERE space_id = $1 AND user_id = ANY($2::uuid[])`,
        [ctx.spaceId, body.assignees]
      );
      if (valid.length !== body.assignees.length) {
        return reply.code(400).send({ error: 'Assignees must be members of this space' });
      }
    }
    const sets: string[] = ['assignees = $2'];
    const vals: any[] = [id, JSON.stringify(body.assignees)];
    if (body.dueDate !== undefined) {
      vals.push(body.dueDate);
      sets.push(`due_date = $${vals.length}`);
    }
    await q(`UPDATE learning_paths SET ${sets.join(', ')} WHERE id = $1`, vals);
    // notify newly assigned members
    const path = await one<any>(`SELECT title FROM learning_paths WHERE id = $1`, [id]);
    const existing = new Set<string>();
    for (const uid of body.assignees) {
      if (uid === req.user!.id) continue;
      await q(
        `INSERT INTO notifications (user_id, space_id, type, payload) VALUES ($1, $2, 'assigned', $3)`,
        [uid, ctx.spaceId, JSON.stringify({ pathId: id, title: path?.title, dueDate: body.dueDate ?? null, fromName: req.user!.name })]
      );
    }
    void existing;
    void recordActivity(ctx.spaceId, req.user!.id, 'assigned', { pathId: id, title: path?.title, assignees: body.assignees.length, dueDate: body.dueDate ?? null });
    return { ok: true };
  });

  app.post('/paths/:id/progress', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'learning_paths', id);
    if (!ctx) return;
    const body = z.object({ itemIndex: z.number().int().min(0), done: z.boolean() }).parse(req.body);
    await q(
      `INSERT INTO path_progress (user_id, path_id, item_index, done, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, path_id, item_index) DO UPDATE SET done = EXCLUDED.done, updated_at = now()`,
      [req.user!.id, id, body.itemIndex, body.done]
    );
    return { ok: true };
  });
}
