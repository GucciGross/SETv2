/** Upstream Branching Scenario stores tour flags under content id 0. Those are
 * author UI preferences, not learner state or a grant to read another activity.
 * Keep only these known boolean flags on this device, scoped to the SET user.
 */
const tourKeys = new Set([
  'h5p-editor-branching-scenario-tour-v1-seen',
  'h5p-editor-branching-scenario-branching-content-tour-v1-seen',
  'h5p-editor-branching-scenario-information-content-tour-v1-seen',
]);
type Done = (error?: unknown, value?: unknown) => void;
type Extras = { subContentId?: string | number; errorCallback?: Done };
interface UserDataApi {
  getUserData: (contentId: string | number, dataId: string, done: Done, subContentId?: string | number) => unknown;
  setUserData: (contentId: string | number, dataId: string, data: unknown, extras?: Extras) => unknown;
}
type Preferences = Pick<Storage, 'getItem' | 'setItem'>;
export function installAuthorPreferences(h5p: UserDataApi, userId: string, storage: () => Preferences) {
  const originalGet = h5p.getUserData, originalSet = h5p.setUserData;
  const memory = new Map<string, boolean>();
  const matches = (id: string | number, key: string, sub?: string | number) => String(id) === '0' && tourKeys.has(key) && (sub === undefined || String(sub) === '0');
  const storageKey = (key: string) => `set:h5p:author:${encodeURIComponent(userId)}:${key}`;
  const get: UserDataApi['getUserData'] = function(this: UserDataApi, id, key, done, sub) {
    if (!matches(id, key, sub)) return originalGet.call(this, id, key, done, sub);
    let value = memory.get(key) ?? false;
    try { const saved = storage().getItem(storageKey(key)); if (saved !== null) value = saved === 'true'; } catch { /* Private browsing may disable storage. */ }
    done(undefined, value);
  };
  const set: UserDataApi['setUserData'] = function(this: UserDataApi, id, key, value, extras) {
    if (!matches(id, key, extras?.subContentId)) return originalSet.call(this, id, key, value, extras);
    if (typeof value !== 'boolean') { extras?.errorCallback?.(new TypeError('Author tour preferences must be boolean.')); return; }
    memory.set(key, value);
    try { storage().setItem(storageKey(key), String(value)); } catch { /* Retain a session-only preference. */ }
  };
  h5p.getUserData = get; h5p.setUserData = set;
  return () => {
    if (h5p.getUserData === get) h5p.getUserData = originalGet;
    if (h5p.setUserData === set) h5p.setUserData = originalSet;
  };
}
