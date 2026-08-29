/**
 * Self-assembling map: find pages that mention another page's title in plain
 * text (no [[wiki link]]) and turn those mentions into one-tap link
 * suggestions. Pure functions — the routes layer only fetches rows and persists.
 */

export interface SuggestPage {
  id: string;
  title: string;
  markdown: string;
}

export interface Suggestion {
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
}

/** Titles shorter than this match too much noise ("RAG" inside "RAGgetti"). */
const MIN_TITLE = 3;

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * First occurrence of `title` in `markdown` that is NOT already inside a
 * [[wiki link]], case-insensitive, or -1. A match is rejected when the
 * preceding character is `[` (opening bracket of a link) or either neighbor
 * is a word character (substring of a longer word).
 */
export function findPlainMention(markdown: string, title: string): number {
  const t = title.trim();
  if (t.length < MIN_TITLE) return -1;
  const re = new RegExp(`(?<![\\[\\w])${escapeRegExp(t)}(?![\\w])`, 'i');
  const m = re.exec(markdown);
  return m ? m.index : -1;
}

/** Wrap the first plain mention of `title` in [[brackets]], or null. */
export function applySuggestion(markdown: string, title: string): string | null {
  const idx = findPlainMention(markdown, title);
  if (idx === -1) return null;
  // keep the author's casing; syncLinks resolves titles case-insensitively
  return markdown.slice(0, idx) + `[[${markdown.slice(idx, idx + title.trim().length)}]]` + markdown.slice(idx + title.trim().length);
}

/**
 * Pair up mentions across a space. `linkedPairs` holds "sourceId→targetId"
 * strings for links that already exist. Longest titles are matched first so
 * "RAG Pipelines" wins over a hypothetical "RAG". Deterministic: pages in,
 * suggestions out, same order.
 */
export function findSuggestions(
  pages: SuggestPage[],
  linkedPairs: Set<string>,
  cap = 20
): Suggestion[] {
  const usable = pages.filter((p) => p.title.trim().length >= MIN_TITLE && (p.markdown ?? '').length > 0);

  // one suggestion target per normalized title — ambiguous duplicate titles resolve to the first page
  const byTitle = new Map<string, SuggestPage>();
  for (const p of usable) {
    const k = p.title.trim().toLowerCase();
    if (!byTitle.has(k)) byTitle.set(k, p);
  }
  const targets = [...byTitle.values()].sort((x, y) => y.title.length - x.title.length);

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const source of usable) {
    const sourceKey = source.title.trim().toLowerCase();
    for (const target of targets) {
      if (target.id === source.id) continue;
      const targetKey = target.title.trim().toLowerCase();
      if (targetKey === sourceKey) continue;
      const pair = `${source.id}→${target.id}`;
      if (linkedPairs.has(pair) || seen.has(pair)) continue;
      if (findPlainMention(source.markdown ?? '', target.title) === -1) continue;
      seen.add(pair);
      out.push({ sourceId: source.id, sourceTitle: source.title, targetId: target.id, targetTitle: target.title });
      if (out.length >= cap) return out;
    }
  }
  return out;
}
