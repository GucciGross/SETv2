import { useEffect, useState } from 'react';

/**
 * Copilot mascot — a layered, expressive desk pet with role-aware moods.
 * Concept inspired by OpenMausBot (Apache-2.0); artwork is original parametric SVG.
 */

export interface MascotConfig {
  name: string;
  species: 'bot' | 'cat' | 'blob' | 'mouse';
  bodyColor: string;
  accentColor: string;
  eyes: 'normal' | 'happy' | 'sleepy' | 'visor';
  accessory: 'none' | 'antenna' | 'halo' | 'headphones' | 'hardhat' | 'party';
  /** false hides the mascot app-wide (Settings -> Mascot). Absent = shown. */
  enabled?: boolean;
}

export const DEFAULT_MASCOT: MascotConfig = {
  name: 'Pixel',
  species: 'bot',
  bodyColor: '#6c8cff',
  accentColor: '#8b5cf6',
  eyes: 'normal',
  accessory: 'antenna',
};

export type MascotMood = 'idle' | 'thinking' | 'talking' | 'celebrating';

interface MascotProps {
  config: MascotConfig;
  mood?: MascotMood;
  size?: number;
  /** Settings preview renders even when the mascot is turned off. */
  preview?: boolean;
}

const darken = (hex: string, f = 0.72) => {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
};
const lighten = (hex: string, f = 0.45) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number) => Math.round(c + (255 - c) * f);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

export default function Mascot({ config, mood = 'idle', size = 64, preview = false }: MascotProps) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (config.eyes === 'visor') return;
    const t = setInterval(
      () => {
        setBlink(true);
        setTimeout(() => setBlink(false), 130);
      },
      2600 + Math.random() * 3000
    );
    return () => clearInterval(t);
  }, [config.eyes]);

  // hooks above stay unconditional; hiding is a pure render concern
  if (!preview && config.enabled === false) return null;

  const c = config;
  const body = darken(c.bodyColor, 0.92);
  const bodyLight = lighten(c.bodyColor, 0.3);
  const accent = c.accentColor;
  const ink = '#14161d';
  const animClass =
    mood === 'talking' ? 'mascot-talk' : mood === 'thinking' ? 'mascot-think' : mood === 'celebrating' ? 'mascot-celebrate' : 'mascot-idle';
  const eyeY = 46;

  const Eye = ({ cx }: { cx: number }) => {
    if (c.eyes === 'visor') return null;
    if (blink && mood !== 'celebrating') {
      return <path d={`M ${cx - 5} ${eyeY} q 5 3 10 0`} stroke={ink} strokeWidth={2.2} fill="none" strokeLinecap="round" />;
    }
    if (c.eyes === 'happy' || mood === 'celebrating') {
      return (
        <path d={`M ${cx - 5.5} ${eyeY + 1.5} q 5.5 -7 11 0`} stroke={ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      );
    }
    if (c.eyes === 'sleepy') {
      return <path d={`M ${cx - 5} ${eyeY - 1} q 5 5 10 0`} stroke={ink} strokeWidth={2.4} fill="none" strokeLinecap="round" />;
    }
    return (
      <g>
        <ellipse cx={cx} cy={eyeY} rx={5} ry={5.6} fill={ink} />
        <circle cx={cx + 1.6} cy={eyeY - 2} r={1.9} fill="#fff" opacity={0.95} />
        <circle cx={cx - 1.6} cy={eyeY + 2.2} r={1} fill="#fff" opacity={0.6} />
      </g>
    );
  };

  const mouth = () => {
    if (mood === 'celebrating') return <path d="M 44 56 q 6 8 12 0 q -6 2 -12 0" fill={ink} />;
    if (mood === 'talking') return <ellipse cx={50} cy={57} rx={4.6} ry={mood === 'talking' ? 3.6 : 2.4} fill={ink} />;
    if (mood === 'thinking') return <circle cx={50} cy={57.5} r={2} fill={ink} opacity={0.85} />;
    return <path d="M 46 56 q 4 3.6 8 0" stroke={ink} strokeWidth={2.2} fill="none" strokeLinecap="round" />;
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={animClass}
      role="img"
      aria-label={`${c.name} the ${c.species}`}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={`mg-${c.species}`} cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor={bodyLight} />
          <stop offset="100%" stopColor={body} />
        </radialGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx={50} cy={88} rx={20} ry={4} fill="#000" opacity={0.28} />

      {/* --- species silhouettes --- */}
      {c.species === 'cat' && (
        <g>
          {/* tail */}
          <path d="M 74 72 q 14 -4 12 -18" stroke={body} strokeWidth={6} fill="none" strokeLinecap="round" className={mood === 'celebrating' ? 'mascot-tail' : ''} />
          <path d="M 74 72 q 14 -4 12 -18" stroke={accent} strokeWidth={2.4} fill="none" strokeLinecap="round" opacity={0.7} />
          {/* ears */}
          <path d="M 27 32 L 22 15 L 40 24 Z" fill={body} stroke={darken(body, 0.8)} strokeWidth={1.5} />
          <path d="M 73 32 L 78 15 L 60 24 Z" fill={body} stroke={darken(body, 0.8)} strokeWidth={1.5} />
          <path d="M 28.5 28 L 25.5 19.5 L 36 25 Z" fill={lighten(accent, 0.5)} />
          <path d="M 71.5 28 L 74.5 19.5 L 64 25 Z" fill={lighten(accent, 0.5)} />
          {/* body */}
          <ellipse cx={50} cy={54} rx={27} ry={30} fill={`url(#mg-${c.species})`} stroke={darken(body, 0.75)} strokeWidth={2} />
          {/* whiskers */}
          <g stroke={darken(body, 0.55)} strokeWidth={1.2} strokeLinecap="round" opacity={0.85}>
            <line x1={20} y1={52} x2={9} y2={50} />
            <line x1={20} y1={56} x2={9} y2={57} />
            <line x1={80} y1={52} x2={91} y2={50} />
            <line x1={80} y1={56} x2={91} y2={57} />
          </g>
        </g>
      )}
      {c.species === 'mouse' && (
        <g>
          {/* curly tail */}
          <path d="M 72 74 q 16 2 14 -12 q -1 -8 -9 -6" stroke={body} strokeWidth={4.4} fill="none" strokeLinecap="round" />
          {/* big round ears */}
          <circle cx={24} cy={26} r={13.5} fill={body} stroke={darken(body, 0.78)} strokeWidth={2} />
          <circle cx={76} cy={26} r={13.5} fill={body} stroke={darken(body, 0.78)} strokeWidth={2} />
          <circle cx={24} cy={26} r={7.5} fill={lighten(accent, 0.45)} />
          <circle cx={76} cy={26} r={7.5} fill={lighten(accent, 0.45)} />
          {/* body */}
          <ellipse cx={50} cy={56} rx={25} ry={28} fill={`url(#mg-${c.species})`} stroke={darken(body, 0.75)} strokeWidth={2} />
        </g>
      )}
      {c.species === 'blob' && (
        <g>
          <path
            d="M 50 24 C 72 22 84 38 82 56 C 80 76 66 86 50 85 C 33 84 18 74 18 55 C 18 37 30 26 50 24 Z"
            fill={`url(#mg-${c.species})`}
            stroke={darken(body, 0.75)}
            strokeWidth={2}
          />
          {/* drip */}
          <ellipse cx={68} cy={22} rx={4.5} ry={5.5} fill={body} stroke={darken(body, 0.75)} strokeWidth={1.5} />
        </g>
      )}
      {c.species === 'bot' && (
        <g>
          {/* body capsule */}
          <rect x={22} y={26} width={56} height={58} rx={19} fill={`url(#mg-${c.species})`} stroke={darken(body, 0.75)} strokeWidth={2} />
          {/* chest light */}
          <rect x={41} y={70} width={18} height={4.5} rx={2.2} fill={accent} opacity={0.75} />
          <circle cx={50} cy={72.2} r={1.4} fill={lighten(accent, 0.6)} className={mood === 'thinking' ? 'mascot-antenna-dot' : ''} />
          {/* side bolts */}
          <circle cx={22} cy={44} r={2.6} fill={darken(body, 0.6)} />
          <circle cx={78} cy={44} r={2.6} fill={darken(body, 0.6)} />
          {/* feet */}
          <rect x={32} y={82} width={13} height={6} rx={3} fill={darken(body, 0.7)} />
          <rect x={55} y={82} width={13} height={6} rx={3} fill={darken(body, 0.7)} />
        </g>
      )}

      {/* belly patch */}
      {c.species !== 'bot' && (
        <ellipse cx={50} cy={66} rx={15} ry={13} fill={lighten(c.bodyColor, 0.55)} opacity={0.85} />
      )}

      {/* visor band */}
      {c.eyes === 'visor' && (
        <g>
          <rect x={28} y={40} width={44} height={13} rx={6.5} fill="#14161d" opacity={0.92} />
          {mood === 'thinking' || mood === 'talking' ? (
            <rect x={33} y={44.5} width={mood === 'talking' ? 20 : 10} height={4} rx={2} fill={lighten(accent, 0.5)} className="mascot-antenna-dot" />
          ) : (
            <rect x={33} y={44.5} width={34} height={4} rx={2} fill={lighten(accent, 0.45)} opacity={0.9} />
          )}
        </g>
      )}

      {/* eyes + face */}
      {c.eyes !== 'visor' && (
        <>
          <Eye cx={38} />
          <Eye cx={62} />
        </>
      )}
      {mouth()}

      {/* blush */}
      {(mood === 'celebrating' || c.eyes === 'happy') && (
        <g fill="#ff8fa8" opacity={0.55}>
          <ellipse cx={28} cy={55} rx={4.6} ry={2.8} />
          <ellipse cx={72} cy={55} rx={4.6} ry={2.8} />
        </g>
      )}

      {/* --- accessories --- */}
      {c.accessory === 'antenna' && (
        <g className={mood === 'thinking' ? 'mascot-antenna' : ''}>
          <line x1={50} y1={c.species === 'cat' ? 22 : 26} x2={50} y2={11} stroke={accent} strokeWidth={2.6} strokeLinecap="round" />
          <circle cx={50} cy={9} r={4.2} fill={accent} className={mood === 'thinking' ? 'mascot-antenna-dot' : ''} />
          <circle cx={48.6} cy={7.6} r={1.4} fill="#fff" opacity={0.8} />
        </g>
      )}
      {c.accessory === 'halo' && <ellipse className="mascot-halo" cx={50} cy={11} rx={14} ry={4.2} fill="none" stroke="#ffd76a" strokeWidth={3.2} />}
      {c.accessory === 'party' && (
        <g>
          <polygon points="56,26 56,6 74,16" fill="#ff6b8a" />
          <polygon points="57,24 57,9 69,16.5" fill="#ff9db4" opacity={0.8} />
          <circle cx={74} cy={16} r={2.6} fill="#ffd76a" className="mascot-antenna-dot" />
        </g>
      )}
      {c.accessory === 'headphones' && (
        <g>
          <path d={`M 21 48 C 21 20 79 20 79 48`} stroke={accent} strokeWidth={5} fill="none" strokeLinecap="round" />
          <rect x={13} y={44} width={11} height={18} rx={5} fill={accent} stroke={darken(accent, 0.7)} strokeWidth={1.5} />
          <rect x={76} y={44} width={11} height={18} rx={5} fill={accent} stroke={darken(accent, 0.7)} strokeWidth={1.5} />
          <circle cx={18.5} cy={53} r={2.4} fill={lighten(accent, 0.55)} />
          <circle cx={81.5} cy={53} r={2.4} fill={lighten(accent, 0.55)} />
        </g>
      )}
      {c.accessory === 'hardhat' && (
        <g>
          <path d="M 28 28 C 30 12 70 12 72 28 Z" fill="#ffcf5c" stroke="#d9a629" strokeWidth={1.6} />
          <rect x={23} y={26.5} width={54} height={5.5} rx={2.7} fill="#ffcf5c" stroke="#d9a629" strokeWidth={1.6} />
          <rect x={46.5} y={13} width={7} height={9} rx={2} fill="#ffcf5c" stroke="#d9a629" strokeWidth={1.4} />
        </g>
      )}

      {/* thinking bubbles / celebrate sparkles */}
      {mood === 'thinking' && (
        <g className="mascot-bubbles">
          <circle cx={86} cy={20} r={2.6} fill={accent} opacity={0.9} />
          <circle cx={92} cy={13} r={3.4} fill={accent} opacity={0.7} />
          <circle cx={96} cy={5} r={4.2} fill={accent} opacity={0.5} />
        </g>
      )}
      {mood === 'celebrating' && (
        <g className="mascot-bubbles">
          <path d="M 12 24 l 2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#ffd76a" />
          <path d="M 88 34 l 1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z" fill="#8be28b" />
          <circle cx={82} cy={12} r={2.4} fill="#ff8fa8" />
        </g>
      )}
    </svg>
  );
}
