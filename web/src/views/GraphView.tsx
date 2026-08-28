import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Network, RefreshCw } from 'lucide-react';
import GraphCanvas from '../components/graph/GraphCanvas';
import NodeCard from '../components/graph/NodeCard';
import { filterGraph } from '../lib/graph/filter';
import { edgeIds } from '../lib/graph/types';
import { useGraphData } from '../lib/graph/useGraphData';

/** Knowledge graph: force-directed canvas with pan/zoom, hover, click-to-inspect. */
export default function GraphView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, refresh } = useGraphData(spaceId);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => (data ? filterGraph(data, filter) : null), [data, filter]);
  const visibleIds = useMemo(() => new Set(filtered?.nodes.map((n) => n.id) ?? []), [filtered]);

  const selected = data?.nodes.find((n) => n.id === selectedId) ?? null;
  const neighbors = useMemo(() => {
    if (!data || !selectedId) return [];
    const ids = new Set<string>();
    for (const e of data.edges) {
      const [s, t] = edgeIds(e);
      if (s === selectedId) ids.add(t);
      else if (t === selectedId) ids.add(s);
    }
    return data.nodes.filter((n) => ids.has(n.id));
  }, [data, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openPage = (id: string) => {
    if (spaceId) navigate(`/app/space/${spaceId}/page/${id}`);
  };

  if (error && !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Network size={28} className="text-set-dim" />
        <div>
          <p className="text-sm text-set-text">Couldn't load the graph</p>
          <p className="mt-1 max-w-sm text-xs text-set-dim">{error}</p>
        </div>
        <button className="set-btn-primary" onClick={refresh}>
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> Retry
          </span>
        </button>
      </div>
    );
  }

  if (!filtered) {
    return <div className="p-8 text-set-dim">Loading graph…</div>;
  }

  if (data!.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Network size={28} className="text-set-dim" />
        <div>
          <p className="text-sm text-set-text">Nothing to graph yet</p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-set-dim">
            Pages show up here as nodes. Link them with{' '}
            <code className="rounded bg-set-panel2 px-1 py-0.5">[[wiki links]]</code> and the connections appear as
            edges.
          </p>
        </div>
        <button className="set-btn-primary" onClick={() => spaceId && navigate(`/app/space/${spaceId}/pages`)}>
          Go to pages
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
        <input
          className="set-input w-56"
          placeholder="Filter pages…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="self-center rounded-lg border border-set-border bg-set-panel px-2 py-1 text-xs text-set-dim">
          {filtered.nodes.length} pages · {filtered.edges.length} links · drag nodes, scroll to zoom, click to
          inspect, double-click to open
        </span>
      </div>
      {filtered.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-xl border border-set-border bg-set-panel px-4 py-3 text-center text-sm text-set-dim">
            No pages match “{filter.trim()}”
          </div>
        </div>
      )}
      <GraphCanvas
        data={data!}
        visibleIds={visibleIds}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onOpen={openPage}
      />
      <AnimatePresence>
        {selected && (
          <NodeCard
            node={selected}
            neighbors={neighbors}
            onClose={() => setSelectedId(null)}
            onOpen={openPage}
            onSelect={setSelectedId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
