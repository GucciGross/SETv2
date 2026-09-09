/** Scope CSS emitted by trusted H5P webpack bundles as well as linked stylesheets.
 * Only styles inserted while an official, locally served H5P script is executing
 * are tagged. React/Copilot/SET style elements are never adopted or rewritten.
 */
export const nativeScope = '@scope (.set-h5p-native, .set-h5p-native-portal)';
let installed = false;
export function installNativeStyleScope() {
  if (installed) return;
  installed = true;
  const head = document.head;
  const mark = (node: Node) => {
    const script = document.currentScript as HTMLScriptElement | null;
    if (!(node instanceof HTMLStyleElement) || !script?.src) return;
    const url = new URL(script.src, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/h5p/assets/native/')) node.dataset.setH5pNativeStyle = 'true';
  };
  const scope = (node: Node | null) => {
    const style = node instanceof HTMLStyleElement ? node : node?.parentElement;
    if (!(style instanceof HTMLStyleElement) || style.dataset.setH5pNativeStyle !== 'true') return;
    const css = style.textContent ?? '';
    if (css.trim() && !css.startsWith(nativeScope)) style.textContent = `${nativeScope} {\n${css}\n}`;
  };
  const append = head.appendChild, insert = head.insertBefore;
  head.appendChild = function<T extends Node>(node: T): T { mark(node); const result = append.call(this, node) as T; scope(node); return result; };
  head.insertBefore = function<T extends Node>(node: T, before: Node | null): T { mark(node); const result = insert.call(this, node, before) as T; scope(node); return result; };
  // style-loader inserts the style first, then its text, and may update that text.
  // This process-wide adapter carries no workspace or session state and is installed once.
  new MutationObserver(records => { for (const record of records) { scope(record.target); for (const node of record.addedNodes) scope(node); } }).observe(head, { childList: true, subtree: true, characterData: true });
}
