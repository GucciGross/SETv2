import { one, q } from '../db.js';
import { mdToDoc } from '../lib/markdown.js';
import { syncLinks } from '../pages/routes.js';
import { hybridSearch } from '../rag/search.js';
import { generateDeck, createDeckRecord } from '../study/generate.js';
import type { Provider } from '../llm/router.js';
import type { ToolDef } from '../llm/router.js';
import { providerAcceptsScreenshots, MAX_INLINE_SCREENSHOT_BYTES } from './visionRouting.js';

export interface ToolContext {
  spaceId: string;
  userId: string;
  provider: Provider | null;
}

export interface ToolResult {
  ok: boolean;
  result: any;
  a2ui?: A2UIComponent[];
}

export interface A2UIComponent {
  type: 'card' | 'kv' | 'table' | 'quiz' | 'flashcards' | 'viewer3d' | 'form' | 'list' | 'image';
  props: Record<string, any>;
}

interface ToolDef2 {
  name: string;
  description: string;
  parameters: any;
  write: boolean;
  run: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

async function findPageByTitleOrId(ctx: ToolContext, ref: string): Promise<{ id: string; title: string; markdown: string } | null> {
  const byId = await one<any>(`SELECT id, title, markdown FROM pages WHERE id::text = $1 AND space_id = $2`, [ref, ctx.spaceId]);
  if (byId) return byId;
  const byTitle = await one<any>(
    `SELECT id, title, markdown FROM pages WHERE space_id = $1 AND lower(title) = lower($2) AND deleted_at IS NULL LIMIT 1`,
    [ctx.spaceId, ref]
  );
  return byTitle ?? null;
}

/**
 * Agent computer use (Phase 4) — queues kind='cua' teach tasks that the
 * user's companion executes against cua-driver, then polls for the result.
 * Capture format (numbered element index + bounds + spill file) adapted from
 * hermes-agent's tools/computer_use/tool.py (MIT, Nous Research).
 */
async function runCuaOp(ctx: ToolContext, op: Record<string, any>, timeoutMs = 120_000): Promise<ToolResult> {
  const task = await one<any>(
    `INSERT INTO teach_tasks (space_id, user_id, title, kind, op) VALUES ($1, $2, $3, 'cua', $4) RETURNING id`,
    [ctx.spaceId, ctx.userId, `cua:${op.action}`, JSON.stringify(op)]
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const row = await one<any>(`SELECT status, result, result_data FROM teach_tasks WHERE id = $1`, [task!.id]);
    if (row?.status === 'done' || row?.status === 'error') {
      const data = row.result_data ?? {};
      if (row.status === 'error') return { ok: false, result: { error: data.error ?? row.result ?? 'companion error' } };
      // The human always sees the capture in chat (a2ui image); the model
      // additionally gets the inline screenshot only when vision routing
      // says the active provider can consume it.
      const png: string | undefined = data.png_b64;
      const a2ui = png
        ? [{ type: 'image' as const, props: { src: `data:image/png;base64,${png}`, title: op.action === 'capture' ? 'Screen capture' : `After ${op.action}`, alt: data.summary?.slice(0, 120) ?? 'capture' } }]
        : undefined;
      if (png && providerAcceptsScreenshots(ctx.provider) && png.length * 0.75 < MAX_INLINE_SCREENSHOT_BYTES) {
        const visionSummary = data.summary ?? (data.after ? `ok\n${data.after.summary}` : undefined) ?? row.result;
        return {
          ok: true,
          result: { summary: visionSummary, screenshot: `data:image/png;base64,${png}`, windowId: data.window_id },
          a2ui,
        };
      }
      const summary = data.summary
        ?? (data.after ? `ok\n${data.after.summary}` : undefined)
        ?? JSON.stringify(data).slice(0, 4000);
      const note = png && !providerAcceptsScreenshots(ctx.provider) ? '\n(screenshot omitted — active model is not vision-capable; ground on the element index)' : '';
      return { ok: true, result: { summary: summary + note, windowId: data.window_id }, a2ui };
    }
  }
  return { ok: false, result: { error: 'companion did not answer in time — is it connected? (Settings → Companion)' } };
}

const CUA_TARGET_PROPS = {
  app: { type: 'string', description: 'Target app name/title substring (optional; defaults to the newest window)' },
  window_id: { type: 'string', description: 'Exact window id from a previous capture (most precise)' },
  pid: { type: 'number', description: 'Target process id (optional)' },
};

export const TOOLS: ToolDef2[] = [
  {
    name: 'search_workspace',
    description: 'Search the workspace pages, databases and notebooks by keyword. Use this before reading or creating pages.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keywords' } }, required: ['query'] },
    write: false,
    async run(args, ctx) {
      const like = `%${args.query}%`;
      const pages = await q(
        `SELECT id, title, icon FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND (title ILIKE $2 OR markdown ILIKE $2) LIMIT 10`,
        [ctx.spaceId, like]
      );
      const notebooks = await q(`SELECT id, title FROM notebooks WHERE space_id = $1 AND title ILIKE $2 LIMIT 5`, [ctx.spaceId, like]);
      return {
        ok: true,
        result: { pages, notebooks },
        a2ui: pages.length
          ? [{ type: 'list', props: { title: `Workspace results — "${args.query}"`, items: pages.map((p: any) => ({ id: p.id, icon: p.icon ?? '', title: p.title, kind: 'page' })) } }]
          : undefined,
      };
    },
  },
  {
    name: 'read_page',
    description: 'Read a page by id or exact title. Returns its markdown content.',
    parameters: { type: 'object', properties: { ref: { type: 'string', description: 'Page id or title' } }, required: ['ref'] },
    write: false,
    async run(args, ctx) {
      const page = await findPageByTitleOrId(ctx, args.ref);
      return page
        ? { ok: true, result: { id: page.id, title: page.title, markdown: page.markdown.slice(0, 8000) } }
        : { ok: false, result: { error: 'Page not found' } };
    },
  },
  {
    name: 'create_page',
    description: 'Create a new page in the workspace with markdown content. Wiki links like [[Other Page]] are supported.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' }, markdown: { type: 'string' }, parentId: { type: 'string', description: 'Optional parent page id' } },
      required: ['title'],
    },
    write: true,
    async run(args, ctx) {
      const page = await one<any>(
        `INSERT INTO pages (space_id, parent_id, title, markdown, content, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title`,
        [ctx.spaceId, args.parentId ?? null, args.title, args.markdown ?? '', JSON.stringify(mdToDoc(args.markdown ?? '')), ctx.userId]
      );
      await syncLinks(page!.id, ctx.spaceId, args.markdown ?? '');
      const { telemetry } = await import('../telemetry/index.js');
      telemetry.track('page_created');
      return {
        ok: true,
        result: { pageId: page!.id, title: page!.title },
        a2ui: [{ type: 'card', props: { title: page!.title, icon: '', pageId: page!.id, body: (args.markdown ?? '').slice(0, 500), action: 'open_page' } }],
      };
    },
  },
  {
    name: 'create_notebook',
    description:
      'Create a new research notebook. Notebooks are containers for indexed sources (documents) that can be searched with citations and turned into study material. Use this when the user asks for a new notebook.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notebook title' },
        description: { type: 'string', description: 'Optional short description of what the notebook collects' },
      },
      required: ['title'],
    },
    write: true,
    async run(args, ctx) {
      const nb = await one<any>(
        `INSERT INTO notebooks (space_id, title, description) VALUES ($1, $2, $3) RETURNING id, title`,
        [ctx.spaceId, args.title, args.description ?? '']
      );
      return {
        ok: true,
        result: { notebookId: nb!.id, title: nb!.title },
        a2ui: [{ type: 'card', props: { title: nb!.title, icon: '', notebookId: nb!.id, body: args.description ?? 'New research notebook', action: 'open_notebook' } }],
      };
    },
  },
  {
    name: 'append_to_page',
    description: 'Append markdown content to an existing page (found by id or title).',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'string' }, markdown: { type: 'string' } },
      required: ['ref', 'markdown'],
    },
    write: true,
    async run(args, ctx) {
      const page = await findPageByTitleOrId(ctx, args.ref);
      if (!page) return { ok: false, result: { error: 'Page not found' } };
      const next = (page.markdown ? page.markdown + '\n\n' : '') + args.markdown;
      await q(`UPDATE pages SET markdown = $2, content = $3, updated_at = now() WHERE id = $1`, [page.id, next, JSON.stringify(mdToDoc(next))]);
      await syncLinks(page.id, ctx.spaceId, next);
      return { ok: true, result: { pageId: page.id, title: page.title } };
    },
  },
  {
    name: 'search_knowledge',
    description: 'Semantic + keyword search over a research notebook\'s indexed sources. Returns grounded excerpts with citations.',
    parameters: {
      type: 'object',
      properties: { notebookId: { type: 'string' }, query: { type: 'string' } },
      required: ['query'],
    },
    write: false,
    async run(args, ctx) {
      let notebookId = args.notebookId;
      if (!notebookId) {
        const nb = await one<any>(`SELECT id FROM notebooks WHERE space_id = $1 ORDER BY created_at LIMIT 1`, [ctx.spaceId]);
        notebookId = nb?.id;
      }
      if (!notebookId) return { ok: false, result: { error: 'No notebook available' } };
      const hits = await hybridSearch(notebookId, args.query, ctx.provider, 6);
      return { ok: true, result: { hits: hits.map((h) => ({ source: h.sourceName, page: h.pageLabel, heading: h.heading, excerpt: h.content.slice(0, 600), score: Math.round(h.score * 1000) / 1000 })) } };
    },
  },
  {
    name: 'generate_study_material',
    description: 'Generate study material (flashcards, quiz, study guide or audio overview script) from a notebook.',
    parameters: {
      type: 'object',
      properties: {
        notebookId: { type: 'string' },
        kind: { type: 'string', enum: ['flashcards', 'quiz', 'studyguide', 'audio'] },
        topic: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['kind'],
    },
    write: true,
    async run(args, ctx) {
      const result = await generateDeck(ctx.spaceId, args.notebookId ?? null, args.kind, args.topic, args.count ?? 10);
      const deck = await createDeckRecord(ctx.spaceId, args.notebookId ?? null, args.kind, `${args.kind}${args.topic ? ' — ' + args.topic : ''}`, result);
      let a2ui: A2UIComponent | undefined;
      if (args.kind === 'flashcards') a2ui = { type: 'flashcards', props: { deckId: deck.id, title: deck.title, cards: (result as any).cards } };
      if (args.kind === 'quiz') a2ui = { type: 'quiz', props: { deckId: deck.id, title: deck.title, items: (result as any).items } };
      if (args.kind === 'studyguide') a2ui = { type: 'card', props: { title: deck.title, icon: '', body: (result as any).markdown.slice(0, 900), kind: 'studyguide', deckId: deck.id } };
      if (args.kind === 'audio') a2ui = { type: 'card', props: { title: deck.title, icon: '', body: (result as any).segments.map((s: any) => `${s.speaker}: ${s.text}`).join('\n').slice(0, 900), kind: 'audio', deckId: deck.id } };
      return { ok: true, result: { deckId: deck.id, kind: args.kind }, a2ui: a2ui ? [a2ui] : undefined };
    },
  },
  {
    name: 'open_3d_model',
    description: 'Open an interactive 3D model in the workspace (3D viewer component). Optionally list models first.',
    parameters: { type: 'object', properties: { modelId: { type: 'string' } }, required: [] },
    write: false,
    async run(args, ctx) {
      const { getSurfaces } = await import('../surfaces.js');
      const surfaces = await getSurfaces(ctx.spaceId);
      if (!surfaces.threeD) {
        return { ok: false, result: { error: 'The 3D & CAD work surface is disabled for this space. The user can enable it in Settings  Work surfaces.' } };
      }
      const models = await q(`SELECT id, name, kind FROM models3d WHERE space_id = $1 ORDER BY created_at`, [ctx.spaceId]);
      if (args.modelId) {
        const model = models.find((m: any) => m.id === args.modelId);
        return model
          ? { ok: true, result: { model }, a2ui: [{ type: 'viewer3d', props: { modelId: model.id, name: model.name } }] }
          : { ok: false, result: { error: 'Model not found', models } };
      }
      return {
        ok: true,
        result: { models, note: 'Specify modelId to open one.' },
        a2ui: models.length ? [{ type: 'list', props: { title: '3D models', items: models.map((m: any) => ({ id: m.id, icon: '3D', title: m.name, kind: 'model' })) } }] : undefined,
      };
    },
  },
  {
    name: 'browse_library',
    description: 'Browse the open-dataset library: the curated catalog, or files inside a HuggingFace dataset (pass datasetId and optional path).',
    parameters: {
      type: 'object',
      properties: {
        datasetId: { type: 'string', description: 'e.g. markov-ai/cad-1000-hours — omit to get the catalog' },
        path: { type: 'string', description: 'Subfolder path inside the dataset' },
      },
      required: [],
    },
    write: false,
    async run(args, ctx) {
      const { getSurfaces } = await import('../surfaces.js');
      const surfaces = await getSurfaces(ctx.spaceId);
      if (!surfaces.library) {
        return { ok: false, result: { error: 'The Library work surface is disabled. The user can enable it in Settings  Work surfaces.' } };
      }
      const { CATALOG } = await import('../library/catalog.js');
      if (!args.datasetId) {
        return {
          ok: true,
          result: { catalog: CATALOG.map((c: any) => ({ id: c.id, name: c.name, category: c.category })) },
          a2ui: [{ type: 'list', props: { title: 'Open dataset library', items: CATALOG.map((c: any) => ({ id: c.id, icon: 'data', title: `${c.name} — ${c.category}`, kind: 'dataset' })) } }],
        };
      }
      const res = await fetch(
        `https://huggingface.co/api/datasets/${args.datasetId}/tree/main${args.path ? '/' + args.path : ''}?recursive=false`,
        { headers: { 'user-agent': 'SET/2.0' }, signal: AbortSignal.timeout(20000) }
      );
      if (!res.ok) return { ok: false, result: { error: `Hub returned ${res.status}` } };
      const entries: any[] = await res.json();
      return { ok: true, result: { entries: entries.slice(0, 80).map((e) => ({ type: e.type, path: e.path, size: e.size })) } };
    },
  },
  {
    name: 'import_from_dataset',
    description:
      'Import a file from a HuggingFace dataset into the workspace. 3D files (.glb/.stl/.obj/.urdf/.step) become models; documents (.md/.txt/.json/.pdf/.parquet) become notebook sources.',
    parameters: {
      type: 'object',
      properties: {
        datasetId: { type: 'string' },
        path: { type: 'string', description: 'File path inside the dataset' },
        notebookId: { type: 'string', description: 'Optional target notebook for documents' },
      },
      required: ['datasetId', 'path'],
    },
    write: true,
    async run(args, ctx) {
      const { getSurfaces } = await import('../surfaces.js');
      const surfaces = await getSurfaces(ctx.spaceId);
      if (!surfaces.library) {
        return { ok: false, result: { error: 'The Library work surface is disabled. The user can enable it in Settings  Work surfaces.' } };
      }
      const { importFromDataset } = await import('../library/import.js');
      return importFromDataset(ctx.spaceId, ctx.userId, args.datasetId, args.path, args.notebookId);
    },
  },
  {
    name: 'demo_on_screen',
    description:
      'Queue a live, on-screen demonstration for the user: their local teaching companion opens the page in their own browser and highlights the element while showing a caption. Use when the user asks to be SHOWN something ("show me how…", "where is…"). Only visible actions — never clicks or edits.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short demo title' },
        url: { type: 'string', description: 'SET path to open, e.g. "/app/space/<id>/graph" (omit for current page)' },
        selector: { type: 'string', description: 'Optional CSS selector or [data-tour=name] to highlight' },
        message: { type: 'string', description: 'One-sentence caption shown next to the highlight' },
      },
      required: ['title'],
    },
    write: true,
    async run(args, ctx) {
      const task = await one<any>(
        `INSERT INTO teach_tasks (space_id, user_id, title, url, selector, message) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title`,
        [ctx.spaceId, ctx.userId, args.title, args.url ?? null, args.selector ?? null, args.message ?? null]
      );
      return {
        ok: true,
        result: { queued: true, taskId: task!.id, note: 'The demo will appear on the user\'s screen when their companion is connected.' },
      };
    },
  },
  {
    name: 'demo_native_app',
    description:
      'Queue a live, on-screen demonstration in a NATIVE desktop app on the user\'s machine: the teaching companion launches the app and points at an element with a visible animated cursor plus a caption. Use when the user asks to be shown a desktop application (calculator, editor, file manager…). Visible actions only — never clicks or edits.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short demo title' },
        app: { type: 'string', description: 'App to launch: name or command, e.g. "calculator", "xed", "nemo"' },
        element: { type: 'string', description: 'What to point at, e.g. "push button:7" or "text:Location" — role and/or visible name substring' },
        message: { type: 'string', description: 'One-sentence caption shown as a desktop notification' },
      },
      required: ['title', 'app', 'element'],
    },
    write: true,
    async run(args, ctx) {
      const task = await one<any>(
        `INSERT INTO teach_tasks (space_id, user_id, title, kind, app, element, message) VALUES ($1, $2, $3, 'native', $4, $5, $6) RETURNING id`,
        [ctx.spaceId, ctx.userId, args.title, args.app, args.element, args.message ?? null]
      );
      return {
        ok: true,
        result: { queued: true, taskId: task!.id, note: 'Requires the user\'s companion with cua-driver connected.' },
      };
    },
  },
  {
    name: 'screen_capture',
    description:
      'See a native desktop app on the user\'s machine: returns an annotated capture — a screenshot (when the model supports vision) plus a numbered element index like `[7] push button "Open" (120,44 80x32)` with pixel bounds. Target apps with app/window_id after launch_app. Address elements in screen_act by their element_index or x,y.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['capture', 'launch_app', 'list_windows', 'list_apps'], description: 'What to do; default capture' },
        app: { type: 'string', description: 'capture: window title/app substring to target; launch_app: app name or command, e.g. "calculator"' },
        window_id: CUA_TARGET_PROPS.window_id,
        pid: CUA_TARGET_PROPS.pid,
      },
    },
    write: false,
    async run(args, ctx) {
      const action = args.action ?? 'capture';
      return runCuaOp(ctx, { action, ...args });
    },
  },
  {
    name: 'screen_act',
    description:
      'Act on a native desktop app on the user\'s machine: click, type, press keys, or scroll. ALWAYS screen_capture first and address elements by element_index (or pixel x,y). Every action returns a fresh capture of the result. Requires the user\'s companion to run with SET_ALLOW_INPUT=1 and may ask the user for approval.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['click', 'type', 'key', 'scroll', 'set_value'] },
        element_index: { type: 'number', description: 'Element from the last capture (preferred)' },
        x: { type: 'number', description: 'Pixel x (alternative to element_index)' },
        y: { type: 'number', description: 'Pixel y' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'click only' },
        count: { type: 'number', description: 'click count (2 = double-click)' },
        text: { type: 'string', description: 'type: text to enter' },
        keys: { type: 'string', description: 'key: combo like "ctrl+s"' },
        direction: { type: 'string', enum: ['up', 'down'], description: 'scroll only' },
        amount: { type: 'number', description: 'scroll steps' },
        value: { type: 'string', description: 'set_value: new value for the element' },
        app: CUA_TARGET_PROPS.app,
        window_id: CUA_TARGET_PROPS.window_id,
      },
      required: ['action'],
    },
    write: true,
    async run(args, ctx) {
      return runCuaOp(ctx, args);
    },
  },
  {
    name: 'render_ui',
    description: 'Render a rich UI component for the user: card, table or form. Use for structured answers instead of plain text.',
    parameters: {
      type: 'object',
      properties: {
        component: { type: 'string', enum: ['card', 'table', 'form'] },
        props: { type: 'object', description: 'card: {title,icon,body}; table: {title,columns,rows}; form: {title,fields:[{name,label,type}],submitLabel}' },
      },
      required: ['component', 'props'],
    },
    write: false,
    async run(args) {
      return { ok: true, result: { rendered: true }, a2ui: [{ type: args.component, props: args.props }] };
    },
  },
];

export const TOOL_DEFS: ToolDef[] = TOOLS.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

export function getTool(name: string): ToolDef2 | undefined {
  return TOOLS.find((t) => t.name === name);
}
