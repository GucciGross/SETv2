import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { one, q } from '../db.js';
import { requireSpace } from '../lib/http.js';
import { config } from '../config.js';
import { mdToDoc } from '../lib/markdown.js';
import { syncLinks } from '../pages/routes.js';
import { recordActivity } from './activity.js';

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];

/** Notion-style export hash suffix: "Title 0123456789abcdef0123456789abcdef.md" */
const HASH_SUFFIX = /\s+[0-9a-f]{32}(?=(\.[a-z]+)?$)/i;

const cleanTitle = (filename: string) => decodeURIComponent(filename).replace(/\.(md|markdown|csv)$/i, '').replace(HASH_SUFFIX, '').trim();

/**
 * Import a ZIP workspace export:
 * - .md files become pages (internal "Title <hash>.md" links become [[wiki links]])
 * - images become uploaded files; ![](image) references are rewritten to served URLs
 * - .csv files become databases (types inferred from values)
 */
export async function importZipRoutes(app: FastifyInstance) {
  app.post('/spaces/:spaceId/import-zip', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;

    const file = req.files ? (await (await req.files()).next()).value : null;
    if (!file) return reply.code(400).send({ error: 'Upload a .zip file' });
    const buf = await file.toBuffer();
    let zip: AdmZip;
    try {
      zip = new AdmZip(buf);
    } catch {
      return reply.code(400).send({ error: 'Not a valid zip archive' });
    }

    const entries = zip.getEntries().filter((e) => !e.isDirectory && !e.entryName.startsWith('__MACOSX') && !e.entryName.split('/').pop()?.startsWith('.'));
    const mdFiles = entries.filter((e) => /\.(md|markdown)$/i.test(e.entryName));
    const csvFiles = entries.filter((e) => /\.csv$/i.test(e.entryName));
    const imageFiles = entries.filter((e) => IMAGE_EXT.includes(path.extname(e.entryName).toLowerCase()));
    if (!mdFiles.length && !csvFiles.length) return reply.code(400).send({ error: 'No .md or .csv files found in the archive' });

    // 1. upload images, remember served path by basename
    const imageByBase = new Map<string, string>();
    for (const img of imageFiles) {
      const base = path.basename(img.entryName);
      if (imageByBase.has(base)) continue;
      const ext = path.extname(base).toLowerCase();
      const dir = path.join(config.dataDir, 'files', spaceId);
      fs.mkdirSync(dir, { recursive: true });
      const stored = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(dir, stored), img.getData());
      const row = await one<any>(
        `INSERT INTO files (space_id, name, mime, size_bytes, path) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [spaceId, base, `image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}`, img.header.size, path.join(dir, stored)]
      );
      imageByBase.set(base, `/api/files/${row!.id}`);
    }

    // 2. markdown pages: strip hash suffixes from titles, rewrite links & images
    const created: any[] = [];
    const titleByEntry = new Map<string, string>();
    for (const md of mdFiles) titleByEntry.set(md.entryName, cleanTitle(path.basename(md.entryName)));

    for (const md of mdFiles) {
      let text = md.getData().toString('utf8');
      // internal page links: [label](Some%20Title%20<hash>.md) -> [[Title|label]]
      text = text.replace(/\[([^\]]*)\]\(([^)]*\.md)(?: #[^)]*)?\)/g, (full, label, target) => {
        const base = cleanTitle(path.basename(decodeURIComponent(target)));
        if (!base) return full;
        return label && label !== base ? `[[${base}|${label}]]` : `[[${base}]]`;
      });
      // image references -> served URL
      text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, target) => {
        const base = path.basename(decodeURIComponent(target.split(' ')[0].split('?')[0]));
        const served = imageByBase.get(base);
        return served ? `![${alt}](${served})` : full;
      });
      const title = titleByEntry.get(md.entryName) || 'Imported page';
      const page = await one<any>(
        `INSERT INTO pages (space_id, title, markdown, content, created_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING RETURNING id, title`,
        [spaceId, title, text, JSON.stringify(mdToDoc(text)), req.user!.id]
      );
      if (page) created.push(page);
    }

    // 3. CSVs -> databases with inferred column types
    const databases: any[] = [];
    for (const csv of csvFiles) {
      const name = cleanTitle(path.basename(csv.entryName)) || 'Imported table';
      const lines = csv.getData().toString('utf8').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) continue;
      const parseLine = (line: string) => {
        const cells: string[] = [];
        let cur = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
          } else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
          else cur += ch;
        }
        cells.push(cur);
        return cells.map((c) => c.trim());
      };
      const headers = parseLine(lines[0]);
      const rows = lines.slice(1).map(parseLine);
      const infer = (idx: number) => {
        const vals = rows.map((r) => (r[idx] ?? '').toLowerCase()).filter(Boolean);
        if (!vals.length) return 'text';
        if (vals.every((v) => v === 'true' || v === 'false' || v === 'yes' || v === 'no' || v === 'checked')) return 'checkbox';
        if (vals.every((v) => v !== '' && !isNaN(Number(v.replace(/[$,%]/g, ''))))) return 'number';
        if (vals.every((v) => !isNaN(Date.parse(v)) && /\d{4}|\d{1,2}\/\d{1,2}/.test(v))) return 'date';
        const uniq = new Set(vals);
        if (uniq.size > 0 && uniq.size <= 8 && vals.length >= uniq.size) {
          return 'select';
        }
        return 'text';
      };
      const columns = headers.map((h, i) => ({ id: `c${i}`, name: h.replace(HASH_SUFFIX, '').trim() || `Column ${i + 1}`, type: infer(i), config: {} }));
      const db = await one<any>(
        `INSERT INTO databases (space_id, name, icon, schema) VALUES ($1, $2, NULL, $3) RETURNING id, name`,
        [spaceId, name, JSON.stringify(columns)]
      );
      await q(`INSERT INTO db_views (database_id, name, type) VALUES ($1, 'Table', 'table')`, [db!.id]);
      for (let r = 0; r < rows.length; r++) {
        const cells: Record<string, any> = {};
        columns.forEach((c, i) => {
          const raw = rows[r][i] ?? '';
          if (c.type === 'checkbox') cells[c.id] = ['true', 'yes', 'checked'].includes(raw.toLowerCase());
          else if (c.type === 'number') cells[c.id] = Number(raw.replace(/[$,%]/g, '')) || null;
          else cells[c.id] = raw || null;
        });
        await q(`INSERT INTO db_rows (database_id, cells) VALUES ($1, $2)`, [db!.id, JSON.stringify(cells)]);
      }
      databases.push(db);
    }

    void recordActivity(spaceId, req.user!.id, 'page_created', { title: `imported ${created.length} pages${databases.length ? `, ${databases.length} databases` : ''} from zip`, pageId: created[0]?.id });
    return { pages: created.length, databases: databases.length, images: imageByBase.size };
  });
}
