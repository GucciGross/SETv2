/** Shell, mobile drawer and portalled Copilot share one viewport.
 * Home Screen apps use CSS viewport units at rest. Both JS height readings can
 * be stale there; never freeze a correct CSS layout to either number.
 * Browser tabs/active editors still need VisualViewport for chrome/keyboard pan.
 */
export type ViewportMeasureOptions = { standalone?: boolean; editing?: boolean };
const finitePositive = (value: number | undefined): value is number =>
  Number.isFinite(value) && Number(value) > 0;

/** null result = ignore zoom/invalid reading; null height = release to CSS. */
export function measureViewport(
  innerHeight: number,
  viewport?: Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'> | null,
  options: ViewportMeasureOptions = {},
): { height: number | null; top: number } | null {
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return null;
  if (options.standalone && !options.editing) return { height: null, top: 0 };
  const height = viewport && finitePositive(viewport.height) ? viewport.height : innerHeight;
  if (!finitePositive(height)) return null;
  const rawTop = viewport?.offsetTop ?? 0;
  return {
    height: Math.round(height * 100) / 100,
    top: Number.isFinite(rawTop) ? Math.round(Math.max(0, rawTop) * 100) / 100 : 0,
  };
}

function isInstalledDisplayMode() {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true
    || window.matchMedia?.('(display-mode: fullscreen)').matches === true;
}

function isTextEditingTarget(element: Element | null) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) return false;
  return !new Set([
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
  ]).has(element.type.toLowerCase());
}

/** Opt-in, local-only measurements. No URL, account, document or credential data. */
export function readViewportDiagnostics() {
  const root = document.documentElement;
  const rect = (selector: string) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } : null;
  };
  const shell = rect('.app-shell');
  const dock = document.querySelector('.set-copilot-command-dock');
  const visual = window.visualViewport;
  const x = shell ? shell.x + shell.width / 2 : 0;
  const y = shell ? shell.bottom - 1 : 0;
  return {
    layoutVersion: 'home-screen-css-v1',
    standalone: isInstalledDisplayMode(),
    editing: isTextEditingTarget(document.activeElement),
    heightSource: root.dataset.setViewport,
    inner: { width: window.innerWidth, height: window.innerHeight },
    // Diagnostic comparison only. Physical screen pixels are NOT a sizing input.
    screen: { width: window.screen.width, height: window.screen.height },
    visual: visual ? { height: visual.height, top: visual.offsetTop, scale: visual.scale } : null,
    cssHeight: getComputedStyle(root).height,
    safeBottom: getComputedStyle(dock ?? root).paddingBottom,
    shell, main: rect('.app-shell > main'), dock: rect('.set-copilot-command-dock'),
    bottomHitIsDock: !!dock?.contains(document.elementFromPoint(x, y)),
    rootScroll: { x: window.scrollX, y: window.scrollY },
  };
}

function installDiagnostics() {
  if (new URLSearchParams(window.location.search).get('viewport-debug') !== '1') return () => {};
  const panel = document.createElement('details');
  panel.setAttribute('data-set-viewport-debug', '');
  panel.setAttribute('aria-label', 'Screen layout diagnostics');
  panel.style.cssText = 'position:fixed;z-index:2147483647;top:max(8px,env(safe-area-inset-top));left:8px;right:8px;max-width:420px;max-height:60dvh;overflow:auto;padding:12px;border:1px solid #78839a;border-radius:12px;background:#111827;color:#f3f4f6;font:12px/1.5 monospace';
  const summary = document.createElement('summary');
  summary.textContent = 'Screen layout diagnostics';
  const refresh = document.createElement('button');
  refresh.type = 'button'; refresh.textContent = 'Refresh measurements';
  refresh.style.cssText = 'min-height:44px;padding:8px;color:inherit';
  const output = document.createElement('pre');
  output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
  const update = () => { output.textContent = JSON.stringify(readViewportDiagnostics(), null, 2); };
  refresh.addEventListener('click', update);
  panel.addEventListener('toggle', update);
  panel.append(summary, refresh, output);
  document.body.append(panel);
  return () => panel.remove();
}

export function installViewport(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const keys = ['--set-viewport-height', '--set-viewport-top'] as const;
  const previous = keys.map(key => root.style.getPropertyValue(key));
  const previousMode = root.getAttribute('data-set-viewport');
  const hadClass = root.classList.contains('set-app-viewport');
  const displays = ['standalone', 'fullscreen'].map(mode => window.matchMedia?.(`(display-mode: ${mode})`));
  let frame = 0;
  root.classList.add('set-app-viewport');

  const update = () => {
    frame = 0;
    if (document.hidden) return;
    const size = measureViewport(window.innerHeight, viewport, {
      standalone: isInstalledDisplayMode(), editing: isTextEditingTarget(document.activeElement),
    });
    if (!size) return;
    if (size.height === null) root.style.removeProperty(keys[0]);
    else root.style.setProperty(keys[0], `${size.height}px`);
    root.style.setProperty(keys[1], `${size.top}px`);
    root.dataset.setViewport = size.height === null ? 'standalone-css' : 'visual';
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  update();
  const removeDiagnostics = installDiagnostics();
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  displays.forEach(display => display?.addEventListener('change', schedule));

  return () => {
    cancelAnimationFrame(frame);
    removeDiagnostics();
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener('pageshow', schedule);
    document.removeEventListener('visibilitychange', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    displays.forEach(display => display?.removeEventListener('change', schedule));
    keys.forEach((key, i) => previous[i] ? root.style.setProperty(key, previous[i]) : root.style.removeProperty(key));
    if (previousMode === null) root.removeAttribute('data-set-viewport');
    else root.setAttribute('data-set-viewport', previousMode);
    if (!hadClass) root.classList.remove('set-app-viewport');
  };
}
