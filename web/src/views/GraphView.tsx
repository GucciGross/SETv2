import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Frame, Network, RefreshCw, RotateCcw, X } from 'lucide-react';
import GraphCanvas, { type FlyToRequest, type GraphColorMode } from '../components/graph/GraphCanvas';
import NodeCard from '../components/graph/NodeCard';
import { filterGraph } from '../lib/graph/filter';
import { edgeIds } from '../lib/graph/types';
import { useGraphData } from '../lib/graph/useGraphData';

const COLOR_KEY = 'set-graph-color';
const COLOR_MODES: { id: GraphColorMode; label: string }[] = [
  { id: 'clique', label: 'Cliques' },
  { id: 'recency', label: 'Recent' },
  { id: 'off', label: 'Plain' },
];

/** Knowledge graph: force-directed canvas with pan/zoom, hover, click-to-inspect. */
export default function GraphView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, refresh, cliques } = useGraphData(spaceId);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<GraphColorMode>(
    () => (localStorage.getItem(COLOR_KEY) as GraphColorMode) || 'clique'
  );
  const [flyTo, setFlyTo] = useState<FlyToRequest | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const pickColorMode = (m: GraphColorMode) => {
    setColorMode(m);
    localStorage.setItem(COLOR_KEY, m);
  };

  const filtered = useMemo(() => (data ? filterGraph(data, filter) : null), [data, filter]);
  const visibleIds = useMemo(() => new Set(filtered?.nodes.map((n) => n.id) ?? []), [filtered]);

  // search picks: pages whose title contains the query, best first
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q || !data) return [];
    return data.nodes
      .filter((n) => n.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.toLowerCase().indexOf(q) - b.title.toLowerCase().indexOf(q))
      .slice(0, 8);
  }, [data, filter]);

  const selected = data?.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedClique = selectedId ? cliques?.byNode.get(selectedId) : undefined;
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

  const flyToNode = (id: string) => {
    setSelectedId(id);
    setFlyTo({ ids: [id], nonce: Date.now() });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchOpen) setSearchOpen(false);
        else setSelectedId(null);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [searchOpen]);

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

  const focused = filter.trim().length > 0;

  return (
    <div className="relative h-full">
      <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2">
        <div ref={searchWrapRef} className="relative">
          <input
            className="set-input w-56"
            placeholder="Search the map…"
            value={filter}
            autoComplete="off"
            onChange={(e) => {
              setFilter(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches.length > 0) {
                flyToNode(matches[0].id);
                setSearchOpen(false);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {focused && (
            <button
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-0.5 text-set-dim hover:text-set-text"
              onClick={() => setFilter('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
          {searchOpen && matches.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-72 overflow-hidden rounded-xl border border-set-border bg-set-panel shadow-pop">
              <div className="px-3 pt-2 pb-1 text-[10px] tracking-[0.15em] text-set-dim uppercase">
                Jump to a page
              </div>
              {matches.map((n) => (
                <button
                  key={n.id}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-set-dim hover:bg-set-panel2 hover:text-set-text"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    flyToNode(n.id);
                    setSearchOpen(false);
                  }}
                >
                  <span>{n.icon || '📄'}</span>
                  <span className="truncate">{n.title}</span>
                  <span className="ml-auto shrink-0 text-[10px] opacity-70">zoom there</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex rounded-lg border border-set-border bg-set-panel p-0.5">
          {COLOR_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => pickColorMode(m.id)}
              className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                colorMode === m.id ? 'bg-set-panel2 text-set-text' : 'text-set-dim hover:text-set-text'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {focused ? (
          <span className="flex items-center gap-2 self-center rounded-lg border border-set-accent/40 bg-set-panel px-2 py-1 text-xs text-set-text">
            showing {filtered.nodes.length} pages near “{filter.trim()}”
            <button
              className="rounded p-0.5 text-set-dim hover:text-set-text"
              onClick={() => setFilter('')}
              aria-label="Show everything"
              title="Show everything"
            >
              <X size={13} />
            </button>
          </span>
        ) : (
          <span className="self-center rounded-lg border border-set-border bg-set-panel px-2 py-1 text-xs text-set-dim">
            {filtered.nodes.length} pages · {filtered.edges.length} links · drag nodes, scroll to zoom, click to
            inspect, double-click to open
          </span>
        )}
      </div>
      {colorMode === 'clique' && cliques && cliques.cliques.length > 0 && (
        <div className="absolute top-3 right-3 z-10 w-44 rounded-xl border border-set-border bg-set-panel/95 p-2 shadow-pop backdrop-blur">
          <div className="px-1 pb-1 text-[10px] tracking-[0.15em] text-set-dim uppercase">Neighborhoods</div>
          {cliques.cliques.map((c) => (
            <button
              key={c.id}
              className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs text-set-dim hover:bg-set-panel2 hover:text-set-text"
              onClick={() => setFlyTo({ ids: c.memberIds, nonce: Date.now() })}
              title="Zoom to this neighborhood"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: `hsl(${c.hue} 75% 62%)` }}
                aria-hidden
              />
              <span className="truncate">{c.name}</span>
              <span className="ml-auto shrink-0 text-[10px] opacity-70">{c.memberIds.length}</span>
            </button>
          ))}
        </div>
      )}
      {colorMode === 'recency' && data && data.nodes.length > 0 && (
        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1 rounded-xl border border-set-border bg-set-panel/95 p-2 text-[11px] text-set-dim backdrop-blur">
          <span className="px-1 pb-0.5 text-[10px] tracking-[0.15em] uppercase">Edited</span>
          {(
            [
              ['#8affc1', 'today'],
              ['#7ee2a8', 'this week'],
              ['#6c8cff', 'this month'],
              ['#8b93a5', 'older'],
            ] as const
          ).map(([color, label]) => (
            <span key={label} className="flex items-center gap-2 px-1">
              <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
              {label}
            </span>
          ))}
        </div>
      )}
      {filtered.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-xl border border-set-border bg-set-panel px-4 py-3 text-center text-sm text-set-dim">
            No pages match “{filter.trim()}”
          </div>
        </div>
      )}
      {/* camera helpers — one click each, nothing to learn */}
      <div className="absolute right-3 bottom-24 z-10 flex flex-col gap-1.5">
        <button
          className="rounded-xl border border-set-border bg-set-panel/95 p-2 text-set-dim shadow-pop backdrop-blur hover:text-set-text"
          onClick={() => setFlyTo({ ids: [...visibleIds], nonce: Date.now() })}
          title="Fit everything on screen"
          aria-label="Fit everything on screen"
        >
          <Frame size={16} />
        </button>
        <button
          className="rounded-xl border border-set-border bg-set-panel/95 p-2 text-set-dim shadow-pop backdrop-blur hover:text-set-text"
          onClick={() => setResetSignal((n) => n + 1)}
          title="Shake it up — release all pinned nodes"
          aria-label="Reset layout"
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <GraphCanvas
        data={data!}
        visibleIds={visibleIds}
        selectedId={selectedId}
        cliques={cliques}
        colorMode={colorMode}
        flyTo={flyTo}
        pinsKey={spaceId ? `set-graph-pins:${spaceId}` : undefined}
        resetSignal={resetSignal}
        onSelect={setSelectedId}
        onOpen={openPage}
      />
      <AnimatePresence>
        {selected && (
          <NodeCard
            node={selected}
            neighbors={neighbors}
            clique={selectedClique}
            onClose={() => setSelectedId(null)}
            onOpen={openPage}
            onSelect={(id) => flyToNode(id)}
            onFocusNeighborhood={() => {
              setFilter(selected.title);
              setSelectedId(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
