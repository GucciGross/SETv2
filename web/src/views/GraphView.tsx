import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, type Simulation } from 'd3-force';
import { api } from '../lib/api';

/** Knowledge graph: force-directed canvas with pan/zoom, hover & click. */
interface GNode {
  id: string;
  title: string;
  icon: string | null;
  is_daily?: boolean;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  deg?: number;
}
interface GEdge { source: string | GNode; target: string | GNode }

export default function GraphView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<GNode, GEdge> | null>(null);
  const [data, setData] = useState<{ nodes: GNode[]; edges: GEdge[] } | null>(null);
  const [filter, setFilter] = useState('');
  // hover is display-only; kept in a ref so hovering doesn't rebuild the
  // simulation (that re-centered the graph on every mouse move and broke panning)
  const hoverRef = useRef<GNode | null>(null);
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ node?: GNode; panning?: boolean; lastX: number; lastY: number }>({ lastX: 0, lastY: 0 });

  useEffect(() => {
    if (!spaceId) return;
    api.get(`/spaces/${spaceId}/graph`).then((r) => {
      const deg: Record<string, number> = {};
      for (const e of r.edges) {
        deg[e.source] = (deg[e.source] ?? 0) + 1;
        deg[e.target] = (deg[e.target] ?? 0) + 1;
      }
      r.nodes.forEach((n: GNode) => (n.deg = deg[n.id] ?? 0));
      setData({ nodes: r.nodes, edges: r.edges });
    });
  }, [spaceId]);

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!filter.trim()) return data;
    const q = filter.toLowerCase();
    const keep = new Set(data.nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id));
    // include 1-hop neighborhood
    for (const e of data.edges) {
      const s = typeof e.source === 'string' ? e.source : e.source.id;
      const t = typeof e.target === 'string' ? e.target : e.target.id;
      if (keep.has(s)) keep.add(t);
      else if (keep.has(t)) keep.add(s);
    }
    return { nodes: data.nodes.filter((n) => keep.has(n.id)), edges: data.edges.filter((e) => keep.has(typeof e.source === 'string' ? e.source : e.source.id) && keep.has(typeof e.target === 'string' ? e.target : e.target.id)) };
  }, [data, filter]);

  useEffect(() => {
    if (!filtered || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    window.addEventListener('resize', resize);

    const nodes = filtered.nodes;
    const edges = filtered.edges;
    const sim = forceSimulation<GNode>(nodes)
      .force('charge', forceManyBody<GNode>().strength(-160))
      .force(
        'link',
        forceLink<GNode, GEdge>(edges).id((d) => d.id).distance(90).strength(0.35)
      )
      .force('center', forceCenter(canvas.clientWidth / 2, canvas.clientHeight / 2))
      .force('collide', forceCollide<GNode>(20));
    simRef.current = sim;

    const radius = (n: GNode) => 5 + Math.min((n.deg ?? 0) * 1.4, 12);

    const draw = () => {
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      const { x, y, k } = viewRef.current;
      ctx.translate(x, y);
      ctx.scale(k, k);

      for (const e of edges) {
        const s = e.source as GNode;
        const t = e.target as GNode;
        const hl = hoverRef.current && (hoverRef.current.id === s.id || hoverRef.current.id === t.id);
        ctx.strokeStyle = hl ? 'rgba(140,130,255,0.9)' : 'rgba(120,130,170,0.22)';
        ctx.lineWidth = hl ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }
      for (const n of nodes) {
        const r = radius(n);
        const hl = hoverRef.current?.id === n.id;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx.fillStyle = n.is_daily ? '#f0c060' : hl ? '#a5b8ff' : (n.deg ?? 0) > 0 ? '#6c8cff' : '#8b93a5';
        ctx.fill();
        ctx.font = `${11 / viewRef.current.k}px sans-serif`;
        ctx.fillStyle = hl ? '#ffffff' : '#c7cddc';
        ctx.textAlign = 'center';
        const label = (n.icon ? n.icon + ' ' : '') + n.title;
        const shown = label.length > 24 ? label.slice(0, 23) + '…' : label;
        ctx.fillText(shown, n.x!, n.y! + r + 12);
      }
      ctx.restore();
    };
    sim.on('tick', draw);
    sim.alpha(0.9).restart();
    draw();

    const toWorld = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      const { x, y, k } = viewRef.current;
      return { x: (cx - rect.left - x) / k, y: (cy - rect.top - y) / k };
    };
    const pick = (cx: number, cy: number): GNode | null => {
      const w = toWorld(cx, cy);
      for (const n of nodes) {
        if (Math.hypot(n.x! - w.x, n.y! - w.y) < 14) return n;
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const node = pick(e.clientX, e.clientY);
      dragRef.current = { node: node ?? undefined, panning: !node, lastX: e.clientX, lastY: e.clientY };
      if (node) {
        sim.alphaTarget(0.25).restart();
        node.vx = 0;
        node.vy = 0;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (dragRef.current.node) {
        const w = toWorld(e.clientX, e.clientY);
        const n = dragRef.current.node;
        n.x = w.x;
        n.y = w.y;
      } else if (dragRef.current.panning) {
        viewRef.current.x += e.clientX - dragRef.current.lastX;
        viewRef.current.y += e.clientY - dragRef.current.lastY;
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
        draw();
      } else {
        hoverRef.current = pick(e.clientX, e.clientY);
        draw();
      }
    };
    const onUp = () => {
      if (dragRef.current.node) sim.alphaTarget(0);
      dragRef.current = { lastX: 0, lastY: 0 };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = Math.min(4, Math.max(0.25, viewRef.current.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      viewRef.current.k = k;
      draw();
    };
    const onDblClick = (e: MouseEvent) => {
      const node = pick(e.clientX, e.clientY);
      if (node && spaceId) navigate(`/app/space/${spaceId}/page/${node.id}`);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);

    return () => {
      sim.stop();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDblClick);
    };
  }, [filtered, spaceId, navigate]);

  if (!filtered) return <div className="p-8 text-set-dim">Loading graph…</div>;

  return (
    <div className="h-full relative">
      <div className="absolute top-3 left-3 z-10 flex gap-2">
        <input className="set-input w-56" placeholder="Filter pages…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="text-xs text-set-dim self-center bg-set-panel border border-set-border rounded-lg px-2 py-1">
          {filtered.nodes.length} pages · {filtered.edges.length} links · drag nodes, scroll to zoom, double-click to open
        </span>
      </div>
      <canvas ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing" style={{ touchAction: 'none' }} />
    </div>
  );
}
