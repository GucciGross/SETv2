import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { Frame, Link2Off, Network, Pause, Play, RefreshCw, RotateCcw, Sparkles, X } from 'lucide-react';
import GraphCanvas, { type FlyToRequest, type GraphColorMode, type MasteryState } from '../components/graph/GraphCanvas';
import { PullToRefresh } from '../components/PullToRefresh';
import { GraphSkeleton } from '../components/Skeleton';
import NodeCard from '../components/graph/NodeCard';
import { filterGraph } from '../lib/graph/filter';
import { edgeIds } from '../lib/graph/types';
import { useGraphData } from '../lib/graph/useGraphData';
import { api } from '../lib/api';

interface LinkSuggestion {
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
}

const COLOR_KEY = 'set-graph-color';
const COLOR_MODES: { id: GraphColorMode; label: string }[] = [
  { id: 'clique', label: 'Cliques' },
  { id: 'recency', label: 'Recent' },
  { id: 'mastery', label: 'Mastery' },
  { id: 'off', label: 'Plain' },
];

const MASTERY_LEGEND: { state: import('../components/graph/GraphCanvas').MasteryState; label: string; color: string }[] = [
  { state: 'mastered', label: 'mastered', color: '#34d399' },
  { state: 'learning', label: 'learning', color: '#60a5fa' },
  { state: 'decaying', label: 'needs review', color: '#fbbf24' },
];

/** Knowledge graph: force-directed canvas with pan/zoom, hover, click-to-inspect. */
export default function GraphView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, refresh, cliques } = useGraphData(spaceId);
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mastery, setMastery] = useState<Record<string, MasteryState> | null>(null);
  const [colorMode, setColorMode] = useState<GraphColorMode>(
    () => (localStorage.getItem(COLOR_KEY) as GraphColorMode) || 'clique'
  );
  const [flyTo, setFlyTo] = useState<FlyToRequest | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  // — new since your last visit —
  // read the previous visit stamp once, then stamp this visit; pages edited in
  // between get a ripple wave when the map opens
  const seenAtRef = useRef<number | null>(null);
  if (seenAtRef.current === null) {
    const key = `set-graph-seen:${spaceId ?? 'none'}`;
    seenAtRef.current = Number(localStorage.getItem(key) ?? 0);
    try {
      localStorage.setItem(key, String(Date.now()));
    } catch {
      /* ignore */
    }
  }
  const pulseIds = useMemo(() => {
    const seen = seenAtRef.current ?? 0;
    if (!seen || !data) return [];
    const fresh = data.nodes
      .filter((n) => n.updated_at && new Date(n.updated_at).getTime() > seen)
      .map((n) => n.id);
    return fresh.length > 20 ? [] : fresh; // a wave, not a fireworks show
  }, [data]);

  // — a brand-new neighborhood forms: celebrate it once —
  // clique ids are stable across sessions, so localStorage tells us which
  // community the map has never shown before
  const [celebrate, setCelebrate] = useState<{ ids: string[]; name: string } | null>(null);
  const cliquesSeenKey = `set-graph-cliques:${spaceId ?? 'none'}`;
  const cliquesSig = cliques ? cliques.cliques.map((c) => c.id).join(',') : '';
  useEffect(() => {
    if (!cliques) return;
    let prev: string[] = [];
    try {
      prev = JSON.parse(localStorage.getItem(cliquesSeenKey) ?? '[]');
    } catch {
      /* ignore */
    }
    const prevSet = new Set(prev);
    const fresh = prev.length ? cliques.cliques.find((c) => !prevSet.has(c.id)) : null;
    try {
      localStorage.setItem(cliquesSeenKey, JSON.stringify(cliques.cliques.map((c) => c.id)));
    } catch {
      /* ignore */
    }
    if (fresh) {
      setCelebrate({ ids: fresh.memberIds, name: fresh.name });
      setFlyTo({ ids: fresh.memberIds, nonce: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliquesSig]);

  useEffect(() => {
    if (!celebrate) return;
    const t = window.setTimeout(() => setCelebrate(null), 9000);
    return () => window.clearTimeout(t);
  }, [celebrate]);

  // — growth playback —
  const births = useMemo(
    () => (data ? data.nodes.map((n) => (n.created_at ? new Date(n.created_at).getTime() : 0)) : []),
    [data]
  );
  const range = useMemo(() => {
    if (births.length === 0) return null;
    const t0 = Math.min(...births);
    const t1 = Date.now();
    return t1 - t0 < 1000 ? null : { t0, t1 }; // a graph born in one moment has no story
  }, [births]);
  const [playhead, setPlayhead] = useState<number | null>(null); // null = living in the present
  const [playing, setPlaying] = useState(false);
  const playheadRef = useRef<number | null>(null);
  playheadRef.current = playhead;

  useEffect(() => {
    if (!playing || !range) return;
    const dur = 12000;
    const start = performance.now();
    const from = playheadRef.current ?? range.t0;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      setPlayhead(from + (range.t1 - from) * p);
      if (p < 1) raf = requestAnimationFrame(step);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, range]);

  // — loose pages —
  const loose = useMemo(() => data?.nodes.filter((n) => (n.deg ?? 0) === 0) ?? [], [data]);
  const [looseOpen, setLooseOpen] = useState(false);

  // — link suggestions: the map can grow itself —
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const loadSuggestions = useCallback(async () => {
    if (!spaceId) return;
    try {
      const r = await api.get<{ suggestions: LinkSuggestion[] }>(`/spaces/${spaceId}/link-suggestions`);
      setSuggestions(r.suggestions ?? []);
    } catch {
      /* suggestions are garnish — never block the map on them */
    }
  }, [spaceId]);
  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const applySuggestion = async (s: LinkSuggestion) => {
    if (!spaceId) return;
    const key = `${s.sourceId}→${s.targetId}`;
    setApplying(key);
    try {
      await api.post(`/spaces/${spaceId}/link-suggestions/apply`, { sourceId: s.sourceId, targetId: s.targetId });
      setSuggestions((list) => list.filter((x) => !(x.sourceId === s.sourceId && x.targetId === s.targetId)));
      refresh(); // the new edge lands on the map immediately
    } catch {
      /* leave the row; the user can retry */
    } finally {
      setApplying(null);
    }
  };

  const revealedCount =
    playhead == null ? (data?.nodes.length ?? 0) : births.filter((b) => b <= playhead).length;

  const pickColorMode = (m: GraphColorMode) => {
    setColorMode(m);
    localStorage.setItem(COLOR_KEY, m);
  };

  // mastery states for the Mastery color mode (paths + page quizzes + reviews)
  const loadMastery = useCallback(() => {
    if (!spaceId) return;
    api
      .get<{ mastery: Record<string, { state: MasteryState }> }>(`/spaces/${spaceId}/mastery`)
      .then((r) => setMastery(Object.fromEntries(Object.entries(r.mastery ?? {}).map(([id, v]) => [id, v.state]))))
      .catch(() => {});
  }, [spaceId]);
  useEffect(() => {
    loadMastery();
  }, [loadMastery]);
  const refreshAll = useCallback(() => {
    refresh();
    loadMastery();
  }, [refresh, loadMastery]);

  const masteryCounts = useMemo(() => {
    const counts: Record<MasteryState, number> = { mastered: 0, learning: 0, decaying: 0 };
    for (const state of Object.values(mastery ?? {})) counts[state] += 1;
    return counts;
  }, [mastery]);

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
    return (
      <div className="h-full">
        <GraphSkeleton />
      </div>
    );
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
    <PullToRefresh onRefresh={refreshAll}>
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
        {colorMode === 'mastery' && (
          <div className="flex items-center gap-2.5 rounded-lg border border-set-border bg-set-panel px-2.5 py-1.5 text-[11px] text-set-dim">
            {MASTERY_LEGEND.map((l) => (
              <span key={l.state} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                {l.label} {masteryCounts[l.state] > 0 && <span className="text-set-text">{masteryCounts[l.state]}</span>}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-set-panel2 border border-set-border" />
              untested
            </span>
          </div>
        )}
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
        {range && playhead == null && (
          <button
            className="rounded-xl border border-set-border bg-set-panel/95 p-2 text-set-dim shadow-pop backdrop-blur hover:text-set-text"
            onClick={() => {
              setPlayhead(range.t0);
              setPlaying(true);
            }}
            title="Watch it grow — replay how this space was built, page by page"
            aria-label="Watch it grow"
          >
            <Play size={16} />
          </button>
        )}
      </div>
      {/* link suggestions: pages that mention other pages, one tap to connect */}
      {suggestions.length > 0 && playhead == null && (
        <div className="absolute bottom-[3.25rem] left-3 z-10 md:bottom-[11.75rem]">
          <button
            className="flex items-center gap-1.5 rounded-xl border border-set-border bg-set-panel/95 px-2.5 py-1.5 text-xs text-set-dim shadow-pop backdrop-blur hover:text-set-text"
            onClick={() => setSuggestOpen((o) => !o)}
            title="Pages that mention other pages — connect them in one tap"
          >
            <Sparkles size={13} /> Suggestions · {suggestions.length}
          </button>
          {suggestOpen && (
            <div className="absolute bottom-full left-0 mb-1 w-72 overflow-hidden rounded-xl border border-set-border bg-set-panel shadow-pop">
              <div className="px-3 pt-2 pb-1 text-[10px] tracking-[0.15em] text-set-dim uppercase">
                The map can grow itself
              </div>
              {suggestions.map((s) => {
                const key = `${s.sourceId}→${s.targetId}`;
                return (
                  <div key={key} className="flex items-center gap-2 px-3 py-2 text-xs text-set-dim">
                    <span className="min-w-0 flex-1 truncate" title={`${s.sourceTitle} mentions ${s.targetTitle}`}>
                      <span className="text-set-text">{s.sourceTitle}</span> mentions {s.targetTitle}
                    </span>
                    <button
                      className="shrink-0 rounded-md border border-set-border px-1.5 py-0.5 text-[10px] text-set-dim hover:bg-set-panel2 hover:text-set-text disabled:opacity-50"
                      disabled={applying === key}
                      onClick={() => void applySuggestion(s)}
                    >
                      {applying === key ? '…' : 'Link'}
                    </button>
                  </div>
                );
              })}
              <p className="px-3 py-2 text-[10px] leading-relaxed text-set-dim opacity-80">
                Linking wraps the mention in{' '}
                <code className="rounded bg-set-panel2 px-1 py-0.5">[[brackets]]</code> — the map draws the connection
                instantly.
              </p>
            </div>
          )}
        </div>
      )}
      {/* loose pages: on the map but connected to nothing */}
      {loose.length > 0 && playhead == null && (
        <div className="absolute bottom-3 left-3 z-10 md:bottom-[8.25rem]">
          <button
            className="flex items-center gap-1.5 rounded-xl border border-set-border bg-set-panel/95 px-2.5 py-1.5 text-xs text-set-dim shadow-pop backdrop-blur hover:text-set-text"
            onClick={() => setLooseOpen((o) => !o)}
            title="Pages nothing links to yet"
          >
            <Link2Off size={13} /> Loose pages · {loose.length}
          </button>
          {looseOpen && (
            <div className="absolute bottom-full left-0 mb-1 w-60 overflow-hidden rounded-xl border border-set-border bg-set-panel shadow-pop">
              <div className="px-3 pt-2 pb-1 text-[10px] tracking-[0.15em] text-set-dim uppercase">
                Not linked to anything yet
              </div>
              {loose.map((n) => (
                <button
                  key={n.id}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-set-dim hover:bg-set-panel2 hover:text-set-text"
                  onClick={() => {
                    flyToNode(n.id);
                    setLooseOpen(false);
                  }}
                >
                  <span>{n.icon || '📄'}</span>
                  <span className="truncate">{n.title}</span>
                </button>
              ))}
              <p className="px-3 py-2 text-[10px] leading-relaxed text-set-dim opacity-80">
                Mention them with <code className="rounded bg-set-panel2 px-1 py-0.5">[[their title]]</code> anywhere
                to pull them into the map.
              </p>
            </div>
          )}
        </div>
      )}
      {/* growth playback bar (the corner play button opens it) */}
      {range && playhead != null && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-set-border bg-set-panel/95 px-3 py-2 shadow-pop backdrop-blur">
              <button
                className="rounded-full p-1 text-set-dim hover:text-set-text"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <input
                type="range"
                min={0}
                max={1000}
                value={Math.round(((playhead ?? range.t0) - range.t0) / Math.max(1, range.t1 - range.t0) * 1000)}
                onChange={(e) => {
                  setPlaying(false);
                  setPlayhead(range.t0 + ((range.t1 - range.t0) * Number(e.target.value)) / 1000);
                }}
                className="w-40 accent-[#8c8cff]"
                aria-label="Scrub through time"
              />
              <span className="w-36 text-center text-[11px] whitespace-nowrap text-set-dim">
                {revealedCount} pages ·{' '}
                {playhead != null
                  ? new Date(playhead).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  : ''}
              </span>
              <button
                className="rounded-full p-1 text-set-dim hover:text-set-text"
                onClick={() => {
                  setPlaying(false);
                  setPlayhead(null);
                }}
                aria-label="Back to today"
                title="Back to today"
              >
                <X size={14} />
              </button>
          </div>
        </div>
      )}
      {celebrate && (
        <div className="absolute bottom-[4.25rem] left-1/2 z-20 -translate-x-1/2">
          <div className="rounded-full border border-set-accent/40 bg-set-panel/95 px-3.5 py-1.5 text-xs text-set-text shadow-pop backdrop-blur">
            ✦ New neighborhood formed — <span className="font-medium">{celebrate.name}</span>
          </div>
        </div>
      )}
      <GraphCanvas
        data={data!}
        visibleIds={visibleIds}
        selectedId={selectedId}
        cliques={cliques}
        colorMode={colorMode}
        mastery={mastery}
        flyTo={flyTo}
        pinsKey={spaceId ? `set-graph-pins:${spaceId}` : undefined}
        resetSignal={resetSignal}
        reveal={playhead}
        pulseIds={playhead == null ? celebrate?.ids ?? pulseIds : []}
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
    </PullToRefresh>
  );
}
