import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BookOpen, Brain, Network, Database, Terminal, Bot, Boxes, PenLine, GraduationCap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Floating glass tiles for the login gate — isocons-style 3D slabs (dark
 * glass, extruded edge, one small accent tick) carrying SET's surfaces.
 *
 * They glide in from outside the viewport on a damped spring to their home
 * spot, then they're yours: grab one and smack it — ice physics (momentum,
 * soft wall bounces, tile-to-tile collisions) take over and it drifts to a
 * stop wherever it lands. One rAF loop drives every tile, transforms only.
 */

type IconDef = {
  glyph: LucideIcon;
  label: string;
  /** Home position as a fraction of the layer (layer = full page). */
  home: { x: number; y: number };
  /** Phone override — the tall form card hides the sides, so tiles move up. */
  compactHome?: { x: number; y: number };
  accent: string;
  /** Static z-rotation, so the field doesn't look stamped. */
  rz: number;
  desktopOnly?: boolean;
};

const ICONS: IconDef[] = [
  { glyph: Brain, label: 'Copilot', home: { x: 0.1, y: 0.16 }, compactHome: { x: 0.14, y: 0.13 }, accent: '#8b5cf6', rz: -5 },
  { glyph: BookOpen, label: 'Notebooks', home: { x: 0.87, y: 0.14 }, compactHome: { x: 0.86, y: 0.115 }, accent: '#6c8cff', rz: 4 },
  { glyph: Terminal, label: 'Terminal', home: { x: 0.89, y: 0.44 }, compactHome: { x: 0.91, y: 0.42 }, accent: '#fbbf24', rz: -4 },
  { glyph: Database, label: 'Postgres', home: { x: 0.1, y: 0.56 }, compactHome: { x: 0.09, y: 0.42 }, accent: '#6c8cff', rz: 5 },
  { glyph: Bot, label: 'Agent', home: { x: 0.87, y: 0.78 }, compactHome: { x: 0.9, y: 0.94 }, accent: '#f472b6', rz: -3 },
  { glyph: GraduationCap, label: 'Learning paths', home: { x: 0.12, y: 0.85 }, compactHome: { x: 0.1, y: 0.94 }, accent: '#34d399', rz: 3 },
  { glyph: Network, label: 'Knowledge graph', home: { x: 0.3, y: 0.3 }, accent: '#34d399', rz: -2, desktopOnly: true },
  { glyph: Boxes, label: '3D & CAD', home: { x: 0.71, y: 0.29 }, accent: '#8b5cf6', rz: 2, desktopOnly: true },
  { glyph: PenLine, label: 'Editor', home: { x: 0.27, y: 0.88 }, accent: '#fbbf24', rz: -3, desktopOnly: true },
  { glyph: Terminal, label: 'Coding', home: { x: 0.74, y: 0.89 }, accent: '#6c8cff', rz: 4, desktopOnly: true },
];

type Body = {
  def: IconDef;
  el: HTMLElement;
  s: number; // tile size (px)
  r: number; // collision radius
  x: number; y: number; // center, layer-relative
  vx: number; vy: number;
  hx: number; hy: number; // home center
  grabbed: boolean;
  spring: boolean; // glide-to-home force; off forever after first grab
  everGrabbed: boolean;
  activatedAt: number; // entrance stagger
  phase: number; // idle bob phase
  scale: number; rx: number; ry: number; // eased render state
  gv: { x: number; y: number }; // smoothed grab velocity (px per pointer event)
  // touch direction lock: decide per gesture whether the finger drags the
  // tile or scrolls the page. Mouse never scrolls — it always drags.
  mode: 'undecided' | 'drag' | 'scroll';
  pdX: number; pdY: number; // pointer position at down (layer coords)
  plX: number; plY: number; // pointer position at last move
  sVel: number; // smoothed scroll velocity in scroll mode (pointer dy/event)
};

// physics tuning (units: px per 60fps frame)
const SPRING_K = 0.013;
const SPRING_DAMP = 0.9;
const ICE_DAMP = 0.988; // the ice
const WALL_BOUNCE = 0.72;
const HIT_BOUNCE = 0.85;
const MAX_V = 52;
const STOP_V = 0.045;
const BASE_RX = 13; // resting 3D tilt
const BASE_RY = -11;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export default function FloatingIcons() {
  const layerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const defs = ICONS.filter((d) => !(d.desktopOnly && compact));
  const S = compact ? 50 : 62;

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tiles = Array.from(layer.querySelectorAll<HTMLElement>('[data-tile]'));
    let W = layer.clientWidth;
    let H = layer.clientHeight;

    const bodies: Body[] = tiles.map((el, i) => {
      const def = defs[i];
      const homeFrac = compact && def.compactHome ? def.compactHome : def.home;
      const b: Body = {
        def, el, s: S, r: S * 0.58,
        x: 0, y: 0, vx: 0, vy: 0,
        hx: homeFrac.x * W, hy: homeFrac.y * H,
        grabbed: false,
        spring: !reduced, // reduced motion: already at home, no glide-in
        everGrabbed: false,
        activatedAt: performance.now() + 350 + i * 110,
        phase: i * 1.7,
        scale: 1, rx: 0, ry: 0,
        gv: { x: 0, y: 0 },
        mode: 'undecided',
        pdX: 0, pdY: 0, plX: 0, plY: 0,
        sVel: 0,
      };
      if (reduced) {
        b.x = b.hx; b.y = b.hy;
      } else {
        // start outside the visible area, on a random bearing from home
        const ang = (i * 2.399) % (Math.PI * 2); // golden-angle spread
        const dist = Math.hypot(W, H) * 0.55 + 140;
        b.x = b.hx + Math.cos(ang) * dist;
        b.y = b.hy + Math.sin(ang) * dist;
      }
      return b;
    });

    const onResize = () => {
      W = layer.clientWidth;
      H = layer.clientHeight;
      for (const b of bodies) {
        const hf = compact && b.def.compactHome ? b.def.compactHome : b.def.home;
        b.hx = hf.x * W;
        b.hy = hf.y * H;
        b.x = clamp(b.x, b.r, W - b.r);
        b.y = clamp(b.y, b.r, H - b.r);
      }
    };
    window.addEventListener('resize', onResize);

    const layerRect = () => layer.getBoundingClientRect();
    // Touch gestures that start on a tile and read as vertical swipes scroll
    // this container by hand (touch-action is none, so the browser never
    // scrolls for us — that's what keeps tile flings from moving the page).
    const scroller = layer.parentElement;
    const canScroll = !!scroller && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY);
    let scrollMom = 0; // px/frame handed to the loop on release

    const onDown = (b: Body) => (e: PointerEvent) => {
      if (b.grabbed) return;
      e.preventDefault();
      b.el.setPointerCapture(e.pointerId);
      b.grabbed = true;
      b.spring = false;
      b.everGrabbed = true;
      b.gv.x = 0; b.gv.y = 0;
      scrollMom = 0; // a new touch cancels scroll momentum
      b.mode = e.pointerType === 'touch' && canScroll ? 'undecided' : 'drag';
      const rect = layerRect();
      b.pdX = b.plX = e.clientX - rect.left;
      b.pdY = b.plY = e.clientY - rect.top;
      b.el.classList.add('icon-grabbed');
    };
    const onMove = (b: Body) => (e: PointerEvent) => {
      if (!b.grabbed) return;
      const rect = layerRect();
      const tx = e.clientX - rect.left;
      const ty = e.clientY - rect.top;

      // hold still until the gesture declares itself, then lock the direction
      if (b.mode === 'undecided') {
        const dx = tx - b.pdX, dy = ty - b.pdY;
        if (Math.hypot(dx, dy) < 10) return;
        b.mode = Math.abs(dy) > Math.abs(dx) * 1.8 ? 'scroll' : 'drag';
        if (b.mode === 'scroll') {
          b.el.classList.remove('icon-grabbed'); // it was never really grabbed
          b.sVel = 0;
          b.plX = tx; b.plY = ty;
          return;
        }
      }
      if (b.mode === 'scroll') {
        const dy = ty - b.plY;
        scroller!.scrollTop -= dy;
        b.sVel = b.sVel * 0.65 + dy * 0.35;
        b.plX = tx; b.plY = ty;
        return;
      }

      const nx = b.x + (tx - b.x) * 0.5; // smooth follow — the tile has weight
      const ny = b.y + (ty - b.y) * 0.5;
      b.gv.x = b.gv.x * 0.55 + (nx - b.x) * 0.45;
      b.gv.y = b.gv.y * 0.55 + (ny - b.y) * 0.45;
      b.x = nx; b.y = ny;
    };
    const onUp = (b: Body) => () => {
      if (!b.grabbed) return;
      b.grabbed = false;
      b.el.classList.remove('icon-grabbed');
      if (b.mode === 'scroll') {
        scrollMom = clamp(-b.sVel, -55, 55); // fling the scroll, not the tile
      } else {
        b.vx = clamp(b.gv.x, -MAX_V, MAX_V);
        b.vy = clamp(b.gv.y, -MAX_V, MAX_V);
      }
      b.gv.x = 0; b.gv.y = 0;
      b.sVel = 0;
      b.mode = 'undecided';
    };

    const cleanups = bodies.map((b) => {
      const down = onDown(b), move = onMove(b), up = onUp(b);
      b.el.addEventListener('pointerdown', down);
      b.el.addEventListener('pointermove', move);
      b.el.addEventListener('pointerup', up);
      b.el.addEventListener('pointercancel', up);
      return () => {
        b.el.removeEventListener('pointerdown', down);
        b.el.removeEventListener('pointermove', move);
        b.el.removeEventListener('pointerup', up);
        b.el.removeEventListener('pointercancel', up);
      };
    });

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const st = Math.min((now - last) / 16.7, 2.2); // step scale vs 60fps
      last = now;
      const start = bodies[0].activatedAt - 350;

      // released scroll fling glides out with its own friction
      if (canScroll && scroller) {
        if (Math.abs(scrollMom) > 0.2) {
          scroller.scrollTop += scrollMom * st;
          scrollMom *= Math.pow(0.94, st);
        } else scrollMom = 0;
      }

      for (const b of bodies) {
        if (b.grabbed) continue; // pinned to the pointer; velocity set on release
        if (b.spring) {
          if (now >= b.activatedAt) {
            b.vx += (b.hx - b.x) * SPRING_K * st;
            b.vy += (b.hy - b.y) * SPRING_K * st;
          }
          const d = Math.pow(SPRING_DAMP, st);
          b.vx *= d; b.vy *= d;
        } else {
          const d = Math.pow(ICE_DAMP, st);
          b.vx *= d; b.vy *= d;
          if (Math.hypot(b.vx, b.vy) < STOP_V) { b.vx = 0; b.vy = 0; }
        }
        b.x += b.vx * st;
        b.y += b.vy * st;
      }

      // tile-to-tile collisions — grabbed tiles act as infinite mass
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], c = bodies[j];
          const min = a.r + c.r;
          const dx = c.x - a.x, dy = c.y - a.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= min || dist < 0.001) continue;
          const nx = dx / dist, ny = dy / dist;
          const overlap = min - dist;
          if (a.grabbed) { c.x += nx * overlap; c.y += ny * overlap; }
          else if (c.grabbed) { a.x -= nx * overlap; a.y -= ny * overlap; }
          else { a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; c.x += nx * overlap / 2; c.y += ny * overlap / 2; }
          const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (vn < 0) {
            if (a.grabbed) { c.vx -= (1 + HIT_BOUNCE) * vn * nx; c.vy -= (1 + HIT_BOUNCE) * vn * ny; }
            else if (c.grabbed) { a.vx += (1 + HIT_BOUNCE) * vn * nx; a.vy += (1 + HIT_BOUNCE) * vn * ny; }
            else {
              const imp = (1 + HIT_BOUNCE) * vn / 2;
              a.vx += imp * nx; a.vy += imp * ny;
              c.vx -= imp * nx; c.vy -= imp * ny;
            }
          }
        }
      }

      // walls: soft bounce, energy lost on each hit
      for (const b of bodies) {
        if (b.grabbed) continue;
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * WALL_BOUNCE; }
        else if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * WALL_BOUNCE; }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * WALL_BOUNCE; }
        else if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * WALL_BOUNCE; }
      }

      // render — one transform write per tile per frame
      for (const b of bodies) {
        const targetScale = b.grabbed ? 1.12 : 1;
        b.scale += (targetScale - b.scale) * 0.2;
        const tRy = clamp(b.vx * 0.3, -18, 18); // tilt into the direction of travel
        const tRx = clamp(-b.vy * 0.3, -18, 18);
        b.rx += (tRx - b.rx) * 0.1;
        b.ry += (tRy - b.ry) * 0.1;
        const sp = Math.hypot(b.vx, b.vy);
        const bob = reduced || b.everGrabbed ? 0 : Math.sin(now / 1300 + b.phase) * 3 / (1 + sp * 0.6);
        b.el.style.transform =
          `translate3d(${(b.x - b.s / 2).toFixed(2)}px, ${(b.y - b.s / 2 + bob).toFixed(2)}px, 0)` +
          ` perspective(560px) rotateX(${(BASE_RX + b.rx).toFixed(2)}deg) rotateY(${(BASE_RY + b.ry).toFixed(2)}deg)` +
          ` rotateZ(${b.def.rz}deg) scale(${b.scale.toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      for (const fn of cleanups) fn();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden>
      {defs.map((d) => (
        <div
          key={d.label}
          data-tile
          className="icon-tile-dragger pointer-events-auto absolute left-0 top-0 cursor-grab select-none active:cursor-grabbing will-change-transform"
        >          <div className="icon-tile" style={{ width: S, height: S, borderRadius: Math.round(S * 0.3) }}>
            <span className="icon-tick" style={{ background: d.accent, boxShadow: `0 0 9px ${d.accent}` }} />
            <d.glyph className="icon-glyph" size={Math.round(S * 0.42)} strokeWidth={1.6} />
          </div>
        </div>
      ))}
    </div>
  );
}
