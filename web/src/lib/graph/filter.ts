import type { GraphData } from './types';
import { edgeIds } from './types';

/**
 * Keep nodes whose title matches the query, plus their 1-hop neighborhood,
 * and only edges between kept nodes. An empty query returns the input as-is.
 * (Expansion checks the match set, not the growing keep set — otherwise one
 * pass transitively floods the whole connected component.)
 */
export function filterGraph(data: GraphData, query: string): GraphData {
  const q = query.trim().toLowerCase();
  if (!q) return data;
  const matched = new Set(
    data.nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id)
  );
  const keep = new Set(matched);
  for (const e of data.edges) {
    const [s, t] = edgeIds(e);
    if (matched.has(s)) keep.add(t);
    else if (matched.has(t)) keep.add(s);
  }
  return {
    nodes: data.nodes.filter((n) => keep.has(n.id)),
    edges: data.edges.filter((e) => {
      const [s, t] = edgeIds(e);
      return keep.has(s) && keep.has(t);
    }),
  };
}
