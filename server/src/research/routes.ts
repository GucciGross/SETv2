import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createReadStream } from 'node:fs';
import { join, normalize } from 'node:path';
import { one, q } from '../db.js';
import { requireSpace } from '../lib/http.js';
import { getProvider, chatCompletion } from '../llm/router.js';
import { generateDeck, createDeckRecord } from '../study/generate.js';
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
        maxMinutes: z.number().int().min(5).max(4320).optional(), // 5 min … 72 h
        style: z.string().max(120).optional(), // enum or 'tpl:<templateId>'
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
    const researchCfg = settings?.data?.research ?? {}
    // resolve workspace report templates (Settings → Deep Research → Templates)
    const templates: any[] = researchCfg.templates ?? [];
    const tpl = body.style?.startsWith('tpl:') ? templates.find((t) => `tpl:${t.id}` === body.style) : undefined;
    const styleValue = tpl ? `tpl:${tpl.id}` : (body.style && ['ste', 'professional', 'executive', 'study'].includes(body.style) ? body.style : (researchCfg.style ?? 'ste'));;

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
      style: run!.style,
      style_instructions: tpl?.instructions ?? null,
      notebook_id: notebookId,
      max_pages: body.maxPages ?? researchCfg.maxPages ?? 40,
      max_minutes: body.maxMinutes ?? researchCfg.maxMinutes ?? 25,
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

  /**
   * Rewrite an existing report in Simplified Technical English (short active
   * sentences, plain words, concrete facts; citations preserved). Plain,
   * direct writing also reads like a competent human wrote it — not like
   * generic AI filler.
   */
  app.post('/research/:id/simplify', async (req, reply) => {
    const id = (req.params as any).id;
    if (!(await runSpace(req, reply, id))) return;
    const run = await one<any>(`SELECT * FROM research_runs WHERE id = $1`, [id]);
    if (!run?.report_md) return reply.code(400).send({ error: 'No report to simplify' });
    const provider = await getProvider(run.space_id);
    if (!provider) return reply.code(400).send({ error: 'No LLM provider configured' });

    const STE_RULES = `Rewrite the report in Simplified Technical English (ASD-STE100 style):
- Short sentences. One idea per sentence. Aim for 15 words or fewer.
- Active voice only. Subject, verb, object.
- Use everyday words. No jargon unless you define it on first use.
- Delete all filler and marketing language ("cutting-edge", "it is worth noting that", "in today's world").
- Keep every concrete fact: numbers, names, dates, comparisons.
- Keep every [S#] citation attached to the fact it supports. Add nothing the sources do not say.
- Keep the markdown structure: same headings order, TL;DR first, "Gaps & open questions" last.
Output only the rewritten markdown.`;

    const result = await chatCompletion(provider, null, {
      messages: [
        { role: 'system', content: STE_RULES },
        { role: 'user', content: run.report_md.slice(0, 60000) },
      ],
      temperature: 0.2,
    });
    const next = (result.content ?? '').trim();
    if (!next || next.length < 200) return reply.code(502).send({ error: 'Rewrite came back empty' });

    await q(`UPDATE research_runs SET report_md = $2 WHERE id = $1`, [id, next]);
    if (run.report_page_id) {
      const title = (next.match(/^#\s+(.+)$/m)?.[1] ?? run.question).slice(0, 120);
      await q(`UPDATE pages SET title = $2, markdown = $3, content = $4, updated_at = now() WHERE id = $1`, [
        run.report_page_id, title, next, JSON.stringify(mdToDoc(next)),
      ]);
      await syncLinks(run.report_page_id, run.space_id, next);
    }
    await q(
      `UPDATE research_runs SET log = log || $2::jsonb WHERE id = $1`,
      [id, JSON.stringify([{ t: new Date().toISOString(), type: 'simplify', message: 'Report rewritten in Simplified Technical English' }])]
    );
    return { ok: true };
  });

  // report visuals (charts/pictures) written by the worker under
  // DATA_DIR/research-assets/<runId>/ — filenames are worker-generated and
  // unguessable; <img> tags cannot send auth headers.
  app.get('/research/:id/assets/:file', async (req, reply) => {
    const id = (req.params as any).id as string;
    const file = (req.params as any).file as string;
    if (!/^[\w.-]+$/.test(file) || !/^[0-9a-f-]{36}$/.test(id)) return reply.code(400).send({ error: 'bad path' });
    const path = normalize(join(config.dataDir, 'research-assets', id, file));
    if (!path.startsWith(join(config.dataDir, 'research-assets'))) return reply.code(400).send({ error: 'bad path' });
    const stream = createReadStream(path);
    stream.on('error', () => reply.code(404).send({ error: 'not found' }));
    reply.header('content-type', file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream');
    return stream;
  });

  /** One-click study deck from a finished run's ingested notebook sources. */
  app.post('/research/:id/deck', async (req, reply) => {
    const id = (req.params as any).id;
    if (!(await runSpace(req, reply, id))) return;
    const body = z.object({ kind: z.enum(['flashcards', 'quiz', 'studyguide']).default('flashcards') }).parse(req.body ?? {});
    const run = await one<any>(`SELECT * FROM research_runs WHERE id = $1`, [id]);
    if (!run?.notebook_id) return reply.code(400).send({ error: 'Run has no notebook' });
    const provider = await getProvider(run.space_id);
    if (!provider) return reply.code(400).send({ error: 'No LLM provider configured' });
    try {
      const result = await generateDeck(run.space_id, run.notebook_id, body.kind, run.question.slice(0, 120), 12);
      const deck = await createDeckRecord(run.space_id, run.notebook_id, body.kind, `${body.kind} — ${run.question.slice(0, 60)}`, result);
      await q(
        `UPDATE research_runs SET log = log || $2::jsonb WHERE id = $1`,
        [id, JSON.stringify([{ t: new Date().toISOString(), type: 'deck', message: `Generated ${body.kind} deck from research sources` }])]
      );
      return { deckId: deck.id, notebookId: run.notebook_id, kind: body.kind };
    } catch (e: any) {
      return reply.code(500).send({ error: `Deck generation failed: ${e?.message ?? e}` });
    }
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
