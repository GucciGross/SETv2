import { initialParams } from '../../vendor/lersent-orb/src/presets';
import type { OrbRenderTarget } from '../../vendor/lersent-orb/src/orb-states';

export type VoiceOrbState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
export function voiceOrbState(input: {
  state: 'idle' | 'requesting' | 'listening' | 'transcribing' | 'live';
  sending: boolean; speaking: boolean; error: string;
}): VoiceOrbState {
  if (input.error) return 'error';
  if (input.speaking) return 'speaking';
  if (input.sending || input.state === 'transcribing') return 'thinking';
  if (input.state === 'requesting') return 'connecting';
  if (input.state === 'live' || input.state === 'listening') return 'listening';
  return 'idle';
}

/** Upstream liquid-glass preset + measured audio, not a substitute CSS orb. */
export function voiceOrbTarget(state: VoiceOrbState, level = 0): OrbRenderTarget {
  const amplitude = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const active = state === 'listening' || state === 'speaking' || state === 'thinking';
  return {
    state: active ? 'thinking' : 'idle', activationDuration: 0.22, transitionDuration: 0.65,
    params: {
      ...initialParams,
      speed: state === 'thinking' ? 1.15 : state === 'speaking' ? 0.95 : state === 'listening' ? 0.6 : 0.22,
      contourDeform: (active ? 0.04 : 0.01) + amplitude * 0.16,
      exposure: (active ? 1.9 : 1.2) + amplitude * 0.4,
      warp: (state === 'thinking' ? 3.8 : 2.6) + amplitude * 0.6,
      ...(state === 'error' ? { colorB: '#DE849B', glowColor: '#DE849B', exposure: 1 } : {}),
    },
  };
}
