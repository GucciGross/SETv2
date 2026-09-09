import { describe, expect, it } from 'vitest';
import { approvalKey, approvalReducer, readApproval, toolFailure, type Approval } from './approvals';
import { resolveCopilotRoute } from './copilotRoutes';
const pending: Approval = { runId: 'run', callId: 'call', threadId: 'thread', spaceId: 'space', tool: 'h5p_create_draft', args: { title: 'Lesson' }, expiresAt: 1000, status: 'pending' };
describe('Copilot approval state', () => {
  it('deduplicates replayed requests without resurrecting a decided card', () => {
    const approved = { ...pending, status: 'approved' as const };
    expect(approvalReducer([approved], { type: 'request', approval: pending })).toEqual([approved]);
  });
  it('separates same tool-call ids across threads and runs', () => {
    const others = [{ ...pending, runId: 'other' }, { ...pending, threadId: 'other' }];
    const result = approvalReducer([pending, ...others], { type: 'update', key: approvalKey(pending), patch: { status: 'rejected' } });
    expect(result.map((a) => a.status)).toEqual(['rejected', 'pending', 'pending']);
  });
  it('never turns an approved receipt back into pending after a delayed network failure', () => {
    expect(approvalReducer([{ ...pending, status: 'approved' }], { type: 'update', key: approvalKey(pending), patch: { status: 'pending', error: 'offline' } })[0].status).toBe('approved');
  });
  it('ends only pending cards in the matching thread', () => {
    expect(approvalReducer([pending, { ...pending, threadId: 'other' }, { ...pending, callId: 'done', status: 'approved' }], { type: 'end', threadId: 'thread' }).map((a) => a.status)).toEqual(['cancelled', 'pending', 'approved']);
  });
  it('rejects malformed and cross-workspace events', () => {
    expect(readApproval(pending, 'space')).toEqual(pending);
    expect(readApproval(pending, 'different')).toBeUndefined();
    expect(readApproval({ ...pending, expiresAt: NaN }, 'space')).toBeUndefined();
    expect(readApproval({ ...pending, callId: '' }, 'space')).toBeUndefined();
  });
  it('keeps submitting separate from approval until the server acknowledges', () => {
    expect(approvalReducer([pending], { type: 'update', key: approvalKey(pending), patch: { submitting: true } })[0]).toMatchObject({ status: 'pending', submitting: true });
  });
  it('distinguishes expiration, cancellation, denial and execution failure', () => {
    expect(toolFailure(JSON.stringify({ approval: { status: 'expired' } }))).toContain('without a decision');
    expect(toolFailure({ rejected: true })).toContain('rejected');
    expect(toolFailure({ error: 'Missing content type' })).toBe('Missing content type');
    expect(toolFailure({ approval: { status: 'cancelled' } })).toContain('cancelled');
    expect(toolFailure({ activity: { id: 'ok' } })).toBeUndefined();
  });
});
describe('H5P navigation', () => {
  it('recognizes both Studio and individual activities', () => {
    expect(resolveCopilotRoute('/app/h5p', 'space')).toEqual({ to: '/app/space/space/h5p' });
    expect(resolveCopilotRoute('/app/space/space/h5p/activity', 'space')).toHaveProperty('to');
  });
  it('keeps established routes and rejects unknown or external destinations', () => {
    expect(resolveCopilotRoute('/app/notebooks', 'space')).toHaveProperty('to', '/app/space/space/notebooks');
    expect(resolveCopilotRoute('/app/space/space/page/id', 'space')).toHaveProperty('to');
    expect(resolveCopilotRoute('https://example.com', 'space')).toHaveProperty('error');
    expect(resolveCopilotRoute('/app/wrong', 'space')).toHaveProperty('error');
  });
  it('does not route a tool into another workspace', () => {
    expect(resolveCopilotRoute('/app/space/other/h5p/activity', 'space')).toHaveProperty('error');
  });
});
