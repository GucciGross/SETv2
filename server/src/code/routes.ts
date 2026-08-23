import type { FastifyInstance } from 'fastify';
import vm from 'node:vm';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace, requireResourceSpace, rid } from '../lib/http.js';
import { requireSurface } from '../surfaces.js';

/** Coding surface: per-space code files + a sandboxed JavaScript runner. */

export function runJs(code: string, timeoutMs = 3000): { ok: boolean; result: string; logs: string[] } {
  const logs: string[] = [];
  const push = (level: string) => (...args: any[]) =>
    logs.push(`${level}: ${args.map((a) => (typeof a === 'object' ? safeJson(a) : String(a))).join(' ')}`);
  const sandbox = {
    console: { log: push('log'), info: push('info'), warn: push('warn'), error: push('error') },
    JSON,
    Math,
    Date,
  };
  try {
    const context = vm.createContext(sandbox);
    const value = new vm.Script(code, { filename: 'set-sandbox.js' }).runInContext(context, { timeout: timeoutMs });
    let result = '';
    if (value !== undefined) {
      result = typeof value === 'object' ? safeJson(value) : String(value);
    }
    return { ok: true, result, logs };
  } catch (e: any) {
    return { ok: false, result: e?.message ? `${e.name}: ${e.message}` : String(e), logs };
  }
}

function safeJson(v: any): string {
  try {
    return JSON.stringify(v, null, 1) ?? String(v);
  } catch {
    return String(v);
  }
}

export async function codeRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/code/files', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    if (!(await requireSurface(reply, spaceId, 'coding'))) return;
    const rows = await q(
      `SELECT path, length(content) AS size, updated_at FROM code_files WHERE space_id = $1 ORDER BY path`,
      [spaceId]
    );
    return { files: rows };
  });

  app.get('/spaces/:spaceId/code/file', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    if (!(await requireSurface(reply, spaceId, 'coding'))) return;
    const path = String((req.query as any).path ?? '');
    const row = await one<{ content: string }>(
      `SELECT content FROM code_files WHERE space_id = $1 AND path = $2`,
      [spaceId, path]
    );
    if (!row) return reply.code(404).send({ error: 'File not found' });
    return { path, content: row.content };
  });

  app.put('/spaces/:spaceId/code/file', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    if (!(await requireSurface(reply, spaceId, 'coding'))) return;
    const body = z.object({ path: z.string().min(1).max(300), content: z.string().max(2_000_000) }).parse(req.body);
    if (!/^[\w./ -]+$/.test(body.path) || body.path.includes('..')) {
      return reply.code(400).send({ error: 'Invalid path' });
    }
    await q(
      `INSERT INTO code_files (space_id, path, content, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (space_id, path) DO UPDATE SET content = EXCLUDED.content, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [spaceId, body.path, body.content, req.user!.id]
    );
    return { ok: true };
  });

  app.delete('/spaces/:spaceId/code/file', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    if (!(await requireSurface(reply, spaceId, 'coding'))) return;
    const path = String((req.query as any).path ?? '');
    await q(`DELETE FROM code_files WHERE space_id = $1 AND path = $2`, [spaceId, path]);
    return { ok: true };
  });

  app.post('/spaces/:spaceId/code/run', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    if (!(await requireSurface(reply, spaceId, 'coding'))) return;
    const body = z
      .object({ code: z.string().optional(), path: z.string().optional(), timeoutMs: z.number().min(100).max(10000).optional() })
      .parse(req.body);
    let code = body.code ?? '';
    if (!code && body.path) {
      const row = await one<{ content: string }>(`SELECT content FROM code_files WHERE space_id = $1 AND path = $2`, [
        spaceId,
        body.path,
      ]);
      if (!row) return reply.code(404).send({ error: 'File not found' });
      code = row.content;
    }
    if (!code.trim()) return reply.code(400).send({ error: 'Nothing to run' });
    return runJs(code, body.timeoutMs ?? 3000);
  });
}

export async function terminalRoutes(app: FastifyInstance) {
  app.post('/terminal/exec', async (req, reply) => {
    const body = z.object({ spaceId: z.string(), command: z.string().min(1).max(4000) }).parse(req.body);
    if (!(await requireSpace(req, reply, body.spaceId))) return;
    if (!(await requireSurface(reply, body.spaceId, 'terminal'))) return;
    const userId = req.user!.id;
    const [cmd, ...rest] = body.command.trim().split(/\s+/);
    const arg = body.command.trim().slice(cmd.length).trim();
    const out: string[] = [];

    switch (cmd) {
      case 'help':
        out.push(
          'SET workspace console — commands:',
          '  help                 this text',
          '  stat                 space statistics',
          '  pages [filter]       list pages (optional filter)',
          '  open <title>         show a page (id + preview)',
          '  new <title>          create a page',
          '  notebooks            list research notebooks',
          '  find <query>         grounded search across all notebooks',
          '  models               list 3D models (3D & CAD surface)',
          '  surfaces             show enabled work surfaces',
          '  runjs <code>         run JavaScript in the sandbox'
        );
        break;
      case 'stat': {
        const [p, n, d] = await Promise.all([
          one<{ c: string }>(`SELECT count(*)::text AS c FROM pages WHERE space_id = $1 AND deleted_at IS NULL`, [body.spaceId]),
          one<{ c: string }>(`SELECT count(*)::text AS c FROM notebooks WHERE space_id = $1`, [body.spaceId]),
          one<{ c: string }>(`SELECT count(*)::text AS c FROM databases WHERE space_id = $1`, [body.spaceId]),
        ]);
        out.push(`pages: ${p?.c}  notebooks: ${n?.c}  databases: ${d?.c}`);
        break;
      }
      case 'surfaces': {
        const { getSurfaces } = await import('../surfaces.js');
        const surfaces = await getSurfaces(body.spaceId);
        out.push(...Object.entries(surfaces).map(([k, v]) => `${v ? '[x]' : '[ ]'} ${k}`));
        break;
      }
      case 'pages': {
        const rows = await q<{ title: string }>(
          `SELECT title FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND is_template = false
           AND ($2 = '' OR title ILIKE '%' || $2 || '%') ORDER BY title LIMIT 40`,
          [body.spaceId, arg]
        );
        out.push(...(rows.length ? rows.map((r) => `  ${r.title}`) : ['no pages matched']));
        break;
      }
      case 'open': {
        if (!arg) {
          out.push('usage: open <title>');
          break;
        }
        const page = await one<any>(
          `SELECT id, title, markdown FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND lower(title) = lower($2) LIMIT 1`,
          [body.spaceId, arg]
        );
        if (!page) {
          out.push(`no page titled "${arg}"`);
          break;
        }
        out.push(`${page.title}  (${page.id})`, '', page.markdown.split('\n').slice(0, 15).join('\n') || '(empty page)');
        break;
      }
      case 'new': {
        if (!arg) {
          out.push('usage: new <title>');
          break;
        }
        const { mdToDoc } = await import('../lib/markdown.js');
        const page = await one<any>(
          `INSERT INTO pages (space_id, title, markdown, content, created_by) VALUES ($1, $2, '', $3, $4) RETURNING id, title`,
          [body.spaceId, arg, JSON.stringify(mdToDoc('')), userId]
        );
        out.push(`created page "${page!.title}" (${page!.id})`);
        break;
      }
      case 'notebooks': {
        const rows = await q<{ title: string; id: string }>(
          `SELECT title, id FROM notebooks WHERE space_id = $1 ORDER BY created_at DESC`,
          [body.spaceId]
        );
        out.push(...(rows.length ? rows.map((r) => `  ${r.title}  (${r.id.slice(0, 8)})`) : ['no notebooks']));
        break;
      }
      case 'find': {
        if (!arg) {
          out.push('usage: find <query>');
          break;
        }
        const notebooks = await q<{ id: string; title: string }>(`SELECT id, title FROM notebooks WHERE space_id = $1`, [body.spaceId]);
        if (!notebooks.length) {
          out.push('no notebooks in this space yet');
          break;
        }
        const { retrieve } = await import('../rag/provider.js');
        for (const nb of notebooks) {
          const hits = await retrieve(nb.id, arg, 3);
          for (const h of hits) {
            out.push(`  [${nb.title}] ${h.sourceName}${h.pageLabel ? ` (${h.pageLabel})` : ''}`);
            out.push(`    ${h.content.replace(/\s+/g, ' ').slice(0, 160)}…`);
          }
        }
        if (out.length === 0) out.push('no grounded matches');
        break;
      }
      case 'models': {
        const surfaces = await (await import('../surfaces.js')).getSurfaces(body.spaceId);
        if (!surfaces.threeD) {
          out.push('3D & CAD surface is disabled (enable in Settings  Work surfaces)');
          break;
        }
        const rows = await q<{ name: string; kind: string }>(`SELECT name, kind FROM models3d WHERE space_id = $1`, [body.spaceId]);
        out.push(...(rows.length ? rows.map((r) => `  ${r.name} [${r.kind}]`) : ['no models']));
        break;
      }
      case 'runjs': {
        if (!arg) {
          out.push('usage: runjs <javascript>');
          break;
        }
        const r = runJs(arg);
        out.push(...r.logs, ...(r.result ? [`=> ${r.result}`] : []), r.ok ? '' : `error: ${r.result}`);
        break;
      }
      default:
        out.push(`unknown command: ${cmd} — try "help"`);
    }
    return { output: out.filter((l) => l !== '').join('\n') };
  });
}
