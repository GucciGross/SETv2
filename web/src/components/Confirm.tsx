import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Promise-based confirm replacing window.confirm — bottom action sheet on
 * mobile (consistent with the other sheets), centered dialog on desktop.
 *
 *   if (!(await confirmDialog({ title: 'Delete this capture?', danger: true }))) return;
 *
 * Cancel / backdrop / Escape all resolve false. One dialog at a time; a
 * second request while open resolves false immediately.
 */

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

let current: ((v: boolean) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (current) return Promise.resolve(false); // one at a time; never queue prompts
  return new Promise<boolean>((resolve) => {
    current = resolve;
    for (const l of listeners) l(opts);
  });
}

let listeners: ((opts: ConfirmOptions) => void)[] = [];

export function ConfirmHost() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);

  useEffect(() => {
    const on = (o: ConfirmOptions) => setOpts(o);
    listeners.push(on);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && opts) settle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      listeners = listeners.filter((l) => l !== on);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);

  const settle = (v: boolean) => {
    setOpts(null);
    current?.(v);
    current = null;
  };

  if (!opts) return null;

  const body = (
    <>
      <div className="flex items-start gap-2.5">
        {opts.danger && <AlertTriangle size={16} className="text-amber-300 shrink-0 mt-0.5" />}
        <div className="min-w-0">
          <div className="text-sm text-white">{opts.title}</div>
          {opts.body && <div className="text-xs text-set-dim mt-1 leading-relaxed">{opts.body}</div>}
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button className={`flex-1 text-sm py-2 rounded-xl transition-colors ${opts.danger ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'set-btn-primary'}`} onClick={() => settle(true)}>
          {opts.confirmLabel ?? 'Confirm'}
        </button>
        <button className="flex-1 set-btn text-sm py-2" onClick={() => settle(false)}>
          {opts.cancelLabel ?? 'Cancel'}
        </button>
      </div>
    </>
  );

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/60" onClick={() => settle(false)} />
      {/* mobile: bottom sheet · desktop: centered dialog */}
      <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-[81] set-card p-4 rounded-2xl shadow-2xl sheet-in md:hidden max-h-[calc(100dvh-24px)] overflow-y-auto">
        {body}
      </div>
      <div className="hidden md:flex fixed inset-0 z-[81] items-center justify-center p-4 pointer-events-none">
        <div className="set-card bg-set-panel w-full max-w-sm p-5 shadow-2xl sheet-in pointer-events-auto">{body}</div>
      </div>
    </>
  );
}
