import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { one } from '../db.js';
import { config } from '../config.js';
import { ingestSource } from '../rag/search.js';
import { getProvider, ensureBootstrapProvider } from '../llm/router.js';

const HF = 'https://huggingface.co';
const MAX_IMPORT_BYTES = 250 * 1024 * 1024;

const MESH_EXT = ['.glb', '.gltf', '.stl', '.obj', '.urdf', '.step', '.stp'];
const TEXT_EXT = ['.md', '.markdown', '.txt', '.json'];
const PDF_EXT = ['.pdf'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

const extOf = (p: string) => path.extname(p).toLowerCase();

export async function downloadFromDataset(datasetId: string, filePath: string): Promise<{ buf: Buffer; name: string; ext: string; error?: string }> {
  const url = `${HF}/datasets/${datasetId}/resolve/main/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  const headers: Record<string, string> = { 'user-agent': 'SET/2.0 (self-hosted knowledge OS)' };
  if (config.hfToken) headers.authorization = `Bearer ${config.hfToken}`;
  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!res.ok) return { buf: Buffer.alloc(0), name: '', ext: '', error: `Download failed (${res.status})` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMPORT_BYTES) return { buf: Buffer.alloc(0), name: '', ext: '', error: 'File too large (250MB cap)' };
  const name = path.basename(filePath);
  return { buf, name, ext: extOf(name) };
}

export function importModeFor(ext: string): 'model' | 'notebook' | 'file' {
  if (MESH_EXT.includes(ext)) return 'model';
  if ([...TEXT_EXT, ...PDF_EXT, '.parquet'].includes(ext)) return 'notebook';
  return 'file';
}

export async function importFromDataset(
  spaceId: string,
  userId: string,
  datasetId: string,
  filePath: string,
  notebookId?: string,
  forceMode?: 'model' | 'notebook' | 'file'
) {
  const dl = await downloadFromDataset(datasetId, filePath);
  if (dl.error) return { ok: false, result: { error: dl.error } };
  const { buf, name, ext } = dl;
  const mode = forceMode ?? importModeFor(ext);

  if (mode === 'model') {
    const model = await importModel(spaceId, name, ext, buf);
    return {
      ok: true,
      result: { model, mode },
      a2ui: [{ type: 'viewer3d' as const, props: { modelId: model.id, name: model.name } }],
    };
  }
  if (mode === 'notebook') {
    const r = await importNotebookSource(userId, spaceId, datasetId, filePath, name, ext, buf, notebookId);
    return {
      ok: true,
      result: { sourceId: r.sourceId, notebookId: r.notebookId, mode },
      a2ui: [{ type: 'card' as const, props: { title: name, icon: 'source', body: `Imported from ${datasetId} and queued for indexing.`, action: 'open_notebook' } }],
    };
  }
  const file = await importFile(spaceId, name, ext, buf);
  return { ok: true, result: { file, mode } };
}

export async function importModel(spaceId: string, name: string, ext: string, buf: Buffer) {
  const dir = path.join(config.dataDir, 'models', spaceId);
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(dir, stored), buf);
  const kind =
    ext === '.urdf' ? 'urdf' : ext === '.step' || ext === '.stp' ? 'step' : ['.stl', 'obj'].includes(ext.slice(1)) ? ext.slice(1) : 'gltf';
  let parts: any = [];
  if (kind === 'urdf') {
    const { parseUrdf } = await import('../models3d/routes.js');
    parts = parseUrdf(buf.toString('utf8'));
  }
  const model = await one<any>(
    `INSERT INTO models3d (space_id, name, kind, file_path, file_size, parts) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, kind, file_size`,
    [spaceId, name.replace(/\.[^.]+$/, ''), kind, path.join(dir, stored), buf.length, JSON.stringify(parts)]
  );
  return model!;
}

export async function importFile(spaceId: string, name: string, ext: string, buf: Buffer) {
  const dir = path.join(config.dataDir, 'files', spaceId);
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(dir, stored), buf);
  const mime =
    ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';
  const file = await one<any>(
    `INSERT INTO files (space_id, name, mime, size_bytes, path) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, mime, size_bytes`,
    [spaceId, name, mime, buf.length, path.join(dir, stored)]
  );
  return file!;
}

export async function importNotebookSource(
  userId: string,
  spaceId: string,
  datasetId: string,
  filePath: string,
  name: string,
  ext: string,
  buf: Buffer,
  notebookId?: string
) {
  let nbId = notebookId;
  if (nbId) {
    const nb = await one<any>(`SELECT id FROM notebooks WHERE id = $1 AND space_id = $2`, [nbId, spaceId]);
    if (!nb) nbId = undefined;
  }
  if (!nbId) {
    const title = `${datasetId.split('/')[1]} imports`;
    const existing = await one<{ id: string }>(
      `SELECT id FROM notebooks WHERE space_id = $1 AND title = $2 LIMIT 1`,
      [spaceId, title]
    );
    if (existing) {
      nbId = existing.id;
    } else {
      const nb = await one<any>(
        `INSERT INTO notebooks (space_id, title, description) VALUES ($1, $2, $3) RETURNING id`,
        [spaceId, title, `Sources imported from HuggingFace dataset ${datasetId}`]
      );
      nbId = nb!.id;
    }
  }

  let text = '';
  let kind = 'txt';
  if (PDF_EXT.includes(ext)) {
    const pdfParse = (await import('pdf-parse')).default as any;
    text = await pdfParse(buf);
    kind = 'pdf';
  } else if (ext === '.parquet') {
    text = await parquetToMarkdown(buf);
  } else if (ext === '.json') {
    text = jsonToMarkdown(JSON.parse(buf.toString('utf8')));
  } else {
    text = buf.toString('utf8');
    kind = ext === '.md' || ext === '.markdown' ? 'md' : 'txt';
  }
  text = text.slice(0, 2_000_000);

  const source = await one<any>(
    `INSERT INTO sources (notebook_id, kind, name, text_content, status, meta) VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING id`,
    [nbId, kind, name, text, JSON.stringify({ dataset: datasetId, path: filePath })]
  );

  await ensureBootstrapProvider(spaceId);
  const provider = await getProvider(spaceId);
  void ingestSource(source!.id, provider);
  return { sourceId: source!.id, notebookId: nbId };
}

/** Flatten arbitrary JSON (narrations, metadata, rubrics) into readable markdown. */
export function jsonToMarkdown(value: any, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 500)
      .map((item, i) => {
        const inner = jsonToMarkdown(item, depth + 1).trim();
        return `- **[${i}]** ${inner.replace(/\n/g, ' ').slice(0, 2000)}`;
      })
      .join('\n');
  }
  return Object.entries(value)
    .map(([k, v]) => {
      if (v && typeof v === 'object') return `### ${k}\n${jsonToMarkdown(v, depth + 1)}`;
      return `- **${k}**: ${String(v).slice(0, 1000)}`;
    })
    .join('\n');
}

/** Convert parquet rows (hyparquet) into markdown records for RAG ingestion. */
export async function parquetToMarkdown(buf: Buffer): Promise<string> {
  const { parquetRead } = await import('hyparquet');
  const rows: any[] = [];
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  await parquetRead({
    file: bytes,
    onComplete: (data: any[][]) => {
      for (const row of data) rows.push(row);
    },
  });
  const limit = Math.min(rows.length, 500);
  const parts: string[] = [];
  for (let i = 0; i < limit; i++) {
    const record = rows[i] as any;
    const entries = Array.isArray(record) ? Object.entries(record[0] ?? {}) : Object.entries(record ?? {});
    const body = entries
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => {
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `**${k}**: ${s.slice(0, 4000)}`;
      })
      .join('\n\n');
    parts.push(`## Record ${i + 1}\n\n${body}`);
  }
  parts.push(`\n(${rows.length} total rows; first ${limit} imported)`);
  return parts.join('\n\n---\n\n');
}
