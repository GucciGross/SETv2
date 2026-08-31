import { one, q } from '../db.js';
import { computeMastery } from './mastery.js';

/**
 * Daily Brief — the morning digest for a space + user. Everything computed
 * from data the workspace already has:
 *
 * - reviews:   SM-2 cards due now, worst decks first
 * - decaying:  mastery-map pages going amber (overdue cards / failed quizzes)
 * - next:      ranked suggestions — due-soon unfinished path items, decaying
 *              pages, and backlog rows from Status databases boosted when
 *              they sit next to freshly-edited pages in the link graph
 * - builds:    WandGx builds from the last 48h
 * - stale:     untouched-for-a-month pages that are linked from recent work
 *
 * Rendered into the daily note by POST /spaces/:id/brief/to-daily (once per
 * day, marked with an HTML comment so re-runs never duplicate).
 */

export interface BriefItem {
  pageId: string;
  title: string;
  reason: string;
}

export interface Brief {
  date: string;
  reviews: { dueNow: number; total: number; decks: { id: string; notebookId: string | null; title: string; due: number }[] };
  decaying: (BriefItem & { overdue: number; total: number })[];
  next: (BriefItem & { score: number })[];
  builds: { id: string; title: string; status: string; liveUrl: string | null; repoUrl: string | null; pageId: string | null; createdAt: string }[];
  stale: { pageId: string; title: string; viaTitle: string }[];
  stats: { pagesTouched24h: number };
}

const BACKLOG_VALUES = new Set(['backlog', 'to do', 'todo', 'planned', 'not started', 'want to learn']);

export async function computeBrief(spaceId: string, userId: string): Promise<Brief> {
  // — reviews due —
  const deckRows = await q<{ id: string; notebook_id: string | null; title: string; due: string; total: string }>(
    `SELECT d.id, d.notebook_id, d.title, count(*) FILTER (WHERE r.due_at < now()) AS due, count(*) AS total
     FROM reviews r JOIN decks d ON d.id = r.deck_id
     WHERE d.space_id = $1 AND r.user_id = $2
     GROUP BY d.id, d.notebook_id, d.title
     HAVING count(*) FILTER (WHERE r.due_at < now()) > 0
     ORDER BY 4 DESC, d.title LIMIT 3`,
    [spaceId, userId]
  );
  const reviews = {
    dueNow: deckRows.reduce((sum, d) => sum + Number(d.due), 0),
    total: deckRows.reduce((sum, d) => sum + Number(d.total), 0),
    decks: deckRows.map((d) => ({ id: d.id, notebookId: d.notebook_id, title: d.title, due: Number(d.due) })),
  };

  // — decaying pages (from the mastery map) —
  const mastery = await computeMastery(spaceId, userId);
  const decayingIds = Object.entries(mastery)
    .filter(([, m]) => m.state === 'decaying')
    .sort((a, b) => b[1].signals.reviews.overdue - a[1].signals.reviews.overdue)
    .slice(0, 5)
    .map(([id]) => id);
  const titleRows = decayingIds.length
    ? await q<{ id: string; title: string }>(`SELECT id, title FROM pages WHERE id = ANY($1::uuid[])`, [decayingIds])
    : [];
  const decaying = decayingIds
    .map((id) => {
      const t = titleRows.find((r) => r.id === id);
      return t ? { pageId: id, title: t.title, overdue: mastery[id].signals.reviews.overdue, total: mastery[id].signals.reviews.total } : null;
    })
    .filter(Boolean) as Brief['decaying'];

  // — suggestions: due-soon unfinished path items —
  const next: (BriefItem & { score: number })[] = [];
  const paths = await q<{ id: string; title: string; due_date: string | null; items: { pageId?: string }[]; done: number }>(
    `SELECT lp.id, lp.title, lp.due_date, lp.items,
       (SELECT count(*)::int FROM path_progress pp WHERE pp.path_id = lp.id AND pp.user_id = $2 AND pp.done) AS done
     FROM learning_paths lp
     WHERE lp.space_id = $1 AND (lp.assignees ? ($2::text)
        OR EXISTS (SELECT 1 FROM path_progress pp WHERE pp.path_id = lp.id AND pp.user_id = $2))`,
    [spaceId, userId]
  );
  const pathTitles = new Map<string, string>();
  const pathPages = paths.length
    ? await q<{ id: string; title: string }>(
        `SELECT DISTINCT p.id, p.title FROM pages p
         WHERE p.space_id = $1 AND p.id = ANY($2::uuid[])`,
        [spaceId, paths.flatMap((p) => (p.items ?? []).map((i) => i.pageId).filter(Boolean)) as string[]]
      )
    : [];
  for (const p of pathPages) pathTitles.set(p.id, p.title);
  const inDays = (iso: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);
  for (const path of paths) {
    const total = (path.items ?? []).length;
    if (!total || path.done >= total) continue;
    const progress = await q<{ item_index: number; done: boolean }>(
      `SELECT item_index, done FROM path_progress WHERE path_id = $1 AND user_id = $2`,
      [path.id, userId]
    );
    const doneSet = new Set(progress.filter((r) => r.done).map((r) => r.item_index));
    const idx = (path.items ?? []).findIndex((item, i) => item.pageId && !doneSet.has(i));
    const pageId = idx >= 0 ? path.items[idx].pageId : null;
    if (!pageId || !pathTitles.get(pageId)) continue;
    const days = inDays(path.due_date);
    next.push({
      pageId,
      title: pathTitles.get(pageId)!,
      reason: days != null ? `path “${path.title}” · ${days < 0 ? 'overdue' : days === 0 ? 'due today' : `due in ${days}d`}` : `next in path “${path.title}”`,
      score: days != null && days <= 3 ? 5 : 3,
    });
  }

  // — decaying pages as suggestions —
  for (const d of decaying) {
    next.push({ pageId: d.pageId, title: d.title, reason: `${d.overdue} of ${d.total || '?'} cards overdue`, score: 4 });
  }

  // — backlog rows from Status databases, boosted next to fresh work —
  const dbs = await q<{ id: string; schema: { id: string; name: string; type: string; config?: { options?: { value: string }[] } }[] }>(
    `SELECT id, schema FROM databases WHERE space_id = $1`,
    [spaceId]
  );
  for (const db of dbs) {
    const statusCol = (db.schema ?? []).find(
      (c) => c.type === 'select' && /status/i.test(c.name) && (c.config?.options ?? []).some((o) => BACKLOG_VALUES.has(String(o.value).toLowerCase()))
    );
    if (!statusCol) continue;
    const backlogValues = (statusCol.config?.options ?? []).map((o) => o.value).filter((v) => BACKLOG_VALUES.has(String(v).toLowerCase()));
    const rows = await q<{ page_id: string }>(
      `SELECT r.page_id FROM db_rows r
       WHERE r.database_id = $1 AND r.page_id IS NOT NULL
         AND lower(r.cells->>$2) = ANY($3)`,
      [db.id, statusCol.id, backlogValues.map((v) => String(v).toLowerCase())]
    );
    const candidates = rows.map((r) => r.page_id).filter((id) => !next.some((n) => n.pageId === id));
    if (!candidates.length) continue;
    const near = await q<{ id: string; title: string; via: string }>(
      `SELECT p.id, p.title, fp.title AS via FROM pages p
       JOIN links l ON (l.target_id = p.id OR l.source_id = p.id)
       JOIN pages fp ON fp.id = CASE WHEN l.target_id = p.id THEN l.source_id ELSE l.target_id END
       WHERE p.space_id = $1 AND p.deleted_at IS NULL AND p.id = ANY($2::uuid[])
         AND fp.updated_at > now() - interval '7 days' AND fp.id <> p.id`,
      [spaceId, candidates]
    );
    const nearIds = new Set(near.map((r) => r.id));
    const allTitles = await q<{ id: string; title: string }>(`SELECT id, title FROM pages WHERE id = ANY($1::uuid[])`, [candidates]);
    for (const t of allTitles) {
      // proximate backlog first (score 2); when the day is otherwise sparse,
      // fall back to a couple of plain backlog picks (score 1)
      if (nearIds.has(t.id)) next.push({ pageId: t.id, title: t.title, reason: 'backlog project next to fresh work', score: 2 });
      else if (next.filter((n) => n.score <= 2).length < 2) next.push({ pageId: t.id, title: t.title, reason: 'from your backlog', score: 1 });
    }
  }
  next.sort((a, b) => b.score - a.score);

  // — wandgx builds (48h) —
  const builds = await q<any>(
    `SELECT id, title, status, live_url, repo_url, page_id, created_at
     FROM wandgx_builds WHERE space_id = $1 AND created_at > now() - interval '48 hours'
     ORDER BY created_at DESC LIMIT 5`,
    [spaceId]
  ).then((rows) =>
    rows.map((b) => ({ id: b.id, title: b.title, status: b.status, liveUrl: b.live_url, repoUrl: b.repo_url, pageId: b.page_id, createdAt: String(b.created_at) }))
  );

  // — stale pages linked from fresh work —
  const staleRows = await q<{ id: string; title: string; via: string }>(
    `SELECT DISTINCT p.id, p.title, fp.title AS via FROM pages p
     JOIN links l ON (l.target_id = p.id OR l.source_id = p.id)
     JOIN pages fp ON fp.id = CASE WHEN l.target_id = p.id THEN l.source_id ELSE l.target_id END
     WHERE p.space_id = $1 AND p.deleted_at IS NULL AND p.is_daily = false
       AND p.updated_at < now() - interval '30 days'
       AND fp.updated_at > now() - interval '7 days' AND fp.id <> p.id
     LIMIT 5`,
    [spaceId]
  );
  const stale = staleRows.map((r) => ({ pageId: r.id, title: r.title, viaTitle: r.via }));

  const touched = await one<{ count: string }>(
    `SELECT count(*) AS count FROM pages WHERE space_id = $1 AND deleted_at IS NULL AND updated_at > now() - interval '24 hours'`,
    [spaceId]
  );

  return {
    date: new Date().toISOString().slice(0, 10),
    reviews,
    decaying,
    next: next.slice(0, 5),
    builds,
    stale,
    stats: { pagesTouched24h: Number(touched?.count ?? 0) },
  };
}

const BRIEF_MARKER = '<!-- set-brief -->';

/** Render the brief as daily-note markdown. Wiki links wire the note into the graph. */
export function renderBriefMarkdown(brief: Brief): string {
  const lines = [BRIEF_MARKER, '## 🌤 Today’s brief', ''];
  if (brief.reviews.dueNow > 0) {
    const worst = brief.reviews.decks[0];
    lines.push(`**${brief.reviews.dueNow} cards due**${worst ? ` — worst: *${worst.title}* (${worst.due} due)` : ''}`, '');
  }
  if (brief.decaying.length) {
    lines.push('### Needs review', '', ...brief.decaying.map((d) => `- [[${d.title}]] — ${d.overdue} of ${d.total || '?'} cards overdue`), '');
  }
  if (brief.next.length) {
    lines.push('### Suggested next', '', ...brief.next.map((n, i) => `${i + 1}. [[${n.title}]] — ${n.reason}`), '');
  }
  if (brief.builds.length) {
    lines.push(
      '### Builds',
      '',
      ...brief.builds.map((b) => {
        const links = [b.liveUrl ? `[live](${b.liveUrl})` : null, b.repoUrl ? `[repo](${b.repoUrl})` : null].filter(Boolean).join(' · ');
        return `- **${b.title}** — ${b.status}${links ? ` · ${links}` : ''}`;
      }),
      ''
    );
  }
  if (brief.stale.length) {
    lines.push('### Coming back around', '', ...brief.stale.map((s) => `- [[${s.title}]] — linked from [[${s.viaTitle}]]`), '');
  }
  if (lines.length <= 3) lines.push('Quiet day — nothing due, nothing decaying, no pending builds. Ship something. 🚀');
  return lines.join('\n').trim();
}

export async function writeBriefToDaily(spaceId: string, userId: string): Promise<{ pageId: string; written: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  const brief = await computeBrief(spaceId, userId);
  const markdown = renderBriefMarkdown(brief);
  const existing = await one<{ id: string; markdown: string | null }>(
    `SELECT id, markdown FROM pages WHERE space_id = $1 AND is_daily AND daily_date = $2`,
    [spaceId, today]
  );
  const { savePageContent, syncLinks } = await import('../pages/routes.js');
  const { bus } = await import('../lib/events.js');
  if (existing) {
    if ((existing.markdown ?? '').includes(BRIEF_MARKER)) return { pageId: existing.id, written: false };
    const next = `${(existing.markdown ?? '').trim()}\n\n${markdown}`;
    await savePageContent(existing.id, spaceId, { markdown: next }, userId);
    return { pageId: existing.id, written: true };
  }
  const { mdToDoc } = await import('../lib/markdown.js');
  const page = await one<{ id: string }>(
    `INSERT INTO pages (space_id, parent_id, title, icon, markdown, content, is_daily, daily_date, created_by)
     VALUES ($1, NULL, $2, '🌤', $3, $4, true, $5, $6) RETURNING id`,
    [spaceId, today, markdown, JSON.stringify(mdToDoc(markdown)), today, userId]
  );
  await syncLinks(page!.id, spaceId, markdown);
  bus.publish({ spaceId, type: 'page_created', payload: { pageId: page!.id } });
  return { pageId: page!.id, written: true };
}
