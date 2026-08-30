import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { one, q } from '../db.js';
import { mdToDoc } from '../lib/markdown.js';
import { relinkSpace } from '../pages/routes.js';
import { bus } from '../lib/events.js';
import { recordActivity } from '../team/activity.js';

/**
 * Import the practical-tutorials/project-based-learning catalog
 * (github.com/practical-tutorials/project-based-learning) as structured
 * knowledge: a hub page, one hub per language, a page per tutorial
 * (wiki-linked into the graph), a "Project Brief" template that encodes the
 * learn-by-building method, and a tracking database.
 *
 * Idempotent: re-running updates content in place; titles are the identity.
 */

const PBL_RAW_URL = 'https://raw.githubusercontent.com/practical-tutorials/project-based-learning/master/README.md';
const SNAPSHOT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'pbl-readme.md');

const HUB_TITLE = 'Project-Based Learning';
const GUIDE_TITLE = 'Learning by Building';
const TEMPLATE_TITLE = 'Project Brief';
const DB_NAME = 'Projects';

export interface PblEntry {
  language: string;
  category: string | null;
  title: string;
  url: string;
  description: string;
}

export interface PblCatalog {
  entries: PblEntry[];
  additional: { title: string; url: string }[];
}

const cleanHeading = (t: string) => t.replace(/[:：]\s*$/, '').trim();

/**
 * The catalog is one big markdown list: `## Language` sections with optional
 * `###`/`####` subcategories. Plain (non-link) list items act as group
 * headings for indented link items ("Writing a minimal JIT compiler" →
 * Part 1/2/3), so a group title prefixes its parts' titles to keep pages
 * distinguishable. Table-of-Contents anchors and the Additional Resources
 * section are handled separately.
 */
export function parsePbl(md: string): PblCatalog {
  const entries: PblEntry[] = [];
  const additional: { title: string; url: string }[] = [];
  let language: string | null = null;
  let category: string | null = null;
  let group: string | null = null;
  let inAdditional = false;

  for (const rawLine of md.split(/\r?\n/)) {
    const h2 = rawLine.match(/^## (?!#)(.+)$/);
    const h3 = rawLine.match(/^#{3,4} (.+)$/);
    if (h2) {
      const name = cleanHeading(h2[1]);
      inAdditional = /^additional resources$/i.test(name);
      language = inAdditional || /^table of contents$/i.test(name) ? null : name;
      category = null;
      group = null;
      continue;
    }
    if (h3) {
      category = cleanHeading(h3[1]);
      group = null;
      continue;
    }
    const listItem = rawLine.match(/^(\s*)- (.+?)\s*$/);
    if (!listItem || !language) {
      if (listItem && inAdditional) {
        const link = listItem[2].match(/^\[([^\]]+)\]\(([^)]+)\)/);
        if (link && !link[2].startsWith('#')) additional.push({ title: link[1].trim(), url: link[2] });
      }
      continue;
    }
    const indented = listItem[1].length > 0;
    const link = listItem[2].match(/^\[([^\]]+)\]\(([^)\s]+)\)\s*(.*)$/);
    if (!link) {
      // plain item → group heading for the indented links that follow
      if (!indented) group = listItem[2].replace(/\*\*/g, '').trim();
      continue;
    }
    const [, linkTitle, url, rest] = link;
    if (url.startsWith('#')) continue; // ToC anchor
    const description = rest.replace(/^[\s—–:-]+/, '').replace(/^\(|\)$/g, '').trim();
    const useGroup = indented && group ? `${group}: ` : '';
    entries.push({
      language,
      category,
      title: `${useGroup}${linkTitle.trim()}`,
      url,
      description,
    });
    if (!indented) group = null;
  }
  return { entries, additional };
}

export async function getPblMarkdown(refresh = false): Promise<string> {
  if (refresh || !fs.existsSync(SNAPSHOT_PATH)) {
    const res = await fetch(PBL_RAW_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Fetching the catalog failed: ${res.status}`);
    const text = await res.text();
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, text);
    return text;
  }
  return fs.readFileSync(SNAPSHOT_PATH, 'utf8');
}

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

const LANG_COLORS = ['blue', 'green', 'amber', 'violet', 'rose', 'cyan', 'orange', 'lime'];

const GUIDE_MD = `# Learning by Building

The method behind [[${HUB_TITLE}]]: you don't learn a stack by reading about it — you learn it by shipping something real with it.

## The loop

1. **Pick a project** from the [[${HUB_TITLE}]] catalog — something just beyond your current level.
2. **Open a Project Brief** — create a page from the *${TEMPLATE_TITLE}* template, link it to the tutorial's page, and write down the goal in one sentence.
3. **Build in passes** — follow the tutorial, but type every line and break it on purpose at least once. Log what surprised you in the brief's Build Log.
4. **Create, don't only follow** — once it works, ask the copilot to *build it with WandGx*: generate your own variant (different stack, extra feature) and compare.
5. **Close the loop** — finish with a Retrospective, then generate study material from your notes and quiz yourself.

## Rules of thumb

- One project at a time, finished beats perfect.
- A tutorial you don't modify is a video you watched.
- The Build Log is the real textbook — it's written by you, for you.`;

const TEMPLATE_MD = `# Project Brief

**Tutorial**: link the [[${HUB_TITLE}]] page you're working from
**Done when**: one sentence describing the finished thing

## Goal

What will exist when this project is done, and why it's worth building.

## Prerequisites

- Concepts / tools you should touch before starting

## Plan

- [ ] Milestone 1
- [ ] Milestone 2
- [ ] Milestone 3

## Build Log

- What you built, what broke, what surprised you (dated entries)

## Retrospective

What you'd do differently, what you'd teach someone else.`;

function hubMarkdown(languages: { name: string; count: number }[], additional: { title: string; url: string }[]): string {
  const lines = [
    `# ${HUB_TITLE}`,
    '',
    `Curated build-it-from-scratch tutorials from [practical-tutorials/project-based-learning](https://github.com/practical-tutorials/project-based-learning), organized as a living catalog. The method: [[${GUIDE_TITLE}]].`,
    '',
    ...languages.map((l) => `- [[${l.name}]] — ${l.count} tutorials`),
    '',
    '## More places to practice',
    '',
    ...additional.map((a) => `- [${a.title}](${a.url})`),
  ];
  return lines.join('\n');
}

function languageHubMarkdown(language: string, entries: PblEntry[]): string {
  const byCat = new Map<string, PblEntry[]>();
  for (const e of entries) {
    const key = e.category ?? '';
    byCat.set(key, [...(byCat.get(key) ?? []), e]);
  }
  const lines = [`# ${language}`, '', `Part of [[${HUB_TITLE}]].`, ''];
  const cats = [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [cat, list] of cats) {
    if (cat) lines.push(`## ${cat}`, '');
    lines.push(...list.map((e) => `- [[${e.title}]]${e.description ? ` — ${e.description}` : ''}`));
    lines.push('');
  }
  return lines.join('\n').trim();
}

function tutorialMarkdown(e: PblEntry): string {
  const bits = [`> Language: [[${e.language}]]${e.category ? ` · ${e.category}` : ''} · [[${HUB_TITLE}]]`, ''];
  if (e.description) bits.push(e.description, '');
  bits.push(`**Tutorial**: [${e.title}](${e.url})`, '', '## Your build', '');
  bits.push(
    `Open a project page from the *${TEMPLATE_TITLE}* template and link it here to work through this tutorial — or ask the copilot to **build it with WandGx** for a generated variant.`
  );
  return bits.join('\n');
}

export interface PblImportSummary {
  languages: string[];
  tutorialsCreated: number;
  tutorialsUpdated: number;
  tutorialsTotal: number;
  databaseRows: number;
}

export async function importPbl(opts: { spaceId: string; userId: string; refresh?: boolean }): Promise<PblImportSummary> {
  const { spaceId, userId } = opts;
  const catalog = await getPblMarkdown(opts.refresh).then(parsePbl);
  if (!catalog.entries.length) throw new Error('Parsed catalog is empty — refusing to import');

  // existing non-template pages by normalized title (identity across re-runs)
  const existing = await q<{ id: string; title: string; parent_id: string | null }>(
    `SELECT id, title, parent_id FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND is_template = false`,
    [spaceId]
  );
  const byTitle = new Map(existing.map((p) => [norm(p.title), p.id]));

  const upsertPage = async (title: string, markdown: string, parentId: string | null): Promise<{ id: string; created: boolean }> => {
    const doc = JSON.stringify(mdToDoc(markdown));
    const found = byTitle.get(norm(title));
    if (found) {
      await q(`UPDATE pages SET markdown = $2, content = $3, parent_id = $4, updated_at = now() WHERE id = $1`, [found, markdown, doc, parentId]);
      return { id: found, created: false };
    }
    const page = await one<{ id: string }>(
      `INSERT INTO pages (space_id, parent_id, title, icon, markdown, content, created_by) VALUES ($1, $2, $3, NULL, $4, $5, $6) RETURNING id`,
      [spaceId, parentId, title, markdown, doc, userId]
    );
    byTitle.set(norm(title), page!.id);
    return { id: page!.id, created: true };
  };

  // 1. hub + methodology guide + project-brief template
  const hub = await upsertPage(HUB_TITLE, '', null);
  await upsertPage(GUIDE_TITLE, GUIDE_MD, hub.id);
  const tpl = await one<{ id: string }>(`SELECT id FROM pages WHERE space_id = $1 AND is_template = true AND lower(title) = lower($2) AND deleted_at IS NULL`, [spaceId, TEMPLATE_TITLE]);
  if (!tpl) {
    await one(
      `INSERT INTO pages (space_id, title, icon, markdown, content, is_template, created_by) VALUES ($1, $2, '', $3, $4, true, $5)`,
      [spaceId, TEMPLATE_TITLE, TEMPLATE_MD, JSON.stringify(mdToDoc(TEMPLATE_MD)), userId]
    );
  }

  // 2. language hubs, then tutorial pages under them. Titles are the import
  //    identity, so they must be deterministic across runs: dedupe within the
  //    catalog only (never against pre-existing pages, or a re-run would
  //    rename every tutorial into a "(2)" duplicate).
  const languages = [...new Set(catalog.entries.map((e) => e.language))];
  const langHubIds = new Map<string, string>();
  for (const lang of languages) {
    const { id } = await upsertPage(lang, '', hub.id);
    langHubIds.set(lang, id);
  }
  let created = 0;
  let updated = 0;
  // deterministic per-entry titles (stable across runs); the same URL can be
  // listed under two languages — e.g. Crafting Interpreters under C/C++ *and*
  // Java — so each listing keeps its own page
  const seenTitles = new Set<string>();
  const finalTitles = catalog.entries.map((e) => {
    let title = e.title;
    for (let n = 2; seenTitles.has(norm(title)); n++) title = `${e.title} (${n})`;
    seenTitles.add(norm(title));
    return title;
  });
  const tutorialPageIds: string[] = []; // per-entry page ids (db rows)
  for (let i = 0; i < catalog.entries.length; i++) {
    const e = catalog.entries[i];
    const res = await upsertPage(finalTitles[i], tutorialMarkdown(e), langHubIds.get(e.language)!);
    tutorialPageIds.push(res.id);
    res.created ? created++ : updated++;
  }

  // 3. hub markdowns now that every page exists (links use resolved titles)
  const titled = catalog.entries.map((e, i) => ({ ...e, title: finalTitles[i] }));
  await upsertPage(HUB_TITLE, hubMarkdown(
    languages.map((name) => ({ name, count: titled.filter((e) => e.language === name).length })),
    catalog.additional
  ), null);
  for (const lang of languages) {
    await upsertPage(lang, languageHubMarkdown(lang, titled.filter((e) => e.language === lang)), hub.id);
  }

  // 4. Projects tracking database (rows link back to tutorial pages)
  let db = await one<{ id: string; schema: any }>(`SELECT id, schema FROM databases WHERE space_id = $1 AND lower(name) = lower($2)`, [spaceId, DB_NAME]);
  if (!db) {
    const schema = [
      { id: 'c1', name: 'Name', type: 'text' },
      { id: 'c2', name: 'Language', type: 'select', config: { options: languages.map((value, i) => ({ value, color: LANG_COLORS[i % LANG_COLORS.length] })) } },
      { id: 'c3', name: 'Category', type: 'text' },
      { id: 'c4', name: 'Tutorial', type: 'url' },
      { id: 'c5', name: 'Status', type: 'select', config: { options: [
        { value: 'Backlog', color: 'amber' }, { value: 'In Progress', color: 'blue' }, { value: 'Done', color: 'green' },
      ] } },
    ];
    db = await one<any>(`INSERT INTO databases (space_id, name, icon, schema) VALUES ($1, $2, NULL, $3) RETURNING id, schema`, [spaceId, DB_NAME, JSON.stringify(schema)]);
    await q(`INSERT INTO db_views (database_id, name, type, config) VALUES ($1, 'Table', 'table', '{}'), ($1, 'Board', 'kanban', '{"groupBy":"c5"}')`, [db!.id]);
  }
  const existingRows = new Set(
    (await q<{ page_id: string }>(`SELECT page_id FROM db_rows WHERE database_id = $1 AND page_id IS NOT NULL`, [db!.id])).map((r) => r.page_id)
  );
  let rows = existingRows.size;
  for (let i = 0; i < catalog.entries.length; i++) {
    const e = catalog.entries[i];
    const pageId = tutorialPageIds[i];
    if (existingRows.has(pageId)) continue;
    await q(`INSERT INTO db_rows (database_id, page_id, cells) VALUES ($1, $2, $3)`, [
      db!.id,
      pageId,
      JSON.stringify({ c1: finalTitles[i], c2: e.language, c3: e.category ?? '', c4: e.url, c5: 'Backlog' }),
    ]);
    rows++;
  }

  // 5. graph + live UI + audit trail
  await relinkSpace(spaceId);
  if (hub.created) bus.publish({ spaceId, type: 'page_created', payload: { pageId: hub.id } });
  bus.publish({ spaceId, type: 'db_updated', payload: { databaseId: db!.id } });
  void recordActivity(spaceId, userId, 'pbl_imported', { source: 'project-based-learning', tutorials: catalog.entries.length, languages: languages.length });

  return { languages, tutorialsCreated: created, tutorialsUpdated: updated, tutorialsTotal: catalog.entries.length, databaseRows: rows };
}

// ---- CLI runner: npm run import:pbl -- --space=<id> [--refresh] ----
if (process.argv[1] && ['pbl.ts', 'pbl.js'].some((s) => process.argv[1]!.endsWith(s))) {
  const args = process.argv.slice(2);
  const spaceId = args.find((a) => a.startsWith('--space='))?.split('=')[1];
  const refresh = args.includes('--refresh');
  const run = async () => {
    if (!spaceId) {
      console.error('usage: npm run import:pbl -- --space=<spaceId> [--refresh]');
      process.exit(1);
    }
    const owner = await one<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE space_id = $1 AND role = 'owner' LIMIT 1`,
      [spaceId]
    );
    if (!owner) {
      console.error(`No space found for id ${spaceId} (or it has no owner)`);
      process.exit(1);
    }
    const s = await importPbl({ spaceId, userId: owner.user_id, refresh });
    console.log(
      `[pbl] imported ${s.tutorialsTotal} tutorials across ${s.languages.length} languages ` +
        `(${s.tutorialsCreated} created, ${s.tutorialsUpdated} updated, ${s.databaseRows} database rows)`
    );
  };
  run().then(() => process.exit(0)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
