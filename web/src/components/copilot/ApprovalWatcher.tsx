import { useEffect, useState } from 'react';
import { ShieldQuestion, Check, X } from 'lucide-react';
import { useAgent } from '@copilotkit/react-core/v2';
import { api } from '../../lib/api';
import { GUIDE_AGENT } from '../../lib/copilot';

/**
 * Human-in-the-loop approvals for write tools. The server engine pauses the
 * run and emits an AG-UI CUSTOM event (name "approval_request"); we render the
 * card here and resolve through the legacy REST endpoint, which unblocks the
 * engine's pending promise in the same server process.
 */

interface Approval {
  runId: string;
  callId: string;
  tool: string;
  args: any;
  resolved?: 'approve' | 'reject';
}

export function ApprovalWatcher() {
  const { agent } = useAgent({ agentId: GUIDE_AGENT });
  const [approvals, setApprovals] = useState<Approval[]>([]);

  useEffect(() => {
    if (!agent) return;
    const sub = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event.name === 'approval_request') {
          const v = event.value as any;
          setApprovals((xs) => [...xs, { runId: v.runId, callId: v.callId, tool: v.tool, args: v.args }]);
        }
      },
    });
    return () => sub.unsubscribe();
  }, [agent]);

  if (!approvals.some((a) => !a.resolved)) return null;

  const resolve = async (a: Approval, decision: 'approve' | 'reject') => {
    setApprovals((xs) => xs.map((x) => (x.callId === a.callId ? { ...x, resolved: decision } : x)));
    try {
      await api.post(`/agent/runs/${a.runId}/approve`, { decision });
    } catch {
      setApprovals((xs) => xs.map((x) => (x.callId === a.callId ? { ...x, resolved: undefined } : x)));
    }
  };

  return (
    <div className="px-3 pb-2 space-y-2">
      {approvals.map((a) => (
        <div key={a.callId} className="fadein border border-amber-500/40 bg-amber-500/10 rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-200">
            <ShieldQuestion size={14} /> Approve action
          </div>
          <div className="text-xs mt-1 font-mono">{a.tool}</div>
          <pre className="mt-1 text-[10px] text-set-dim whitespace-pre-wrap break-all max-h-32 overflow-auto">{JSON.stringify(a.args, null, 1)}</pre>
          {a.resolved ? (
            <div className={`mt-2 text-xs ${a.resolved === 'approve' ? 'text-green-400' : 'text-red-400'}`}>
              {a.resolved === 'approve' ? 'Approved — running' : 'Rejected'}
            </div>
          ) : (
            <div className="flex gap-2 mt-2">
              <button className="set-btn-primary text-xs flex items-center gap-1" onClick={() => resolve(a, 'approve')}>
                <Check size={12} /> Approve
              </button>
              <button className="set-btn text-xs flex items-center gap-1" onClick={() => resolve(a, 'reject')}>
                <X size={12} /> Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
