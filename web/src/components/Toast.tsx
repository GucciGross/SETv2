import { useEffect, useState } from 'react';

/**
 * Minimal toast system — replaces window.alert for non-blocking feedback
 * (errors, confirmations). `toast(msg)` from anywhere; <Toasts /> mounted
 * once in the shell renders them under the top bar with auto-dismiss.
 */

interface ToastItem {
  id: number;
  msg: string;
  kind: 'error' | 'ok' | 'info';
}

let listeners: ((t: ToastItem) => void)[] = [];
let nextId = 1;

export function toast(msg: string, kind: ToastItem['kind'] = 'info') {
  const item = { id: nextId++, msg, kind };
  for (const l of listeners) l(item);
}

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const on = (t: ToastItem) => {
      setItems((cur) => [...cur.slice(-2), t]); // keep at most 3 stacked
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), 3800);
    };
    listeners.push(on);
    return () => {
      listeners = listeners.filter((l) => l !== on);
    };
  }, []);

  return (
    <div className="fixed top-14 inset-x-3 z-[100] flex flex-col gap-1.5 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={`set-card px-3 py-2 text-xs shadow-xl sheet-in pointer-events-auto ${
            t.kind === 'error'
              ? 'border-red-400/40 text-red-200'
              : t.kind === 'ok'
                ? 'border-green-400/40 text-green-200'
                : 'text-set-text'
          }`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
