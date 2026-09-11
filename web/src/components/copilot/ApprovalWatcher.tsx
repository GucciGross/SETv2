import { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { ShieldQuestion, Check, X, Loader2 } from 'lucide-react';
import { CopilotChatToolCallsView, type CopilotChatToolCallsViewProps, useAgent } from '@copilotkit/react-core/v2';
import { api, ApiError } from '../../lib/api';
import { GUIDE_AGENT } from '../../lib/copilot';
import { useApp } from '../../stores/app';
import { approvalKey, approvalReducer, isApprovalStatus, readApproval, type Approval, type ApprovalStatus } from '../../lib/approvals';

const ApprovalContext = createContext<{
  approvals: Approval[];
  decide: (approval: Approval, decision: 'approve' | 'reject') => Promise<void>;
} | null>(null);

/** Non-visual event bridge. Lives OUTSIDE the popup's open/close lifecycle,
 * but every card is rendered INSIDE its matching chat tool call. */
export function ApprovalProvider({ children }: { children: React.ReactNode }) {
  const { agent } = useAgent({ agentId: GUIDE_AGENT });
  const spaceId = useApp((s) => s.currentSpaceId);
  const [approvals, dispatch] = useReducer(approvalReducer, []);
  const inFlight = useRef(new Set<string>());
  const current = useRef(approvals);
  current.current = approvals;

  useEffect(() => {
    if (!agent) return;
    const subscription = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name === 'approval_request') {
          const approval = readApproval(event.value, spaceId);
          if (approval) dispatch({ type: 'request', approval });
        } else if (event.name === 'approval_resolved') {
          const value = event.value as Partial<Approval> | undefined;
          if (!value || value.spaceId !== spaceId || !value.runId || !value.callId || !value.threadId || !isApprovalStatus(value.status)) return;
          dispatch({ type: 'update', key: approvalKey(value as Approval), patch: { status: value.status, submitting: false, error: undefined } });
        }
      },
      onRunFinishedEvent: ({ event }) => dispatch({ type: 'end', threadId: event.threadId }),
      onRunErrorEvent: () => dispatch({ type: 'end', threadId: agent.threadId }),
      onRunFinalized: () => dispatch({ type: 'end', threadId: agent.threadId }),
    });
    return () => subscription.unsubscribe();
  }, [agent, spaceId]);

  // Timers pause on mobile background tabs; compare absolute deadlines on resume.
  useEffect(() => {
    const expire = () => current.current.forEach((a) => {
      if (a.status === 'pending' && !a.submitting && a.expiresAt <= Date.now()) {
        dispatch({ type: 'update', key: approvalKey(a), patch: { status: 'expired' } });
      }
    });
    const timer = window.setInterval(expire, 1000);
    window.addEventListener('focus', expire);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', expire); };
  }, []);

  const decide = async (a: Approval, decision: 'approve' | 'reject') => {
    const key = approvalKey(a);
    const live = current.current.find((v) => approvalKey(v) === key);
    if (!live || live.status !== 'pending' || live.spaceId !== spaceId || live.threadId !== agent.threadId || inFlight.current.has(key)) return;
    if (live.expiresAt <= Date.now()) { dispatch({ type: 'update', key, patch: { status: 'expired' } }); return; }
    inFlight.current.add(key);
    dispatch({ type: 'update', key, patch: { submitting: true, error: undefined } });
    try {
      const response = await api.post<{ callId: string; status: unknown }>(`/agent/runs/${a.runId}/approve`, { callId: a.callId, decision });
      if (response.callId !== a.callId || !isApprovalStatus(response.status) || response.status === 'pending') throw new Error('Approval was not acknowledged. Retry to check this action.');
      dispatch({ type: 'update', key, patch: { status: response.status, submitting: false } });
    } catch (error) {
      // Do not optimistically say "Approved". A retry is safe and scoped to the same call.
      let status: ApprovalStatus = live.status;
      let message = error instanceof Error ? error.message : 'Could not send your decision. Please retry.';
      if (error instanceof ApiError && [403, 404, 409].includes(error.status)) status = 'unavailable';
      try {
        // The server may have accepted a decision whose HTTP acknowledgement was lost.
        const receipt = await api.get<{ callId: string; status: unknown }>(`/agent/runs/${a.runId}/approvals/${encodeURIComponent(a.callId)}`);
        if (receipt.callId === a.callId && isApprovalStatus(receipt.status) && receipt.status !== 'pending') {
          status = receipt.status;
          message = '';
        }
      } catch { /* Keep the visible error and a safe retry of this exact call. */ }
      dispatch({ type: 'update', key, patch: { status, submitting: false, error: message || undefined } });
    } finally { inFlight.current.delete(key); }
  };
  return <ApprovalContext.Provider value={{ approvals, decide }}>{children}</ApprovalContext.Provider>;
}

/** Keep vendor tool renderers, but place each approval at its exact chronological call. */
export function SetToolCallsView({ message, messages }: CopilotChatToolCallsViewProps) {
  const context = useContext(ApprovalContext);
  const { agent } = useAgent({ agentId: GUIDE_AGENT });
  if (!message.toolCalls?.length) return null;
  return <div className="min-w-0 space-y-2" data-set-tool-calls>
    {message.toolCalls.map((call) => {
      const approval = context?.approvals.find((a) => a.callId === call.id && a.threadId === agent.threadId);
      return <div key={call.id} className="min-w-0">
        {approval && <ApprovalCard approval={approval} onDecision={context!.decide} />}
        {(!approval || approval.status === 'approved') && <CopilotChatToolCallsView message={{ ...message, toolCalls: [call] }} messages={messages} />}
      </div>;
    })}
  </div>;
}

/** Required decisions stay in the voice body even though the transcript is absent.
 * No new approval endpoint, optimistic decision, or second tool executor. */
export function VoiceApprovals() {
  const context = useContext(ApprovalContext);
  const { agent } = useAgent({ agentId: GUIDE_AGENT });
  const spaceId = useApp(s => s.currentSpaceId);
  const pending = context?.approvals.filter(a => a.threadId === agent.threadId && a.spaceId === spaceId && a.status === 'pending') ?? [];
  if (!pending.length) return null;
  return <div className="set-voice-approvals" role="region" aria-label="Voice action approvals">
    {pending.map(a => <ApprovalCard key={approvalKey(a)} approval={a} onDecision={context!.decide} />)}
  </div>;
}

const labels: Record<string, string> = {
  h5p_create_draft: 'Create an H5P draft', h5p_save_draft: 'Save the H5P draft',
  h5p_publish_activity: 'Publish this learning activity', h5p_attach_activity: 'Attach this learning activity',
  generate_study_material: 'Generate study material', create_page: 'Create a page',
  update_page: 'Update this page', create_notebook: 'Create a notebook', screen_act: 'Operate your computer',
};

export function ApprovalCard({ approval: a, onDecision }: {
  approval: Approval; onDecision: (approval: Approval, decision: 'approve' | 'reject') => Promise<void>;
}) {
  const ref = useRef<HTMLElement>(null);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    if (a.status === 'pending') ref.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [a.status]);
  const args = a.args && typeof a.args === 'object' ? a.args as Record<string, unknown> : {};
  const summary = [args.title, args.topic].find((v) => typeof v === 'string') as string | undefined;
  const statusText = {
    pending: 'Review before Copilot makes this change.', approved: 'Approved — see the execution result below.',
    rejected: 'Rejected. This action was not run.', expired: 'Expired without a decision. No approval was granted; ask Copilot again.',
    cancelled: 'This request ended before a decision. Ask Copilot again to continue.',
    unavailable: 'This approval is no longer available. Ask Copilot again; no new action was approved.',
  }[a.status];
  return <section ref={ref} data-set-approval data-status={a.status}
    aria-label={labels[a.tool] ?? a.tool.replace(/_/g, ' ')}
    className="my-2 min-w-0 max-w-full rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
    <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
      <ShieldQuestion size={16} className="shrink-0" aria-hidden />
      {a.status === 'pending' ? 'Approve this action?' : 'Approval decision'}
    </div>
    <p className="mt-2 text-sm font-medium break-words">{labels[a.tool] ?? a.tool.replace(/_/g, ' ')}</p>
    {summary && <p className="mt-1 text-xs break-words">{summary}</p>}
    <p className="mt-1 text-xs text-set-dim" role="status">{statusText}</p>
    <button type="button" className="mt-1 min-h-[44px] text-xs text-set-dim underline underline-offset-2"
      aria-expanded={details} onClick={() => setDetails(!details)}>Action details</button>
    {details && <div className="min-w-0 text-xs">
      <p className="font-mono break-all">{a.tool}</p>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px] text-set-dim">{JSON.stringify(a.args, null, 2)}</pre>
    </div>}
    {a.error && <p role="alert" className="mt-1 text-xs text-red-300 break-words">{a.error}</p>}
    {a.status === 'pending' && <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={a.submitting} className="set-btn-primary min-h-[44px] text-sm inline-flex items-center gap-2 disabled:opacity-60"
        onClick={() => void onDecision(a, 'approve')}>
        {a.submitting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />} {a.submitting ? 'Sending…' : 'Approve'}
      </button>
      <button type="button" disabled={a.submitting} className="set-btn min-h-[44px] text-sm inline-flex items-center gap-2 disabled:opacity-60"
        onClick={() => void onDecision(a, 'reject')}><X size={16} aria-hidden /> Deny</button>
    </div>}
  </section>;
}
