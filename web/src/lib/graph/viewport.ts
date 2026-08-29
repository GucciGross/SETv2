/**
 * Pan/zoom/pinch controller for canvas graph views. Owns the view transform and
 * all pointer machinery so renderers only implement hit-testing and drawing.
 *
 * Fixes over the old inline handlers in GraphView: zoom anchors at the cursor
 * (the old version pivoted at the origin and drifted), two-finger pinch works
 * on touch, and clicks are distinguished from drags by a movement slop.
 */
export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

/** An edge under the cursor: its two endpoint objects, in link direction. */
export interface EdgeHit<T> {
  source: T;
  target: T;
}

export interface ViewportHooks<T> {
  /** Return the object under a world-space point, or null. */
  hitTest: (wx: number, wy: number) => T | null;
  /** Optional: the edge under a world-space point (asked only when no node was hit). */
  hitEdgeTest?: (wx: number, wy: number) => EdgeHit<T> | null;
  /** Move a dragged object to a world-space point. */
  onDragObject: (obj: T, wx: number, wy: number) => void;
  /** Called once when a dragged object is released. */
  onDragEnd: (obj: T) => void;
  onHover: (obj: T | null) => void;
  /** Optional mouse-only edge hover; client coords accompany it for tooltips. */
  onEdgeHover?: (e: EdgeHit<T> | null, clientX: number, clientY: number) => void;
  onClick: (obj: T | null) => void;
  onDoubleClick: (obj: T | null) => void;
  /** Called after any transform/hover change that needs a redraw. */
  onChange: () => void;
}

const MIN_K = 0.2;
const MAX_K = 4;
/** Pointer movement (px) below which a press counts as a click — finger taps
 *  jitter several times more than mouse clicks. */
const clickSlop = (pointerType: string) => (pointerType === 'mouse' ? 5 : 12);

export class Viewport<T> {
  transform: ViewTransform = { x: 0, y: 0, k: 1 };

  private pointers = new Map<number, { x: number; y: number }>();
  private dragTarget: T | null = null;
  private panning = false;
  private downX = 0;
  private downY = 0;
  private moved = 0;
  private slop = 5;
  private pinchDist = 0;
  private lastHover: T | null = null;
  private lastEdge: EdgeHit<T> | null = null;

  constructor(private canvas: HTMLCanvasElement, private hooks: ViewportHooks<T>) {}

  attach() {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('dblclick', this.onDblClick);
  }

  detach() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('dblclick', this.onDblClick);
  }

  toWorld(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const { x, y, k } = this.transform;
    return { x: (clientX - rect.left - x) / k, y: (clientY - rect.top - y) / k };
  }

  /** Zoom by a factor anchored at a client point so content under the cursor stays put. */
  zoomAt(clientX: number, clientY: number, factor: number) {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const k = Math.min(MAX_K, Math.max(MIN_K, this.transform.k * factor));
    const ratio = k / this.transform.k;
    this.transform.x = px - (px - this.transform.x) * ratio;
    this.transform.y = py - (py - this.transform.y) * ratio;
    this.transform.k = k;
    this.hooks.onChange();
  }

  /** Center and scale the view so a world-space box fits with padding. */
  fit(bounds: { minX: number; minY: number; maxX: number; maxY: number }, padding = 90) {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, bounds.maxX - bounds.minX);
    const h = Math.max(1, bounds.maxY - bounds.minY);
    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min((rect.width - padding * 2) / w, (rect.height - padding * 2) / h)));
    this.transform.k = k;
    this.transform.x = rect.width / 2 - (bounds.minX + w / 2) * k;
    this.transform.y = rect.height / 2 - (bounds.minY + h / 2) * k;
    this.hooks.onChange();
  }

  private onDown = (e: PointerEvent) => {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic/inactive pointers can't be captured — events still flow */
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // second finger → pinch takes over, drop any drag/pan in progress
      this.dragTarget = null;
      this.panning = false;
      this.pinchDist = this.pointerDistance();
      return;
    }
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.moved = 0;
    this.slop = clickSlop(e.pointerType);
    const w = this.toWorld(e.clientX, e.clientY);
    this.dragTarget = this.hooks.hitTest(w.x, w.y);
    this.panning = !this.dragTarget;
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (prev) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      const dist = this.pointerDistance();
      const [a, b] = [...this.pointers.values()];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (this.pinchDist > 0) this.zoomAt(midX, midY, dist / this.pinchDist);
      this.pinchDist = dist;
      // midpoint drag pans too
      this.transform.x += e.clientX - (prev?.x ?? e.clientX);
      this.transform.y += e.clientY - (prev?.y ?? e.clientY);
      this.hooks.onChange();
      return;
    }

    if (this.dragTarget) {
      this.moved += Math.abs(e.clientX - (prev?.x ?? e.clientX)) + Math.abs(e.clientY - (prev?.y ?? e.clientY));
      const w = this.toWorld(e.clientX, e.clientY);
      this.hooks.onDragObject(this.dragTarget, w.x, w.y);
      this.hooks.onChange();
      return;
    }

    if (this.panning && prev) {
      this.moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
      this.transform.x += e.clientX - prev.x;
      this.transform.y += e.clientY - prev.y;
      this.hooks.onChange();
      return;
    }

    // no buttons — hover
    if (e.buttons === 0 && e.pointerType === 'mouse') {
      const w = this.toWorld(e.clientX, e.clientY);
      const hit = this.hooks.hitTest(w.x, w.y);
      if (hit || !this.hooks.hitEdgeTest) {
        if (this.lastEdge) {
          this.lastEdge = null;
          this.hooks.onEdgeHover?.(null, e.clientX, e.clientY);
        }
        if ((hit as unknown) !== (this.lastHover as unknown)) {
          this.lastHover = hit;
          this.hooks.onHover(hit);
          this.hooks.onChange();
        }
        return;
      }
      // edge hover: first drop any node hover, then compare edges
      if (this.lastHover) {
        this.lastHover = null;
        this.hooks.onHover(null);
      }
      const edge = this.hooks.hitEdgeTest(w.x, w.y);
      const changed =
        (edge === null) !== (this.lastEdge === null) ||
        (edge !== null && this.lastEdge !== null && (edge.source !== this.lastEdge.source || edge.target !== this.lastEdge.target));
      this.lastEdge = edge;
      if (changed) {
        this.hooks.onEdgeHover?.(edge, e.clientX, e.clientY);
        this.hooks.onChange();
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    const wasSingle = this.pointers.size === 1;
    const target = this.dragTarget;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (target) this.hooks.onDragEnd(target);
    if (wasSingle && this.moved < this.slop) {
      this.hooks.onClick(target);
    }
    this.dragTarget = null;
    this.panning = false;
  };

  private onDblClick = (e: MouseEvent) => {
    const w = this.toWorld(e.clientX, e.clientY);
    this.hooks.onDoubleClick(this.hooks.hitTest(w.x, w.y));
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 0.89);
  };

  private pointerDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
