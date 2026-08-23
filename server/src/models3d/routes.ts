import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';
import { config } from '../config.js';
import { requireSurface } from '../surfaces.js';

export interface UrdfLink {
  name: string;
  visual?: { geometry: { type: 'box' | 'cylinder' | 'sphere'; size?: string; radius?: string; length?: string }; origin?: { xyz?: string; rpy?: string }; material?: { color?: string; name?: string } };
}
export interface UrdfJoint {
  name: string;
  type: string;
  parent: string;
  child: string;
  origin?: { xyz?: string; rpy?: string };
  axis?: string;
  limit?: { lower?: string; upper?: string; effort?: string; velocity?: string };
}

/** Minimal regex-based URDF parser (no external XML dependency). */
export function parseUrdf(xml: string): { links: UrdfLink[]; joints: UrdfJoint[] } {
  const links: UrdfLink[] = [];
  const joints: UrdfJoint[] = [];
  for (const lm of xml.matchAll(/<link\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/link>|<link\s+name="([^"]+)"[^>]*\/>/g)) {
    const name = lm[1] ?? lm[3];
    const body = lm[2] ?? '';
    const vis = body.match(/<visual[^>]*>([\s\S]*?)<\/visual>/)?.[1] ?? '';
    const geo = vis.match(/<(box|cylinder|sphere)((?:\s+\w+="[^"]*")*)\s*\/?>/);
    const attrs = (s: string | undefined) =>
      Object.fromEntries((Array.from((s ?? '').matchAll(/(\w+)="([^"]*)"/g)) as RegExpExecArray[]).map((m) => [m[1], m[2]]));
    let visual: UrdfLink['visual'];
    if (geo) {
      const a = attrs(geo[2]);
      visual = {
        geometry: {
          type: geo[1] as any,
          size: a.size,
          radius: a.radius,
          length: a.length,
        },
        origin: (() => {
          const o = vis.match(/<origin([^/]*)\/>/)?.[1];
          return o ? attrs(o) : undefined;
        })(),
        material: (() => {
          const m = vis.match(/<material\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/material>/);
          if (!m) return undefined;
          const color = m[2].match(/<color\s+rgba="([^"]+)"/)?.[1];
          return { name: m[1], color };
        })(),
      };
    }
    links.push({ name, visual });
  }
  for (const jm of xml.matchAll(/<joint\s+name="([^"]+)"\s+type="([^"]+)"[^>]*>([\s\S]*?)<\/joint>/g)) {
    const body = jm[3];
    const limitM = body.match(/<limit([^/]*)\/>/)?.[1];
    joints.push({
      name: jm[1],
      type: jm[2],
      parent: body.match(/<parent\s+link="([^"]+)"/)?.[1] ?? '',
      child: body.match(/<child\s+link="([^"]+)"/)?.[1] ?? '',
      origin: (() => {
        const o = body.match(/<origin([^/]*)\/>/)?.[1];
        return o ? attrs2(o) : undefined;
      })(),
      axis: body.match(/<axis\s+xyz="([^"]+)"/)?.[1],
      limit: limitM ? attrs2(limitM) : undefined,
    });
  }
  return { links, joints };
}
function attrs2(s: string) {
  return Object.fromEntries(
    ([...s.matchAll(/(\w+)="([^"]*)"/g)] as RegExpExecArray[]).map((m) => [m[1], m[2]])
  );
}

export async function modelsRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/models', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    if (!(await requireSurface(reply, spaceId, 'threeD'))) return;
    const rows = await q(`SELECT id, name, kind, file_size, parts, created_at FROM models3d WHERE space_id = $1 ORDER BY created_at DESC`, [spaceId]);
    return { models: rows };
  });

  app.post('/spaces/:spaceId/models', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    if (!(await requireSurface(reply, spaceId, 'threeD'))) return;
    const files = req.files ? await req.files() : [];
    const created: any[] = [];
    for await (const file of files) {
      const buf = await file.toBuffer();
      const lower = file.filename.toLowerCase();
      const kind = lower.endsWith('.urdf') || lower.endsWith('.xml') ? 'urdf' : lower.endsWith('.stl') ? 'stl' : lower.endsWith('.obj') ? 'obj' : lower.endsWith('.step') || lower.endsWith('.stp') ? 'step' : 'gltf';
      const dir = path.join(config.dataDir, 'models', spaceId);
      fs.mkdirSync(dir, { recursive: true });
      const stored = `${crypto.randomUUID()}${path.extname(file.filename) || ''}`;
      fs.writeFileSync(path.join(dir, stored), buf);
      let parts: any = [];
      if (kind === 'urdf') {
        parts = parseUrdf(buf.toString('utf8'));
      }
      const model = await one<any>(
        `INSERT INTO models3d (space_id, name, kind, file_path, file_size, parts) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [spaceId, file.filename.replace(/\.[^.]+$/, ''), kind, path.join(dir, stored), buf.length, JSON.stringify(parts)]
      );
      created.push(model);
    }
    return { models: created };
  });

  app.get('/models/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'models3d', id);
    if (!ctx) return;
    if (!(await requireSurface(reply, ctx.spaceId, 'threeD'))) return;
    const model = await one<any>(`SELECT id, space_id, name, kind, file_size, parts, created_at FROM models3d WHERE id = $1`, [id]);
    return { model };
  });

  app.patch('/models/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'models3d', id, 'editor');
    if (!ctx) return;
    if (!(await requireSurface(reply, ctx.spaceId, 'threeD'))) return;
    const body = z
      .object({
        name: z.string().optional(),
        parts: z
          .array(z.object({ node: z.string(), name: z.string().optional(), linkedPageId: z.string().nullable().optional() }))
          .optional(),
      })
      .parse(req.body);
    if (body.name !== undefined) await q(`UPDATE models3d SET name = $2 WHERE id = $1`, [id, body.name]);
    if (body.parts !== undefined) await q(`UPDATE models3d SET parts = $2 WHERE id = $1`, [id, JSON.stringify(body.parts)]);
    return { ok: true };
  });

  app.delete('/models/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'models3d', id, 'editor');
    if (!ctx) return;
    if (!(await requireSurface(reply, ctx.spaceId, 'threeD'))) return;
    await q(`DELETE FROM models3d WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.get('/models/:id/file', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'models3d', id);
    if (!ctx) return;
    if (!(await requireSurface(reply, ctx.spaceId, 'threeD'))) return;
    const model = await one<{ name: string; kind: string; file_path: string }>(`SELECT name, kind, file_path FROM models3d WHERE id = $1`, [id]);
    if (!model || !fs.existsSync(model.file_path)) return reply.code(404).send({ error: 'File missing' });
    const ext = path.extname(model.file_path).toLowerCase();
    const mime = model.kind === 'urdf' ? 'application/xml' : ext === '.stl' ? 'model/stl' : ext === '.obj' ? 'text/plain' : ext === '.step' || ext === '.stp' ? 'application/step' : ext === '.gltf' ? 'model/gltf+json' : 'model/gltf-binary';
    reply.header('content-type', mime);
    return fs.createReadStream(model.file_path);
  });

  // Auto-link model parts to pages by matching part names against page titles
  app.post('/models/:id/autolink', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'models3d', id, 'editor');
    if (!ctx) return;
    if (!(await requireSurface(reply, ctx.spaceId, 'threeD'))) return;
    const model = await one<any>(`SELECT parts FROM models3d WHERE id = $1`, [id]);
    const pages = await q<{ id: string; title: string }>(`SELECT id, title FROM pages WHERE space_id = $1 AND deleted_at IS NULL`, [ctx.spaceId]);
    // URDF models store {links, joints}; glTF models store a flat part array
    const raw = model?.parts ?? [];
    const parts: any[] = Array.isArray(raw) ? raw : [...(raw.links ?? [])];
    let linked = 0;
    for (const part of parts) {
      const nodeName = part.name ?? part.node;
      const match = pages.find((p) => p.title.toLowerCase() === String(nodeName ?? '').toLowerCase());
      if (match) {
        part.linkedPageId = match.id;
        linked++;
      }
    }
    const nextParts = Array.isArray(raw) ? parts : { ...raw, links: parts };
    await q(`UPDATE models3d SET parts = $2 WHERE id = $1`, [id, JSON.stringify(nextParts)]);
    return { parts: nextParts, linked };
  });
}
