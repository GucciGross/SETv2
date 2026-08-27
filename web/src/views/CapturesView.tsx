import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, getToken } from '../lib/api';
import { Camera, MousePointerClick, Trash2, X, MonitorSmartphone } from 'lucide-react';

/**
 * Capture history — every screenshot the computer-use tools persisted,
 * newest first. Turns an agent computer-use session into a reviewable
 * activity log: what the agent saw, and what it looked like after each
 * action (the "after" capture of every click/type/key/scroll).
 */

function captureSrc(c: any): string {
  return `${c.url}${c.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(getToken())}`;
}

function ActionChip({ action }: { action: string }) {
  const isAct = action.startsWith('act:');
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border shrink-0 whitespace-nowrap ${isAct ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-set-border bg-set-panel2 text-set-dim'}`}>
      {isAct ? <MousePointerClick size={10} /> : <Camera size={10} />}
      {isAct ? action.slice(4) : 'capture'}
    </span>
  );
}

export default function CapturesView() {
  const { spaceId } = useParams();
  const [captures, setCaptures] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any | null>(null);

  const load = () =>
    api.get(`/spaces/${spaceId}/companion/captures?limit=120`).then((r) => setCaptures(r.captures)).catch(() => setCaptures([]));
  useEffect(() => {
    load();
  }, [spaceId]);

  // Esc closes the lightbox
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSel(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const del = async (c: any) => {
    if (!confirm('Delete this capture from the history?')) return;
    try {
      await api.del(`/spaces/${spaceId}/companion/captures/${c.id}`);
      setCaptures((cs) => cs?.filter((x) => x.id !== c.id) ?? null);
      if (sel?.id === c.id) setSel(null);
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2"><Camera size={22} /> Capture history</h1>
      <p className="text-set-dim text-sm mb-6">
        Every screenshot your copilot took on this machine — the reviewable log of what the agent saw and did.
        Computer use is visible-actions-only and input requires your companion to run with <code className="text-violet-300">SET_ALLOW_INPUT=1</code>.
      </p>

      {!captures && <p className="text-set-dim text-sm">Loading…</p>}

      {captures?.length === 0 && (
        <div className="set-card p-6 text-center">
          <MonitorSmartphone size={28} className="mx-auto text-set-dim mb-2" />
          <p className="text-sm text-set-dim">
            No captures yet. They appear here when the copilot uses <code className="text-violet-300">screen_capture</code> / <code className="text-violet-300">screen_act</code>{' '}
            while driving a desktop app — see <Link className="text-blue-300 underline underline-offset-2" to={`/app/space/${spaceId}/settings`}>Settings → Companion</Link> for setup.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {captures?.map((c) => (
          <div key={c.id} className="set-card overflow-hidden group">
            <button className="block w-full" onClick={() => setSel(c)} title="Open capture">
              <img
                src={captureSrc(c)}
                alt={`${c.action} — ${c.window_title ?? 'window'}`}
                loading="lazy"
                className="w-full h-32 object-cover object-top hover:opacity-90 transition-opacity bg-set-panel2"
              />
            </button>
            <div className="px-2.5 py-2 flex items-center gap-1.5">
              <ActionChip action={c.action} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-set-text truncate" title={c.window_title ?? ''}>{c.window_title ?? 'window'}</div>
                <div className="text-[10px] text-set-dim">{new Date(c.created_at).toLocaleString()}</div>
              </div>
              <button
                className="set-btn-ghost opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 shrink-0"
                title="Delete capture"
                onClick={() => del(c)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {sel && (
        <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4" onClick={() => setSel(null)}>
          <div className="max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2 text-sm">
              <ActionChip action={sel.action} />
              <span className="text-white truncate flex-1">{sel.window_title ?? 'window'}</span>
              <span className="text-xs text-set-dim shrink-0">
                {sel.width && sel.height ? `${sel.width}×${sel.height} · ` : ''}{new Date(sel.created_at).toLocaleString()}
              </span>
              <button className="set-btn-ghost hover:text-red-400 p-1" title="Delete" onClick={() => del(sel)}><Trash2 size={14} /></button>
              <button className="set-btn-ghost p-1" title="Close" onClick={() => setSel(null)}><X size={16} /></button>
            </div>
            <img
              src={captureSrc(sel)}
              alt={`${sel.action} — ${sel.window_title ?? 'window'}`}
              className="max-h-[78vh] max-w-full mx-auto rounded-lg border border-set-border"
              onClick={() => setSel(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
