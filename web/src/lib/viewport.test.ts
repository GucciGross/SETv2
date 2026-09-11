import { describe, expect, it } from 'vitest';
import { measureViewport } from './viewport';
describe('visible viewport', () => {
  it('uses the actual visible iPhone height, not a device preset', () => {
    for (const height of [667, 812, 844, 874, 932, 956]) expect(measureViewport(1000, { height, offsetTop: 0, scale: 1 })).toEqual({ height, top: 0 });
  });
  it('tracks keyboard pan without subtracting the keyboard twice', () => {
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
  });
});
