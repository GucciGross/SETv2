/** Shared geometry for the app shell, drawer and portalled Copilot.
 * Browser tabs follow the visible area so their toolbars/keyboard stay clear.
 * Installed apps at rest use a live CSS viewport length, NOT a pixel snapshot:
 * iOS can leave both innerHeight and VisualViewport shorter than its CSS canvas.
 * The footer owns its safe-area padding separately; never subtract it here.
 */
export type ViewportMeasureOptions = {
  standalone?: boolean;
  editing?: boolean;
};

const finitePositive = (value: number | undefined): value is number =>
  Number.isFinite(value) && Number(value) > 0;

export function measureViewport(
  innerHeight: number,
  viewport?: Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'> | null,
  options: ViewportMeasureOptions = {},
) {
  // Do not reflow accessible pinch zoom or replace the last keyboard geometry.
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return null;

  // No browser toolbar exists in standalone/fullscreen mode. Keeping this as
  // CSS also lets rotation/window resizing recover without a JS resize event.
  // Never use screen.height: that includes pixels the OS may not give the app.
  if (options.standalone && !options.editing) return { height: '100vh' as const, top: 0 };

  const layoutHeight = finitePositive(innerHeight) ? innerHeight : undefined;
  const visualHeight = viewport && finitePositive(viewport.height) ? viewport.height : undefined;
  const height = visualHeight ?? layoutHeight;
  if (height === undefined) return null;
  const rawTop = viewport?.offsetTop ?? 0;
  const top = Number.isFinite(rawTop) ? Math.max(0, rawTop) : 0;
  return { height: Math.round(height * 100) / 100, top: Math.round(top * 100) / 100 };
}

function isTextEditingTarget(element: Element | null) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) return false;
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']
    .includes((element.type || 'text').toLowerCase());
}

export function installViewport(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const modes = ['standalone', 'fullscreen'].map(mode => window.matchMedia(`(display-mode: ${mode})`));
  const keys = ['--set-viewport-height', '--set-viewport-top'] as const;
  const previous = keys.map(key => root.style.getPropertyValue(key));
  const previousInstalled = root.getAttribute('data-set-installed');
  let frame = 0;

  const update = () => {
    frame = 0;
    if (document.hidden) return;
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
      || modes.some(mode => mode.matches);
    root.toggleAttribute('data-set-installed', standalone);
    const size = measureViewport(window.innerHeight, viewport, {
      standalone,
      editing: isTextEditingTarget(document.activeElement),
    });
    if (!size) return;
    root.style.setProperty(keys[0], typeof size.height === 'number' ? `${size.height}px` : size.height);
    root.style.setProperty(keys[1], `${size.top}px`);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

  update();
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  modes.forEach(mode => mode.addEventListener?.('change', schedule));

  return () => {
    cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener('pageshow', schedule);
    document.removeEventListener('visibilitychange', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    modes.forEach(mode => mode.removeEventListener?.('change', schedule));
    keys.forEach((key, i) => previous[i] ? root.style.setProperty(key, previous[i]) : root.style.removeProperty(key));
    if (previousInstalled === null) root.removeAttribute('data-set-installed');
    else root.setAttribute('data-set-installed', previousInstalled);
  };
}
