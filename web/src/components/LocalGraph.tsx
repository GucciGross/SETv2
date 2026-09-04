import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import { api } from '../lib/api';
import type { GraphNode } from '../lib/graph/types';

/** The graph endpoint's raw shape — endpoints are ids until a sim mutates them. */
type RawGraph = { nodes: GraphNode[]; edges: { source: string; target: string }[] };

/**
 * Local graph — the "connection lens": a mini force-directed map of just this
 * page's neighborhood (depth-adjustable), rendered into the page side panel.
 * Layout settles synchronously; the canvas is crisp (charts are the dithered
 * ones), matching the main Graph view's vector look.
 */
export default function LocalGraph({ spaceId, pageId, onOpen }: { spaceId: string; pageId: string; onOpen: (id: string) => void }) {
  const [depth, setDepth] = useState(2);
  const [data, setData] = useState<RawGraph | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<{ pos: Map<string, { x: number; y: number }>; nodes: GraphNode[]; edges: { source: string; target: string }[] }>({ pos: new Map(), nodes: [], edges: [] });

  useEffect(() => {
    api.get(`/spaces/${spaceId}/graph`).then((r) => setData(r)).catch(() => setData({ nodes: [], edges: [] }));
  }, [spaceId]);

  // neighborhood within `depth` links of the current page
  const sub = useMemo(() => {
    if (!data) return null;
    const ids = new Set<string>([pageId]);
    let frontier = new Set<string>([pageId]);
    for (let d = 0; d < depth; d++) {
      const next = new Set<string>();
      for (const e of data.edges) {
        if (frontier.has(e.source) && !ids.has(e.target)) next.add(e.target);
        if (frontier.has(e.target) && !ids.has(e.source)) next.add(e.source);
      }
      next.forEach((id) => ids.add(id));
      if (next.size === 0) break;
      frontier = next;
    }
    const nodes = data.nodes.filter((n) => ids.has(n.id));
    const byId = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter((e) => byId.has(e.source) && byId.has(e.target));
    return { nodes, edges };
  }, [data, pageId, depth]);

  useEffect(() => {
    if (!sub || sub.nodes.length === 0) return;
    // degree within the neighborhood drives node size
    const deg = new Map<string, number>();
    for (const e of sub.edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    const width = wrapRef.current?.clientWidth || 232;
    const height = 190;
    const simNodes = sub.nodes.map((n) => ({ id: n.id, r: n.id === pageId ? 7 : 4 + Math.min((deg.get(n.id) ?? 0) * 1.3, 6) }));
    const simEdges = sub.edges.map((e) => ({ source: e.source, target: e.target }));
    const sim = forceSimulation(simNodes as any)
      .force('charge', forceManyBody().strength(-90))
      .force('link', forceLink(simEdges as any).id((d: any) => d.id).distance(34).strength(0.7))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide().radius((d: any) => d.r + 4))
      .stop();
    for (let i = 0; i < 220; i++) sim.tick();
    const pos = new Map<string, { x: number; y: number }>();
    for (const n of simNodes as any[]) pos.set(n.id, { x: n.x, y: n.y });
    // fit the settled layout into the canvas — a corner cluster with clipped
    // labels reads as broken. Extra bottom padding leaves room for labels.
    if (pos.size > 1) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pos.values()) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const padX = 34, padTop = 18, padBottom = 30;
      const scaleX = (width - padX * 2) / Math.max(maxX - minX, 1);
      const scaleY = (height - padTop - padBottom) / Math.max(maxY - minY, 1);
      const scale = Math.min(scaleX, scaleY, 1.8);
      const offX = (width - (maxX - minX) * scale) / 2 - minX * scale;
      const offY = padTop + (height - padTop - padBottom - (maxY - minY) * scale) / 2 - minY * scale;
      for (const [id2, p] of pos) pos.set(id2, { x: p.x * scale + offX, y: p.y * scale + offY });
    }
    layoutRef.current = { pos, nodes: sub.nodes, edges: sub.edges };
  }, [sub, pageId]);

  // paint (also on hover so highlights redraw)
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const width = wrap.clientWidth || 232;
    const height = 190;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const { pos, nodes, edges } = layoutRef.current;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const me = pos.get(pageId);
    const isDim = (id: string) => hoverId != null && hoverId !== id && hoverId !== pageId &&
      !edges.some((e) => (e.source === hoverId && e.target === id) || (e.target === hoverId && e.source === id));
    ctx.lineWidth = 1;
    for (const e of edges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      const touched = hoverId != null && (e.source === hoverId || e.target === hoverId);
      ctx.strokeStyle = touched ? 'rgba(125, 165, 255, 0.85)' : isDim(e.source) || isDim(e.target) ? 'rgba(120, 130, 160, 0.10)' : 'rgba(120, 140, 190, 0.35)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (touched) {
        ctx.fillStyle = 'rgba(125, 165, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 1.6, 0, Math.PI * 2);
        ctx.arc(a.x, a.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const n of nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const isMe = n.id === pageId;
      const dim = isDim(n.id);
      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.fillStyle = isMe ? '#7da5ff' : '#8b93b8';
      ctx.beginPath();
      ctx.arc(p.x, p.y, isMe ? 7 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      if (isMe) {
        ctx.strokeStyle = 'rgba(125, 165, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // labels: current page always; others on hover or when few. Alternate
    // above/below placement so neighbor labels don't stack on each other.
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const labelled = new Set<string>([pageId]);
    if (hoverId) labelled.add(hoverId);
    const labelCap = hoverId != null ? 8 : 6;
    if (nodes.length <= labelCap) nodes.forEach((n) => labelled.add(n.id));
    nodes.forEach((n, i) => {
      if (!labelled.has(n.id)) return;
      const p = pos.get(n.id);
      if (!p) return;
      const raw = byId.get(n.id)?.title || 'Untitled';
      const title = raw.length > 15 ? `${raw.slice(0, 14)}…` : raw;
      const isMe = n.id === pageId;
      ctx.fillStyle = isMe ? 'rgba(255,255,255,0.92)' : 'rgba(190, 198, 225, 0.78)';
      ctx.fillText(title, p.x, isMe || i % 2 === 0 ? p.y + 16 : p.y - 10);
    });
  }, [sub, hoverId, pageId, depth]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const [id, p] of layoutRef.current.pos) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 12 && (!best || d < best.d)) best = { id, d };
    }
    if (best && best.id !== pageId) onOpen(best.id);
  };

  const move = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let hit: string | null = null;
    for (const [id, p] of layoutRef.current.pos) {
      if (Math.hypot(p.x - x, p.y - y) < 12) { hit = id; break; }
    }
    setHoverId(hit);
  };

  if (!sub) return <p className="text-xs text-set-dim p-2">Mapping…</p>;
  if (sub.nodes.length <= 1) {
    return <p className="text-xs text-set-dim p-2 leading-relaxed">No connections yet. Add <code className="rounded bg-set-panel2 px-1">[[wiki links]]</code> and the neighborhood shows up here.</p>;
  }

  return (
    <div>
      <div ref={wrapRef} className="relative">
        <canvas
          ref={canvasRef}
          className="w-full cursor-pointer"
          style={{ height: 190 }}
          onClick={click}
          onMouseMove={move}
          onMouseLeave={() => setHoverId(null)}
        />
      </div>
      <div className="flex items-center gap-2 px-2 pb-1 text-[10px] text-set-dim">
        <span>depth</span>
        <input
          type="range"
          min={1}
          max={3}
          step={1}
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          className="flex-1 accent-blue-400 h-1"
        />
        <span className="tabular-nums">{sub.nodes.length} · {sub.edges.length}</span>
      </div>
    </div>
  );
}
