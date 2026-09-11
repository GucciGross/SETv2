import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeVoiceAudio, voiceLevel } from './voiceAudioMeter';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('read-only audio visualization', () => {
  it('measures bounded RMS, handles silence/invalid samples and never invents audio', () => {
    expect(voiceLevel(new Float32Array())).toBe(0);
    expect(voiceLevel(new Float32Array([0, 0]))).toBe(0);
    expect(voiceLevel(new Float32Array([0.1, -0.1]))).toBeCloseTo(0.6);
    expect(voiceLevel(new Float32Array([1, -1]))).toBe(1);
    expect(voiceLevel(new Float32Array([NaN, Infinity]))).toBe(0);
  });
  it('taps the supplied stream, never connects speakers/stops tracks, disposes exactly once', async () => {
    vi.useFakeTimers();
    const trackStop = vi.fn(); const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const analyser = { fftSize: 256, disconnect: vi.fn(), getFloatTimeDomainData: (array: Float32Array) => array.fill(0.05) };
    const createMediaStreamSource = vi.fn(() => source), close = vi.fn(async () => {});
    vi.stubGlobal('AudioContext', class {
      state = 'running'; destination = { speakers: true };
      createMediaStreamSource = createMediaStreamSource;
      createAnalyser = () => analyser;
      resume = async () => {}; close = close;
    });
    const level = vi.fn(); const dispose = observeVoiceAudio(stream, level);
    expect(createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(level).toHaveBeenLastCalledWith(expect.closeTo(0.3));
    vi.advanceTimersByTime(100);
    dispose(); dispose();
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(trackStop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(level).toHaveBeenLastCalledWith(0);
  });
  it('degrades independently when Web Audio is absent or stream analysis is refused', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => observeVoiceAudio({} as MediaStream, vi.fn())()).not.toThrow();
    const close = vi.fn(async () => {});
    vi.stubGlobal('AudioContext', class {
      state = 'running'; close = close;
      createMediaStreamSource() { throw new Error('Not a supported stream'); }
    });
    const level = vi.fn();
    expect(() => observeVoiceAudio({} as MediaStream, level)()).not.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
    expect(level).toHaveBeenCalledWith(0);
  });
});
