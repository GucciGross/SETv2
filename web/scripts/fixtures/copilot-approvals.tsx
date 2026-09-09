/** Deterministic test agent, never imported by the production application. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CopilotKit } from '@copilotkit/react-core/v2';
import type { BaseEvent } from '@ag-ui/core';
import { AbstractAgent } from '@ag-ui/client';
import { Observable } from 'rxjs';
import GuideFab from '../../src/components/GuideFab';
import { CopilotCoreBridge } from '../../src/lib/copilot';
import { useApp } from '../../src/stores/app';
import '../../src/index.css';
import styles from 'virtual:copilotkit-v2-styles';
const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
const spaceId = '10000000-0000-4000-8000-000000000001';
useApp.setState({ currentSpaceId: spaceId, user: { id: 'author', name: 'Author', email: 'author@example.invalid' }, spaces: [{ id: spaceId, name: 'Training', kind: 'team', icon: '', role: 'owner' }] });
const fixture = (window as any).approvalFixture = { timeoutMs: 180000, calls: [], finish: (_status: string) => {}, repeat: () => {} };
class FixtureAgent extends AbstractAgent {
  run(input: any) {
    return new Observable<BaseEvent>((subscriber) => {
      const callId = crypto.randomUUID(), runId = crypto.randomUUID(), messageId = `tc-${callId}`;
      const send = (type: string, rest = {}) => subscriber.next({ type, ...rest } as BaseEvent);
      send('RUN_STARTED', { threadId: input.threadId, runId: input.runId });
      send('TEXT_MESSAGE_START', { messageId, role: 'assistant' });
      send('TOOL_CALL_START', { toolCallId: callId, toolCallName: 'h5p_create_draft' });
      send('TOOL_CALL_ARGS', { toolCallId: callId, delta: JSON.stringify({ title: 'Threshold Hunter — interactive lesson' }) });
      const request = { runId, callId, threadId: input.threadId, spaceId, tool: 'h5p_create_draft', args: { title: 'Threshold Hunter — interactive lesson' }, expiresAt: Date.now() + fixture.timeoutMs };
      fixture.repeat = () => send('CUSTOM', { name: 'approval_request', value: request });
      fixture.repeat();
      fixture.finish = (status: string) => {
        send('CUSTOM', { name: 'approval_resolved', value: { ...request, status } });
        send('TOOL_CALL_END', { toolCallId: callId });
        send('TOOL_CALL_RESULT', { messageId, role: 'tool', toolCallId: callId, content: JSON.stringify(status === 'approved'
          ? { activity: { id: '10000000-0000-4000-8000-000000000002', spaceId, title: request.args.title, draftRevision: 0, publishedRevision: null } }
          : { executed: false, approval: { status }, ...(status === 'rejected' ? { rejected: true } : {}) }) });
        send('TEXT_MESSAGE_END', { messageId });
        send('RUN_FINISHED', { threadId: input.threadId, runId: input.runId });
        subscriber.complete();
      };
      return () => {};
    });
  }
}
const agent = new FixtureAgent({ agentId: 'set_guide' });
createRoot(document.getElementById('root')!).render(<MemoryRouter><CopilotKit selfManagedAgents={{ set_guide: agent }} enableInspector={false}>
  <CopilotCoreBridge />
  <main className="p-6"><h1 className="text-lg">Learning workspace</h1><p className="text-set-dim">Copilot approvals must stay inside the conversation.</p></main>
  <GuideFab />
</CopilotKit></MemoryRouter>);
