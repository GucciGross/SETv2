import { useEffect, useState } from 'react';
import { Compass, MessageSquarePlus, X } from 'lucide-react';
import { CopilotPopup, useAgent, useConfigureSuggestions } from '@copilotkit/react-core/v2';
import { useApp } from '../stores/app';
import { GuideTools } from './copilot/GuideTools';
import { SetToolRenderers } from './copilot/ToolRenderers';
import { ApprovalWatcher } from './copilot/ApprovalWatcher';
import { askAgent, GUIDE_AGENT } from '../lib/copilot';
import Mascot, { DEFAULT_MASCOT, type MascotConfig } from './Mascot';
import { uuid } from '../lib/utils';

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

/** Launcher icons for the built-in toggle (props-object slot: keeps the
 * vendor's click handler while giving the button SET's identity). */
function CopilotOpenIcon() {
  return <Compass size={16} aria-hidden className="text-violet-300" />;
}
function CopilotCloseIcon() {
  return <X size={16} aria-hidden className="text-violet-200" />;
}

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

  // Persistent conversation: the thread id survives open/close (stored), so
  // the chat picks up where it left off. "New chat" rotates the id.
  const [threadId, setThreadId] = useState(() => localStorage.getItem('set_copilot_thread') ?? uuid());
  const [hasHistory, setHasHistory] = useState(() => !!localStorage.getItem('set_copilot_thread'));
  useEffect(() => {
    localStorage.setItem('set_copilot_thread', threadId);
  }, [threadId]);
  // once the thread has messages, bind it explicitly (keeps history across
  // open/close); a fresh thread stays unbound so the welcome screen shows
  useEffect(() => {
    if (!hasHistory && agent?.messages?.length) setHasHistory(true);
  }, [agent?.messages?.length, hasHistory]);
  const startNewChat = () => {
    const id = uuid();
    setHasHistory(false);
    setThreadId(id);
  };

  // chat header: default title/close + a "new chat" action
  const header = {
    children: ({ titleContent, closeButton }: any) => (
      <div className="flex w-full items-center gap-1">
        {titleContent}
        <button
          className="ml-auto p-1.5 rounded-md text-set-dim hover:text-set-text hover:bg-set-panel2 text-xs flex items-center gap-1"
          title="Start a new chat"
          onClick={startNewChat}
        >
          <MessageSquarePlus size={14} />
          <span className="hidden sm:inline">New chat</span>
        </button>
        {closeButton}
      </div>
    ),
  };

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
        threadId={hasHistory ? threadId : undefined}
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
        header={header}
        welcomeScreen={SetWelcomeScreen}
        toggleButton={{ openIcon: CopilotOpenIcon, closeIcon: CopilotCloseIcon }}
      />
    </>
  );
}
