import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSpace } from '../lib/http.js';
import { config } from '../config.js';
import { CATALOG } from './catalog.js';
import { importFromDataset } from './import.js';
import { requireSurface } from '../surfaces.js';

const HF = 'https://huggingface.co';

async function hfFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = { 'user-agent': 'SET/2.0 (self-hosted knowledge OS)' };
  if (config.hfToken) headers.authorization = `Bearer ${config.hfToken}`;
  return fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
}

const DS_ID_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Library surface: curated open datasets browsable and importable into the space. */
export async function libraryRoutes(app: FastifyInstance) {
  app.get('/library/catalog', async () => ({ catalog: CATALOG }));

  app.get('/library/datasets/:dsId/browse', async (req, reply) => {
    const dsId = decodeURIComponent((req.params as any).dsId);
    if (!DS_ID_RE.test(dsId)) return reply.code(400).send({ error: 'Invalid dataset id' });
    if (!(await requireSpace(req, reply, (req.query as any).spaceId))) return;
    if (!(await requireSurface(reply, String((req.query as any).spaceId), 'library'))) return;
    const sub = String((req.query as any).path ?? '');
    const url = `${HF}/api/datasets/${dsId}/tree/main${sub ? '/' + sub.split('/').map(encodeURIComponent).join('/') : ''}?recursive=false`;
    try {
      const res = await hfFetch(url);
      if (!res.ok) return reply.code(res.status).send({ error: `Hub returned ${res.status}` });
      const entries: any[] = await res.json();
      return { entries: entries.map((e) => ({ type: e.type, path: e.path, size: e.size ?? 0 })) };
    } catch (e: any) {
      return reply.code(502).send({ error: `Cannot reach HuggingFace Hub: ${e.message}` });
    }
  });

  app.get('/library/datasets/:dsId/readme', async (req, reply) => {
    const dsId = decodeURIComponent((req.params as any).dsId);
    if (!DS_ID_RE.test(dsId)) return reply.code(400).send({ error: 'Invalid dataset id' });
    if (!(await requireSpace(req, reply, (req.query as any).spaceId))) return;
    try {
      const res = await hfFetch(`${HF}/datasets/${dsId}/resolve/main/README.md`);
      if (!res.ok) return { readme: '' };
      return { readme: await res.text() };
    } catch {
      return { readme: '' };
    }
  });

  app.post('/library/import', async (req, reply) => {
    const body = z
      .object({
        spaceId: z.string(),
        datasetId: z.string().regex(DS_ID_RE),
        path: z.string().min(1),
        as: z.enum(['auto', 'model', 'notebook', 'file']).default('auto'),
        notebookId: z.string().optional(),
      })
      .parse(req.body);
    if (!(await requireSpace(req, reply, body.spaceId, 'editor'))) return;
    if (!(await requireSurface(reply, body.spaceId, 'library'))) return;
    const force = body.as === 'auto' ? undefined : body.as;
    const result = await importFromDataset(body.spaceId, req.user!.id, body.datasetId, body.path, body.notebookId, force);
    if (!result.ok) return reply.code(502).send({ error: (result.result as any).error });
    return result.result;
  });
}
