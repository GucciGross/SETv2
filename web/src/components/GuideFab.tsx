import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, PanelRightClose, PanelRightOpen } from 'lucide-react';
import {
  CopilotPopup,
  CopilotChatAssistantMessage,
  useAgent,
  UseAgentUpdate,
  useCopilotChatConfiguration,
} from '@copilotkit/react-core/v2';
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
 *
 * Thread handling: we never pass a `threadId` prop. CopilotKit keeps an
 * uncontrolled thread per mount, which is exactly right — the id is stable for
 * the component's life, so messages survive open/close, and the welcome screen
 * shows whenever the thread is empty. (Passing a threadId that flips from
 * undefined to a stored id after the first message made CopilotKit treat it as
 * a thread switch and clear the thread mid-run — the "first message vanishes"
 * bug. This CopilotKit release doesn't restore server-side history on reload,
 * so persisting the id bought nothing.)
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
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="text-violet-300">
      {/* dithered compass needle: 2×2 pixel blocks instead of a smooth glyph */}
      {[
        [7, 1], [8, 1], [7, 2], [8, 2],
        [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3],
        [4, 4], [5, 4], [10, 4], [11, 4],
        [3, 5], [4, 5], [11, 5], [12, 5],
        [2, 6], [3, 6], [12, 6], [13, 6],
        [2, 7], [13, 7], [2, 8], [13, 8],
        [2, 9], [3, 9], [12, 9], [13, 9],
        [3, 10], [4, 10], [11, 10], [12, 10],
        [4, 11], [5, 11], [10, 11], [11, 11],
        [7, 12], [8, 12], [7, 13], [8, 13],
      ].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill="currentColor" />
      ))}
      <rect x="7" y="7" width="2" height="2" fill="currentColor" />
    </svg>
  );
}
function CopilotCloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="text-violet-200">
      {[[2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10], [10, 2], [9, 3], [3, 9], [2, 10], [4, 8], [8, 4], [5, 7], [7, 5], [6, 6]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="1.4" height="1.4" fill="currentColor" />
      ))}
    </svg>
  );
}

/** Welcome screen: the user's own mascot introduces the copilot. Starter
 * pills are rendered directly (sending through the agent on click) — the
 * vendor's auto-suggestion pipeline never mounted them reliably, and a welcome
 * without its starters is exactly the "boring empty box" we're fixing.
 * On mobile the whole thing must fit the compact sheet with no scrolling,
 * so every block carries a hook that the mobile CSS in index.css tightens. */
function SetWelcomeScreen({ input }: { input?: React.ReactNode; suggestionView?: React.ReactNode }) {
  const user = useApp((s) => s.user);
  const mascot: MascotConfig = (user as any)?.mascot ?? DEFAULT_MASCOT;
  const { agent } = useAgent({ agentId: GUIDE_AGENT });
  const isMobile = useIsMobileViewport();
  return (
    <div className={`set-welcome${isMobile ? ' set-welcome-m' : ''}`}>
      <div className="set-welcome-plate set-corners tex-dither rounded-lg">
        <Mascot config={mascot} mood="talking" size={isMobile ? 54 : 76} />
      </div>
      <div>
        <div className="set-mono set-mono-dim">{isMobile ? 'guide // online' : 'GUIDE // ONLINE'}</div>
        <div className="set-welcome-name text-base font-semibold text-white mt-1">{mascot.name}</div>
        <div className="set-welcome-blurb text-xs text-set-dim mt-1 max-w-[280px] mx-auto leading-relaxed">
          Your on-screen guide — explains this screen, writes into your notes, and runs the workspace for you.
        </div>
      </div>
      <div className="set-welcome-starters">
        {SUGGESTIONS.map((s) => (
          <button key={s.title} className="set-suggestion-pill" onClick={() => void askAgent(agent, s.message)}>
            {s.title}
          </button>
        ))}
      </div>
      {input && <div className="set-welcome-input">{input}</div>}
    </div>
  );
}

/** Desktop panel preference: docked = full-height right rail (VS Code style),
 * undocked = the floating window. One body class drives all of the styling in
 * index.css; the choice persists across sessions. */
export function setCopilotDocked(docked: boolean) {
  document.body.classList.toggle('copilot-docked', docked);
  localStorage.setItem('set_copilot_docked', docked ? '1' : '0');
}

/** Chat header: SET mono identity + "new chat" via CopilotKit's own
 * startNewThread (rotates the thread id and clears messages in one call).
 * The runtime value carries it in this release even though the public
 * interface doesn't declare it — hence the defensive access. */
function SetChatHeader({ titleContent, closeButton }: { titleContent?: React.ReactNode; closeButton?: React.ReactNode }) {
  const config = useCopilotChatConfiguration();
  const startNewThread = (config as any)?.startNewThread as (() => void) | undefined;
  const [docked, setDocked] = useState(() => document.body.classList.contains('copilot-docked'));
  return (
    <div className="flex w-full items-center gap-2 pr-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-set-ok animate-pulse shrink-0" aria-hidden />
      <div className="set-mono text-white/90">{titleContent}</div>
      <button
        className="ml-auto p-1.5 rounded-md text-set-dim hover:text-set-text hover:bg-set-panel2 text-xs flex items-center gap-1 transition-colors"
        title="Start a new chat"
        onClick={() => startNewThread?.()}
      >
        <MessageSquarePlus size={14} />
        <span className="hidden sm:inline">New chat</span>
      </button>
      <button
        className="hidden md:inline-flex p-1.5 rounded-md text-set-dim hover:text-set-text hover:bg-set-panel2 transition-colors"
        title={docked ? 'Undock — floating window' : 'Dock to right panel'}
        onClick={() => {
          const next = !docked;
          setDocked(next);
          setCopilotDocked(next);
        }}
      >
        {docked ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
      </button>
      {closeButton}
    </div>
  );
}

/** The header must be passed in its object form: a component-type header slot
 * is invoked with NO props (renderSlot({})), so the vendor-bound title and
 * close button only exist through this children render-prop. */
const SET_HEADER = {
  children: ({ titleContent, closeButton }: any) => (
    <SheetDragZone>
      <SetChatHeader titleContent={titleContent} closeButton={closeButton} />
    </SheetDragZone>
  ),
};

/** Mobile swipe-to-dismiss. The header bar is the grab zone (plus the visible
 * grabber pill in index.css): dragging translates the whole sheet through
 * --set-dy while the scrim fades through --set-drag-p; releasing past a
 * distance/velocity threshold slides the sheet out and closes it, anything
 * less springs back. Pointer Events cover real fingers (pointerType 'touch')
 * and, on mobile-width viewports only, a mouse drag. Buttons in the bar still
 * tap normally — a drag only starts after 8px of movement, and the click a
 * release would synthesize is swallowed. Desktop never sees the listeners. */
function SheetDragZone({ children }: { children: React.ReactNode }) {
  const config = useCopilotChatConfiguration();
  const zoneRef = useRef<HTMLDivElement>(null);
  const isOpen = !!config?.isModalOpen;
  // via ref so the listener effect below depends only on isOpen — a rebind
  // mid-gesture would cancel an in-progress drag
  const closeRef = useRef(() => (config as any)?.setModalOpen?.(false));
  closeRef.current = () => (config as any)?.setModalOpen?.(false);

  // any (re)open starts from a clean drag state — this also covers a fast
  // reopen while the close-out timers at the bottom are still pending
  useEffect(() => {
    resetSheetDragState();
  }, [isOpen]);

  useEffect(() => {
    const el = zoneRef.current;
    if (!el || !window.matchMedia('(max-width: 767px)').matches) return;
    const root = document.documentElement;
    let pointerId = -1;
    let startY = 0, startT = 0, dy = 0;
    let prevY = 0, prevT = 0, lastY = 0, lastT = 0;
    let active = false;
    let dragging = false;
    let closeTimer: number | undefined;
    let settleTimer: number | undefined;

    // a completed drag must not synthesize a click on whatever header button
    // it started on (touch usually suppresses it; mouse pointers don't)
    const swallowClick = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const swallowNextClick = () => {
      window.addEventListener('click', swallowClick, { capture: true, once: true });
      settleTimer = window.setTimeout(() => {
        window.removeEventListener('click', swallowClick, { capture: true });
      }, 400);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!isOpen || active) return;
      pointerId = e.pointerId;
      startY = prevY = lastY = e.clientY;
      startT = prevT = lastT = performance.now();
      dy = 0;
      active = true;
      dragging = false;
      window.clearTimeout(closeTimer);
      window.clearTimeout(settleTimer);
      // no setPointerCapture here: capturing on down would retarget the
      // synthesized click away from the header buttons (New chat / close).
      // Touch pointers are implicitly captured anyway; mouse gets captured
      // below, once the gesture is provably a drag.
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!active || e.pointerId !== pointerId) return;
      dy = Math.max(0, e.clientY - startY);
      prevY = lastY; prevT = lastT;
      lastY = e.clientY; lastT = performance.now();
      if (!dragging && dy > 8) {
        dragging = true;
        document.body.classList.add('set-sheet-dragging');
        try { el.setPointerCapture(e.pointerId); } catch { /* released */ }
      }
      if (!dragging) return;
      e.preventDefault();
      root.style.setProperty('--set-dy', `${dy}px`);
      root.style.setProperty('--set-drag-p', String(Math.min(1, dy / 260)));
    };
    const onPointerUp = () => {
      if (!active) return;
      active = false;
      document.body.classList.remove('set-sheet-dragging');
      document.body.classList.add('set-sheet-release');
      // flick detection: velocity of the last gesture segment, falling back
      // to the whole-gesture average when the release is a dead stop
      const segDt = Math.max(1, lastT - prevT);
      const segVel = (lastY - prevY) / segDt;
      const avgVel = dy / Math.max(1, lastT - startT);
      const vel = segDt < 120 ? segVel : avgVel;
      const sheetH = document.querySelector<HTMLElement>('[data-copilot-popup]')?.offsetHeight ?? 480;
      const shouldClose = dragging && (dy > Math.max(120, sheetH * 0.32) || vel > 0.55);
      if (shouldClose) {
        document.body.classList.add('set-sheet-closing');
        root.style.setProperty('--set-dy', `${window.innerHeight + 160}px`);
        root.style.setProperty('--set-drag-p', '1');
        // let the slide-out finish before the vendor's unmount animation runs
        closeTimer = window.setTimeout(() => closeRef.current(), 300);
        settleTimer = window.setTimeout(resetSheetDragState, 640);
      } else {
        root.style.setProperty('--set-dy', '0px');
        root.style.setProperty('--set-drag-p', '0');
        settleTimer = window.setTimeout(() => {
          document.body.classList.remove('set-sheet-release');
          window.removeEventListener('click', swallowClick, { capture: true });
        }, 500);
      }
      if (dragging) swallowNextClick();
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove, { passive: false });
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      window.clearTimeout(closeTimer);
      window.clearTimeout(settleTimer);
      if (dragging) resetSheetDragState();
    };
  }, [isOpen]);

  return (
    <div ref={zoneRef} className="set-drag-zone relative w-full">
      <div className="set-sheet-grabber" aria-hidden />
      {children}
    </div>
  );
}

/** Back to rest: sheet seated, scrim fully on, no transition classes left. */
function resetSheetDragState() {
  document.body.classList.remove('set-sheet-dragging', 'set-sheet-release', 'set-sheet-closing');
  document.documentElement.style.setProperty('--set-dy', '0px');
  document.documentElement.style.setProperty('--set-drag-p', '0');
}

/** Watches the guide thread and flips body.set-chat-live once the user has
 * sent their first message: the mobile sheet then sits full screen (CSS in
 * index.css) instead of compact. "New chat" empties the thread → the class
 * drops and the sheet glides back down to the welcome size. Lives outside
 * the popup's render tree so streaming re-renders stay local to this noop. */
function SheetModeWatcher() {
  const { agent } = useAgent({
    agentId: GUIDE_AGENT,
    updates: [UseAgentUpdate.OnMessagesChanged],
    throttleMs: 250,
  });
  const live = !!agent.messages?.some((m: any) => m?.role === 'user');
  useEffect(() => {
    document.body.classList.toggle('set-chat-live', live);
    return () => document.body.classList.remove('set-chat-live');
  }, [live]);
  return null;
}

/**
 * Assistant messages: keep ALL of CopilotKit's message machinery (markdown,
 * tool-call view, hover toolbar) by composing the stock component with its
 * children render-prop — we only add the chrome around it: the user's mascot
 * on a dithered plate and a mono name label, like an operator console.
 */
function SetAssistantMessage({ children, message, messages, isRunning, ...props }: any) {
  const user = useApp((s) => s.user);
  const mascot: MascotConfig = (user as any)?.mascot ?? DEFAULT_MASCOT;
  // the mascot leans in only while THIS message is the one streaming
  const isLatest = messages?.[messages.length - 1]?.id === message?.id;
  const streaming = !!isRunning && isLatest;
  return (
    <CopilotChatAssistantMessage {...props} message={message} messages={messages} isRunning={isRunning}>
      {(slots: any) => (
        <div className="set-chat-assistant flex gap-2.5 fadein">
          <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
            <div className="tex-dither border border-set-border/70 rounded-md p-0.5 bg-set-panel/60">
              <Mascot config={mascot} mood={streaming ? 'thinking' : 'idle'} size={26} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="set-mono set-mono-dim mb-1">{mascot.name}</div>
            {slots.markdownRenderer}
            {slots.toolCallsView}
            {slots.toolbarVisible !== false && slots.toolbar}
          </div>
        </div>
      )}
    </CopilotChatAssistantMessage>
  );
}

/** Tracks the phone breakpoint (same 767px split CopilotKit uses) so the
 * popup can behave differently per form factor. */
function useIsMobileViewport() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export default function GuideFab() {
  const user = useApp((s) => s.user);
  const mascotEnabled = (user as any)?.mascot?.enabled !== false;
  const { agent } = useAgent({ agentId: GUIDE_AGENT });
  // tap-outside-to-close is a phone behavior: on a phone the sheet dims the
  // page, so tapping the page should dismiss it; on desktop the popup floats
  // beside the work and closing on any outside click would be maddening.
  const isMobile = useIsMobileViewport();

  // Keyboard-aware mobile sheet: expose the software keyboard's height as a
  // CSS var (--set-kb) so the sheet can sit on top of it. visualViewport is
  // the only reliable source on iOS. Updates are debounced — the raw events
  // fire many times during the keyboard animation and each one snapped the
  // sheet around; debounced + a CSS transition it does one smooth glide.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let timer: number | undefined;
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
      root.style.setProperty('--set-kb', `${kb < 40 ? 0 : kb}px`);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 120);
    };
    update();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      window.clearTimeout(timer);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
    };
  }, []);

  // restore the desktop panel preference (docked vs floating)
  useEffect(() => {
    document.body.classList.toggle('copilot-docked', localStorage.getItem('set_copilot_docked') === '1');
  }, []);

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
      <SheetModeWatcher />
      <CopilotPopup
        agentId={GUIDE_AGENT}
        // CopilotPopup's defaultOpen defaults to TRUE — must start closed.
        defaultOpen={false}
        clickOutsideToClose={isMobile}
        labels={{
          modalHeaderTitle: 'SET COPILOT',
          welcomeMessageText: 'Your on-screen guide — ask anything, or pick a starter:',
          chatInputPlaceholder: 'Ask anything, or “what am I looking at?”…',
          chatDisclaimerText: '',
          chatToggleOpenLabel: 'Open the SET copilot',
          chatToggleCloseLabel: 'Close the SET copilot',
        }}
        width={400}
        header={SET_HEADER}
        welcomeScreen={SetWelcomeScreen}
        messageView={{ assistantMessage: SetAssistantMessage as any }}
        toggleButton={{ openIcon: CopilotOpenIcon, closeIcon: CopilotCloseIcon }}
      />
    </>
  );
}
