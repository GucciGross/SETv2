import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useApp } from '../../stores/app';
import { Check, Circle, Rocket, X, Sparkles } from 'lucide-react';
import { startTour } from '../../lib/tour';

const STEPS: { id: string; label: string; hint: string; to?: string }[] = [
  { id: 'page', label: 'Create a page', hint: 'The Page button in the sidebar', to: 'page' },
  { id: 'link', label: 'Link two pages', hint: 'Type [[Another Page]] — it builds the graph', to: 'graph' },
  { id: 'provider', label: 'Connect an AI provider', hint: 'Bring your own key — chat and RAG turn on', to: 'settings' },
  { id: 'copilot', label: 'Ask the copilot something', hint: 'It reads and writes your workspace', to: 'copilot' },
  { id: 'invite', label: 'Invite a teammate', hint: 'Share the workspace with your team', to: 'settings' },
];

/**
 * Activation checklist for the dashboard. Completion comes from the server
 * (derived from real workspace data), so it can never drift from reality.
 */
export default function Checklist({ onRevealWelcome }: { onRevealWelcome?: () => void }) {
  const { spaceId } = useParams();
  const navigate = useNavigate();
  const { user } = useApp();
  const [items, setItems] = useState<{ id: string; done: boolean }[]>([]);
  const [hidden, setHidden] = useState((user as any)?.onboarding?.checklistHidden ?? false);

  const load = async () => {
    if (!spaceId) return;
    const r = await api.get(`/users/onboarding?spaceId=${spaceId}`).catch(() => null);
    if (r?.checklist) setItems(r.checklist);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000); // re-derive while the user works
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  if (hidden || !items.length) return null;
  const done = items.filter((i) => i.done).length;
  const all = items.length;
  const complete = done === all;

  const dismiss = async () => {
    setHidden(true);
    await api.put('/users/onboarding', { checklistHidden: true });
    useApp.setState({ user: { ...(user as any), onboarding: { ...(user as any)?.onboarding, checklistHidden: true } } });
  };

  const go = (to?: string) => {
    if (to === 'copilot') {
      // open the floating copilot overlay (CopilotKit's built-in toggle)
      document.querySelector<HTMLButtonElement>("[data-slot='chat-toggle-button']")?.click();
    } else if (to) {
      navigate(`/app/space/${spaceId}/${to === 'page' ? '' : to}`.replace(/\/$/, ''));
    }
  };

  return (
    <div className="set-card p-4 mb-6 relative">
      <button className="absolute top-3 right-3 text-set-dim hover:text-set-text" onClick={dismiss} aria-label="Dismiss setup checklist">
        <X size={14} />
      </button>
      <div className="flex items-center gap-2 mb-1">
        <Rocket size={15} className="text-set-accent" />
        <h3 className="text-sm font-semibold text-white">{complete ? 'Workspace ready' : 'Get this workspace ready'}</h3>
        <span className="text-xs text-set-dim">{done} of {all}</span>
      </div>
      <div className="h-1 bg-set-panel2 rounded-full overflow-hidden mb-3 mt-2">
        <div className="h-full bg-set-accent transition-all duration-500" style={{ width: `${(done / all) * 100}%` }} />
      </div>
      <div className="space-y-0.5">
        {STEPS.map((s) => {
          const state = items.find((i) => i.id === s.id);
          const isDone = !!state?.done;
          return (
            <button
              key={s.id}
              onClick={() => !isDone && go(s.to)}
              className={`w-full flex items-start gap-2.5 py-1.5 px-1 rounded text-left ${isDone ? 'opacity-60 cursor-default' : 'hover:bg-set-panel2/40'}`}
            >
              <span className={`mt-0.5 shrink-0 ${isDone ? 'text-green-400' : 'text-set-dim'}`}>
                {isDone ? <Check size={15} /> : <Circle size={15} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block text-sm ${isDone ? 'text-set-dim line-through' : 'text-white'}`}>{s.label}</span>
                {!isDone && <span className="block text-[11px] text-set-dim">{s.hint}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {complete && (
        <div className="mt-3 pt-3 border-t border-set-border/50 flex items-center gap-2 text-xs text-set-dim">
          <Sparkles size={13} className="text-green-400" /> All set — this workspace is fully activated.
        </div>
      )}
      <div className="mt-3 pt-2 border-t border-set-border/40 flex gap-3 text-[11px]">
        <button className="text-set-accent hover:underline" onClick={() => startTour()}>
          Replay the tour
        </button>
        {onRevealWelcome && (
          <button className="text-set-dim hover:text-set-text" onClick={onRevealWelcome}>
            Change starter setup
          </button>
        )}
      </div>
    </div>
  );
}
