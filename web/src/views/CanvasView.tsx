import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../stores/app';
import { Plus } from 'lucide-react';

/**
 * Canvas UI experiment: an infinite pannable/zoomable surface where pages are
 * draggable cards and wiki-links render as edges — a spatial view over the vault.
 */
interface CNode {
  id: string;
  title: string;
  icon: string | null;
  x: number;
  y: number;
}
interface CEdge { source: string; target: string }

export default function CanvasView() {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { createPage } = useApp();
  const [nodes, setNodes] = useState<CNode[]>([]);
  const [edges, setEdges] = useState<CEdge[]>([]);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ node?: CNode; panning?: boolean; lastX: number; lastY: number }>({ lastX: 0, lastY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!spaceId) return;
    Promise.all([api.get(`/spaces/${spaceId}/graph`)]).then(([g]) => {
      // deterministic spiral layout
      const placed: CNode[] = g.nodes.map((n: any, i: number) => {
        const a = i * 2.399963; // golden angle
        const r = 90 * Math.sqrt(i + 0.5);
        return { id: n.id, title: n.title, icon: n.icon, x: Math.cos(a) * r, y: Math.sin(a) * r };
      });
      setNodes(placed);
      setEdges(g.edges);
    });
  }, [spaceId]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const saveNode = (n: CNode) => {
    // positions are ephemeral in v1 (localStorage per space)
    const key = `set_canvas_${spaceId}`;
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    stored[n.id] = { x: n.x, y: n.y };
    localStorage.setItem(key, JSON.stringify(stored));
  };

  useEffect(() => {
    if (!spaceId) return;
    const stored = JSON.parse(localStorage.getItem(`set_canvas_${spaceId}`) ?? '{}');
    setNodes((ns) => ns.map((n) => (stored[n.id] ? { ...n, ...stored[n.id] } : n)));
  }, [spaceId]);

  const onPointerDown = (e: React.PointerEvent, node?: CNode) => {
    // capture on the container: capture on e.target could grab a child card
    // or text node and route moves away from the pan handlers
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { node, panning: !node, lastX: e.clientX, lastY: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d.node) {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === d.node!.id ? { ...n, x: n.x + (e.clientX - d.lastX) / view.k, y: n.y + (e.clientY - d.lastY) / view.k } : n
        )
      );
      d.lastX = e.clientX;
      d.lastY = e.clientY;
    } else if (d.panning) {
      setView((v) => ({ ...v, x: v.x + e.clientX - d.lastX, y: v.y + e.clientY - d.lastY }));
      d.lastX = e.clientX;
      d.lastY = e.clientY;
    }
  };
  const onPointerUp = () => {
    if (dragRef.current.node) saveNode(dragRef.current.node);
    dragRef.current = { lastX: 0, lastY: 0 };
  };

  // non-passive wheel so the page's scroll container can't swallow zoom gestures
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.08 : 0.93))) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full relative overflow-hidden bg-[radial-gradient(circle_at_1px_1px,#1c2130_1px,transparent_0)] [background-size:24px_24px] cursor-grab active:cursor-grabbing touch-none"
      style={{ backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={(e) => onPointerDown(e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="absolute inset-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0' }}>
        <svg className="absolute inset-0 overflow-visible pointer-events-none" width="100%" height="100%">
          {edges.map((e, i) => {
            const s = byId.get(e.source);
            const t = byId.get(e.target);
            if (!s || !t) return null;
            const mx = (s.x + t.x) / 2 + 40;
            const my = (s.y + t.y) / 2 - 30;
            return (
              <path
                key={i}
                d={`M ${s.x + 90} ${s.y + 24} Q ${mx} ${my} ${t.x + 90} ${t.y + 24}`}
                fill="none"
                stroke="rgba(120,130,170,0.35)"
                strokeWidth={1.5}
              />
            );
          })}
        </svg>
        {nodes.map((n) => (
          <div
            key={n.id}
            className="absolute w-44 set-card p-2.5 cursor-pointer hover:border-set-accent/50 select-none"
            style={{ left: n.x, top: n.y }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e, n);
            }}
            onDoubleClick={() => navigate(`/app/space/${spaceId}/page/${n.id}`)}
          >
            <div className="text-sm text-white truncate">{n.icon ?? ''} {n.title}</div>
          </div>
        ))}
      </div>

      <div className="absolute top-3 left-3 flex items-center gap-2">
        <span className="text-xs text-set-dim bg-set-panel/90 border border-set-border rounded-lg px-2 py-1">
           Canvas (experimental) · drag cards, pan background, scroll to zoom · double-click a card to open
        </span>
        <button
          className="set-btn text-xs flex items-center gap-1"
          onClick={async () => {
            const p = await createPage({ spaceId: spaceId!, title: 'Canvas note' });
            setNodes((ns) => [...ns, { id: p.id, title: p.title, icon: p.icon, x: -view.x / view.k + 100, y: -view.y / view.k + 100 }]);
          }}
        >
          <Plus size={12} /> Add card
        </button>
      </div>
      <div className="absolute bottom-3 left-3 text-xs text-set-dim bg-set-panel/80 rounded px-2 py-1 border border-set-border">
        {nodes.length} cards · {edges.length} links · zoom {Math.round(view.k * 100)}%
      </div>
    </div>
  );
}
