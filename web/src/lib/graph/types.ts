import type { SimulationNodeDatum } from 'd3-force';

/** Knowledge graph: one node per page, one edge per resolved [[wiki-link]]. */
export interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  icon: string | null;
  is_daily?: boolean;
  /** Last edit time (ISO) — powers the recency color mode. */
  updated_at?: string;
  /** Link count, computed client-side from the edge list. */
  deg?: number;
}

export interface GraphEdge {
  /** d3-force replaces the id strings with node objects once the sim starts. */
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Edge endpoints as node ids, regardless of sim state. */
export const edgeIds = (e: GraphEdge): [string, string] => [
  typeof e.source === 'string' ? e.source : e.source.id,
  typeof e.target === 'string' ? e.target : e.target.id,
];
