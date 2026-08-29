/**
 * Server twin of web/src/lib/graph/cliques.ts — same label propagation, same
 * word lists, same hashing — so the neighborhoods the copilot talks about
 * carry the exact names and colors the map already shows. If you change one
 * side, change both: determinism across client and server is the contract.
 */

/** 32-bit FNV-1a hash — identical constants to the client. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Clique {
  id: string;
  name: string;
  memberIds: string[];
  hubId: string;
  hue: number;
}

export interface CliqueResult {
  cliques: Clique[];
  byNode: Map<string, Clique>;
  strays: Set<string>;
}

const MIN_CLIQUE = 3;
const MAX_ROUNDS = 30;

const ADJECTIVES = [
  'Static', 'Neon', 'Quiet', 'Amber', 'Velvet', 'Cobalt', 'Lucid', 'Paper', 'Iron', 'Glass',
  'Midnight', 'Solar', 'Copper', 'Silent', 'Woven', 'Fractal', 'Hollow', 'Radiant', 'Moss', 'Rusted',
];
const NOUNS = [
  'Garden', 'Circuit', 'Archive', 'Harbor', 'Choir', 'Foundry', 'Orchard', 'Lattice', 'Reef', 'Atelier',
  'Bazaar', 'Observatory', 'Greenhouse', 'Workshop', 'Sanctum', 'Junction', 'Gallery', 'Reservoir', 'Colony', 'Loop',
];

/** Deterministic word-pair name for a clique id, e.g. "Static Garden". */
export function cliqueName(id: string): string {
  const h = fnv1a(`clique:${id}`);
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[(h >>> 8) % NOUNS.length]}`;
}

export interface SimpleGraph {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
}

/**
 * Communities over the wiki-link graph via label propagation, fully
 * deterministic: nodes visited in sorted-id order, ties break toward the
 * lexicographically smaller label, hues spread by golden angle in stable-id
 * order. Same contract as the client engine.
 */
export function detectCliques(data: SimpleGraph): CliqueResult {
  const ids = data.nodes.map((n) => n.id).sort();

  const adj = new Map<string, string[]>(ids.map((id) => [id, [] as string[]]));
  for (const e of data.edges) {
    if (e.source === e.target) continue;
    const a = adj.get(e.source);
    const b = adj.get(e.target);
    if (!a || !b) continue;
    a.push(e.target);
    b.push(e.source);
  }

  const label = new Map<string, string>(ids.map((id) => [id, id]));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const id of ids) {
      const counts = new Map<string, number>();
      for (const nb of adj.get(id)!) {
        const l = label.get(nb)!;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      let best: string | null = null;
      let bestCount = 0;
      for (const [l, c] of counts) {
        if (c > bestCount || (c === bestCount && (best === null || l < best))) {
          best = l;
          bestCount = c;
        }
      }
      if (best !== null && best !== label.get(id)) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const grouped = new Map<string, string[]>();
  for (const id of ids) {
    const l = label.get(id)!;
    const members = grouped.get(l);
    if (members) members.push(id);
    else grouped.set(l, [id]);
  }

  const cliques: Clique[] = [];
  for (const members of grouped.values()) {
    if (members.length < MIN_CLIQUE) continue;
    const id = String(fnv1a(members.join(',')));
    const hubId = members.reduce((best, id) =>
      adj.get(id)!.length > adj.get(best)!.length ? id : best
    );
    cliques.push({ id, name: cliqueName(id), memberIds: members, hubId, hue: 0 });
  }
  cliques.sort((x, y) => y.memberIds.length - x.memberIds.length || (x.id < y.id ? -1 : 1));
  cliques.forEach((c, i) => {
    c.hue = Math.round((i * 137.508) % 360);
  });

  const byNode = new Map<string, Clique>();
  const strays = new Set<string>(ids);
  for (const c of cliques) {
    for (const id of c.memberIds) {
      byNode.set(id, c);
      strays.delete(id);
    }
  }
  return { cliques, byNode, strays };
}
