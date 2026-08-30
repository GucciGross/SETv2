/**
 * BibTeX export for notebook sources — pure so it's unit-testable.
 * Keys are deterministic (set<year><slug>), deduped with letter suffixes.
 */

export interface CiteSource {
  id: string;
  name: string;
  uri: string | null;
  kind: string;
  created_at: Date | string;
}

/** Escape LaTeX specials in plain text fields (titles, notes). */
export function texEscape(s: string): string {
  return (s ?? '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&#%$_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function keyFor(name: string, createdAt: Date | string): string {
  const year = new Date(createdAt).getFullYear() || new Date().getFullYear();
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 18) || 'source';
  return `set${year}${slug}`;
}

export function sourcesToBibTeX(sources: CiteSource[]): string {
  const seen = new Map<string, number>();
  return (
    sources
      .map((s) => {
        let key = keyFor(s.name, s.created_at);
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        if (n > 0) key += String.fromCharCode(96 + n); // set2026foo, then set2026fooa, set2026foob, …
        const year = new Date(s.created_at).getFullYear() || new Date().getFullYear();
        const lines = [
          `@misc{${key},`,
          `  title = {${texEscape(s.name)}},`,
          s.uri ? `  url = {${s.uri}},` : null,
          `  year = {${year}},`,
          `  note = {Source (${s.kind}) collected in SET.}`,
          `}`,
        ].filter((l): l is string => l !== null);
        return lines.join('\n');
      })
      .join('\n\n') + '\n'
  );
}
