import { fnv1a } from '../../components/dither-kit/pixel';
import { edgeIds, type GraphData } from './types';

/** A community: 3+ pages more linked to each other than to the rest of the space. */
export interface Clique {
  /** fnv1a of the sorted member ids — stable across sessions and fetch order. */
  id: string;
  /** Word-pair name generated deterministically from the id, e.g. "Static Garden". */
  name: string;
  memberIds: string[];
  /** Highest-degree member (ties → smallest id) — the clique's natural center. */
  hubId: string;
  /** Deterministic hue (0–360) shared by all members' color coding. */
  hue: number;
}

export interface CliqueResult {
  /** Cliques sorted by size, largest first. */
  cliques: Clique[];
  /** nodeId → its clique, for nodes that belong to one. */
  byNode: Map<string, Clique>;
  /** Nodes in no clique — isolated, or only in groups smaller than 3. */
  strays: Set<string>;
}

/** Groups smaller than this are too thin to feel like a neighborhood. */
const MIN_CLIQUE = 3;
/** Label propagation is capped so pathological graphs can't spin forever. */
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

/**
 * Communities over the wiki-link graph via label propagation, fully
 * deterministic: nodes are visited in sorted-id order and count ties break
 * toward the lexicographically smaller label, so the same graph always yields
 * the same cliques, names and hues — regardless of fetch or edge order.
 */
export function detectCliques(data: GraphData): CliqueResult {
  const ids = data.nodes.map((n) => n.id).sort();

  // Deduped, symmetric adjacency; edges to unknown nodes and self-loops are ignored.
  const adj = new Map<string, string[]>(ids.map((id) => [id, [] as string[]]));
  for (const e of data.edges) {
    const [s, t] = edgeIds(e);
    if (s === t) continue;
    const a = adj.get(s);
    const b = adj.get(t);
    if (!a || !b) continue;
    a.push(t);
    b.push(s);
  }

  // Each node starts as its own community; repeatedly adopt the neighbors'
  // majority label until nothing moves.
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
    // members were pushed in sorted-id order, so they're already sorted
    const id = String(fnv1a(members.join(',')));
    const hubId = members.reduce((best, id) =>
      adj.get(id)!.length > adj.get(best)!.length ? id : best
    );
    cliques.push({ id, name: cliqueName(id), memberIds: members, hubId, hue: 0 });
  }
  cliques.sort((a, b) => b.memberIds.length - a.memberIds.length || (a.id < b.id ? -1 : 1));
  // Hues go around the wheel by golden angle in stable-id order, so two
  // cliques in one space can never land on (nearly) the same color the way
  // independent hashes would.
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
