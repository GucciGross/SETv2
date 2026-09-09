/** Approval state is keyed by thread + server run + tool call, never a tool name. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'unavailable';
export interface Approval {
  runId: string; callId: string; threadId: string; spaceId: string;
  tool: string; args: unknown; expiresAt: number; status: ApprovalStatus;
  submitting?: boolean; error?: string;
}
export const approvalKey = (a: Pick<Approval, 'threadId' | 'runId' | 'callId'>) => JSON.stringify([a.threadId, a.runId, a.callId]);
const statuses: ApprovalStatus[] = ['pending', 'approved', 'rejected', 'expired', 'cancelled', 'unavailable'];
export const isApprovalStatus = (v: unknown): v is ApprovalStatus => statuses.includes(v as ApprovalStatus);
export function readApproval(value: unknown, spaceId: string | null): Approval | undefined {
  if (!value || typeof value !== 'object') return;
  const a = value as Record<string, unknown>;
  if (!['runId', 'callId', 'threadId', 'spaceId', 'tool'].every((key) => typeof a[key] === 'string' && (a[key] as string).length > 0)) return;
  if (a.spaceId !== spaceId || typeof a.expiresAt !== 'number' || !Number.isFinite(a.expiresAt)) return;
  return { ...a, status: 'pending' } as unknown as Approval;
}
export type ApprovalAction =
  | { type: 'request'; approval: Approval }
  | { type: 'update'; key: string; patch: Partial<Pick<Approval, 'status' | 'submitting' | 'error'>> }
  | { type: 'end'; threadId: string };
export function approvalReducer(state: Approval[], action: ApprovalAction): Approval[] {
  if (action.type === 'request') {
    // Replayed events must not re-enable a decision which has already settled.
    return state.some((a) => approvalKey(a) === approvalKey(action.approval)) ? state : [...state, action.approval];
  }
  if (action.type === 'end') return state.map((a) => a.threadId === action.threadId && a.status === 'pending'
    ? { ...a, status: 'cancelled', submitting: false } : a);
  return state.map((a) => approvalKey(a) === action.key ? {
    ...a, ...action.patch,
    // A delayed error/response can never resurrect an already settled card.
    status: a.status !== 'pending' && (action.patch.status === 'pending' || action.patch.status === 'unavailable') ? a.status : action.patch.status ?? a.status,
  } : a);
}
export function parseToolResult(value: unknown): any {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
export function toolFailure(value: unknown): string | undefined {
  const result = parseToolResult(value);
  if (!result || typeof result !== 'object') return;
  if (result.approval?.status === 'expired') return 'Approval expired without a decision. No change was made.';
  if (result.approval?.status === 'cancelled') return 'Request cancelled. No change was made.';
  if (result.rejected || result.approval?.status === 'rejected') return 'Action rejected. No change was made.';
  if (result.error) return typeof result.error === 'string' ? result.error : 'This action could not be completed.';
  if (result.ok === false || result.executed === false) return result.note ?? 'This action was not completed.';
}
