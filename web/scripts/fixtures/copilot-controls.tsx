/** Browser-only fixtures: real SET shell and controls, synthetic agent and microphone. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { CopilotKit } from '@copilotkit/react-core/v2';
import { AbstractAgent } from '@ag-ui/client';
import type { BaseEvent } from '@ag-ui/core';
import { Observable } from 'rxjs';
import { AppShellInner } from '../../src/components/AppShell';
import SettingsView from '../../src/views/SettingsView';
import DashboardView from '../../src/views/DashboardView';
import { CopilotCoreBridge } from '../../src/lib/copilot';
import { CopilotInteractionProvider } from '../../src/components/copilot/CopilotDock';
import { DEFAULT_MASCOT } from '../../src/components/Mascot';
import { useApp } from '../../src/stores/app';
import '../../src/index.css';
import styles from 'virtual:copilotkit-v2-styles';
const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
const spaceId = '10000000-0000-4000-8000-000000000001';
const fixture = (window as any).controlsFixture = { calls: [] as any[], stoppedTracks: 0, permissionRequests: 0, deferPermission: false, denyPermission: false, grant: () => {}, hideMascot: () => {}, studio: () => {} };
useApp.setState({ currentSpaceId: spaceId, user: { id: 'tester', name: 'Test author', email: 'tester@example.invalid', onboarding: { welcomed: true }, mascot: { ...DEFAULT_MASCOT, enabled: false } } as any, spaces: [{ id: spaceId, name: 'Robotics lab', kind: 'team', icon: '', role: 'owner' }], shellMode: 'simple' });
fixture.hideMascot = () => useApp.setState(s => ({ user: { ...s.user, mascot: { ...DEFAULT_MASCOT, enabled: false } } as any }));
fixture.studio = () => useApp.getState().setShellMode('studio');
class FixtureAgent extends AbstractAgent {
  run(input: any) {
    return new Observable<BaseEvent>(subscriber => {
      fixture.calls.push({ threadId: input.threadId, messages: structuredClone(input.messages) });
      const messageId = crypto.randomUUID();
      const send = (type: string, rest = {}) => subscriber.next({ type, ...rest } as BaseEvent);
      send('RUN_STARTED', { threadId: input.threadId, runId: input.runId });
      send('TEXT_MESSAGE_START', { messageId, role: 'assistant' });
      send('TEXT_MESSAGE_CONTENT', { messageId, delta: `Received in the same Copilot conversation: ${input.messages.filter((m: any) => m.role === 'user').at(-1)?.content}` });
      send('TEXT_MESSAGE_END', { messageId });
      send('RUN_FINISHED', { threadId: input.threadId, runId: input.runId });
      subscriber.complete();
    });
  }
}
const audio = () => ({ getTracks: () => [{ stop: () => { fixture.stoppedTracks++; } }] });
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
  fixture.permissionRequests++;
  if (fixture.denyPermission) throw new DOMException('Denied', 'NotAllowedError');
  if (fixture.deferPermission) return new Promise(resolve => { fixture.grant = () => resolve(audio()); });
  return audio();
} });
class Recorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm'; onstop?: () => void; ondataavailable?: (e: any) => void;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['synthetic audio'], { type: 'audio/webm' }) }); this.onstop?.(); }); }
}
(window as any).MediaRecorder = Recorder;
window.speechSynthesis.speak = () => {};
function Surface() {
  const location = useLocation();
  return <div className="p-5 sm:p-10 max-w-4xl mx-auto">
    <div className="set-mono text-set-accent mb-5">ROBOTICS LAB / WORKSPACE</div>
    <h1 className="text-3xl text-set-text font-semibold mb-3">Make knowledge useful.</h1>
    <p className="text-set-dim max-w-lg mb-8">Keep your research, learning material and tools together. Your Copilot is here to help you work.</p>
    <div className="set-card p-5 mb-4"><div className="set-mono text-set-dim mb-3">CURRENT PROJECT</div><h2 className="text-lg text-set-text">Robotic arm — learning notebook</h2><p className="text-sm text-set-dim mt-2">Mechanics, joint limits and the next experiment.</p></div>
    <p className="text-xs text-set-dim" data-fixture-route>{location.pathname}</p>
    <p className="text-xs text-set-dim mt-8">Interface test · synthetic workspace content</p>
  </div>;
}
const agent = new FixtureAgent({ agentId: 'set_guide' });
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[`/app/space/${spaceId}${location.search.includes('settings') ? '/settings' : ''}`]}>
    <CopilotKit selfManagedAgents={{ set_guide: agent }} enableInspector={false}>
      <CopilotCoreBridge /><CopilotInteractionProvider>
        <Routes><Route path="/app/space/:spaceId" element={<AppShellInner />}>
          <Route path="settings" element={<SettingsView />} /><Route path="*" element={<Surface />} /><Route index element={location.search.includes('dashboard') ? <DashboardView /> : <Surface />} />
        </Route></Routes>
      </CopilotInteractionProvider>
    </CopilotKit>
  </MemoryRouter>
);
