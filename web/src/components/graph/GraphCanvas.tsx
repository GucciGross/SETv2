import { useEffect, useRef } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
} from 'd3-force';
import { Viewport, type EdgeHit } from '../../lib/graph/viewport';
import type { CliqueResult } from '../../lib/graph/cliques';
import { edgeIds, type GraphData, type GraphEdge, type GraphNode } from '../../lib/graph/types';

export type GraphColorMode = 'clique' | 'recency' | 'mastery' | 'off';

export interface FlyToRequest {
  /** Node ids to fit in view. */
  ids: string[];
  /** Bump to re-trigger a fly to the same ids. */
  nonce: number;
}

export type MasteryState = 'mastered' | 'learning' | 'decaying';

interface GraphCanvasProps {
  /** Full dataset — drives the simulation. */
  data: GraphData;
  /** Subset of node ids to draw and hit-test (the filter result). */
  visibleIds: Set<string>;
  selectedId: string | null;
  /** Community detection result — colors nodes in clique mode. */
  cliques: CliqueResult | null;
  colorMode: GraphColorMode;
  /** Per-page mastery (mastery color mode); absent page = untested. */
  mastery: Record<string, MasteryState> | null;
  /** When the nonce changes, the camera animates to fit these node ids. */
  flyTo: FlyToRequest | null;
  /** localStorage key for dragged-pin positions; undefined disables memory. */
  pinsKey?: string;
  /** Bump to unpin everything, reheat the layout and fly back out. */
  resetSignal: number;
  /** Growth playback: epoch-ms cutoff — pages born after this are hidden. null = show everything. */
  reveal: number | null;
  /** Node ids to ripple ("new since your last visit"); ripples run once for ~8s. */
  pulseIds: string[];
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
}

const radius = (n: GraphNode) => 5 + Math.min((n.deg ?? 0) * 1.4, 12);
const DAY = 86_400_000;
/** Camera flights never come closer than this — nose-against-glass zoom feels broken. */
const FLY_MAX_K = 2.2;
const MINI_W = 152;
const MINI_H = 104;

/** Freshness ramp for recency mode — brighter means fresher. */
function recencyFill(n: GraphNode): string | null {
  if (!n.updated_at) return null;
  const age = Date.now() - new Date(n.updated_at).getTime();
  if (age < DAY) return '#8affc1';
  if (age < 7 * DAY) return '#7ee2a8';
  if (age < 30 * DAY) return '#6c8cff';
  return null;
}

type PinMap = Record<string, [number, number]>;

function loadPins(key?: string): PinMap {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') ?? {};
  } catch {
    return {};
  }
}

function savePins(key: string | undefined, pins: PinMap) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(pins));
  } catch {
    /* private mode / full quota — pins just won't persist */
  }
}

/**
 * Force-directed knowledge graph on a canvas. The simulation runs on the full
 * node set and is created once per dataset — filtering only changes what gets
 * drawn, so typing in the filter box never rebuilds or re-heats the layout.
 */
export default function GraphCanvas({
  data,
  visibleIds,
  selectedId,
  cliques,
  colorMode,
  mastery,
  flyTo,
  pinsKey,
  resetSignal,
  reveal,
  pulseIds,
  onSelect,
  onOpen,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<GraphNode, GraphEdge> | null>(null);
  const viewportRef = useRef<Viewport<GraphNode> | null>(null);
  /** Hovered node + its neighbor set, for the focus-dimming effect. */
  const hoverRef = useRef<{ id: string; neighbors: Set<string> } | null>(null);
  /** Hovered edge (mouse only) — highlights the relationship + drives the tooltip. */
  const edgeHoverRef = useRef<EdgeHit<GraphNode> | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<() => void>(() => {});
  /** Camera flight starter, rebuilt with each dataset; used by flyTo and reset. */
  const flyFnRef = useRef<(ids: string[]) => void>(() => {});
  const prevByIdRef = useRef<Map<string, GraphNode>>(new Map());
  /** Minimap world mapping, refreshed on every draw so pointer handlers can use it. */
  const miniMapRef = useRef<{ minX: number; minY: number; scale: number } | null>(null);
  /** Active ripple state for the pulse rings (component-level: survives dataset swaps). */
  const pulseRef = useRef<{ ids: Set<string>; start: number; end: number } | null>(null);

  // refs mirroring props so the main effect never needs to re-bind listeners
  const visibleRef = useRef(visibleIds);
  visibleRef.current = visibleIds;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const cliquesRef = useRef(cliques);
  cliquesRef.current = cliques;
  const colorModeRef = useRef(colorMode);
  colorModeRef.current = colorMode;
  const masteryRef = useRef(mastery);
  masteryRef.current = mastery;
  const dataRef = useRef(data);
  dataRef.current = data;
  const pinsKeyRef = useRef(pinsKey);
  pinsKeyRef.current = pinsKey;
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
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
    // pins saved from earlier sessions win over the position cache
    const savedPins = loadPins(pinsKey);
    for (const n of data.nodes) {
      const p = savedPins[n.id];
      if (p) {
        n.fx = p[0];
        n.fy = p[1];
        if (n.x == null) {
          n.x = p[0];
          n.y = p[1];
        }
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

    const nodeFill = (n: GraphNode, hovered: boolean, selected: boolean): string => {
      if (hovered || selected) return '#a5b8ff';
      if (n.is_daily) return '#f0c060';
      const mode = colorModeRef.current;
      if (mode === 'clique') {
        const c = cliquesRef.current?.byNode.get(n.id);
        if (c) return `hsl(${c.hue} 70% 62%)`;
      } else if (mode === 'recency') {
        const fresh = recencyFill(n);
        if (fresh) return fresh;
      } else if (mode === 'mastery') {
        const state = masteryRef.current?.[n.id];
        if (state === 'mastered') return '#34d399';
        if (state === 'decaying') return '#fbbf24';
        if (state === 'learning') return '#60a5fa';
      }
      return (n.deg ?? 0) > 0 ? '#6c8cff' : '#8b93a5';
    };

    /** Growth playback: a page exists on the map only if it was born before the playhead. */
    const born = (n: GraphNode): boolean => {
      const cutoff = revealRef.current;
      if (cutoff == null) return true;
      if (!n.created_at) return true; // undated pages have always been here
      return new Date(n.created_at).getTime() <= cutoff;
    };

    /** The current visible world bounds — the minimap's frame. */
    const worldBounds = () => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of data.nodes) {
        if (!visibleRef.current.has(n.id) || !born(n) || n.x == null || n.y == null) continue;
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x > maxX) maxX = n.x;
        if (n.y > maxY) maxY = n.y;
      }
      if (!Number.isFinite(minX)) return null;
      return { minX, minY, maxX, maxY };
    };

    const drawMini = () => {
      const mini = miniRef.current;
      if (!mini) return;
      const mctx = mini.getContext('2d')!;
      const mdpr = Math.min(window.devicePixelRatio || 1, 2);
      const pw = mini.clientWidth, ph = mini.clientHeight;
      if (mini.width !== pw * mdpr) {
        mini.width = pw * mdpr;
        mini.height = ph * mdpr;
      }
      mctx.save();
      mctx.clearRect(0, 0, mini.width, mini.height);
      mctx.scale(mdpr, mdpr);
      const bounds = worldBounds();
      if (!bounds) {
        miniMapRef.current = null;
        mctx.restore();
        return;
      }
      const pad = 10;
      const bw = Math.max(1, bounds.maxX - bounds.minX);
      const bh = Math.max(1, bounds.maxY - bounds.minY);
      const scale = Math.min((pw - pad * 2) / bw, (ph - pad * 2) / bh);
      const offX = (pw - bw * scale) / 2;
      const offY = (ph - bh * scale) / 2;
      miniMapRef.current = { minX: bounds.minX, minY: bounds.minY, scale };
      const toMini = (wx: number, wy: number): [number, number] => [
        offX + (wx - bounds.minX) * scale,
        offY + (wy - bounds.minY) * scale,
      ];

      // the rectangle of the main viewport, in minimap coordinates
      const { x, y, k } = viewport.transform;
      const corner = toMini((-x) / k, (-y) / k);
      const corner2 = toMini((canvas.clientWidth - x) / k, (canvas.clientHeight - y) / k);
      mctx.fillStyle = 'rgba(140,130,255,0.10)';
      mctx.strokeStyle = 'rgba(160,150,255,0.55)';
      mctx.lineWidth = 1;
      const rx = Math.min(corner[0], corner2[0]), ry = Math.min(corner[1], corner2[1]);
      const rw = Math.abs(corner2[0] - corner[0]), rh = Math.abs(corner2[1] - corner[1]);
      mctx.beginPath();
      mctx.roundRect(rx, ry, rw, rh, 3);
      mctx.fill();
      mctx.stroke();

      for (const n of data.nodes) {
        if (!visibleRef.current.has(n.id) || !born(n) || n.x == null || n.y == null) continue;
        const [mx, my] = toMini(n.x, n.y);
        mctx.beginPath();
        mctx.arc(mx, my, 1.6 + Math.min((n.deg ?? 0) * 0.25, 1.8), 0, Math.PI * 2);
        mctx.fillStyle = selectedRef.current === n.id ? '#ffffff' : nodeFill(n, false, false);
        mctx.fill();
      }
      mctx.restore();
    };

    const draw = () => {
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      const { x, y, k } = viewport.transform;
      ctx.translate(x, y);
      ctx.scale(k, k);
      const vis = visibleRef.current;
      const hoverNode = hoverRef.current;
      const hEdge = edgeHoverRef.current;
      // focus = hovered node's neighborhood, or a hovered edge's two endpoints
      let focus = hoverNode;
      if (!focus && hEdge) focus = { id: hEdge.source.id, neighbors: new Set([hEdge.source.id, hEdge.target.id]) };
      const hoverId = focus?.id ?? null;
      const selectedIdNow = selectedRef.current;

      // edges: curved, with a directional arrowhead at the target. Hovering a
      // node focuses its neighborhood — everything else drops back.
      const arrow = 7 / k;
      const showArrows = k > 0.45;
      for (const e of data.edges) {
        const s = e.source as GraphNode;
        const t = e.target as GraphNode;
        if (typeof e.source === 'string' || typeof e.target === 'string') continue; // sim not started yet
        if (!vis.has(s.id) || !vis.has(t.id) || !born(s) || !born(t) || s.x == null || t.x == null) continue;
        const incident =
          hoverId === s.id ||
          hoverId === t.id ||
          selectedIdNow === s.id ||
          selectedIdNow === t.id ||
          (!!hEdge && ((s.id === hEdge.source.id && t.id === hEdge.target.id) || (s.id === hEdge.target.id && t.id === hEdge.source.id)));
        const dx = t.x! - s.x!;
        const dy = t.y! - s.y!;
        const dist = Math.hypot(dx, dy) || 1;

        let alpha: number;
        if (incident) alpha = 0.9;
        else if (focus) alpha = 0.06;
        else alpha = 0.22;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = incident ? 'rgba(140,130,255,0.9)' : 'rgba(120,130,170,1)';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = incident ? 1.6 : 0.8;

        // trim the ends so lines start on the circle rim, not behind it
        const ux = dx / dist;
        const uy = dy / dist;
        const sx = s.x! + ux * radius(s);
        const sy = s.y! + uy * radius(s);
        const tipShorten = showArrows ? radius(t) + arrow * 0.8 : radius(t);
        const txp = t.x! - ux * tipShorten;
        const typ = t.y! - uy * tipShorten;
        const bend = dist * 0.12;
        const cxp = (sx + txp) / 2 - uy * bend;
        const cyp = (sy + typ) / 2 + ux * bend;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(cxp, cyp, txp, typ);
        ctx.stroke();

        if (showArrows) {
          const ang = Math.atan2(typ - cyp, txp - cxp);
          ctx.beginPath();
          ctx.moveTo(txp, typ);
          ctx.lineTo(txp - arrow * Math.cos(ang - 0.42), typ - arrow * Math.sin(ang - 0.42));
          ctx.lineTo(txp - arrow * Math.cos(ang + 0.42), typ - arrow * Math.sin(ang + 0.42));
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      for (const n of data.nodes) {
        if (!vis.has(n.id) || !born(n) || n.x == null || n.y == null) continue;
        const r = radius(n);
        const hovered =
          hoverId === n.id || (!!hEdge && (n.id === hEdge.source.id || n.id === hEdge.target.id));
        const selected = selectedIdNow === n.id;
        const dimmed = focus !== null && !focus.neighbors.has(n.id) && !selected;
        ctx.globalAlpha = dimmed ? 0.18 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = nodeFill(n, hovered, selected);
        ctx.fill();
        if (selected) {
          ctx.strokeStyle = '#dee4f0';
          ctx.lineWidth = 1.5 / k;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4 / k, 0, Math.PI * 2);
          ctx.stroke();
        }

        // semantic zoom: at low magnification only label what matters
        const labeled = !dimmed && (k >= 0.7 || hovered || selected || (n.deg ?? 0) >= 4 || n.is_daily);
        if (labeled) {
          ctx.font = `${11 / k}px sans-serif`;
          ctx.fillStyle = hovered || selected ? '#ffffff' : '#c7cddc';
          ctx.textAlign = 'center';
          const label = (n.icon ? n.icon + ' ' : '') + n.title;
          const shown = label.length > 24 ? label.slice(0, 23) + '…' : label;
          ctx.fillText(shown, n.x, n.y + r + 12);
        }
      }
      ctx.globalAlpha = 1;

      // "new since your last visit" ripples: soft rings radiating from each
      // fresh page, staggered so they arrive like a wave
      const pulse = pulseRef.current;
      if (pulse && pulse.ids.size > 0) {
        const now = performance.now();
        if (now < pulse.end) {
          for (const n of data.nodes) {
            if (!pulse.ids.has(n.id) || !vis.has(n.id) || !born(n) || n.x == null || n.y == null) continue;
            const phase = ((now - pulse.start) / 1300 + (n.x + n.y) * 0.0009) % 1;
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius(n) + 3 + phase * 15, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(138,255,193,${(1 - phase) * 0.6})`;
            ctx.lineWidth = 2 / k;
            ctx.stroke();
          }
        }
      }
      ctx.restore();
      drawMini();
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
          if (!visibleRef.current.has(n.id) || !born(n) || n.x == null || n.y == null) continue;
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
      /** The edge under a world point: bbox prefilter, then sample the curve. */
      hitEdgeTest: (wx, wy) => {
        const k = viewport.transform.k;
        const reach = 6 / k;
        const vis = visibleRef.current;
        for (const e of data.edges) {
          const s = e.source as GraphNode;
          const t = e.target as GraphNode;
          if (typeof e.source === 'string' || typeof e.target === 'string') continue;
          if (!vis.has(s.id) || !vis.has(t.id) || !born(s) || !born(t)) continue;
          if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
          if (wx < Math.min(s.x, t.x) - 24 || wx > Math.max(s.x, t.x) + 24) continue;
          if (wy < Math.min(s.y, t.y) - 24 || wy > Math.max(s.y, t.y) + 24) continue;
          const dx = t.x! - s.x!;
          const dy = t.y! - s.y!;
          const dist = Math.hypot(dx, dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          const sx = s.x! + ux * radius(s);
          const sy = s.y! + uy * radius(s);
          const txp = t.x! - ux * radius(t);
          const typ = t.y! - uy * radius(t);
          const bend = dist * 0.12;
          const cxp = (sx + txp) / 2 - uy * bend;
          const cyp = (sy + typ) / 2 + ux * bend;
          for (let i = 0; i <= 14; i++) {
            const u = i / 14;
            const px = (1 - u) * (1 - u) * sx + 2 * u * (1 - u) * cxp + u * u * txp;
            const py = (1 - u) * (1 - u) * sy + 2 * u * (1 - u) * cyp + u * u * typ;
            if (Math.hypot(px - wx, py - wy) < reach) return { source: s, target: t };
          }
        }
        return null;
      },
      onDragObject: (n, wx, wy) => {
        n.fx = wx;
        n.fy = wy;
        if (sim.alphaTarget() < 0.2) sim.alphaTarget(0.25).restart();
      },
      onDragEnd: (n) => {
        // the node stays pinned where it was dropped — and the pin survives
        // reloads, so a hand-arranged map stays arranged
        if (n.fx != null && n.fy != null) {
          const pins = loadPins(pinsKeyRef.current);
          pins[n.id] = [n.fx, n.fy];
          savePins(pinsKeyRef.current, pins);
        }
        sim.alphaTarget(0);
      },
      onHover: (n) => {
        if (n) {
          const neighbors = new Set<string>([n.id]);
          for (const e of dataRef.current.edges) {
            const [s, t] = edgeIds(e);
            if (s === n.id) neighbors.add(t);
            else if (t === n.id) neighbors.add(s);
          }
          hoverRef.current = { id: n.id, neighbors };
        } else {
          hoverRef.current = null;
        }
        canvas.style.cursor = n ? 'pointer' : 'grab';
      },
      onEdgeHover: (hit, clientX, clientY) => {
        edgeHoverRef.current = hit;
        const tip = tooltipRef.current;
        if (tip) {
          if (hit) {
            const rect = canvas.getBoundingClientRect();
            const clip = (s: string) => (s.length > 24 ? s.slice(0, 23) + '…' : s);
            tip.textContent = `${clip(hit.source.title)} → ${clip(hit.target.title)}`;
            tip.style.display = 'block';
            tip.style.left = `${clientX - rect.left + 14}px`;
            tip.style.top = `${clientY - rect.top + 12}px`;
          } else {
            tip.style.display = 'none';
          }
        }
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      },
      onClick: (n) => onSelectRef.current(n ? n.id : null),
      onDoubleClick: (n) => {
        if (n) onOpenRef.current(n.id);
      },
      onChange: () => draw(),
    });
    viewport.attach();
    viewportRef.current = viewport;

    // minimap: click or drag to move the main camera there
    const mini = miniRef.current;
    let miniDragging = false;
    const miniToCenter = (clientX: number, clientY: number) => {
      const mm = miniMapRef.current;
      if (!mm) return;
      const rect = mini!.getBoundingClientRect();
      // reconstruct the same letterboxed mapping drawMini used
      const bounds = worldBounds();
      if (!bounds) return;
      const pad = 10;
      const bw = Math.max(1, bounds.maxX - bounds.minX);
      const bh = Math.max(1, bounds.maxY - bounds.minY);
      const scale = Math.min((MINI_W - pad * 2) / bw, (MINI_H - pad * 2) / bh);
      const offX = (MINI_W - bw * scale) / 2;
      const offY = (MINI_H - bh * scale) / 2;
      const cx = bounds.minX + (clientX - rect.left - offX) / scale;
      const cy = bounds.minY + (clientY - rect.top - offY) / scale;
      const k = viewport.transform.k;
      viewport.transform.x = canvas.clientWidth / 2 - cx * k;
      viewport.transform.y = canvas.clientHeight / 2 - cy * k;
      draw();
    };
    const onMiniDown = (e: PointerEvent) => {
      miniDragging = true;
      try {
        mini!.setPointerCapture(e.pointerId);
      } catch {
        /* released */
      }
      miniToCenter(e.clientX, e.clientY);
    };
    const onMiniMove = (e: PointerEvent) => {
      if (miniDragging) miniToCenter(e.clientX, e.clientY);
    };
    const onMiniUp = () => {
      miniDragging = false;
    };
    mini?.addEventListener('pointerdown', onMiniDown);
    mini?.addEventListener('pointermove', onMiniMove);
    mini?.addEventListener('pointerup', onMiniUp);
    mini?.addEventListener('pointercancel', onMiniUp);

    // camera flight starter: animate the transform to fit the given nodes.
    // Rebuilt here because it closes over the current dataset and viewport.
    let flightRaf = 0;
    const flyToIds = (ids: string[]) => {
      const pts = data.nodes.filter((n) => ids.includes(n.id) && n.x != null && n.y != null);
      if (pts.length === 0) return;
      const bounds = {
        minX: Math.min(...pts.map((n) => n.x!)),
        maxX: Math.max(...pts.map((n) => n.x!)),
        minY: Math.min(...pts.map((n) => n.y!)),
        maxY: Math.max(...pts.map((n) => n.y!)),
      };
      const start = { ...viewport.transform };
      viewport.fit(bounds); // reuse fit's math, then treat its result as the target
      if (viewport.transform.k > FLY_MAX_K) {
        // fit() clamps at MAX_K; for small targets land at a reading-friendly zoom
        const rect = canvas.getBoundingClientRect();
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        viewport.transform.k = FLY_MAX_K;
        viewport.transform.x = rect.width / 2 - cx * FLY_MAX_K;
        viewport.transform.y = rect.height / 2 - cy * FLY_MAX_K;
      }
      const target = { ...viewport.transform };
      Object.assign(viewport.transform, start);
      const t0 = performance.now();
      const dur = 550;
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      cancelAnimationFrame(flightRaf);
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = ease(p);
        viewport.transform.x = start.x + (target.x - start.x) * e;
        viewport.transform.y = start.y + (target.y - start.y) * e;
        viewport.transform.k = start.k + (target.k - start.k) * e;
        draw();
        if (p < 1) flightRaf = requestAnimationFrame(step);
      };
      flightRaf = requestAnimationFrame(step);
    };
    flyFnRef.current = flyToIds;

    sim.on('tick', draw);
    sim.alpha(0.9).restart();
    resize();
    // test hooks: let browser QA drive the sim and force redraws when the
    // tab's timers are throttled
    (canvas as any).__graphSim = sim;
    (canvas as any).__graphDraw = draw;
    (canvas as any).__graphNodes = data.nodes;
    (canvas as any).__graphFly = flyToIds;
    (canvas as any).__graphViewport = viewport;

    return () => {
      sim.stop();
      observer.disconnect();
      viewport.detach();
      mini?.removeEventListener('pointerdown', onMiniDown);
      mini?.removeEventListener('pointermove', onMiniMove);
      mini?.removeEventListener('pointerup', onMiniUp);
      mini?.removeEventListener('pointercancel', onMiniUp);
      cancelAnimationFrame(flightRaf);
      simRef.current = null;
      viewportRef.current = null;
      delete (canvas as any).__graphSim;
      delete (canvas as any).__graphDraw;
      delete (canvas as any).__graphNodes;
      delete (canvas as any).__graphFly;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // redraw when any purely-visual input changes — no sim work. `reveal` rides
  // along so the playback (which fires while the sim is asleep) redraws live.
  useEffect(() => {
    drawRef.current();
  }, [visibleIds, selectedId, colorMode, cliques, mastery, reveal]);

  // external camera requests (search pick, clique legend, fit button)
  const flyNonce = flyTo?.nonce ?? 0;
  useEffect(() => {
    if (flyTo) flyFnRef.current(flyTo.ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyNonce]);

  // reset layout: forget pins, reheat, and fly back out so the reshuffle is visible
  const resetSeen = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === resetSeen.current) return;
    resetSeen.current = resetSignal;
    try {
      if (pinsKey) localStorage.removeItem(pinsKey);
    } catch {
      /* ignore */
    }
    for (const n of dataRef.current.nodes) {
      n.fx = undefined;
      n.fy = undefined;
    }
    const sim = simRef.current;
    if (sim) sim.alpha(1).restart();
    const all = dataRef.current.nodes.map((n) => n.id);
    window.setTimeout(() => flyFnRef.current(all), 900); // once the layout has spread again
  }, [resetSignal, pinsKey]);

  // drive the ripple animation with its own rAF heartbeat — the sim's tick
  // loop is asleep once the layout settles, so nothing else would redraw
  const pulseKey = pulseIds.join(',');
  useEffect(() => {
    if (!pulseIds.length) return;
    const start = performance.now();
    pulseRef.current = { ids: new Set(pulseIds), start, end: start + 8000 };
    let raf = 0;
    const loop = () => {
      drawRef.current();
      if (pulseRef.current && performance.now() < pulseRef.current.end) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const stop = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      pulseRef.current = null;
      drawRef.current();
    }, 8200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(stop);
      pulseRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseKey]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
      />
      <canvas
        ref={miniRef}
        className="absolute bottom-3 left-3 z-10 hidden cursor-pointer rounded-xl border border-set-border bg-set-panel/85 shadow-pop md:block"
        style={{ width: MINI_W, height: MINI_H, touchAction: 'none' }}
        title="Map — click to jump"
      />
      {/* relationship tooltip — positioned imperatively on edge hover */}
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-20 max-w-72 truncate rounded-lg border border-set-border bg-set-panel px-2 py-1 text-[11px] text-set-text shadow-pop"
        style={{ display: 'none' }}
      />
    </>
  );
}
