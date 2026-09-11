/** A single visible viewport for the shell and portalled Copilot.
 * Do not infer keyboard height from screen/innerHeight or subtract it twice.
 * Ignore pinch zoom: accessibility zoom must not reflow the application.
 */
export function measureViewport(innerHeight: number, viewport?: Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'> | null) {
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return null;
  const height = viewport?.height ?? innerHeight;
  if (!Number.isFinite(height) || height <= 0) return null;
  const top = viewport?.offsetTop ?? 0;
  return { height: Math.round(height * 100) / 100, top: Number.isFinite(top) ? Math.max(0, top) : 0 };
}

export function installViewport(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const keys = ['--set-viewport-height', '--set-viewport-top'] as const;
  const previous = keys.map(key => root.style.getPropertyValue(key));
  let frame = 0;
  const update = () => {
    frame = 0;
    const size = measureViewport(window.innerHeight, viewport);
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
  return () => {
    cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener('pageshow', schedule);
    document.removeEventListener('visibilitychange', schedule);
    keys.forEach((key, i) => previous[i] ? root.style.setProperty(key, previous[i]) : root.style.removeProperty(key));
  };
}
