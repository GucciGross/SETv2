/** Per-call approval gates. A timeout is never a user's rejection. */
export type ApprovalDecision = 'approve' | 'reject';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
export type ApprovalOutcome = Exclude<ApprovalStatus, 'pending'>;
export interface ApprovalRequest {
  runId: string;
  callId: string;
  threadId: string;
  spaceId: string;
  tool: string;
  args: unknown;
}
export interface ApprovalSnapshot extends ApprovalRequest {
  status: ApprovalStatus;
  expiresAt: number;
}
interface Gate {
  snapshot: ApprovalSnapshot;
  finish: (status: ApprovalOutcome) => void;
}

/** One bounded process-local registry shared by the engine and authenticated REST routes.
 * Completed receipts allow a lost HTTP acknowledgement to be retried without executing twice.
 * A server restart invalidates gates; it NEVER implies approval. */
export class ApprovalGates {
  private gates = new Map<string, Gate>();
  constructor(private timeoutMs = 180_000, private receiptMs = 300_000) {}
  private key(runId: string, callId: string) { return JSON.stringify([runId, callId]); }

  request(request: ApprovalRequest, options: {
    signal?: AbortSignal;
    onRequest?: (snapshot: ApprovalSnapshot) => void;
  } = {}): Promise<ApprovalOutcome> {
    const key = this.key(request.runId, request.callId);
    if (this.gates.has(key)) throw new Error('Approval already exists for this tool call');
    return new Promise((resolve) => {
      const snapshot: ApprovalSnapshot = { ...request, status: 'pending', expiresAt: Date.now() + this.timeoutMs };
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = () => finish('cancelled');
      const finish = (status: ApprovalOutcome) => {
        if (snapshot.status !== 'pending') return;
        snapshot.status = status;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        // Bound retained receipts, including rejected/expired requests.
        const cleanup = setTimeout(() => this.gates.delete(key), this.receiptMs);
        cleanup.unref?.();
        resolve(status);
      };
      // Register BEFORE publishing the event: a fast response must find its gate.
      this.gates.set(key, { snapshot, finish });
      timer = setTimeout(() => finish('expired'), this.timeoutMs);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) { finish('cancelled'); return; }
      try { options.onRequest?.({ ...snapshot }); }
      catch { finish('cancelled'); }
    });
  }

  get(runId: string, callId: string): ApprovalSnapshot | undefined {
    const gate = this.gates.get(this.key(runId, callId));
    if (!gate) return undefined;
    if (gate.snapshot.status === 'pending' && Date.now() >= gate.snapshot.expiresAt) gate.finish('expired');
    return { ...gate.snapshot };
  }

  decide(runId: string, callId: string, decision: ApprovalDecision): ApprovalSnapshot | undefined {
    const current = this.get(runId, callId);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    // A stale call, expired grant or contradictory retry cannot settle another action.
    if (!current || (current.status !== 'pending' && current.status !== status)) return undefined;
    this.gates.get(this.key(runId, callId))!.finish(status);
    return this.get(runId, callId);
  }
}
export const approvalGates = new ApprovalGates();

export function approvalStopResult(status: ApprovalOutcome, skipped = false) {
  const note = status === 'rejected'
    ? 'The user rejected this action. Stop; do not substitute another write tool.'
    : status === 'expired'
      ? 'Approval expired without a decision. The user did NOT reject it. Ask again before making any change.'
      : 'The run was cancelled. No approval was granted.';
  return { executed: false, approval: { status }, ...(status === 'rejected' ? { rejected: true } : {}), skipped, note };
}
