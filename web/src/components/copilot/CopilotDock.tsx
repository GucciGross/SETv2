import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Mic, Square, Keyboard, Volume2, VolumeX } from 'lucide-react';
import { useAgent } from '@copilotkit/react-core/v2';
import { askAgent, GUIDE_AGENT } from '../../lib/copilot';
import { openSetCopilot, focusCopilotInput, isSetCopilotOpen, COPILOT_TOGGLE_SELECTOR } from '../../lib/copilotLauncher';
import { useCopilotVoice, type VoiceState } from './useCopilotVoice';
import './copilotDock.css';

interface Interaction {
  open: boolean; mode: 'voice' | 'text'; state: VoiceState; error: string; interim: string;
  sending: boolean; ready: boolean; spoken: boolean;
  text: (source?: HTMLElement) => void; voice: (source?: HTMLElement) => void;
  toggleSpoken: () => void;
}
const InteractionContext = createContext<Interaction | null>(null);
function useInteraction() {
  const value = useContext(InteractionContext);
  return value;
}

/** One interaction state for the dock AND the open chat's header. Never a second agent. */
export function CopilotInteractionProvider({ children }: { children: ReactNode }) {
  const { agent } = useAgent({ agentId: GUIDE_AGENT });
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'voice' | 'text'>('text');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [spoken, setSpoken] = useState(true);
  const origin = useRef<HTMLElement | undefined>(undefined);
  const focusCleanup = useRef<(() => void) | undefined>(undefined);
  const live = useRef(true);
  const voice = useCopilotVoice(text => {
    if (!agent || agent.isRunning) { setSendError('Copilot is still working. Wait for this run to finish, then try again.'); return; }
    openSetCopilot(); setSending(true); setSendError('');
    void askAgent(agent, text).catch(() => { if (live.current) setSendError('The voice message could not finish. Review the chat and retry.'); })
      .finally(() => { if (live.current) setSending(false); });
  });

  useEffect(() => {
    live.current = true;
    setOpen(false);
    let buttonObserver: MutationObserver | undefined;
    const connect = () => {
      const button = document.querySelector<HTMLButtonElement>(COPILOT_TOGGLE_SELECTOR);
      if (!button) return false;
      let wasOpen = isSetCopilotOpen(button);
      setOpen(wasOpen);
      const update = () => {
        const next = isSetCopilotOpen(button);
        setOpen(next);
        if (wasOpen && !next) {
          voice.cancel(); window.speechSynthesis?.cancel(); setMode('text');
          requestAnimationFrame(() => { if (origin.current?.isConnected) origin.current.focus({ preventScroll: true }); });
        }
        wasOpen = next;
      };
      buttonObserver = new MutationObserver(update);
      buttonObserver.observe(button, { attributes: true, attributeFilter: ['aria-pressed', 'data-state'] });
      return true;
    };
    const mounting = new MutationObserver(() => { if (connect()) mounting.disconnect(); });
    if (!connect()) mounting.observe(document.body, { childList: true, subtree: true });
    const hidden = () => { if (document.hidden) { voice.cancel(); window.speechSynthesis?.cancel(); } };
    const reset = () => { voice.cancel(); window.speechSynthesis?.cancel(); setMode('text'); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('set:copilot-reset-input', reset);
    return () => {
      live.current = false; mounting.disconnect(); buttonObserver?.disconnect();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('set:copilot-reset-input', reset);
      voice.cancel(); window.speechSynthesis?.cancel(); focusCleanup.current?.();
    };
  }, [voice.cancel]);

  useEffect(() => {
    if (!agent || mode !== 'voice' || !spoken || !('speechSynthesis' in window)) return;
    const sub = agent.subscribe({ onTextMessageEndEvent: (params: any) => {
      if (voice.state !== 'idle') return;
      const text = String(params?.textMessageBuffer ?? '').replace(/[#*`_>\[\]]/g, '').slice(0, 1600).trim();
      if (!text) return;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } });
    return () => { sub.unsubscribe(); window.speechSynthesis.cancel(); };
  }, [agent, mode, spoken, voice.state]);

  const ensureOpen = (source?: HTMLElement) => {
    if (!open && source) origin.current = source;
    if (!openSetCopilot()) { setSendError('Copilot is not ready yet. Try again in a moment.'); return false; }
    return true;
  };
  const text = (source?: HTMLElement) => {
    voice.cancel(); window.speechSynthesis?.cancel(); setMode('text'); setSendError('');
    if (ensureOpen(source)) { focusCleanup.current?.(); focusCleanup.current = focusCopilotInput(); }
  };
  const toggleVoice = (source?: HTMLElement) => {
    if (voice.state === 'listening') { voice.stop(); return; }
    if (voice.state === 'requesting' || voice.state === 'transcribing') { voice.cancel(); return; }
    if (sending || agent?.isRunning) { setSendError('Copilot is working. Finish or stop the current run before speaking.'); return; }
    focusCleanup.current?.(); setMode('voice'); setSendError('');
    if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
    if (ensureOpen(source)) void voice.start();
  };
  const value: Interaction = {
    open, mode, state: voice.state, error: sendError || voice.error, interim: voice.interim,
    sending, ready: voice.ready, spoken, text, voice: toggleVoice,
    toggleSpoken: () => { setSpoken(v => !v); window.speechSynthesis?.cancel(); },
  };
  return <InteractionContext.Provider value={value}>{children}</InteractionContext.Provider>;
}

export function CopilotModeControls({ compact = false }: { compact?: boolean }) {
  const i = useInteraction();
  // Standalone chat fixtures can omit the application dock.
  if (!i) return null;
  const recording = i.state === 'listening';
  const active = i.state !== 'idle';
  const label = recording ? 'Stop recording and send to Copilot' : active ? 'Cancel voice input' : 'Talk to Copilot';
  const status = i.error || (i.state === 'requesting' ? 'Waiting for microphone permission…' : recording ? 'Listening — tap the microphone to send.'
    : i.state === 'transcribing' ? 'Transcribing…' : i.sending ? 'Copilot is working…' : '');
  return (
    <div className={`set-copilot-mode${compact ? ' set-copilot-mode--compact' : ''}`}>
      <div className="set-copilot-rocker" role="group" aria-label="Copilot voice and text" data-listening={recording || undefined}>
        <button type="button" className="set-copilot-rocker-voice" aria-label={label} title={label}
          aria-pressed={i.open && i.mode === 'voice'} disabled={!i.ready && !active}
          onClick={e => i.voice(e.currentTarget)}>
          {active ? <Square size={24} strokeWidth={1.65} aria-hidden /> : <Mic size={27} strokeWidth={1.65} aria-hidden />}
        </button>
        <span className="set-copilot-rocker-divider" aria-hidden />
        <button type="button" className="set-copilot-rocker-text" aria-label="Type to Copilot" title="Type to Copilot"
          aria-pressed={i.open && i.mode === 'text'} onClick={e => i.text(e.currentTarget)}>
          <Keyboard size={28} strokeWidth={1.65} aria-hidden />
        </button>
      </div>
      {(status || (i.open && i.mode === 'voice')) && (
        <div className="set-copilot-voice-status" data-error={!!i.error || undefined}>
          <span role={i.error ? 'alert' : 'status'} aria-live={i.error ? 'assertive' : 'polite'}>{status || 'Voice ready'}</span>
          {i.mode === 'voice' && <button type="button" onClick={i.toggleSpoken} aria-label={i.spoken ? 'Mute spoken replies' : 'Enable spoken replies'} title={i.spoken ? 'Mute spoken replies' : 'Enable spoken replies'}>
            {i.spoken ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />}
          </button>}
        </div>
      )}
    </div>
  );
}

/** Takes layout space: no content hidden behind a floating, oversized launcher. */
export default function CopilotDock({ children }: { children: ReactNode }) {
  const interaction = useInteraction();
  const open = interaction?.open ?? false;
  useEffect(() => {
    document.body.classList.add('set-command-dock');
    return () => document.body.classList.remove('set-command-dock');
  }, []);
  return (
    <section className="set-copilot-command-dock" aria-label="Workspace controls" style={open ? { visibility: 'hidden' } : undefined}>
      <CopilotModeControls />
      {children}
    </section>
  );
}
