/** A single viewport authority for the shell and portalled Copilot.
 *
 * In a normal browser tab the VisualViewport is useful because browser chrome,
 * keyboard panning and the OSK can make the visible area smaller than the
 * layout viewport. Installed iOS web apps are different: WebKit can leave
 * visualViewport.height stuck too small after keyboard/orientation changes.
 * With no browser chrome to avoid, window.innerHeight is the safer authority at
 * rest. We only trust the smaller VisualViewport in an installed app while a
 * text-editing control is actually focused.
 *
 * Pinch zoom is intentionally ignored: accessibility zoom must not reflow the
 * application.
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
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return null;

  const layoutHeight = finitePositive(innerHeight) ? innerHeight : undefined;
  const visualHeight = viewport && finitePositive(viewport.height) ? viewport.height : undefined;

  // Home-screen iOS apps have no Safari toolbar. When idle, sizing the shell to
  // a stale, shorter visualViewport creates the exact blank band seen on real
  // devices. Do not use screen.height here: iOS may reserve system-owned pixels
  // that web content cannot render into. innerHeight/100dvh describes the DOM's
  // actual layout viewport.
  const useLayoutViewport = options.standalone && !options.editing && layoutHeight !== undefined;
  const height = useLayoutViewport ? layoutHeight : (visualHeight ?? layoutHeight);
  if (height === undefined) return null;

  const rawTop = useLayoutViewport ? 0 : (viewport?.offsetTop ?? 0);
  const top = Number.isFinite(rawTop) ? Math.max(0, rawTop) : 0;
  return {
    height: Math.round(height * 100) / 100,
    top: Math.round(top * 100) / 100,
  };
}

function isInstalledDisplayMode() {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone
    || window.matchMedia?.('(display-mode: standalone)').matches === true
    || window.matchMedia?.('(display-mode: fullscreen)').matches === true;
}

function isTextEditingTarget(element: Element | null) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) return false;

  const nonKeyboardTypes = new Set([
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
  ]);
  return !nonKeyboardTypes.has((element.type || 'text').toLowerCase());
}

export function installViewport(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const keys = ['--set-viewport-height', '--set-viewport-top'] as const;
  const previous = keys.map(key => root.style.getPropertyValue(key));
  let frame = 0;

  const update = () => {
    frame = 0;
    const size = measureViewport(window.innerHeight, viewport, {
      standalone: isInstalledDisplayMode(),
      editing: isTextEditingTarget(document.activeElement),
    });
    if (!size || document.hidden) return;
    root.style.setProperty(keys[0], `${size.height}px`);
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
    keys.forEach((key, i) => previous[i] ? root.style.setProperty(key, previous[i]) : root.style.removeProperty(key));
  };
}
