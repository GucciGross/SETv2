import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import VoiceOrb from '../../src/components/copilot/VoiceOrb';
import type { VoiceOrbState } from '../../src/components/copilot/voiceOrbState';
import '../../src/components/copilot/copilotVoice.css';

function Fixture() {
  const [state, setState] = useState<VoiceOrbState>('listening');
  const [mounted, setMounted] = useState(true);
  const level = useRef(0);
  Object.assign(window, { orbFixture: { setState, setMounted, setLevel: (n: number) => { level.current = n; } } });
  return <main style={{ width: 360, margin: '40px auto' }}>
    {mounted && <VoiceOrb state={state} level={level} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
