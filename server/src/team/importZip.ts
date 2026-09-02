import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { one, q } from '../db.js';
import { requireSpace } from '../lib/http.js';
import { config } from '../config.js';
import { mdToDoc } from '../lib/markdown.js';
import { relinkSpace } from '../pages/routes.js';
import { recordActivity } from './activity.js';

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];

/** Notion-style export hash suffix: "Title 0123456789abcdef0123456789abcdef.md" */
const HASH_SUFFIX = /\s+[0-9a-f]{32}(?=(\.[a-z]+)?$)/i;

const cleanTitle = (filename: string) => decodeURIComponent(filename).replace(/\.(md|markdown|csv)$/i, '').replace(HASH_SUFFIX, '').trim();

/**
 * Vault-flavor normalization applied to every imported markdown page.
 * Obsidian: strip YAML front-matter (tags survive as hashtags), rewrite
 * ![[embeds]] to served image URLs (or plain links for note embeds), drop
 * `.md` extensions and `#heading` anchors inside wiki links. Notion quirks
 * are handled by cleanTitle + the .md-link rewrite in the route. All of
 * these are no-ops when the patterns aren't present.
 */
export function normalizeImportedMarkdown(text: string, imageByBase: Map<string, string>): string {
  // YAML front-matter → hashtags (Obsidian doesn't render it; SET pages shouldn't show raw YAML)
  let tags: string[] = [];
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    text = text.slice(fm[0].length);
    const tagLine = fm[1].match(/^tags:\s*\[([^\]]*)\]/m) ?? fm[1].match(/^tags:\s*(.+)$/m);
    if (tagLine) {
      tags = tagLine[1]
        .split(/[[\],]/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 12);
    }
  }

  // ![[image.png]] and ![[image.png|400]] → served image URL
  text = text.replace(/!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g, (full, target) => {
    const base = path.basename(String(target).trim());
    const served = imageByBase.get(base);
    return served ? `![${base}](${served})` : full;
  });
  // remaining ![[Note]] note embeds → plain links (SET has no transclusion)
  text = text.replace(/!\[\[([^\]]+)\]\]/g, (_f, t) => `[[${t}]]`);

  // [[Note.md#Heading|alias]] → [[Note|alias]]; [[Note.md]] → [[Note]]
  text = text.replace(/\[\[([^\]|]+?)(?:#[^\]|]*)?(\|[^\]]*)?\]\]/g, (_f, target: string, alias?: string) => {
    const clean = String(target).trim().replace(/\.(md|markdown)$/i, '').replace(HASH_SUFFIX, '').trim();
    return clean ? (alias ? `[[${clean}${alias}]]` : `[[${clean}]]`) : _f;
  });

  if (tags.length) text += `\n\n${tags.map((t) => `#${t.replace(/\s+/g, '-')}`).join(' ')}\n`;
  return text;
}

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
      // Obsidian/Notion flavor: front-matter, embeds, wiki-link hygiene
      text = normalizeImportedMarkdown(text, imageByBase);
      const title = titleByEntry.get(md.entryName) || 'Imported page';
      const page = await one<any>(
        `INSERT INTO pages (space_id, title, markdown, content, created_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING RETURNING id, title`,
        [spaceId, title, text, JSON.stringify(mdToDoc(text)), req.user!.id]
      );
      if (page) created.push(page);
    }
    // one link pass after every page exists: syncLinks only resolves targets
    // that already exist, so per-page syncing would drop forward references
    await relinkSpace(spaceId);

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

  /** Full workspace export: everything as plain files in one zip. */
  app.get('/spaces/:spaceId/export.zip', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;

    const zip = new AdmZip();
    const safe = (s: string) => (s || 'untitled').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);

    // pages as markdown — [[wiki links]] stay intact, so a re-import round-trips
    const pages = await q<{ title: string; markdown: string; is_daily: boolean; daily_date: string | null }>(
      `SELECT title, markdown, is_daily, daily_date FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND is_template = false ORDER BY created_at`,
      [spaceId]
    );
    const used = new Set<string>();
    for (const p of pages) {
      let name = safe(p.title);
      let n = 2;
      while (used.has(name.toLowerCase())) name = `${safe(p.title)} (${n++})`;
      used.add(name.toLowerCase());
      const front = p.is_daily ? `daily: ${p.daily_date ?? ''}\n\n` : '';
      zip.addFile(`pages/${name}.md`, Buffer.from(front + (p.markdown ?? '') + '\n'));
    }

    // databases as CSV (schema order preserved)
    const databases = await q<{ id: string; name: string; schema: any }>(
      `SELECT id, name, schema FROM databases WHERE space_id = $1 ORDER BY created_at`,
      [spaceId]
    );
    const csvCell = (v: unknown) => {
      const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    for (const db of databases) {
      const columns: any[] = Array.isArray(db.schema) ? db.schema : [];
      const rows = await q<{ cells: any }>(`SELECT cells FROM db_rows WHERE database_id = $1 ORDER BY created_at`, [db.id]);
      const lines = [columns.map((c) => csvCell(c.name)).join(',')];
      for (const r of rows) lines.push(columns.map((c) => csvCell(r.cells?.[c.id])).join(','));
      zip.addFile(`databases/${safe(db.name)}.csv`, Buffer.from(lines.join('\n') + '\n'));
    }

    // notebooks: source texts + a .bib for citations
    const { sourcesToBibTeX } = await import('../rag/cite.js');
    const notebooks = await q<{ id: string; title: string }>(`SELECT id, title FROM notebooks WHERE space_id = $1 ORDER BY created_at`, [spaceId]);
    for (const nb of notebooks) {
      const sources = await q<{ id: string; name: string; uri: string | null; kind: string; text_content: string; created_at: Date }>(
        `SELECT id, name, uri, kind, text_content, created_at FROM sources WHERE notebook_id = $1 ORDER BY created_at`,
        [nb.id]
      );
      const dir = `notebooks/${safe(nb.title)}`;
      for (const s of sources) {
        zip.addFile(`${dir}/sources/${safe(s.name)}.txt`, Buffer.from(s.text_content ?? ''));
      }
      if (sources.length) zip.addFile(`${dir}/sources.bib`, Buffer.from(sourcesToBibTeX(sources as any)));
    }

    const space = await one<{ name: string }>(`SELECT name FROM spaces WHERE id = $1`, [spaceId]);
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="set-export-${safe(space?.name ?? spaceId.slice(0, 8))}.zip"`);
    void recordActivity(spaceId, req.user!.id, 'workspace_exported', { pages: pages.length, databases: databases.length, notebooks: notebooks.length });
    return reply.send(zip.toBuffer());
  });
}
