import type { FastifyInstance } from 'fastify';
import AdmZip from 'adm-zip';
import path from 'node:path';
import { one } from '../db.js';
import { requireSpace, requireUser } from '../lib/http.js';
import { mdToDoc } from '../lib/markdown.js';
import { relinkSpace } from '../pages/routes.js';
import { normalizeImportedMarkdown } from './importZip.js';
import { recordActivity } from './activity.js';

/**
 * Codebase graph import (graphify pipeline): a zip of graphify's Obsidian
 * vault export becomes a page tree that mirrors the repo —
 *
 *   <name>/                ← root page
 *     server/              ← one page per directory (from source_file)
 *       study/
 *         mastery.ts       ← file + symbol notes under their directory
 *
 * graphify notes carry `source_file:` front-matter; the front-matter itself
 * is stripped like any Obsidian import. Wiki links are synced on insert so
 * backlinks and the graph view work immediately.
 */

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** `source_file: "server/src/study/mastery.ts"` → the path (quotes optional). */
function sourceFileOf(frontMatter: string): string | null {
  const m = frontMatter.match(/^source_file:\s*"?([^"\n]+)"?\s*$/m);
  const v = m?.[1]?.trim();
  return v || null;
}

/** Normalized posix dirname of a repo-relative path ('' for the root). */
function dirOf(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export async function codegraphRoutes(app: FastifyInstance) {
  app.post('/spaces/:spaceId/import-codegraph', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    const user = await requireUser(req, reply);
    if (!user) return;
    // the stream is single-shot: one parts() pass collects fields and the zip
    const fields: Record<string, string> = {};
    let zipBuf: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!zipBuf) zipBuf = await part.toBuffer();
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }
    const intoNew = fields.newSpace === '1';
    const name = (fields.name || 'Codebase graph').trim().slice(0, 120);

    // into a new workspace: the :spaceId param is just a routing artifact
    let targetSpaceId = spaceId;
    let createdSpaceId: string | null = null;
    if (intoNew) {
      const space = await one<any>(
        `INSERT INTO spaces (name, kind, icon, owner_id) VALUES ($1, 'team', '🧬', $2) RETURNING id`,
        [name, user.id]
      );
      targetSpaceId = space!.id;
      createdSpaceId = space!.id;
      await one(`INSERT INTO memberships (user_id, space_id, role) VALUES ($1, $2, 'owner')`, [user.id, targetSpaceId]);
    } else if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;

    if (!zipBuf) {
      if (createdSpaceId) await one(`DELETE FROM spaces WHERE id = $1`, [createdSpaceId]);
      return reply.code(400).send({ error: 'Upload a .zip of the graphify vault' });
    }
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuf);
    } catch {
      return reply.code(400).send({ error: 'Not a valid zip archive' });
    }

    // first pass: read notes + collect the directory set from source_file
    const notes: { title: string; sourceFile: string | null; text: string }[] = [];
    const dirSet = new Set<string>();
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !/\.(md|markdown)$/i.test(e.entryName)) continue;
      if (e.entryName.split('/').pop()?.startsWith('.')) continue;
      const raw = e.getData().toString('utf8');
      const fm = raw.match(FRONT_MATTER);
      const sourceFile = fm ? sourceFileOf(fm[1]) : null;
      const body = fm ? raw.slice(fm[0].length) : raw;
      // empty image map: code graphs have no image embeds to rewrite
      const text = normalizeImportedMarkdown(body, new Map()).trim();
      const base = path.basename(e.entryName).replace(/\.(md|markdown)$/i, '');
      notes.push({ title: base, sourceFile, text });
      if (sourceFile) {
        // every ancestor directory of the source file becomes a page
        const parts = sourceFile.split(/[\\/]/).filter(Boolean);
        parts.pop();
        for (let i = 0; i < parts.length; i++) dirSet.add(parts.slice(0, i + 1).join('/'));
      }
    }
    if (!notes.length) return reply.code(400).send({ error: 'No .md notes found in the archive — is this a graphify vault export?' });

    // the root ties the tree together (kept empty except for a pointer legend)
    const root = await one<any>(
      `INSERT INTO pages (space_id, parent_id, title, icon, markdown, content, created_by)
       VALUES ($1, NULL, $2, '🧬', $3, '{}', $4) RETURNING id`,
      [targetSpaceId, name, `Imported from a [graphify](https://github.com/Graphify-Labs/graphify) codebase graph.\n\n${notes.length} symbol notes across ${dirSet.size} directories.`, user.id]
    );

    // directory pages, shallowest first so parents exist before children;
    // top-level directories nest under the root, not beside it
    const dirPageId = new Map<string, string>();
    const dirs = [...dirSet].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    for (const dir of dirs) {
      const parts = dir.split('/');
      const parent = parts.length > 1 ? dirPageId.get(parts.slice(0, -1).join('/'))! : root!.id;
      const seg = parts[parts.length - 1];
      const page = await one<any>(
        `INSERT INTO pages (space_id, parent_id, title, icon, markdown, content, created_by)
         VALUES ($1, $2, $3, '📁', '', '{}', $4) RETURNING id`,
        [targetSpaceId, parent, seg, user.id]
      );
      dirPageId.set(dir, page!.id);
    }

    // notes land in the page for their source directory; anything without
    // source_file (reports, indexes) goes straight under the root
    let created = 0;
    for (const n of notes) {
      const dir = n.sourceFile ? dirOf(n.sourceFile) : '';
      const parent = dir ? dirPageId.get(dir) ?? root!.id : root!.id;
      const page = await one<any>(
        `INSERT INTO pages (space_id, parent_id, title, markdown, content, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id`,
        [targetSpaceId, parent, n.title, n.text, JSON.stringify(mdToDoc(n.text)), user.id]
      );
      if (page) created++;
    }
    // link sync runs once, after every page exists: syncLinks only resolves
    // targets that already exist, so per-note syncing would drop every
    // forward reference (symbol notes pointing at later-inserted files)
    await relinkSpace(targetSpaceId);

    void recordActivity(targetSpaceId, user.id, 'page_created', { title: `imported codebase graph “${name}” (${created} notes)`, pageId: root!.id });
    return { spaceId: targetSpaceId, pages: created, directories: dirPageId.size };
  });
}
