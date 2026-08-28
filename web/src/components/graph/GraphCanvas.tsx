import { useEffect, useRef } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from 'd3-force';
import { Viewport } from '../../lib/graph/viewport';
import type { GraphData, GraphEdge, GraphNode } from '../../lib/graph/types';

interface GraphCanvasProps {
  /** Full dataset — drives the simulation. */
  data: GraphData;
  /** Subset of node ids to draw and hit-test (the filter result). */
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
}

const radius = (n: GraphNode) => 5 + Math.min((n.deg ?? 0) * 1.4, 12);

/**
 * Force-directed knowledge graph on a canvas. The simulation runs on the full
 * node set and is created once per dataset — filtering only changes what gets
 * drawn, so typing in the filter box never rebuilds or re-heats the layout.
 */
export default function GraphCanvas({ data, visibleIds, selectedId, onSelect, onOpen }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<GraphNode, GraphEdge> | null>(null);
  const hoverRef = useRef<GraphNode | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const prevByIdRef = useRef<Map<string, GraphNode>>(new Map());

  // refs mirroring props so the main effect never needs to re-bind listeners
  const visibleRef = useRef(visibleIds);
  visibleRef.current = visibleIds;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    // carry positions (and pins) across refetches so live updates don't re-layout
    const prev = prevByIdRef.current;
    for (const n of data.nodes) {
      const old = prev.get(n.id);
      if (old) {
        n.x = old.x;
        n.y = old.y;
        n.fx = old.fx;
        n.fy = old.fy;
      }
    }
    prevByIdRef.current = new Map(data.nodes.map((n) => [n.id, n]));

    const centerForce = forceCenter<GraphNode>(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const sim = forceSimulation<GraphNode>(data.nodes)
      .force('charge', forceManyBody<GraphNode>().strength(-160))
      .force('link', forceLink<GraphNode, GraphEdge>(data.edges).id((d) => d.id).distance(90).strength(0.35))
      .force('center', centerForce)
      .force('collide', forceCollide<GraphNode>(20));
    simRef.current = sim;

    const draw = () => {
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      const { x, y, k } = viewport.transform;
      ctx.translate(x, y);
      ctx.scale(k, k);
      const vis = visibleRef.current;
      const hoverId = hoverRef.current?.id;
      const selectedIdNow = selectedRef.current;

      for (const e of data.edges) {
        const s = e.source as GraphNode;
        const t = e.target as GraphNode;
        if (typeof e.source === 'string' || typeof e.target === 'string') continue; // sim not started yet
        if (!vis.has(s.id) || !vis.has(t.id)) continue;
        const hl = hoverId === s.id || hoverId === t.id || selectedIdNow === s.id || selectedIdNow === t.id;
        ctx.strokeStyle = hl ? 'rgba(140,130,255,0.9)' : 'rgba(120,130,170,0.22)';
        ctx.lineWidth = hl ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }
      for (const n of data.nodes) {
        if (!vis.has(n.id) || n.x == null || n.y == null) continue;
        const r = radius(n);
        const hovered = hoverRef.current?.id === n.id;
        const selected = selectedIdNow === n.id;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.is_daily
          ? '#f0c060'
          : hovered || selected
            ? '#a5b8ff'
            : (n.deg ?? 0) > 0
              ? '#6c8cff'
              : '#8b93a5';
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = '#dee4f0';
          ctx.lineWidth = 1.5 / k;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4 / k, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.font = `${11 / k}px sans-serif`;
        ctx.fillStyle = hovered || selected ? '#ffffff' : '#c7cddc';
        ctx.textAlign = 'center';
        const label = (n.icon ? n.icon + ' ' : '') + n.title;
        const shown = label.length > 24 ? label.slice(0, 23) + '…' : label;
        ctx.fillText(shown, n.x, n.y + r + 12);
      }
      ctx.restore();
    };
    drawRef.current = draw;

    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      centerForce.x(canvas.clientWidth / 2);
      centerForce.y(canvas.clientHeight / 2);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const viewport = new Viewport<GraphNode>(canvas, {
      hitTest: (wx, wy) => {
        const k = viewport.transform.k;
        let best: GraphNode | null = null;
        let bestD = Infinity;
        for (const n of data.nodes) {
          if (!visibleRef.current.has(n.id) || n.x == null || n.y == null) continue;
          const d = Math.hypot(n.x - wx, n.y - wy);
          // generous minimum so taps land: ~20px on screen even when zoomed out
          const reach = Math.max(radius(n) + 4, 20 / k);
          if (d < reach && d < bestD) {
            best = n;
            bestD = d;
          }
        }
        return best;
      },
      onDragObject: (n, wx, wy) => {
        n.fx = wx;
        n.fy = wy;
        if (sim.alphaTarget() < 0.2) sim.alphaTarget(0.25).restart();
      },
      onDragEnd: (n) => {
        // keep fx/fy: the node stays pinned where it was dropped until the
        // next drag (positions survive refetches via the position cache)
        sim.alphaTarget(0);
      },
      onHover: (n) => {
        hoverRef.current = n;
        canvas.style.cursor = n ? 'pointer' : 'grab';
      },
      onClick: (n) => onSelectRef.current(n ? n.id : null),
      onDoubleClick: (n) => {
        if (n) onOpenRef.current(n.id);
      },
      onChange: () => draw(),
    });
    viewport.attach();

    sim.on('tick', draw);
    sim.alpha(0.9).restart();
    resize();
    // test hooks: let browser QA drive the sim and force redraws when the
    // tab's timers are throttled
    (canvas as any).__graphSim = sim;
    (canvas as any).__graphDraw = draw;
    (canvas as any).__graphNodes = data.nodes;

    return () => {
      sim.stop();
      observer.disconnect();
      viewport.detach();
      simRef.current = null;
      delete (canvas as any).__graphSim;
      delete (canvas as any).__graphDraw;
    };
  }, [data]);

  // redraw when the visible subset or selection changes — no sim work
  useEffect(() => {
    drawRef.current();
  }, [visibleIds, selectedId]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'none' }}
    />
  );
}
