import { useRef, type TouchEvent } from 'react';

/**
 * Swipe-down-to-dismiss for mobile bottom sheets: the sheet follows the
 * finger while dragging, closes past ~80px or on a fast flick, and springs
 * back otherwise. Touches that start on interactive content (inputs,
 * buttons, scrollable lists) are ignored so the gesture never fights the
 * content.
 */
export function useSheetDrag(onClose: () => void) {
  const startY = useRef<number | null>(null);
  const delta = useRef(0);
  const lastDelta = useRef(0);

  const onTouchStart = (e: TouchEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, button, a, select, label')) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0].clientY;
    delta.current = 0;
    lastDelta.current = 0;
  };

  const onTouchMove = (e: TouchEvent<HTMLElement>) => {
    if (startY.current == null) return;
    delta.current = Math.max(0, e.touches[0].clientY - startY.current);
    lastDelta.current = delta.current - lastDelta.current; // rough velocity signal
    const el = e.currentTarget;
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta.current}px)`;
  };

  const onTouchEnd = (e: TouchEvent<HTMLElement>) => {
    if (startY.current == null) return;
    const el = e.currentTarget;
    el.style.transition = 'transform 0.18s ease-out';
    el.style.transform = '';
    if (delta.current > 80 || lastDelta.current > 24) onClose();
    startY.current = null;
  };

  return { onTouchStart, onTouchMove, onTouchEnd };
}
