import { useEffect, useState } from 'react';

/**
 * User-creatable copilot mascot — a desk pet with role-aware expressions
 * (inspired by OpenMausBot's SupaMaus concept, Apache-2.0).
 * Species, colors, eyes and accessory are fully parametric; the mascot reacts
 * to copilot state: idle | thinking | talking | celebrating.
 */

export interface MascotConfig {
  name: string;
  species: 'bot' | 'cat' | 'blob' | 'mouse';
  bodyColor: string;
  accentColor: string;
  eyes: 'normal' | 'happy' | 'sleepy' | 'visor';
  accessory: 'none' | 'antenna' | 'halo' | 'headphones' | 'hardhat' | 'party';
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
}

export default function Mascot({ config, mood = 'idle', size = 64 }: MascotProps) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (config.eyes === 'visor') return;
    const t = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 140);
    }, 3200 + Math.random() * 2600);
    return () => clearInterval(t);
  }, [config.eyes]);

  const c = config;
  const bodyClass =
    mood === 'talking'
      ? 'mascot-talk'
      : mood === 'thinking'
        ? 'mascot-think'
        : mood === 'celebrating'
          ? 'mascot-celebrate'
          : 'mascot-idle';

  const eyeShape = (x: number) => {
    if (c.eyes === 'visor') return <rect x={x - 7} y={44} width={14} height={6} rx={3} fill="#0c0e13" opacity={0.85} />;
    if (blink) return <rect x={x - 5} y={47} width={10} height={2} rx={1} fill="#0c0e13" />;
    if (c.eyes === 'happy')
      return (
        <path d={`M ${x - 5} 48 Q ${x} 43 ${x + 5} 48`} stroke="#0c0e13" strokeWidth={2.4} fill="none" strokeLinecap="round" />
      );
    if (c.eyes === 'sleepy')
      return (
        <path d={`M ${x - 5} 47 Q ${x} 50 ${x + 5} 47`} stroke="#0c0e13" strokeWidth={2.4} fill="none" strokeLinecap="round" />
      );
    return (
      <>
        <circle cx={x} cy={47} r={4.4} fill="#0c0e13" />
        <circle cx={x + 1.4} cy={45.6} r={1.5} fill="#ffffff" opacity={0.9} />
      </>
    );
  };

  const mouth =
    mood === 'talking' || mood === 'celebrating' ? (
      <ellipse cx={50} cy={57} rx={6} ry={mood === 'celebrating' ? 5 : 4} fill="#0c0e13" opacity={0.85} />
    ) : mood === 'thinking' ? (
      <circle cx={50} cy={57} r={2.2} fill="#0c0e13" opacity={0.7} />
    ) : (
      <path d="M 45 56 Q 50 60 55 56" stroke="#0c0e13" strokeWidth={2.2} fill="none" strokeLinecap="round" opacity={0.8} />
    );

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={bodyClass}
      role="img"
      aria-label={`${c.name} the ${c.species}`}
      style={{ overflow: 'visible' }}
    >
      {/* accessory (behind head) */}
      {c.accessory === 'halo' && (
        <ellipse className="mascot-halo" cx={50} cy={12} rx={13} ry={4} fill="none" stroke="#ffd76a" strokeWidth={3} />
      )}
      {c.accessory === 'party' && (
        <>
          <polygon points="62,8 62,26 76,17" fill="#ff6b8a" />
          <rect x={60} y={24} width={5} height={7} rx={1.5} fill={c.accentColor} />
        </>
      )}

      {/* body */}
      {c.species === 'cat' || c.species === 'mouse' ? (
        <>
          <circle cx={26} cy={26} r={12} fill={c.bodyColor} />
          <circle cx={74} cy={26} r={12} fill={c.bodyColor} />
          <circle cx={26} cy={26} r={5.5} fill={c.accentColor} />
          <circle cx={74} cy={26} r={5.5} fill={c.accentColor} />
          {c.species === 'mouse' && (
            <>
              <ellipse cx={19} cy={27} rx={5} ry={9} fill="#ffb9c4" opacity={0.9} />
              <ellipse cx={81} cy={27} rx={5} ry={9} fill="#ffb9c4" opacity={0.9} />
            </>
          )}
        </>
      ) : null}

      {c.species === 'blob' ? (
        <path
          d="M 50 22 C 74 22 84 40 82 58 C 80 76 66 84 50 84 C 34 84 20 76 18 58 C 16 40 26 22 50 22 Z"
          fill={c.bodyColor}
          stroke={c.accentColor}
          strokeWidth={2.5}
        />
      ) : (
        <rect x={18} y={24} width={64} height={62} rx={c.species === 'bot' ? 16 : 30} fill={c.bodyColor} stroke={c.accentColor} strokeWidth={2.5} />
      )}

      {/* bot panel line */}
      {c.species === 'bot' && <rect x={34} y={72} width={32} height={5} rx={2.5} fill={c.accentColor} opacity={0.55} />}

      {/* eyes + mouth */}
      {eyeShape(38)}
      {eyeShape(62)}
      {mouth}

      {/* cheeks when celebrating */}
      {mood === 'celebrating' && (
        <>
          <circle cx={26} cy={57} r={4.5} fill="#ff8fa8" opacity={0.7} />
          <circle cx={74} cy={57} r={4.5} fill="#ff8fa8" opacity={0.7} />
        </>
      )}

      {/* accessory (front) */}
      {c.accessory === 'antenna' && (
        <>
          <line x1={50} y1={24} x2={50} y2={12} stroke={c.accentColor} strokeWidth={2.5} className={mood === 'thinking' ? 'mascot-antenna' : ''} />
          <circle cx={50} cy={10} r={4} fill={c.accentColor} className={mood === 'thinking' ? 'mascot-antenna-dot' : ''} />
        </>
      )}
      {c.accessory === 'headphones' && (
        <>
          <path d="M 18 46 C 18 22 82 22 82 46" stroke={c.accentColor} strokeWidth={4} fill="none" />
          <rect x={12} y={44} width={10} height={16} rx={4} fill={c.accentColor} />
          <rect x={78} y={44} width={10} height={16} rx={4} fill={c.accentColor} />
        </>
      )}
      {c.accessory === 'hardhat' && (
        <>
          <path d="M 28 26 C 30 12 70 12 72 26 Z" fill="#ffcf5c" stroke="#d9a629" strokeWidth={1.5} />
          <rect x={24} y={25} width={52} height={5} rx={2.5} fill="#ffcf5c" stroke="#d9a629" strokeWidth={1.5} />
        </>
      )}

      {/* thinking indicator */}
      {mood === 'thinking' && (
        <g className="mascot-bubbles">
          <circle cx={86} cy={22} r={2.4} fill={c.accentColor} opacity={0.9} />
          <circle cx={92} cy={14} r={3.2} fill={c.accentColor} opacity={0.75} />
          <circle cx={97} cy={6} r={4} fill={c.accentColor} opacity={0.6} />
        </g>
      )}
    </svg>
  );
}
