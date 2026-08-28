import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../../stores/app';
import type { GraphData, GraphNode } from './types';

/**
 * Loads a space's graph (nodes = pages, edges = wiki-links) and keeps it live:
 * the store reloads its page list on page create/delete/remote-update events,
 * and any change there triggers a debounced graph refetch.
 */
export function useGraphData(spaceId: string | undefined) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const pages = useApp((s) => s.pages);
  const debounce = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (!spaceId) return;
    try {
      const r = await api.get<{ nodes: GraphNode[]; edges: { source: string; target: string }[] }>(
        `/spaces/${spaceId}/graph`
      );
      const deg: Record<string, number> = {};
      for (const e of r.edges) {
        deg[e.source] = (deg[e.source] ?? 0) + 1;
        deg[e.target] = (deg[e.target] ?? 0) + 1;
      }
      for (const n of r.nodes) n.deg = deg[n.id] ?? 0;
      setData({ nodes: r.nodes, edges: r.edges });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  // initial load + manual refresh
  useEffect(() => {
    setLoading(true);
    load();
  }, [load, tick]);

  // stay in sync with page create/delete/remote edits (debounced)
  useEffect(() => {
    if (tick === 0 && !data) return; // initial load handles itself
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(load, 600);
    return () => window.clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { data, error, loading, refresh };
}
