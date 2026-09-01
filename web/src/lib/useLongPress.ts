import { useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';

/**
 * Long-press (hold ~480ms without moving) for touch + mouse; right-click on
 * desktop triggers immediately. Cancels on movement or early release, so it
 * never fires during a scroll or a normal tap.
 */
export function useLongPress(onLongPress: () => void, ms = 480) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  };

  return {
    onPointerDown: (e: ReactPointerEvent) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, ms);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!start.current || !timer.current) return;
      if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      if (!fired.current) {
        fired.current = true;
        onLongPress();
      }
    },
  };
}
