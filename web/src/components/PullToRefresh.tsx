import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Mobile pull-to-refresh for any view inside the shell's scroll container:
 * pull past 64px (rubber-banded) while at the top → spinner fills, release
 * triggers onRefresh, content rides along partway like a native list.
 * Touch-only, so desktop is untouched.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => void | Promise<void>; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const pullRef = useRef(0);
  const busyRef = useRef(false);
  const start = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    // the shell's scroll container is tagged explicitly — a plain .overflow-y-auto
    // closest() can accidentally bind to an inner scroll area instead
    const scroller = (wrap?.closest('[data-scroll-root]') ?? wrap?.closest('.overflow-y-auto')) as HTMLElement | null;
    if (!scroller) return;

    const setP = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };

    // listeners live on window: real touch streams always reach it regardless
    // of which inner element the gesture starts on, and the tagged scroller's
    // scrollTop decides whether the pull applies to this view
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || busyRef.current) return;
      start.current = scroller.scrollTop <= 2 ? e.touches[0].clientY : null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current;
      setP(dy > 0 ? Math.min(dy * 0.45, 92) : 0);
    };
    const onTouchEnd = async () => {
      if (start.current == null) return;
      start.current = null;
      if (pullRef.current >= 64) {
        setBusy(true);
        busyRef.current = true;
        setP(64); // hold the indicator while refreshing
        try {
          await onRefresh();
        } finally {
          setBusy(false);
          busyRef.current = false;
          setP(0);
        }
      } else {
        setP(0);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [onRefresh]);

  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(pull / 64, 1);

  return (
    <div ref={wrapRef} className="contents">
      {/* indicator under the top bar */}
      <div
        className="fixed top-[52px] inset-x-0 z-30 flex justify-center pointer-events-none transition-opacity"
        style={{ opacity: pull > 0 || busy ? 1 : 0 }}
      >
        <div
          className={`w-8 h-8 rounded-full bg-set-panel border border-set-border flex items-center justify-center shadow-lg ${busy ? 'ptr-spin' : ''}`}
          style={{ transform: `translateY(${Math.min(pull, 56) * 0.5}px)` }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" className={busy ? 'ptr-rot' : ''}>
            <circle cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeWidth="2" className="text-set-border" />
            <circle
              cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeWidth="2" className="text-set-accent"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - (busy ? 0.75 : progress))}
              transform="rotate(-90 12 12)"
            />
          </svg>
        </div>
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull * 0.4}px)` : undefined,
          transition: start.current == null ? 'transform 0.2s ease-out' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}
