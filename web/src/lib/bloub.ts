/**
 * bloub engine — a deterministic morphing blob avatar.
 *
 * sampleBloub(t, …) is a pure function of time: the same t always yields the
 * same frame, so pausing, scrubbing and prefers-reduced-motion are trivial and
 * the React layer stays dumb. No tween library, no clock inside.
 *
 * Animation approach inspired by jeremy-prt/bloub (MIT) — the measured x.ai
 * bot avatar recreation: radial-profile body morphing with exponential ease
 * (never overshooting), eyes cut as mask holes that lean "\\", and liveliness
 * from gaze drift + blinking rather than constant bobbing. Artwork/constants
 * here are original.
 */

export type BloubMood = 'idle' | 'thinking' | 'talking' | 'celebrating';
export type BloubEyes = 'normal' | 'happy' | 'sleepy' | 'visor';

/** Harmonic amplitudes blended per mood — the only mutable animation state. */
export interface BloubParams {
  breath: number; // slow uniform radius pulsing
  squash: number; // k=2 harmonic — horizontal squash/stretch
  lean: number; // k=1 harmonic — body leans toward one side
  wobble: number; // k=3 harmonic — slowly rotating organic edge
  hop: number; // vertical bounce amplitude (viewBox units)
  orbit: number; // comet orbit visibility 0..1
}

export const BLOUB_TARGETS: Record<BloubMood, BloubParams> = {
  idle: { breath: 0.016, squash: 0, lean: 0, wobble: 0.006, hop: 0, orbit: 0 },
  talking: { breath: 0.01, squash: 0.055, lean: 0.012, wobble: 0.01, hop: 0, orbit: 0 },
  thinking: { breath: 0.012, squash: 0.012, lean: 0.045, wobble: 0.008, hop: 0, orbit: 1 },
  celebrating: { breath: 0.018, squash: 0.03, lean: 0, wobble: 0.012, hop: 9, orbit: 0.35 },
};

/** Exponential ease toward the target — per bloub's measurements the body never overshoots. */
export function blendParams(cur: BloubParams, target: BloubParams, dt: number, tau = 0.16): BloubParams {
  const f = 1 - Math.exp(-dt / tau);
  const mix = (a: number, b: number) => a + (b - a) * f;
  return {
    breath: mix(cur.breath, target.breath),
    squash: mix(cur.squash, target.squash),
    lean: mix(cur.lean, target.lean),
    wobble: mix(cur.wobble, target.wobble),
    hop: mix(cur.hop, target.hop),
    orbit: mix(cur.orbit, target.orbit),
  };
}

export interface BloubEyeHole {
  x: number;
  y: number;
  /** lean off vertical, degrees (negative = "\" like the measured avatar) */
  rot: number;
  /** vertical open factor 0..1 (blink) */
  open: number;
  /** hole outline in local coordinates, already expression-shaped */
  path: string;
}

export interface BloubFrame {
  bodyPath: string;
  /** vertical lift in viewBox units, ≤ 0 (up); eyes already offset by it */
  lift: number;
  /** ground-shadow scale 0..1 (shrinks while airborne) */
  shadow: number;
  eyes: BloubEyeHole[];
  comet: { x: number; y: number; r: number; trail: { x: number; y: number; r: number; opacity: number }[] } | null;
}

// geometry constants (100x100 viewBox, matching the other species' scale)
const CX = 50;
const CY = 55;
const R = 30;
const TAU = Math.PI * 2;
const EYE_LEAN = -26;

/** deterministic value noise — same input, same output; no Math.random anywhere */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Blink schedule: a shut-open triangle inside some cycles, others skipped for natural cadence. */
function blinkOpen(t: number, talking: boolean): number {
  const cycle = talking ? 2.6 : 4.3;
  const i = Math.floor(t / cycle);
  if (hash(i * 7.13) < 0.22) return 1;
  const phase = t - i * cycle;
  const d = 0.18;
  if (phase > d) return 1;
  return Math.abs(1 - (2 * phase) / d);
}

/** Slow lissajous gaze drift — the avatar's resting liveliness. */
function gazeDrift(t: number): { x: number; y: number } {
  return {
    x: 2.1 * Math.sin(TAU * 0.07 * t + 1.3) + 1.0 * Math.sin(TAU * 0.131 * t),
    y: 1.3 * Math.sin(TAU * 0.09 * t + 4.1),
  };
}

const orbitAngle = (t: number) => TAU * 0.45 * t + TAU * hash(42);

/** Catmull-Rom through sampled points → smooth closed cubic path. */
function closedSmoothPath(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + ' Z';
}

const roundedRect = (w: number, h: number, r: number) =>
  `M ${-w / 2 + r} ${-h / 2} H ${w / 2 - r} A ${r} ${r} 0 0 1 ${w / 2} ${-h / 2 + r} V ${h / 2 - r} A ${r} ${r} 0 0 1 ${w / 2 - r} ${h / 2} H ${-w / 2 + r} A ${r} ${r} 0 0 1 ${-w / 2} ${h / 2 - r} V ${-h / 2 + r} A ${r} ${r} 0 0 1 ${-w / 2 + r} ${-h / 2} Z`;

/** Expression hole outlines, local coords, long axis ~vertical. */
function eyeHolePath(eyes: BloubEyes): string {
  switch (eyes) {
    case 'happy': // upward crescent
      return 'M -6.2 1.8 Q 0 -7.4 6.2 1.8 Q 0 -2.6 -6.2 1.8 Z';
    case 'sleepy': // thin heavy-lid sliver
      return 'M -5.6 0.4 Q 0 -3.6 5.6 0.4 Q 0 -1.6 -5.6 0.4 Z';
    case 'visor':
      return roundedRect(40, 12.5, 6.2);
    default: // vertical capsule
      return roundedRect(8.2, 15, 4.1);
  }
}

export function sampleBloub(t: number, p: BloubParams, eyes: BloubEyes, mood: BloubMood): BloubFrame {
  // hops: |sin| bounce, extra squash at ground contact
  const hopPhase = TAU * 0.85 * t;
  const lift = -p.hop * Math.abs(Math.sin(hopPhase));
  const ground = Math.abs(Math.cos(hopPhase));
  const squashNow = p.squash + (p.hop > 0.5 ? 0.07 * ground * ground : 0);

  // comet orbit (thinking) — the dot stays put while its trail sweeps around it
  const a = orbitAngle(t);
  const orbitR = R + 9;
  const comet =
    p.orbit > 0.02
      ? {
          x: CX + orbitR * Math.cos(a),
          y: CY - 5 + orbitR * 0.6 * Math.sin(a),
          r: 3.1,
          trail: Array.from({ length: 6 }, (_, k) => {
            const ta = a - (k + 1) * 0.17;
            return {
              x: CX + orbitR * Math.cos(ta),
              y: CY - 5 + orbitR * 0.6 * Math.sin(ta),
              r: 3.1 * (1 - (k + 1) / 7.5),
              opacity: 0.7 * (1 - (k + 1) / 7),
            };
          }),
        }
      : null;

  // gaze: drift at rest, locks onto the comet while thinking (blend by orbit weight)
  const drift = gazeDrift(t);
  const gx = p.orbit > 0.02 ? drift.x * (1 - p.orbit) + 2.6 * Math.cos(a) * p.orbit : drift.x;
  const gy = p.orbit > 0.02 ? drift.y * (1 - p.orbit) + 1.6 * Math.sin(a) * p.orbit : drift.y;

  // radial profile: circle + slow breathing + k2 squash + k1 lean + k3 wobble
  const leanDir = comet ? a : 0;
  const N = 56;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * TAU;
    const r =
      R *
      (1 +
        p.breath * Math.sin(TAU * 0.35 * t) +
        squashNow * Math.cos(2 * th) * Math.sin(TAU * 1.1 * t) +
        p.lean * Math.cos(th - leanDir) +
        p.wobble * Math.sin(3 * th + TAU * 0.05 * t + TAU * hash(7)));
    pts.push([CX + r * Math.cos(th), CY + lift + r * Math.sin(th)]);
  }

  const eyeY = CY - 6 + lift;
  const open = eyes === 'happy' ? 1 : blinkOpen(t, mood === 'talking');
  const holePath = eyeHolePath(eyes);
  const eyeHoles: BloubEyeHole[] =
    eyes === 'visor'
      ? [{ x: CX + gx * 0.4, y: eyeY, rot: 0, open: 1, path: holePath }]
      : [
          { x: CX - 8.5 + gx, y: eyeY + gy, rot: EYE_LEAN, open, path: holePath },
          { x: CX + 8.5 + gx, y: eyeY + gy, rot: EYE_LEAN, open, path: holePath },
        ];

  return {
    bodyPath: closedSmoothPath(pts),
    lift,
    shadow: Math.min(1, Math.max(0.55, 1 + lift / 45)),
    eyes: eyeHoles,
    comet,
  };
}
