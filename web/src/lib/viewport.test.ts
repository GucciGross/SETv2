import { describe, expect, it } from 'vitest';
import { measureViewport } from './viewport';

describe('visible viewport', () => {
  it('uses the actual visible phone height in browser mode, not a device preset', () => {
    for (const height of [568, 667, 812, 844, 852, 874, 932, 956]) {
      expect(measureViewport(1000, { height, offsetTop: 0, scale: 1 })).toEqual({ height, top: 0 });
    }
  });

  it('releases installed height to CSS instead of freezing either JS reading', () => {
    // Neither JS reading proves the CSS/paint viewport is this short.
    expect(measureViewport(
      812,
      { height: 712, offsetTop: 0, scale: 1 },
      { standalone: true, editing: false },
    )).toEqual({ height: null, top: 0 });
  });

  it('releases stale keyboard geometry on blur and recovers invalid JS readings', () => {
    for (const inner of [0, NaN, 712, 812]) {
      expect(measureViewport(inner, { height: 420, offsetTop: 86, scale: 1 }, { standalone: true }))
        .toEqual({ height: null, top: 0 });
    }
  });

  it('still follows the standalone keyboard while text is being edited', () => {
    expect(measureViewport(
      812,
      { height: 420, offsetTop: 86, scale: 1 },
      { standalone: true, editing: true },
    )).toEqual({ height: 420, top: 86 });
  });

  it('tracks browser keyboard pan without subtracting the keyboard twice', () => {
    expect(measureViewport(932, { height: 420, offsetTop: 86, scale: 1 })).toEqual({ height: 420, top: 86 });
  });

  it('adapts to landscape, and falls back without VisualViewport', () => {
    expect(measureViewport(430)).toEqual({ height: 430, top: 0 });
    expect(measureViewport(430, { height: 375, offsetTop: 0, scale: 1 })).toEqual({ height: 375, top: 0 });
  });

  it('does not reflow pinch zoom or collapse a hidden/invalid viewport', () => {
    expect(measureViewport(932, { height: 466, offsetTop: 60, scale: 2 })).toBeNull();
    expect(measureViewport(0)).toBeNull();
    expect(measureViewport(NaN)).toBeNull();
    expect(measureViewport(874, { height: NaN, offsetTop: NaN, scale: 1 })).toEqual({ height: 874, top: 0 });
    expect(measureViewport(874, { height: 420, offsetTop: -8, scale: 1 })).toEqual({ height: 420, top: 0 });
    expect(measureViewport(874, { height: 420, offsetTop: 10, scale: 2 }, { standalone: true })).toBeNull();
  });
});
