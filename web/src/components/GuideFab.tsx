import { useEffect } from 'react';
import { CopilotPopup, useAgent, useConfigureSuggestions } from '@copilotkit/react-core/v2';
import { useApp } from '../stores/app';
import { GuideTools } from './copilot/GuideTools';
import { SetToolRenderers } from './copilot/ToolRenderers';
import { ApprovalWatcher } from './copilot/ApprovalWatcher';
import { askAgent, GUIDE_AGENT } from '../lib/copilot';
import Mascot, { DEFAULT_MASCOT, type MascotConfig } from './Mascot';

/**
 * THE SET copilot — one floating overlay on every view (CopilotKit's built-in
 * toggle, restyled as the SET launcher in index.css). It's the onboarding
 * companion and the workspace assistant in one: it sees the current screen,
 * writes into the open note, spotlights UI, runs the tour, navigates — and has
 * the full server toolkit (pages, notebooks, decks) with approvals.
 */

const SUGGESTIONS = [
  { title: 'Show me around SET', message: 'Give me the full tour of this workspace.' },
  { title: 'What am I looking at?', message: 'Explain what is on my screen right now and what I can do here.' },
  { title: 'Help me write', message: 'Help me fill out the note I have open. Ask me what it should cover, then insert it into the note.' },
  { title: 'Set up my workspace', message: "I'm new here — help me get this workspace ready: first page, links, and the right work surfaces." },
];

/** Welcome screen: the user's own mascot introduces the copilot. */
function SetWelcomeScreen({ input, suggestionView }: { input?: React.ReactNode; suggestionView?: React.ReactNode }) {
  const user = useApp((s) => s.user);
  const mascot: MascotConfig = (user as any)?.mascot ?? DEFAULT_MASCOT;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 py-8 text-center overflow-y-auto">
      <Mascot config={mascot} mood="talking" size={76} />
      <div>
        <div className="text-base font-semibold text-white">{mascot.name}</div>
        <div className="text-xs text-set-dim mt-1 max-w-[280px] mx-auto leading-relaxed">
          Your on-screen guide — explains this screen, writes into your notes, and runs the workspace for you.
        </div>
      </div>
      {suggestionView && <div className="w-full max-w-[300px] flex flex-col gap-1.5">{suggestionView}</div>}
      {input && <div className="w-full max-w-[340px] mt-1">{input}</div>}
    </div>
  );
}

export default function GuideFab() {
  const user = useApp((s) => s.user);
  const mascotEnabled = (user as any)?.mascot?.enabled !== false;
  const { agent } = useAgent({ agentId: GUIDE_AGENT });

  // onboarding suggestion pills in the welcome screen
  useConfigureSuggestions({
    suggestions: SUGGESTIONS.map((s) => ({ ...s, className: 'set-suggestion-pill' })),
    available: 'before-first-message',
    consumerAgentId: GUIDE_AGENT,
  });

  // first-run: gently pulse the launcher until the copilot is opened once
  useEffect(() => {
    if (!mascotEnabled) return;
    if (!localStorage.getItem('set_guide_opened')) document.body.classList.add('set-guide-intro');
    const onDocClick = (e: Event) => {
      if ((e.target as Element)?.closest?.("[data-slot='chat-toggle-button']")) {
        localStorage.setItem('set_guide_opened', '1');
        document.body.classList.remove('set-guide-intro');
      }
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [mascotEnabled]);

  // external ask triggers (e.g. "Explain this actuator" in the 3D viewer):
  // open the overlay and send the message through the guide agent
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail as string;
      if (!text) return;
      document.querySelector<HTMLButtonElement>("[data-slot='chat-toggle-button']")?.click();
      if (agent) void askAgent(agent, text);
    };
    window.addEventListener('set:ask-copilot', handler);
    return () => window.removeEventListener('set:ask-copilot', handler);
  }, [agent]);

  if (!mascotEnabled) return null;

  return (
    <>
      <GuideTools />
      <SetToolRenderers />
      <ApprovalWatcher />
      <CopilotPopup
        agentId={GUIDE_AGENT}
        // CopilotPopup's defaultOpen defaults to TRUE — must start closed.
        defaultOpen={false}
        labels={{
          modalHeaderTitle: 'SET Copilot',
          welcomeMessageText: 'Your on-screen guide — ask anything, or pick a starter:',
          chatInputPlaceholder: 'Ask anything, or “what am I looking at?”…',
          chatDisclaimerText: '',
          chatToggleOpenLabel: 'Open the SET copilot',
          chatToggleCloseLabel: 'Close the SET copilot',
        }}
        width={400}
        className="copilotkit-set-guide"
        welcomeScreen={SetWelcomeScreen}
      />
    </>
  );
}
