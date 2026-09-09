import { describe, expect, it, vi } from 'vitest';
import { installAuthorPreferences } from './native-preferences';
const key = 'h5p-editor-branching-scenario-tour-v1-seen';
function fixture() {
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  const h5p = { getUserData: vi.fn(), setUserData: vi.fn() };
  return { h5p, values, storage, originalGet: h5p.getUserData, originalSet: h5p.setUserData };
}
describe('native author preferences', () => {
  it('stores only known tour flags without sending them to learner-state endpoints', () => {
    const { h5p, storage, originalGet, originalSet } = fixture();
    const restore = installAuthorPreferences(h5p, 'user-a', storage), done = vi.fn();
    h5p.getUserData(0, key, done); expect(done).toHaveBeenLastCalledWith(undefined, false);
    h5p.setUserData(0, key, true); h5p.getUserData('0', key, done, '0');
    expect(done).toHaveBeenLastCalledWith(undefined, true);
    expect(originalGet).not.toHaveBeenCalled(); expect(originalSet).not.toHaveBeenCalled(); restore();
  });
  it('never inherits another user or legacy unscoped localStorage preference', () => {
    const { h5p, storage, values } = fixture(); values.set(key, 'true');
    let restore = installAuthorPreferences(h5p, 'user-a', storage); const done = vi.fn();
    h5p.getUserData(0, key, done); expect(done).toHaveBeenLastCalledWith(undefined, false);
    h5p.setUserData(0, key, true); restore();
    restore = installAuthorPreferences(h5p, 'user-b', storage);
    h5p.getUserData(0, key, done); expect(done).toHaveBeenLastCalledWith(undefined, false); restore();
    restore = installAuthorPreferences(h5p, 'user-a', storage);
    h5p.getUserData(0, key, done); expect(done).toHaveBeenLastCalledWith(undefined, true); restore();
  });
  it('delegates real learner state, unknown keys and nonzero subcontent to the authorized API', () => {
    const { h5p, storage, originalGet, originalSet } = fixture();
    const restore = installAuthorPreferences(h5p, 'user', storage), done = vi.fn();
    h5p.getUserData(123, 'state', done); h5p.getUserData(0, 'unknown', done); h5p.getUserData(0, key, done, 2);
    expect(originalGet).toHaveBeenCalledTimes(3);
    h5p.setUserData(123, 'state', { progress: 1 }); h5p.setUserData(0, 'unknown', true);
    expect(originalSet).toHaveBeenCalledTimes(2); restore();
  });
  it('rejects non-boolean flags and tolerates unavailable device storage', () => {
    const { h5p, values, originalSet } = fixture();
    const restore = installAuthorPreferences(h5p, 'user', () => { throw new Error('Storage disabled'); }), done = vi.fn(), errorCallback = vi.fn();
    h5p.setUserData(0, key, true); h5p.getUserData(0, key, done); expect(done).toHaveBeenLastCalledWith(undefined, true);
    h5p.setUserData(0, key, 'false', { errorCallback }); expect(errorCallback).toHaveBeenCalledOnce();
    expect(originalSet).not.toHaveBeenCalled(); expect(values.size).toBe(0); restore();
  });
  it('restores the original functions when authoring unmounts', () => {
    const { h5p, storage, originalGet, originalSet } = fixture();
    const restore = installAuthorPreferences(h5p, 'user', storage); restore(); restore();
    expect(h5p.getUserData).toBe(originalGet); expect(h5p.setUserData).toBe(originalSet);
  });
});
