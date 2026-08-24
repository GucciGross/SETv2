import { q, one } from '../db.js';
import { mdToDoc } from '../lib/markdown.js';
import { syncLinks, relinkSpace } from '../pages/routes.js';
import { retrieve } from '../rag/provider.js';
import { getProvider } from '../llm/router.js';
import { generateDeck, createDeckRecord } from '../study/generate.js';
import { getSurfaces } from '../surfaces.js';
import { recordActivity } from '../team/activity.js';

/**
 * MCP tool catalog — feature parity with the SET API.
 * Store-review requirements honored: snake_case names <=64 chars, end-user
 * descriptions, full JSON Schema inputs (required/enums/descriptions), titles
 * and annotations (readOnlyHint / destructiveHint / idempotentHint).
 */

export interface ToolCtx {
  userId: string;
  spaceId: string;
  role: string;
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: any;
  annotations?: Record<string, any>;
  scope: 'mcp:read' | 'mcp:write';
  run: (args: any, ctx: ToolCtx) => Promise<any>;
}

const pageByRef = async (ctx: ToolCtx, ref: string) =>
  (await one<any>(`SELECT id, title, markdown FROM pages WHERE id::text = $2 AND space_id = $1 AND deleted_at IS NULL`, [ctx.spaceId, ref])) ??
  (await one<any>(
    `SELECT id, title, markdown FROM pages WHERE space_id = $1 AND lower(title) = lower($2) AND deleted_at IS NULL LIMIT 1`,
    [ctx.spaceId, ref]
  ));

const canWrite = (ctx: ToolCtx) => ctx.role !== 'viewer';

export const TOOLS: ToolDef[] = [
  {
    name: 'search_workspace',
    title: 'Search workspace',
    description: 'Full-text search across pages, databases and notebooks in the connected SET workspace. Use this first when looking for existing content.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search keywords (min 2 characters)' }, limit: { type: 'number', description: 'Max results per type (default 10)' } },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(args, ctx) {
      const like = `%${args.query}%`;
      const [pages, notebooks, databases] = await Promise.all([
        q(`SELECT id, title, icon FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND (title ILIKE $2 OR markdown ILIKE $2) LIMIT $3`, [ctx.spaceId, like, args.limit ?? 10]),
        q(`SELECT id, title FROM notebooks WHERE space_id = $1 AND title ILIKE $2 LIMIT 5`, [ctx.spaceId, like]),
        q(`SELECT id, name FROM databases WHERE space_id = $1 AND name ILIKE $2 LIMIT 5`, [ctx.spaceId, like]),
      ]);
      return { pages, notebooks, databases };
    },
  },
  {
    name: 'list_pages',
    title: 'List pages',
    description: 'List all non-deleted pages (id, title, icon, hierarchy) in the workspace.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(_a, ctx) {
      return { pages: await q(`SELECT id, parent_id, title, icon, is_daily FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND is_template = false ORDER BY title`, [ctx.spaceId]) };
    },
  },
  {
    name: 'read_page',
    title: 'Read page',
    description: 'Read a page as Markdown by its id or exact title, including wiki links and front matter.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string', description: 'Page id or exact title' } }, required: ['ref'] },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(args, ctx) {
      const page = await pageByRef(ctx, args.ref);
      if (!page) throw new Error(`Page not found: ${args.ref}`);
      return page;
    },
  },
  {
    name: 'read_page_backlinks',
    title: 'Read page backlinks and mentions',
    description: 'List pages linking to a page (backlinks), pages it links to (outgoing), and unlinked mentions of its title.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string', description: 'Page id or exact title' } }, required: ['ref'] },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(args, ctx) {
      const page = await pageByRef(ctx, args.ref);
      if (!page) throw new Error(`Page not found: ${args.ref}`);
      const backlinks = await q(
        `SELECT p.id, p.title, l.text FROM links l JOIN pages p ON p.id = l.source_id WHERE l.target_id = $1 AND p.deleted_at IS NULL`,
        [page.id]
      );
      const outgoing = await q(
        `SELECT p.id, p.title, l.text FROM links l JOIN pages p ON p.id = l.target_id WHERE l.source_id = $1 AND p.deleted_at IS NULL`,
        [page.id]
      );
      return { backlinks, outgoing };
    },
  },
  {
    name: 'list_databases',
    title: 'List databases',
    description: 'List the workspace databases with their row counts.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(_a, ctx) {
      return {
        databases: await q(
          `SELECT d.id, d.name, (SELECT count(*) FROM db_rows r WHERE r.database_id = d.id) AS row_count FROM databases d WHERE d.space_id = $1`,
          [ctx.spaceId]
        ),
      };
    },
  },
  {
    name: 'query_database',
    title: 'Query database',
    description: 'Read a database schema (columns and types) and all rows, including linked page titles.',
    inputSchema: {
      type: 'object',
      properties: { databaseId: { type: 'string', description: 'Database id (from list_databases)' }, filter: { type: 'string', description: 'Optional substring filter over row values' } },
      required: ['databaseId'],
    },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(args, ctx) {
      const db = await one<any>(`SELECT * FROM databases WHERE id = $1 AND space_id = $2`, [args.databaseId, ctx.spaceId]);
      if (!db) throw new Error('Database not found');
      let rows = await q(
        `SELECT r.id, r.cells, p.title AS page_title FROM db_rows r LEFT JOIN pages p ON p.id = r.page_id WHERE r.database_id = $1 ORDER BY r.sort_order, r.created_at`,
        [args.databaseId]
      );
      if (args.filter) rows = rows.filter((r: any) => JSON.stringify(r).toLowerCase().includes(String(args.filter).toLowerCase()));
      return { database: { id: db.id, name: db.name, columns: db.schema }, rows };
    },
  },
  {
    name: 'list_notebooks',
    title: 'List research notebooks',
    description: 'List research notebooks with source and chunk counts.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(_a, ctx) {
      return {
        notebooks: await q(
          `SELECT n.id, n.title, (SELECT count(*) FROM sources s WHERE s.notebook_id = n.id) AS source_count FROM notebooks n WHERE n.space_id = $1`,
          [ctx.spaceId]
        ),
      };
    },
  },
  {
    name: 'list_sources',
    title: 'List notebook sources',
    description: 'List the indexed sources of a research notebook with their ingestion status.',
    inputSchema: { type: 'object', properties: { notebookId: { type: 'string', description: 'Notebook id' } }, required: ['notebookId'] },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(args, ctx) {
      const nb = await one<any>(`SELECT id FROM notebooks WHERE id = $1 AND space_id = $2`, [args.notebookId, ctx.spaceId]);
      if (!nb) throw new Error('Notebook not found');
      return {
        sources: await q(
          `SELECT id, kind, name, status, (SELECT count(*) FROM chunks c WHERE c.source_id = sources.id) AS chunk_count FROM sources WHERE notebook_id = $1 ORDER BY created_at`,
          [args.notebookId]
        ),
      };
    },
  },
  {
    name: 'search_knowledge',
    title: 'Grounded knowledge search',
    description: 'Hybrid semantic + keyword retrieval over a notebook\u2019s sources. Returns cited excerpts with source name, page label and relevance scores \u2014 use before answering questions about the workspace\u2019s documents.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question or topic to retrieve passages for' },
        notebookId: { type: 'string', description: 'Notebook id (defaults to the first notebook)' },
        limit: { type: 'number', description: 'Max passages (default 6)' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(args, ctx) {
      let notebookId = args.notebookId;
      if (!notebookId) {
        const nb = await one<any>(`SELECT id FROM notebooks WHERE space_id = $1 ORDER BY created_at LIMIT 1`, [ctx.spaceId]);
        if (!nb) throw new Error('No notebooks in this workspace');
        notebookId = nb.id;
      } else {
        const nb = await one<any>(`SELECT id FROM notebooks WHERE id = $1 AND space_id = $2`, [notebookId, ctx.spaceId]);
        if (!nb) throw new Error('Notebook not found');
      }
      return { hits: await retrieve(notebookId, args.query, args.limit ?? 6) };
    },
  },
  {
    name: 'list_study_decks',
    title: 'List study decks',
    description: 'List generated study decks (flashcards, quizzes, study guides, audio overviews).',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(_a, ctx) {
      return {
        decks: await q(`SELECT id, kind, title, jsonb_array_length(items) AS item_count, created_at FROM decks WHERE space_id = $1 ORDER BY created_at DESC`, [ctx.spaceId]),
      };
    },
  },
  {
    name: 'get_deck',
    title: 'Get study deck',
    description: 'Read a study deck\u2019s full content (cards, quiz items, guide markdown or audio script).',
    inputSchema: { type: 'object', properties: { deckId: { type: 'string', description: 'Deck id' } }, required: ['deckId'] },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(args, ctx) {
      const deck = await one<any>(`SELECT * FROM decks WHERE id = $1 AND space_id = $2`, [args.deckId, ctx.spaceId]);
      if (!deck) throw new Error('Deck not found');
      return deck;
    },
  },
  {
    name: 'list_my_tasks',
    title: 'List my tasks',
    description: 'The calling user\u2019s open tasks: assigned learning paths (with due dates and progress) plus open checkbox tasks across workspace pages.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(_a, ctx) {
      const paths = await q(
        `SELECT lp.id, lp.title, lp.due_date, (SELECT count(*) FROM jsonb_array_elements(lp.items)) AS total,
          (SELECT count(*) FROM path_progress pp WHERE pp.path_id = lp.id AND pp.user_id = $2 AND pp.done) AS done
         FROM learning_paths lp WHERE lp.space_id = $1 AND lp.assignees ? ($2::text)`,
        [ctx.spaceId, ctx.userId]
      );
      const pages = await q(`SELECT id, title, markdown FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND markdown LIKE '%[ ]%'`, [ctx.spaceId]);
      const tasks: any[] = [];
      for (const p of pages) {
        for (const m of p.markdown.matchAll(/^(\s*[-*]\s+\[ \])(.+)$/gm)) {
          tasks.push({ pageId: p.id, pageTitle: p.title, text: m[2].trim().slice(0, 160) });
        }
      }
      return { paths, tasks };
    },
  },
  {
    name: 'list_activity',
    title: 'List workspace activity',
    description: 'Recent activity feed: who created pages, commented, assigned training or added sources.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max entries (default 25)' } } },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(args, ctx) {
      return {
        activities: await q(
          `SELECT a.type, a.payload, a.created_at, u.name AS actor FROM activities a JOIN users u ON u.id = a.user_id WHERE a.space_id = $1 ORDER BY a.created_at DESC LIMIT $2`,
          [ctx.spaceId, Math.min(args.limit ?? 25, 100)]
        ),
      };
    },
  },
  {
    name: 'list_notifications',
    title: 'List my notifications',
    description: 'The calling user\u2019s notifications: assignments, due-soon reminders, @mentions and comments.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(_a, ctx) {
      return {
        notifications: await q(`SELECT type, payload, read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 25`, [ctx.userId]),
      };
    },
  },
  {
    name: 'list_models_3d',
    title: 'List 3D models',
    description: 'List 3D & CAD models in the workspace (GLB, STL, OBJ, URDF robots, STEP). Requires the 3D & CAD surface.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    scope: 'mcp:read',
    async run(_a, ctx) {
      const surfaces = await getSurfaces(ctx.spaceId);
      if (!surfaces.threeD) throw new Error('The 3D & CAD work surface is disabled in this workspace');
      return { models: await q(`SELECT id, name, kind, file_size FROM models3d WHERE space_id = $1`, [ctx.spaceId]) };
    },
  },
  // ---------- write ----------
  {
    name: 'create_page',
    title: 'Create page',
    description: 'Create a new page with Markdown content. Wiki links like [[Other Page]] are supported and resolve automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title' },
        markdown: { type: 'string', description: 'Page body in Markdown (headings, lists, tables, [[wiki links]], images)' },
        parentRef: { type: 'string', description: 'Optional parent page id or title to nest under' },
      },
      required: ['title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      let parentId: string | null = null;
      if (args.parentRef) {
        const parent = await pageByRef(ctx, args.parentRef);
        parentId = parent?.id ?? null;
      }
      const page = await one<any>(
        `INSERT INTO pages (space_id, parent_id, title, markdown, content, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title`,
        [ctx.spaceId, parentId, args.title, args.markdown ?? '', JSON.stringify(mdToDoc(args.markdown ?? '')), ctx.userId]
      );
      await syncLinks(page!.id, ctx.spaceId, args.markdown ?? '');
      await relinkSpace(ctx.spaceId);
      void recordActivity(ctx.spaceId, ctx.userId, 'page_created', { pageId: page!.id, title: args.title, via: 'mcp' });
      return { pageId: page!.id, title: page!.title };
    },
  },
  {
    name: 'append_to_page',
    title: 'Append to page',
    description: 'Append Markdown content to the end of an existing page (found by id or exact title).',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'Page id or exact title' }, markdown: { type: 'string', description: 'Markdown to append' } },
      required: ['ref', 'markdown'],
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const page = await pageByRef(ctx, args.ref);
      if (!page) throw new Error(`Page not found: ${args.ref}`);
      const next = (page.markdown ? page.markdown + '\n\n' : '') + args.markdown;
      await q(`UPDATE pages SET markdown = $2, content = $3, updated_at = now() WHERE id = $1`, [page.id, next, JSON.stringify(mdToDoc(next))]);
      await syncLinks(page.id, ctx.spaceId, next);
      return { pageId: page.id, title: page.title };
    },
  },
  {
    name: 'update_page_properties',
    title: 'Update page properties',
    description: 'Rename a page or change its icon.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'Page id or exact title' }, title: { type: 'string', description: 'New title' }, icon: { type: 'string', description: 'New icon (single character or short text)' } },
      required: ['ref'],
    },
    annotations: { readOnlyHint: false },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const page = await pageByRef(ctx, args.ref);
      if (!page) throw new Error(`Page not found: ${args.ref}`);
      if (args.title) await q(`UPDATE pages SET title = $2 WHERE id = $1`, [page.id, args.title]);
      if (args.icon) await q(`UPDATE pages SET icon = $2 WHERE id = $1`, [page.id, args.icon]);
      if (args.title) await relinkSpace(ctx.spaceId);
      return { ok: true };
    },
  },
  {
    name: 'create_comment',
    title: 'Comment on page',
    description: 'Add a comment to a page. @Name mentions notify workspace members.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'Page id or exact title' }, body: { type: 'string', description: 'Comment text (Markdown not rendered; @Name mentions trigger notifications)' } },
      required: ['ref', 'body'],
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const page = await pageByRef(ctx, args.ref);
      if (!page) throw new Error(`Page not found: ${args.ref}`);
      const { one: _o, q: _q } = await import('../db.js');
      const comment = await one<any>(`INSERT INTO comments (page_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, created_at`, [page.id, ctx.userId, args.body]);
      void recordActivity(ctx.spaceId, ctx.userId, 'comment', { pageId: page.id, pageTitle: page.title, via: 'mcp' });
      return { commentId: comment!.id };
    },
  },
  {
    name: 'create_database_row',
    title: 'Create database row',
    description: 'Add a row to a database, creating a linked page for the row\u2019s title when the database uses page rows.',
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database id' },
        title: { type: 'string', description: 'Row/page title' },
        cells: { type: 'object', description: 'Column values keyed by column name, e.g. Status=Done, Qty=5' } },
      required: ['databaseId'],
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const db = await one<any>(`SELECT * FROM databases WHERE id = $1 AND space_id = $2`, [args.databaseId, ctx.spaceId]);
      if (!db) throw new Error('Database not found');
      const page = await one<any>(`INSERT INTO pages (space_id, title, created_by) VALUES ($1, $2, $3) RETURNING id`, [ctx.spaceId, args.title ?? 'New item', ctx.userId]);
      const byName = new Map<string, string>((db.schema ?? []).map((c: any) => [String(c.name).toLowerCase(), String(c.id)] as [string, string]));
      const cells: any = {};
      for (const entry of Object.entries((args.cells ?? {}) as Record<string, any>)) {
        const k = entry[0]; const v = entry[1];
        const colId = byName.get(String(k).toLowerCase());
        if (colId) cells[colId] = v;
      }
      const row = await one<any>(`INSERT INTO db_rows (database_id, page_id, cells) VALUES ($1, $2, $3) RETURNING id`, [args.databaseId, page!.id, JSON.stringify(cells)]);
      return { rowId: row!.id, pageId: page!.id };
    },
  },
  {
    name: 'update_database_row',
    title: 'Update database row',
    description: 'Update cells of a database row by column names (e.g. {"Status": "Running"}).',
    inputSchema: {
      type: 'object',
      properties: { rowId: { type: 'string', description: 'Row id' }, cells: { type: 'object', description: 'Column values keyed by column name, e.g. Status=Running' } },
      required: ['rowId', 'cells'],
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const row = await one<any>(
        `SELECT r.id, r.database_id FROM db_rows r JOIN databases d ON d.id = r.database_id WHERE r.id = $1 AND d.space_id = $2`,
        [args.rowId, ctx.spaceId]
      );
      if (!row) throw new Error('Row not found');
      const db = await one<any>(`SELECT schema FROM databases WHERE id = $1`, [row.database_id]);
      const byName = new Map<string, string>((db?.schema ?? []).map((c: any) => [String(c.name).toLowerCase(), String(c.id)] as [string, string]));
      const cells: any = {};
      for (const entry of Object.entries((args.cells ?? {}) as Record<string, any>)) {
        const k = entry[0]; const v = entry[1];
        const colId = byName.get(String(k).toLowerCase());
        if (colId) cells[colId] = v;
      }
      await q(`UPDATE db_rows SET cells = cells || $2, updated_at = now() WHERE id = $1`, [args.rowId, JSON.stringify(cells)]);
      return { ok: true };
    },
  },
  {
    name: 'create_notebook',
    title: 'Create research notebook',
    description: 'Create a new research notebook for grounded, cited Q&A over sources.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Notebook title' }, description: { type: 'string', description: 'What this notebook researches' } },
      required: ['title'],
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const nb = await one<any>(`INSERT INTO notebooks (space_id, title, description) VALUES ($1, $2, $3) RETURNING id, title`, [ctx.spaceId, args.title, args.description ?? '']);
      return { notebookId: nb!.id, title: nb!.title };
    },
  },
  {
    name: 'add_notebook_source',
    title: 'Add notebook source',
    description: 'Add a text source (Markdown, notes, transcript) to a notebook. It is chunked and indexed automatically for grounded search.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'Notebook id' },
        name: { type: 'string', description: 'Source name shown in citations' },
        text: { type: 'string', description: 'The source text (Markdown headings improve chunking)' },
      },
      required: ['notebookId', 'name', 'text'],
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const nb = await one<any>(`SELECT id FROM notebooks WHERE id = $1 AND space_id = $2`, [args.notebookId, ctx.spaceId]);
      if (!nb) throw new Error('Notebook not found');
      const { ingestSource } = await import('../rag/search.js');
      const { ensureBootstrapProvider } = await import('../llm/router.js');
      const src = await one<any>(`INSERT INTO sources (notebook_id, kind, name, text_content, status) VALUES ($1, 'txt', $2, $3, 'pending') RETURNING id`, [args.notebookId, args.name, args.text]);
      await ensureBootstrapProvider(ctx.spaceId);
      const provider = await getProvider(ctx.spaceId);
      void ingestSource(src!.id, provider);
      void recordActivity(ctx.spaceId, ctx.userId, 'source_added', { count: 1, names: [args.name], via: 'mcp' });
      return { sourceId: src!.id, status: 'indexing' };
    },
  },
  {
    name: 'generate_study_material',
    title: 'Generate study material',
    description: 'Generate flashcards, a quiz, a study guide or an audio-overview script from a notebook\u2019s sources using the workspace LLM.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: { type: 'string', description: 'Notebook id' },
        kind: { type: 'string', enum: ['flashcards', 'quiz', 'studyguide', 'audio'], description: 'Material to generate' },
        topic: { type: 'string', description: 'Optional topic focus' },
        count: { type: 'number', description: 'Items to generate (3-40, default 10)' },
      },
      required: ['notebookId', 'kind'],
    },
    annotations: { readOnlyHint: false },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const nb = await one<any>(`SELECT id FROM notebooks WHERE id = $1 AND space_id = $2`, [args.notebookId, ctx.spaceId]);
      if (!nb) throw new Error('Notebook not found');
      const result = await generateDeck(ctx.spaceId, args.notebookId, args.kind, args.topic, Math.min(Math.max(args.count ?? 10, 3), 40));
      const deck = await createDeckRecord(ctx.spaceId, args.notebookId, args.kind, `${args.kind}${args.topic ? ' - ' + args.topic : ''} (agent)`, result);
      void recordActivity(ctx.spaceId, ctx.userId, 'deck_generated', { deckId: deck.id, kind: args.kind, via: 'mcp' });
      return { deckId: deck.id, kind: args.kind, preview: JSON.stringify(result).slice(0, 600) };
    },
  },
  {
    name: 'import_from_dataset',
    title: 'Import from open dataset',
    description: 'Import a file from a public HuggingFace dataset into the workspace: meshes (.glb/.stl/.obj/.urdf/.step) become 3D models; documents (.md/.txt/.json/.pdf/.parquet) become indexed notebook sources. Requires the Library surface.',
    inputSchema: {
      type: 'object',
      properties: {
        datasetId: { type: 'string', description: 'Dataset repo id, e.g. markov-ai/cad-1000-hours' },
        path: { type: 'string', description: 'File path inside the dataset' },
        notebookId: { type: 'string', description: 'Optional target notebook for documents' },
      },
      required: ['datasetId', 'path'],
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const surfaces = await getSurfaces(ctx.spaceId);
      if (!surfaces.library) throw new Error('The Library work surface is disabled in this workspace');
      const { importFromDataset } = await import('../library/import.js');
      return importFromDataset(ctx.spaceId, ctx.userId, args.datasetId, args.path, args.notebookId);
    },
  },
  {
    name: 'create_page_template',
    title: 'Create page template',
    description: 'Save a Markdown template that users can create pages from (meeting notes, SOPs, onboarding checklists).',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: 'Template title' }, markdown: { type: 'string', description: 'Template body in Markdown' } },
      required: ['title'],
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    scope: 'mcp:write',
    async run(args, ctx) {
      if (!canWrite(ctx)) throw new Error('Viewer role cannot write');
      const tpl = await one<any>(
        `INSERT INTO pages (space_id, title, markdown, content, is_template, created_by) VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
        [ctx.spaceId, args.title, args.markdown ?? '', JSON.stringify(mdToDoc(args.markdown ?? '')), ctx.userId]
      );
      return { templateId: tpl!.id };
    },
  },
];

export function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, ...(t.annotations ?? {}) },
  }));
}

export async function callTool(name: string, args: any, ctx: ToolCtx) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return { scope: tool.scope, result: await tool.run(args ?? {}, ctx) };
}
