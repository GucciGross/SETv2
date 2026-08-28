import type { FastifyInstance, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';
import { config } from '../config.js';
import { getProvider, chatCompletionStream, ensureBootstrapProvider } from '../llm/router.js';
import { ingestSource, buildGroundedPrompt, type SearchHit } from './search.js';
import { recordActivity } from '../team/activity.js';
import { transcriptionConfigured, transcribeBuffer } from '../copilotkit/transcribe.js';
import { retrieve } from './provider.js';
import { extractDates } from './chunker.js';

async function extractPdfText(buf: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default as any;
  const result = await pdfParse(buf);
  return result.text as string;
}

async function extractWebText(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'SET/2.0 (+self-hosted research tool)' } });
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? url;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

function sseSend(reply: FastifyReply, event: string, data: any) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function ragRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/notebooks', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT n.*, (SELECT count(*) FROM sources s WHERE s.notebook_id = n.id) AS source_count,
        (SELECT count(*) FROM chunks c WHERE c.notebook_id = n.id) AS chunk_count
       FROM notebooks n WHERE n.space_id = $1 ORDER BY n.created_at DESC`,
      [spaceId]
    );
    return { notebooks: rows };
  });

  app.post('/spaces/:spaceId/notebooks', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z
      .object({
        title: z.string().min(1),
        description: z.string().optional(),
        subjectId: z.string().nullable().optional(),
      })
      .parse(req.body);
    const nb = await one<any>(
      `INSERT INTO notebooks (space_id, title, description, subject_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [spaceId, body.title, body.description ?? '', body.subjectId ?? null]
    );
    return { notebook: nb };
  });

  app.get('/notebooks/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'notebooks', id);
    if (!ctx) return;
    const notebook = await one<any>(`SELECT * FROM notebooks WHERE id = $1`, [id]);
    const sources = await q(
      `SELECT id, kind, name, uri, mime, size_bytes, status, error, meta, created_at,
        (SELECT count(*) FROM chunks c WHERE c.source_id = sources.id) AS chunk_count
       FROM sources WHERE notebook_id = $1 ORDER BY created_at`,
      [id]
    );
    return { notebook, sources };
  });

  app.patch('/notebooks/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'notebooks', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        subjectId: z.string().nullable().optional(),
      })
      .parse(req.body);
    const sets: string[] = [];
    const vals: any[] = [id];
    if (body.title !== undefined) { vals.push(body.title); sets.push(`title = $${vals.length}`); }
    if (body.description !== undefined) { vals.push(body.description); sets.push(`description = $${vals.length}`); }
    if (body.subjectId !== undefined) {
      vals.push(body.subjectId);
      sets.push(`subject_id = $${vals.length}::uuid`);
    }
    if (!sets.length) return reply.code(400).send({ error: 'Nothing to update' });
    const notebook = await one<any>(`UPDATE notebooks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    return { notebook };
  });

  app.delete('/notebooks/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'notebooks', id, 'editor');
    if (!ctx) return;
    await q(`DELETE FROM notebooks WHERE id = $1`, [id]);
    return { ok: true };
  });

  // Whether server-side STT is configured (recorder mode UI checks this)
  app.get('/transcribe/available', async () => {
    return { available: transcriptionConfigured() };
  });

  // Recorder mode: multipart audio → STT → transcript source → auto-ingest.
  // Fields: audio (file), title (optional text field).
  app.post('/notebooks/:id/transcribe', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'notebooks', id, 'editor');
    if (!ctx) return;
    if (!transcriptionConfigured()) {
      return reply.code(400).send({
        error: 'Voice transcription is not configured on this server. Set TRANSCRIBE_BASE_URL (any Whisper-compatible /audio/transcriptions endpoint) and restart.',
      });
    }
    let audio: { buf: Buffer; filename: string } | null = null;
    let title = '';
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        audio = { buf: await part.toBuffer(), filename: part.filename || 'audio.webm' };
      } else if (part.fieldname === 'title') {
        title = String(part.value ?? '');
      }
    }
    if (!audio) return reply.code(400).send({ error: 'No audio received' });

    let transcript: string;
    try {
      transcript = await transcribeBuffer(audio.buf, audio.filename);
    } catch (e: any) {
      return reply.code(502).send({ error: e.message ?? 'Transcription failed' });
    }
    if (!transcript.trim()) return reply.code(502).send({ error: 'Transcription came back empty — was the recording audible?' });

    await ensureBootstrapProvider(ctx.spaceId);
    const provider = await getProvider(ctx.spaceId);
    const name = title.trim() || `Recording — ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    const src = await one<any>(
      `INSERT INTO sources (notebook_id, kind, name, mime, size_bytes, text_content, meta, status)
       VALUES ($1, 'recording', $2, $3, $4, $5, $6, 'pending') RETURNING *`,
      [id, name, audio.filename, audio.buf.length, transcript, JSON.stringify({ recorded: true })]
    );
    void ingestSource(src!.id, provider);
    void recordActivity(id, req.user!.id, 'source_added', { count: 1, names: [name] });
    return { source: { ...src, text_content: undefined }, transcriptLength: transcript.length };
  });

  // Upload a source: multipart file (pdf/md/txt), JSON {url}, or JSON {text}
  app.post('/notebooks/:id/sources', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'notebooks', id, 'editor');
    if (!ctx) return;
    await ensureBootstrapProvider(ctx.spaceId);
    const provider = await getProvider(ctx.spaceId);
    const created: any[] = [];

    const makeSource = async (kind: string, name: string, text: string, extra: { uri?: string; mime?: string; size?: number; meta?: any } = {}) => {
      const src = await one<any>(
        `INSERT INTO sources (notebook_id, kind, name, uri, mime, size_bytes, text_content, meta, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING *`,
        [id, kind, name, extra.uri ?? null, extra.mime ?? null, extra.size ?? text.length, text, JSON.stringify(extra.meta ?? {})]
      );
      created.push(src);
      // ingest asynchronously — status field tracks progress
      void ingestSource(src!.id, provider).then(() => {
        void 0;
      });
    };

    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('multipart/form-data')) {
      const files = req.files ? await req.files() : [];
      for await (const file of files) {
        const buf = await file.toBuffer();
        const lower = file.filename.toLowerCase();
        let text = '';
        let kind = 'txt';
        if (lower.endsWith('.pdf') || file.mimetype === 'application/pdf') {
          kind = 'pdf';
          text = await extractPdfText(buf).catch((e) => {
            throw new Error(`PDF parse failed for ${file.filename}: ${e.message}`);
          });
        } else if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
          kind = 'md';
          text = buf.toString('utf8');
        } else {
          text = buf.toString('utf8');
        }
        // persist original file for source viewer / highlight
        const dir = path.join(config.dataDir, 'sources', id);
        fs.mkdirSync(dir, { recursive: true });
        const safe = file.filename.replace(/[^\w.\- ]/g, '_');
        fs.writeFileSync(path.join(dir, safe), buf);
        await makeSource(kind, file.filename.replace(/\.[^.]+$/, ''), text, {
          mime: file.mimetype,
          size: buf.length,
          meta: { storedFile: safe },
        });
      }
    } else {
      const body = z
        .object({ url: z.string().url().optional(), text: z.string().optional(), name: z.string().optional(), kind: z.string().optional() })
        .parse(req.body);
      if (body.url) {
        const { title, text } = await extractWebText(body.url);
        await makeSource('web', body.name ?? title, text, { uri: body.url });
      } else if (body.text) {
        await makeSource(body.kind ?? 'txt', body.name ?? 'Pasted text', body.text);
      } else {
        return reply.code(400).send({ error: 'Provide a file, url or text' });
      }
    }
    if (created.length) void recordActivity(id, req.user!.id, 'source_added', { count: created.length, names: created.map((c: any) => c.name).slice(0, 3) });
    return { sources: created };
  });

  app.get('/sources/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'sources', id);
    if (!ctx) return;
    const source = await one<any>(`SELECT * FROM sources WHERE id = $1`, [id]);
    return { source };
  });

  app.delete('/sources/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'sources', id, 'editor');
    if (!ctx) return;
    await q(`DELETE FROM sources WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.get('/sources/:id/chunks', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'sources', id);
    if (!ctx) return;
    const rows = await q(
      `SELECT id, idx, heading, content, page_label, meta FROM chunks WHERE source_id = $1 ORDER BY idx`,
      [id]
    );
    return { chunks: rows };
  });

  // Human-in-the-loop chunk correction (visual chunking inspection)
  app.patch('/chunks/:chunkId', async (req, reply) => {
    const chunkId = rid((req.params as any).chunkId);
    const ctx = await requireResourceSpace(req, reply, 'chunks', chunkId, 'editor');
    if (!ctx) return;
    const body = z.object({ content: z.string().optional(), heading: z.string().optional() }).parse(req.body);
    if (body.content !== undefined) await q(`UPDATE chunks SET content = $2, tsv = NULL, embedding = NULL WHERE id = $1`, [chunkId, body.content]);
    if (body.heading !== undefined) await q(`UPDATE chunks SET heading = $2, tsv = NULL WHERE id = $1`, [chunkId, body.heading]);
    return { ok: true };
  });

  app.post('/chunks/:chunkId/reembed', async (req, reply) => {
    const chunkId = rid((req.params as any).chunkId);
    const ctx = await requireResourceSpace(req, reply, 'chunks', chunkId, 'editor');
    if (!ctx) return;
    await ensureBootstrapProvider(ctx.spaceId);
    const provider = await getProvider(ctx.spaceId);
    const chunk = await one<any>(`SELECT * FROM chunks WHERE id = $1`, [chunkId]);
    const { embedTexts, hashEmbed } = await import('../llm/router.js');
    const text = `${chunk.heading ? chunk.heading + '\n' : ''}${chunk.content}`;
    const vec = provider?.embed_model ? (await embedTexts(provider, [text])).vectors[0] : hashEmbed(text);
    await q(`UPDATE chunks SET embedding = $2 WHERE id = $1`, [chunkId, JSON.stringify(vec)]);
    return { ok: true };
  });

  // Knowledge organization views over a notebook
  app.get('/notebooks/:id/views', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'notebooks', id);
    if (!ctx) return;
    const chunks = await q<{ heading: string | null; content: string; source_id: string; page_label: string | null; idx: number }>(
      `SELECT heading, content, source_id, page_label, idx FROM chunks WHERE notebook_id = $1 ORDER BY source_id, idx`,
      [id]
    );
    const sources = await q<{ id: string; name: string; kind: string }>(`SELECT id, name, kind FROM sources WHERE notebook_id = $1`, [id]);
    const sourceById = new Map(sources.map((s) => [s.id, s]));

    // Mind map / tree: source  heading  chunks
    const tree = sources.map((s) => {
      const heads = new Map<string, { text: string; chunkId?: string }[]>();
      for (const c of chunks.filter((c) => c.source_id === s.id)) {
        const key = c.heading || '(body)';
        if (!heads.has(key)) heads.set(key, []);
        heads.get(key)!.push({ text: c.content.slice(0, 160) });
      }
      return { id: s.id, name: s.name, kind: s.kind, children: [...heads.entries()].map(([heading, items]) => ({ heading, items: items.slice(0, 6) })) };
    });

    // Timeline: dates found in chunks
    const timeline: { date: string; context: string; sourceName: string }[] = [];
    for (const c of chunks) {
      for (const d of extractDates(c.content)) {
        timeline.push({ ...d, sourceName: sourceById.get(c.source_id)?.name ?? '' });
      }
    }
    timeline.sort((a, b) => a.date.localeCompare(b.date));

    // Page index: flat chunk index grouped per source
    const index = sources.map((s) => ({
      source: s,
      entries: chunks.filter((c) => c.source_id === s.id).map((c) => ({ heading: c.heading || '(body)', page: c.page_label, preview: c.content.slice(0, 120) })),
    }));

    return { tree, timeline: timeline.slice(0, 100), index };
  });

  // ---------- Grounded chat ----------

  app.get('/spaces/:spaceId/sessions', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const notebookId = (req.query as any).notebookId;
    const rows = await q(
      `SELECT * FROM chat_sessions WHERE space_id = $1 AND user_id = $2 AND ($3::uuid IS NULL OR notebook_id = $3::uuid)
       ORDER BY created_at DESC LIMIT 50`,
      [spaceId, req.user!.id, notebookId ?? null]
    );
    return { sessions: rows };
  });

  app.post('/spaces/:spaceId/chat', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    await ensureBootstrapProvider(spaceId);
    const provider = await getProvider(spaceId);
    const body = z
      .object({
        sessionId: z.string().optional(),
        notebookId: z.string().optional().nullable(),
        message: z.string().min(1),
      })
      .parse(req.body);

    let session = body.sessionId
      ? await one<any>(`SELECT * FROM chat_sessions WHERE id = $1 AND space_id = $2 AND user_id = $3`, [body.sessionId, spaceId, req.user!.id])
      : null;
    if (!session) {
      session = await one<any>(
        `INSERT INTO chat_sessions (space_id, notebook_id, user_id, title) VALUES ($1, $2, $3, $4) RETURNING *`,
        [spaceId, body.notebookId ?? null, req.user!.id, body.message.slice(0, 60)]
      );
    }

    // SSE stream
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    sseSend(reply, 'meta', { sessionId: session.id });

    await q(`INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', $2)`, [session.id, body.message]);

    let hits: SearchHit[] = [];
    if (body.notebookId) {
      hits = await retrieve(body.notebookId, body.message, 8);
    }

    if (!provider) {
      const msg = 'No LLM provider configured. Add one in **Settings  AI Providers** (e.g. Ollama at `http://localhost:11434/v1`) to enable grounded chat.';
      sseSend(reply, 'text', { delta: msg });
      await q(`INSERT INTO messages (session_id, role, content, citations) VALUES ($1, 'assistant', $2, $3)`, [session.id, msg, JSON.stringify([])]);
      sseSend(reply, 'done', { citations: [] });
      reply.raw.end();
      return;
    }

    const history = await q<{ role: string; content: string }>(
      `SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at`,
      [session.id]
    );
    const prior = history.slice(-8, -1).map((m) => ({ role: m.role as any, content: m.content }));

    let system: string;
    let user: string;
    if (hits.length) {
      const prompt = buildGroundedPrompt(body.message, hits);
      system = prompt.system;
      user = prompt.user;
    } else if (body.notebookId) {
      system = 'You are SET Research. The current notebook has no indexed sources yet — tell the user to add sources first.';
      user = body.message;
    } else {
      system = 'You are SET, a helpful knowledge assistant. Be concise.';
      user = body.message;
    }

    let full = '';
    try {
      const result = await chatCompletionStream(
        provider,
        null,
        { messages: [{ role: 'system', content: system }, ...prior, { role: 'user', content: user }] },
        (delta) => {
          full += delta;
          sseSend(reply, 'text', { delta });
        }
      );
      const citations = hits.map((h, i) => ({
        marker: i + 1,
        chunkId: h.chunkId,
        sourceId: h.sourceId,
        sourceName: h.sourceName,
        pageLabel: h.pageLabel,
        heading: h.heading,
        quote: h.content.slice(0, 280),
      }));
      sseSend(reply, 'sources', { hits });
      await q(
        `INSERT INTO messages (session_id, role, content, citations) VALUES ($1, 'assistant', $2, $3)`,
        [session.id, result.content ?? '', JSON.stringify(citations)]
      );
      sseSend(reply, 'done', { citations });
    } catch (e: any) {
      sseSend(reply, 'error', { message: e.message ?? String(e) });
    }
    reply.raw.end();
  });

  app.get('/sessions/:id/messages', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'chat_sessions', id);
    if (!ctx) return;
    const rows = await q(`SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at`, [id]);
    return { messages: rows };
  });

  app.delete('/sessions/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'chat_sessions', id, 'editor');
    if (!ctx) return;
    await q(`DELETE FROM chat_sessions WHERE id = $1`, [id]);
    return { ok: true };
  });

  // Direct search endpoint (used by agent tools and chunk inspector)
  app.post('/notebooks/:id/search', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'notebooks', id);
    if (!ctx) return;
    const body = z.object({ query: z.string().min(1), limit: z.number().optional() }).parse(req.body);
    return { hits: await retrieve(id, body.query, body.limit ?? 8) };
  });

  // Bind a notebook to a RAGFlow dataset (retrieval then routes through RAGFlow)
  app.patch('/notebooks/:id/ragflow', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'notebooks', id, 'editor');
    if (!ctx) return;
    const body = z.object({ datasetId: z.string().nullable() }).parse(req.body);
    await q(`UPDATE notebooks SET ragflow_dataset_id = $2 WHERE id = $1`, [id, body.datasetId]);
    return { ok: true };
  });
}
