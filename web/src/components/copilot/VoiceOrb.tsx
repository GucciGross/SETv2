import { useEffect, useRef, useState } from 'react';
import poster from '../../vendor/lersent-orb/poster.png';
import { voiceOrbTarget, type VoiceOrbState } from './voiceOrbState';

type Renderer = typeof import('../../vendor/lersent-orb/src/orb-renderer');

/** Keep the shader out of text mode. Disposal also covers slow imports,
 * unsupported adapters, device loss, hidden tabs and React StrictMode. */
export default function VoiceOrb({ state, level }: { state: VoiceOrbState; level: React.MutableRefObject<number> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const currentState = useRef(state); currentState.current = state;
  const [rendering, setRendering] = useState(false);
  const [fallback, setFallback] = useState('loading');
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let generation = 0;
    let dispose: (() => void) | undefined;
    const release = () => { generation++; dispose?.(); dispose = undefined; };
    const start = () => {
      release(); setRendering(false);
      if (document.hidden) { setFallback('hidden'); return; }
      if (reduced.matches) { setFallback('reduced-motion'); return; }
      if (!navigator.gpu) { setFallback('unsupported'); return; }
      setFallback('loading');
      const expected = generation;
      void import('../../vendor/lersent-orb/src/orb-renderer').then((module: Renderer) => {
        if (expected !== generation) return;
        dispose = module.createOrbRenderer({
          canvas: element,
          getTarget: () => voiceOrbTarget(currentState.current, level.current),
          onReady: () => { if (expected === generation) { setRendering(true); setFallback(''); } },
          onError: () => { if (expected === generation) { setRendering(false); setFallback('unavailable'); } },
        });
      }).catch(() => { if (expected === generation) { setRendering(false); setFallback('unavailable'); } });
    };
    start();
    document.addEventListener('visibilitychange', start);
    reduced.addEventListener('change', start);
    return () => { release(); document.removeEventListener('visibilitychange', start); reduced.removeEventListener('change', start); };
  }, [level]);
  return <div className="set-voice-orb" data-set-voice-orb data-renderer={rendering ? 'webgpu' : fallback} aria-hidden="true">
    <img src={poster} alt="" className="set-voice-orb-poster" hidden={rendering} draggable={false} />
    <canvas ref={canvas} className="set-voice-orb-canvas" style={{ opacity: rendering ? 1 : 0 }} />
  </div>;
}
