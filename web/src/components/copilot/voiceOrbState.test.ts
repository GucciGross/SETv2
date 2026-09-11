import { describe, expect, it } from 'vitest';
import { voiceOrbState, voiceOrbTarget } from './voiceOrbState';
import { initialParams } from '../../vendor/lersent-orb/src/presets';
const idle = { state: 'idle' as const, sending: false, speaking: false, error: '' };
describe('voice orb state reflects the existing voice session', () => {
  it('shows idle, connecting, listening, transcription/work and speaking distinctly', () => {
    expect(voiceOrbState(idle)).toBe('idle');
    expect(voiceOrbState({ ...idle, state: 'requesting' })).toBe('connecting');
    expect(voiceOrbState({ ...idle, state: 'listening' })).toBe('listening');
    expect(voiceOrbState({ ...idle, state: 'live' })).toBe('listening');
    expect(voiceOrbState({ ...idle, state: 'transcribing' })).toBe('thinking');
    expect(voiceOrbState({ ...idle, sending: true })).toBe('thinking');
    expect(voiceOrbState({ ...idle, speaking: true, sending: true })).toBe('speaking');
  });
  it('errors take precedence without changing modality or inventing speech', () => {
    expect(voiceOrbState({ ...idle, state: 'live', sending: true, speaking: true, error: 'Denied' })).toBe('error');
    expect(voiceOrbState({ ...idle, state: 'live', sending: true })).toBe('thinking');
  });
  it('uses the upstream preset, keeps it immutable and bounds measured levels', () => {
    const original = { ...initialParams };
    const quiet = voiceOrbTarget('listening');
    expect(quiet.params.style).toBe(initialParams.style);
    expect(quiet.params.glassEnabled).toBe(true);
    expect(voiceOrbTarget('speaking', 0.4).params.contourDeform).toBeGreaterThan(quiet.params.contourDeform);
    expect(voiceOrbTarget('speaking', 9)).toEqual(voiceOrbTarget('speaking', 1));
    for (const bad of [NaN, Infinity, -3]) expect(voiceOrbTarget('idle', bad)).toEqual(voiceOrbTarget('idle', 0));
    expect(initialParams).toEqual(original);
  });
});
