import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace } from '../lib/http.js';
import { getProvider } from '../llm/router.js';
import { ingestSource } from '../rag/search.js';
import { mdToDoc } from '../lib/markdown.js';
import { syncLinks } from '../pages/routes.js';
import { config } from '../config.js';

/**
 * Deep research routes (PLAN.md Phase 1). The CrewAI worker (compose service
 * `research`) executes runs and writes progress + raw sources into Postgres;
 * this layer creates runs, forwards provider config, and — once the worker
 * finishes — ingests the sources (chunk+embed via the normal pipeline) and
 * creates the cited report page. Ingestion stays in TypeScript; the Python
 * side never embeds.
 */

const TERMINAL = new Set(['finished', 'error', 'cancelled']);

async function runSpace(req: any, reply: any, runId: string): Promise<string | null> {
  const row = await one<{ space_id: string }>(`SELECT space_id FROM research_runs WHERE id = $1`, [runId]);
  if (!row) {
    reply.code(404).send({ error: 'Run not found' });
    return null;
  }
  if (!(await requireSpace(req, reply, row.space_id))) return null;
  return row.space_id;
}

export async function researchRoutes(app: FastifyInstance) {
  app.post('/spaces/:spaceId/research', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z
      .object({
        question: z.string().min(8).max(2000),
        notebookId: z.string().uuid().optional(),
        maxPages: z.number().int().min(1).max(120).optional(),
        maxMinutes: z.number().int().min(1).max(60).optional(),
      })
      .parse(req.body);

    // target notebook: existing, or a fresh one per run
    let notebookId = body.notebookId ?? null;
    if (!notebookId) {
      const nb = await one<any>(
        `INSERT INTO notebooks (space_id, title, description) VALUES ($1, $2, $3) RETURNING id`,
        [spaceId, `Research: ${body.question.slice(0, 80)}`, 'Deep research run']
      );
      notebookId = nb!.id;
    } else {
      const owns = await one<any>(`SELECT id FROM notebooks WHERE id = $1 AND space_id = $2`, [notebookId, spaceId]);
      if (!owns) return reply.code(404).send({ error: 'Notebook not found in this space' });
    }

    const settings = await one<{ data: any }>(`SELECT data FROM settings WHERE space_id = $1`, [spaceId]);
    const researchCfg = settings?.data?.research ?? {};

    const run = await one<any>(
      `INSERT INTO research_runs (space_id, user_id, notebook_id, question, progress)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [spaceId, req.user!.id, notebookId, body.question, JSON.stringify({ pages_budget: body.maxPages ?? 40 })]
    );

    // forward to the worker with this space's provider + firecrawl key
    const provider = await getProvider(spaceId);
    const payload = {
      run_id: run!.id,
      question: body.question,
      notebook_id: notebookId,
      max_pages: body.maxPages ?? researchCfg.maxPages ?? 40,
      max_minutes: body.maxMinutes ?? researchCfg.maxMinutes ?? 15,
      llm_config: provider
        ? {
            base_url: provider.base_url,
            api_key: provider.api_key,
            // mixed-model crews: a tool-calling model for reasoning/tools,
            // a vision-tuned model reads unextractable pages by eye
            chat_model: researchCfg.chatModel || provider.chat_model,
            ...(researchCfg.visionModel ? { vision_model: researchCfg.visionModel } : {}),
          }
        : {},
      // optional Firecrawl-compatible override; in-stack SearXNG+Playwright is the default
      firecrawl_key: researchCfg.firecrawlKey || null,
      firecrawl_url: researchCfg.firecrawlUrl || null,
    };
    dispatch(payload, run!.id);

    return { run: run };
  });

  app.get('/spaces/:spaceId/research', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT r.*, n.title AS notebook_title,
        (SELECT count(*) FROM sources s WHERE s.meta->>'research_run_id' = r.id::text) AS source_count
       FROM research_runs r LEFT JOIN notebooks n ON n.id = r.notebook_id
       WHERE r.space_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
      [spaceId]
    );
    return { runs: rows };
  });

  app.get('/research/:id', async (req, reply) => {
    const id = (req.params as any).id;
    if (!(await runSpace(req, reply, id))) return;
    await advance(id); // ingest + report page when the worker is done
    const row = await one<any>(
      `SELECT r.*, n.title AS notebook_title,
        (SELECT count(*) FROM sources s WHERE s.meta->>'research_run_id' = r.id::text) AS source_count,
        (SELECT json_agg(json_build_object('id', s.id, 'name', s.name, 'uri', s.uri, 'status', s.status))
           FROM sources s WHERE s.meta->>'research_run_id' = r.id::text) AS sources
       FROM research_runs r LEFT JOIN notebooks n ON n.id = r.notebook_id
       WHERE r.id = $1`,
      [id]
    );
    return { run: row };
  });

  app.post('/research/:id/cancel', async (req, reply) => {
    const id = (req.params as any).id;
    if (!(await runSpace(req, reply, id))) return;
    await q(
      `UPDATE research_runs SET status = CASE WHEN status IN ('finished','error','cancelled') THEN status ELSE 'cancelled' END, finished_at = now() WHERE id = $1`,
      [id]
    );
    return { ok: true };
  });
}

/** Fire-and-forget handoff to the Python worker; failures land in the run row. */
function dispatch(payload: any, runId: string) {
  void fetch(`${config.researchServiceUrl}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  })
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        await q(`UPDATE research_runs SET status='error', error=$2, finished_at=now() WHERE id=$1 AND status='pending'`, [runId, `research worker: ${r.status} ${text}`.slice(0, 500)]);
      }
    })
    .catch(async (e: any) => {
      await q(
        `UPDATE research_runs SET status='error', error=$2, finished_at=now() WHERE id=$1 AND status='pending'`,
        [runId, `research service unreachable (${e?.message ?? e}). Is the "research" compose service running?`]
      );
    });
}

/**
 * Worker done (status 'synthesized') → ingest sources, create the cited report
 * page, mark finished. The status-guarded UPDATE makes it idempotent even with
 * concurrent pollers.
 */
async function advance(runId: string) {
  const claimed = await one<any>(
    `UPDATE research_runs SET status='ingesting' WHERE id=$1 AND status='synthesized' RETURNING *`,
    [runId]
  );
  if (!claimed) return;
  const run = claimed;
  try {
    const provider = await getProvider(run.space_id);
    const pending = await q<{ id: string }>(
      `SELECT id FROM sources WHERE meta->>'research_run_id' = $1 AND status IN ('pending','error')`,
      [runId]
    );
    for (const s of pending) {
      try {
        await ingestSource(s.id, provider);
      } catch (e: any) {
        // ingestSource already records per-source errors; keep going
      }
    }
    if (run.report_md) {
      const title = (run.report_md.match(/^#\s+(.+)$/m)?.[1] ?? run.question).slice(0, 120);
      const page = await one<any>(
        `INSERT INTO pages (space_id, title, markdown, content, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [run.space_id, title, run.report_md, JSON.stringify(mdToDoc(run.report_md)), run.user_id]
      );
      await syncLinks(page!.id, run.space_id, run.report_md);
      await q(`UPDATE research_runs SET report_page_id=$2 WHERE id=$1`, [runId, page!.id]);
    }
    await q(`UPDATE research_runs SET status='finished', finished_at=now() WHERE id=$1`, [runId]);
  } catch (e: any) {
    await q(`UPDATE research_runs SET status='error', error=$2, finished_at=now() WHERE id=$1`, [runId, String(e?.message ?? e).slice(0, 800)]);
  }
}
