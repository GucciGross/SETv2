import { installNativeStyleScope } from './native-styles';
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
    for (const path of model.styles) {
      const url = codeUrl(path);
      if (!styles.has(url)) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = url; document.head.appendChild(link); styles.add(url); }
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
    // Track constructor-owned global listeners without removing anyone else's subscriptions.
    const subscriptions: [string, any][] = [], originalOn = H.externalDispatcher.on;
    H.externalDispatcher.on = function (type: string, handler: any) { subscriptions.push([type, handler]); return originalOn.call(this, type, handler); };
    let selector: any;
    destroy = () => {
      if (active !== identity) return;
      exitFullscreen?.();
      for (const xhr of requests) xhr.abort(); requests.clear();
      $(document).off('.setNativeH5p');
      for (const name of ['input', 'change', 'pointerup']) root.removeEventListener(name, changed, true);
      for (const [type, handler] of subscriptions) H.externalDispatcher.off(type, handler);
      selector?.form?.remove?.(); observer.disconnect(); tagPortals();
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
