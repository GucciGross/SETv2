import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { marked } from 'marked';
import { Sparkles, Send, Wrench, ShieldQuestion, Check, X, Square } from 'lucide-react';
import Mascot, { DEFAULT_MASCOT, type MascotConfig } from './Mascot';
import { api, sse } from '../lib/api';
import { useApp } from '../stores/app';
import { A2UIRenderer, type A2UIComponent } from './A2UI';

/**
 * AG-UI client: streams agent lifecycle events (RUN_STARTED, TEXT_MESSAGE_CONTENT,
 * TOOL_CALL_START/END, CUSTOM a2ui/approval, RUN_FINISHED) and renders
 * A2UI generative components + human-in-the-loop approvals inline.
 */

interface ChatItem {
  kind: 'user' | 'assistant' | 'tool' | 'a2ui' | 'approval' | 'error';
  text?: string;
  tool?: { name: string; args: any; ok?: boolean; result?: any };
  component?: A2UIComponent;
  approval?: { runId: string; callId: string; tool: string; args: any; resolved?: 'approve' | 'reject' };
}

const md = (s: string) => ({ __html: marked.parse(s, { async: false }) as string });

export default function CopilotPanel() {
  const { spaceId, pageId, nbId, modelId } = useParams();
  const location = useLocation();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onPanelTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onPanelTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dy = start.y - t.clientY; // positive = swiped up
    const dx = Math.abs(t.clientX - start.x);
    if (dy > 70 && dx < 60) setCopilotOpen(false);
  };
  const [celebrate, setCelebrate] = useState(false);
  const user = useApp((st) => st.user);
  const setCopilotOpen = useApp((st) => st.setCopilotOpen);
  const mascot: MascotConfig = (user as any)?.mascot ?? DEFAULT_MASCOT;
  const mood = celebrate ? 'celebrating' : busy ? 'talking' : 'idle';
  const threadRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<string>('');

  // capture text selection as agent context
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection()?.toString() ?? '';
      if (sel.length > 10) selectionRef.current = sel.slice(0, 1000);
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, []);

  // external ask triggers (e.g. "Explain this actuator" from the 3D viewer)
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail as string;
      if (text) {
        useApp.getState().setCopilotOpen(true);
        run(text);
      }
    };
    window.addEventListener('set:ask-copilot', handler);
    return () => window.removeEventListener('set:ask-copilot', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, pageId, nbId, modelId, busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  const run = async (message: string) => {
    if (!spaceId || !message.trim() || busy) return;
    setItems((xs) => [...xs, { kind: 'user', text: message }]);
    setInput('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await sse(
        '/agent/run',
        {
          spaceId,
          threadId: threadRef.current ?? undefined,
          message,
          context: {
            pageId,
            notebookId: nbId,
            modelId,
            selection: selectionRef.current || undefined,
          },
        },
        {
          RUN_STARTED: (d) => {
            if (!threadRef.current) threadRef.current = d.threadId;
          },
          TEXT_MESSAGE_CONTENT: (d) => {
            setItems((xs) => {
              const last = xs[xs.length - 1];
              if (last?.kind === 'assistant') return [...xs.slice(0, -1), { kind: 'assistant', text: (last.text ?? '') + d.delta }];
              return [...xs, { kind: 'assistant', text: d.delta }];
            });
          },
          TOOL_CALL_START: (d) => {
            setItems((xs) => [...xs, { kind: 'tool', tool: { name: d.name, args: d.args } }]);
          },
          TOOL_CALL_END: (d) => {
            setItems((xs) => {
              for (let i = xs.length - 1; i >= 0; i--) {
                if (xs[i].kind === 'tool' && xs[i].tool && !('ok' in (xs[i].tool as any))) {
                  const copy = [...xs];
                  copy[i] = { ...copy[i], tool: { ...copy[i].tool!, ok: d.ok, result: d.result } };
                  return copy;
                }
              }
              return xs;
            });
          },
          CUSTOM: (d) => {
            if (d.subtype === 'a2ui') {
              setItems((xs) => [...xs, ...d.components.map((c: A2UIComponent) => ({ kind: 'a2ui' as const, component: c }))]);
            } else if (d.subtype === 'approval_request') {
              setItems((xs) => [...xs, { kind: 'approval', approval: { runId: d.runId, callId: d.callId, tool: d.tool, args: d.args } }]);
            }
          },
          RUN_ERROR: (d) => setItems((xs) => [...xs, { kind: 'error', text: d.message }]),
          RUN_FINISHED: () => {
            setCelebrate(true);
            setTimeout(() => setCelebrate(false), 2600);
          },
        },
        controller.signal
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') setItems((xs) => [...xs, { kind: 'error', text: e.message }]);
    } finally {
      setBusy(false);
      selectionRef.current = '';
    }
  };

  const resolveApproval = async (item: ChatItem, decision: 'approve' | 'reject') => {
    if (!item.approval) return;
    await api.post(`/agent/runs/${item.approval.runId}/approve`, { decision });
    setItems((xs) =>
      xs.map((x) => (x.approval?.callId === item.approval!.callId ? { ...x, approval: { ...x.approval!, resolved: decision } } : x))
    );
  };

  return (
    <aside
      className="w-full sm:w-[400px] h-full max-w-full shrink-0 border-l border-set-border bg-set-panel flex flex-col overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      onTouchStart={onPanelTouchStart}
      onTouchEnd={onPanelTouchEnd}
    >
      <div className="h-12 px-3 border-b border-set-border flex items-center gap-2">
        <span className="text-[9px] text-set-dim/70 hidden max-sm:inline select-none">swipe up to close</span>
        <Mascot config={mascot} mood={mood} size={30} />
        <div className="leading-tight">
          <div className="font-semibold text-sm">{mascot.name}</div>
          <div className="text-[9px] text-set-dim uppercase tracking-wide">Copilot · AG-UI · A2UI</div>
        </div>
        <span className="ml-auto text-[10px] text-set-dim">
          {pageId ? 'ctx: page' : nbId ? 'ctx: notebook' : modelId ? 'ctx: model' : ''}
        </span>
        <button
          className="set-btn-ghost p-1.5 shrink-0"
          title="Close copilot"
          aria-label="Close copilot"
          onClick={() => setCopilotOpen(false)}
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-3 space-y-3">
        {items.length === 0 && (
          <div className="text-sm text-set-dim space-y-2 fadein">
            <p> Your workspace agent. It can:</p>
            <ul className="list-disc pl-4 space-y-1 text-xs">
              <li>search &amp; read pages, create or update them</li>
              <li>answer from notebook sources with citations</li>
              <li>generate flashcards / quizzes / study guides</li>
              <li>open 3D models and render rich UI cards</li>
            </ul>
            <p className="text-xs">Try: <em>"Summarize this page"</em>, <em>"Create a page about X"</em>, <em>"Quiz me on the notebook"</em></p>
          </div>
        )}
        {items.map((item, i) => {
          if (item.kind === 'user')
            return (
              <div key={i} className="fadein flex justify-end">
                <div className="bg-set-accent/25 border border-set-accent/40 rounded-xl rounded-br-sm px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap">{item.text}</div>
              </div>
            );
          if (item.kind === 'assistant')
            return (
              <div key={i} className="fadein prose-set text-sm max-w-none" dangerouslySetInnerHTML={md(item.text ?? '')} />
            );
          if (item.kind === 'error')
            return <div key={i} className="fadein text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded-lg p-2">{item.text}</div>;
          if (item.kind === 'tool') {
            const t = item.tool!;
            const failed = t.ok === false;
            const rejected = t.result?.rejected;
            return (
              <div key={i} className={`fadein text-xs border rounded-lg p-2 ${failed ? 'border-red-500/30 bg-red-500/5' : 'border-set-border bg-set-panel2'}`}>
                <div className="flex items-center gap-1.5">
                  <Wrench size={12} className={t.ok === undefined ? 'text-amber-300 animate-pulse' : failed ? 'text-red-400' : 'text-green-400'} />
                  <span className="font-mono">{t.name}</span>
                  {rejected && <span className="text-set-dim">· rejected by user</span>}
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-set-dim">args</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-set-dim">{JSON.stringify(t.args, null, 1)}</pre>
                </details>
                {t.result && !rejected && (
                  <details className="mt-0.5">
                    <summary className="cursor-pointer text-set-dim">result</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-words overflow-hidden text-[10px] text-set-dim">{JSON.stringify(t.result, null, 1).slice(0, 2000)}</pre>
                  </details>
                )}
              </div>
            );
          }
          if (item.kind === 'a2ui')
            return <A2UIRenderer key={i} component={item.component!} onFormSubmit={(values) => run(`Form submitted: ${JSON.stringify(values)}`)} />;
          if (item.kind === 'approval') {
            const a = item.approval!;
            return (
              <div key={i} className="fadein border border-amber-500/40 bg-amber-500/10 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-sm font-medium text-amber-200">
                  <ShieldQuestion size={14} /> Approve action
                </div>
                <div className="text-xs mt-1 font-mono">{a.tool}</div>
                <pre className="mt-1 text-[10px] text-set-dim whitespace-pre-wrap break-all max-h-32 overflow-auto">{JSON.stringify(a.args, null, 1)}</pre>
                {a.resolved ? (
                  <div className={`mt-2 text-xs ${a.resolved === 'approve' ? 'text-green-400' : 'text-red-400'}`}>
                    {a.resolved === 'approve' ? ' Approved — running' : ' Rejected'}
                  </div>
                ) : (
                  <div className="flex gap-2 mt-2">
                    <button className="set-btn-primary text-xs flex items-center gap-1" onClick={() => resolveApproval(item, 'approve')}><Check size={12} /> Approve</button>
                    <button className="set-btn text-xs flex items-center gap-1" onClick={() => resolveApproval(item, 'reject')}><X size={12} /> Reject</button>
                  </div>
                )}
              </div>
            );
          }
          return null;
        })}
        {busy && (
          <button className="text-xs text-set-dim flex items-center gap-1 hover:text-set-text" onClick={() => abortRef.current?.abort()}>
            <Square size={10} /> stop
          </button>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="p-3 border-t border-set-border flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(input);
        }}
      >
        <textarea
          className="set-input resize-none max-h-32"
          rows={2}
          placeholder={location.pathname.includes('/notebook/') ? 'Ask about these sources…' : 'Ask the copilot…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              run(input);
            }
          }}
        />
        <button className="set-btn-primary h-9 w-9 flex items-center justify-center shrink-0" disabled={busy || !input.trim()}>
          <Send size={15} />
        </button>
      </form>
    </aside>
  );
}
