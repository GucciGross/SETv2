import { describe, it, expect, vi, afterEach } from 'vitest';
import { isSetCopilotOpen, openSetCopilot } from './copilotLauncher';

afterEach(() => vi.unstubAllGlobals());
describe('CopilotKit v2 launcher contract', () => {
  it('uses the actual pressed/state attributes rather than nonexistent aria-expanded', () => {
    const button = (attrs: Record<string, string>) => ({ getAttribute: (key: string) => attrs[key] ?? null });
    expect(isSetCopilotOpen(button({ 'aria-pressed': 'true' }))).toBe(true);
    expect(isSetCopilotOpen(button({ 'data-state': 'open' }))).toBe(true);
    expect(isSetCopilotOpen(button({ 'aria-pressed': 'false', 'data-state': 'closed' }))).toBe(false);
    expect(isSetCopilotOpen(null)).toBe(false);
  });
  it('repeated programmatic opens never toggle an open conversation closed', () => {
    let pressed = false;
    const click = vi.fn(() => { pressed = !pressed; });
    const button = { click, getAttribute: (key: string) => key === 'aria-pressed' ? String(pressed) : null };
    vi.stubGlobal('document', { querySelector: () => button });
    expect(openSetCopilot()).toBe(true);
    expect(openSetCopilot()).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(pressed).toBe(true);
  });
});
