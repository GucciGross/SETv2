import { installNativeStyleScope } from './native-styles';
import { installAuthorPreferences } from './native-preferences';
import { createScriptQueue } from './native-script-queue';
/** The only adapter to the pinned H5P browser globals. Real H5P widgets and semantics,
 * mounted in SET's document (not H5PEditor.Editor's iframe constructor).
 */
export interface EditorModel {
  integration: any; scripts: string[]; styles: string[];
  parameters?: { library: string; params: any };
  libraries: { name: string; title: string; majorVersion: number; minorVersion: number; restricted?: boolean; isOld?: boolean }[];
  base: string;
}
export interface NativeEditor { read: () => { library: string; params: any }; destroy: () => void }
const globals = () => window as any;
const scripts = new Map<string, Promise<void>>();
const styles = new Set<string>();
let active: symbol | undefined;
let loading: Promise<void> = Promise.resolve();

function codeUrl(path: string) {
  const url = new URL(path, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/h5p/assets/native/')) throw new Error('Unexpected H5P code URL. Rebuild the matching web and server versions.');
  return url.href;
}
function loadScript(path: string) {
  const url = codeUrl(path);
  let loaded = scripts.get(url);
  if (!loaded) {
    loaded = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script'); script.src = url; script.async = false;
      script.onload = () => resolve();
      script.onerror = () => { scripts.delete(url); script.remove(); reject(new Error('An H5P editor asset failed to load. Your saved draft is unchanged.')); };
      document.head.appendChild(script);
    });
    scripts.set(url, loaded);
  }
  return loaded;
}
function configure(model: EditorModel) {
  const w = globals(), old = w.H5PIntegration;
  w.H5PIntegration = { ...model.integration, hubIsEnabled: false,
    loadedJs: old?.loadedJs ?? [], loadedCss: old?.loadedCss ?? [] };
  const editor = w.H5PEditor ??= {}, settings = model.integration.editor;
  Object.assign(editor, {
    basePath: settings.libraryUrl, fileIcon: settings.fileIcon, ajaxPath: settings.ajaxPath,
    filesPath: settings.filesPath, apiVersion: settings.apiVersion, contentLanguage: settings.language,
    copyrightSemantics: settings.copyrightSemantics, metadataSemantics: settings.metadataSemantics,
    assets: settings.assets, baseUrl: '', enableContentHub: false, contentId: settings.nodeVersionId || undefined,
    getAjaxUrl: (action: string, parameters: Record<string, unknown> = {}) => settings.ajaxPath + encodeURIComponent(action) + Object.entries(parameters).map(([key, value]) => `&${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join(''),
    storage: {
      get: (key: string, next: (value?: boolean) => void) => { let value; try { const saved = localStorage.getItem(`set:h5p:editor:${model.integration.user.id}:${key}`); if (saved === 'true' || saved === 'false') value = saved === 'true'; } catch {} next(value); },
      set: (key: string, value: boolean) => { if (typeof value === 'boolean' && /^[\w-]{1,128}$/.test(key)) try { localStorage.setItem(`set:h5p:editor:${model.integration.user.id}:${key}`, String(value)); } catch {} },
    },
  });
}

/** Reveal native errors including those in collapsed field groups; never hide a required field. */
export function revealInvalidField(root: HTMLElement) {
  const error = root.querySelector<HTMLElement>('.field.error, .h5p-errors:not(:empty), [aria-invalid="true"]');
  if (!error) return;
  let parent: HTMLElement | null = error;
  while (parent && parent !== root) {
    if (parent.classList.contains('group') || parent.classList.contains('listgroup')) parent.classList.add('expanded');
    if (parent.classList.contains('collapsed')) {
      parent.classList.remove('collapsed');
      parent.querySelector(':scope > [aria-expanded="false"]')?.setAttribute('aria-expanded', 'true');
    }
    parent = parent.parentElement;
  }
  error.scrollIntoView({ block: 'center' });
  (error.matches('input,textarea,select,[contenteditable="true"]') ? error : error.querySelector<HTMLElement>('input,textarea,select,[contenteditable="true"]'))?.focus({ preventScroll: true });
}

export async function mountNativeEditor(root: HTMLElement, model: EditorModel, signal: AbortSignal, onDirty: () => void, onError: (message: string) => void): Promise<NativeEditor> {
  // Serialize bootstrap so StrictMode/cancelled navigation cannot reconfigure a newer session.
  const prior = loading; let unlock!: () => void;
  loading = new Promise<void>(resolve => { unlock = resolve; });
  await prior;
  let destroy = () => {};
  try {
    if (signal.aborted) throw new DOMException('Editor closed', 'AbortError');
    if (active) throw new Error('Close the other H5P editor before opening this activity.');
    const identity = Symbol(); active = identity;
    installNativeStyleScope();
    configure(model);
    // Bound the initial style burst through the same queue discipline the
    // per-library loaders use; sequential await keeps insertion order.
    {
      const bootstrap = createScriptQueue(url => new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = url;
        link.onload = () => resolve();
        link.onerror = () => { link.remove(); reject(new Error('An H5P editor asset failed to load. Your saved draft is unchanged.')); };
        document.head.appendChild(link);
      }));
      try {
        for (const path of model.styles) {
          const url = codeUrl(path);
          if (!styles.has(url)) { await bootstrap.load(url); styles.add(url); }
        }
      } finally { bootstrap.dispose(); }
    }
    for (const src of model.scripts) { await loadScript(src); if (signal.aborted) throw new DOMException('Editor closed', 'AbortError'); }
    configure(model); // h5peditor.js initializes its globals once while bootstrapping.
    const w = globals(), H = w.H5P, E = w.H5PEditor, $ = H.jQuery;
    H.$body = $(document.body); E.$ = $;
    E.libraryCache = {}; E.renderableCommonFields = {};
    const originalLayout = [document.documentElement.style.height, document.body.style.height, document.documentElement.style.maxWidth, document.body.style.maxWidth];
    const portals = new Set<HTMLElement>(), requests = new Set<any>();
    const tagPortals = () => {
      for (const child of Array.from(document.body.children)) if (child instanceof HTMLElement && /(?:^|\s)(?:h5p|cke)[\w-]*/.test(child.className) && !root.contains(child)) { child.classList.add('set-h5p-native-portal'); portals.add(child); }
    };
    const observer = new MutationObserver(tagPortals); observer.observe(document.body, { childList: true });
    let exitFullscreen: (() => void) | undefined;
    E.semiFullscreen = ($element: any, after: () => void, done: () => void) => {
      exitFullscreen?.();
      const element = $element[0] as HTMLElement, focus = document.activeElement as HTMLElement | null;
      const restoreVisibility = E.hideAllButOne(element, window);
      const overflow = document.body.style.overflow;
      element.classList.add('h5peditor-semi-fullscreen', 'set-h5p-native-fullscreen'); document.body.style.overflow = 'hidden';
      const key = (event: KeyboardEvent) => { if (event.key === 'Escape') restore(); };
      let exited = false;
      const restore = () => { if (exited) return; exited = true; element.classList.remove('h5peditor-semi-fullscreen', 'set-h5p-native-fullscreen'); document.body.style.overflow = overflow; restoreVisibility(); document.removeEventListener('keyup', key); done?.(); focus?.focus(); exitFullscreen = undefined; };
      exitFullscreen = restore; document.addEventListener('keyup', key); after?.(); return restore;
    };
    const changed = () => { if (!signal.aborted) onDirty(); };
    for (const name of ['input', 'change', 'pointerup']) root.addEventListener(name, changed, true);
    $(document).on('ajaxSend.setNativeH5p', (_e: any, xhr: any, options: any) => { if (String(options.url).startsWith(model.base)) requests.add(xhr); });
    $(document).on('ajaxComplete.setNativeH5p', (_e: any, xhr: any) => requests.delete(xhr));
    $(document).on('ajaxError.setNativeH5p', (_e: any, xhr: any, options: any) => {
      if (!signal.aborted && String(options.url).startsWith(model.base) && xhr.statusText !== 'abort') onError(xhr.status === 413 ? 'This media exceeds the upload limit.' : 'H5P could not load a field or media. Your changes are still here. Retry the operation; reloading will discard unsaved changes.');
    });
    // The upstream loader bursts over 100 requests for complex types and only
    // logs failed dependencies. Bound both CSS and JS; classic scripts retain
    // insertion order, and the form cannot render before its styles are ready.
    const codeAbort = new AbortController();
    const ownedCode = new Set<HTMLElement>();
    const queue = createScriptQueue(key => new Promise<void>((resolve, reject) => {
      const css = key.startsWith('css:'), src = codeUrl(key.slice(key.indexOf(':') + 1));
      const node = css ? document.createElement('link') : document.createElement('script');
      let timer: ReturnType<typeof setTimeout>;
      const finish = (error?: Error) => {
        clearTimeout(timer); node.onload = node.onerror = null;
        codeAbort.signal.removeEventListener('abort', cancel);
        if (error) { node.remove(); ownedCode.delete(node); reject(error); } else resolve();
      };
      const cancel = () => finish(new DOMException('Editor closed', 'AbortError'));
      node.className = css ? 'h5peditor-library-style' : 'h5peditor-library-script';
      if (node instanceof HTMLLinkElement) { node.rel = 'stylesheet'; node.href = src; }
      else { node.src = src; node.async = false; }
      node.onload = () => finish();
      node.onerror = () => finish(new Error('H5P authoring code could not load. Check the connection and reload the authoring tools.'));
      timer = setTimeout(() => finish(new Error('H5P authoring code timed out. Check the connection and reload the authoring tools.')), 15_000);
      codeAbort.signal.addEventListener('abort', cancel, { once: true });
      if (codeAbort.signal.aborted) cancel(); else { ownedCode.add(node); document.head.appendChild(node); }
    }));
    const originalLoadJs = E.loadJs, originalLoadCss = E.loadCss;
    const styleWork: Promise<void>[] = [];
    let reportedCodeFailure = false;
    const failedCode = (error: unknown) => {
      if (signal.aborted || codeAbort.signal.aborted || reportedCodeFailure) return;
      reportedCodeFailure = true; queue.dispose(); codeAbort.abort();
      onError(error instanceof Error ? error.message : 'H5P authoring code could not load.');
    };
    const loadCss = (src: string) => {
      if (signal.aborted || codeAbort.signal.aborted || H.cssLoaded(src)) return;
      const work = queue.load('css:' + src).then(() => {
        if (signal.aborted || codeAbort.signal.aborted) return;
        w.H5PIntegration.loadedCss ??= [];
        if (!H.cssLoaded(src)) w.H5PIntegration.loadedCss.push(src);
      });
      styleWork.push(work); void work.catch(failedCode);
    };
    const loadJs = (src: string, callback?: () => void) => {
      if (signal.aborted || codeAbort.signal.aborted) return;
      void Promise.all(styleWork).then(() => H.jsLoaded(src) ? undefined : queue.load('js:' + src)).then(() => {
        if (signal.aborted || codeAbort.signal.aborted) return;
        w.H5PIntegration.loadedJs ??= [];
        if (!H.jsLoaded(src)) w.H5PIntegration.loadedJs.push(src);
        callback?.();
      }).catch(failedCode);
    };
    E.loadJs = loadJs; E.loadCss = loadCss;
    // H5PEditor.libraryRequested appends every dependency <link> at once,
    // bypassing loadCss — the exact burst the loader bound was meant to stop.
    // Route its CSS through the queue; JS already flows through loadJs.
    const originalLibraryRequested = E.libraryRequested;
    const boundedLibraryRequested = function (libraryName: string, callback: (...args: any[]) => void) {
      const libraryData = E.libraryCache[libraryName];
      if (libraryData && Array.isArray(libraryData.css) && libraryData.css.length) {
        Promise.all(libraryData.css.map((path: string) => H.cssLoaded(path) ? undefined : queue.load('css:' + path).then(() => {
          w.H5PIntegration.loadedCss ??= [];
          if (!H.cssLoaded(path)) w.H5PIntegration.loadedCss.push(path);
        }).catch(failedCode))).then(() => {
          libraryData.css = [];
          originalLibraryRequested.call(E, libraryName, callback);
        }).catch(failedCode);
      } else {
        originalLibraryRequested.call(E, libraryName, callback);
      }
    };
    E.libraryRequested = boundedLibraryRequested;
    // Track constructor-owned global listeners without removing anyone else's subscriptions.
    const subscriptions: [string, any][] = [], originalOn = H.externalDispatcher.on;
    H.externalDispatcher.on = function (type: string, handler: any) { subscriptions.push([type, handler]); return originalOn.call(this, type, handler); };
    const restorePreferences = installAuthorPreferences(H, model.integration.user.id, () => localStorage);
    let selector: any;
    destroy = () => {
      if (active !== identity) return;
      exitFullscreen?.(); queue.dispose(); codeAbort.abort();
      if (E.loadJs === loadJs) E.loadJs = originalLoadJs;
      if (E.loadCss === loadCss) E.loadCss = originalLoadCss;
      if (E.libraryRequested === boundedLibraryRequested) E.libraryRequested = originalLibraryRequested;
      ownedCode.forEach(node => node.remove()); ownedCode.clear();
      for (const xhr of requests) xhr.abort(); requests.clear();
      $(document).off('.setNativeH5p');
      for (const name of ['input', 'change', 'pointerup']) root.removeEventListener(name, changed, true);
      for (const [type, handler] of subscriptions) H.externalDispatcher.off(type, handler);
      selector?.form?.remove?.(); restorePreferences(); observer.disconnect(); tagPortals();
      [document.documentElement.style.height, document.body.style.height, document.documentElement.style.maxWidth, document.body.style.maxWidth] = originalLayout;
      portals.forEach(portal => portal.remove()); root.replaceChildren(); active = undefined;
    };
    try { selector = new E.LibrarySelector(model.libraries, model.parameters?.library, JSON.stringify(model.parameters?.params ?? {})); }
    finally { H.externalDispatcher.on = originalOn; }
    selector.appendTo($(root));
    selector.$selector.attr('aria-label', 'Content type');
    if (model.parameters?.library) selector.setLibrary(model.parameters.library);
    tagPortals();
    signal.addEventListener('abort', destroy, { once: true });
    return {
      read() {
        if (signal.aborted || !selector.form?.metadataForm) throw new Error('Choose a content type and wait for its fields to load.');
        let valid = !!selector.form.metadataForm.getExtraTitleField().validate();
        for (const field of [...(selector.form.metadataForm.children ?? []), ...(selector.form.children ?? [])]) if (field.validate() === false) valid = false;
        if (!valid) { revealInvalidField(root); throw new Error('Complete the highlighted required fields before saving.'); }
        return { library: selector.getCurrentLibrary(), params: { params: selector.getParams(), metadata: selector.getMetadata() } };
      },
      destroy,
    };
  } catch (error) { destroy(); active = undefined; throw error; }
  finally { unlock(); }
}
