import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Mic, Square, Keyboard } from 'lucide-react';
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { askAgent, GUIDE_AGENT } from '../../lib/copilot';
import { openSetCopilot, focusCopilotInput, isSetCopilotOpen, COPILOT_TOGGLE_SELECTOR } from '../../lib/copilotLauncher';
import { useCopilotVoice, type VoiceState } from './useCopilotVoice';
import { useCodexVoice } from './useCodexVoice';
import { runVoiceCopilot } from './runVoiceCopilot';
import './copilotDock.css';

interface Interaction {
  open: boolean; mode: 'voice' | 'text'; state: VoiceState | 'live'; error: string; interim: string;
  sending: boolean; ready: boolean; spoken: boolean; speaking: boolean;
  inputStream: MediaStream | null; outputStream: MediaStream | null;
  text: (source?: HTMLElement) => void; voice: (source?: HTMLElement) => void;
  toggleSpoken: () => void; stopRun: () => void;
}
const InteractionContext = createContext<Interaction | null>(null);
export function useCopilotInteraction() {
  const value = useContext(InteractionContext);
  return value;
}

/** One interaction state for the dock AND the open chat's header. Never a second agent. */
export function CopilotInteractionProvider({ children }: { children: ReactNode }) {
  const { agent } = useAgent({ agentId: GUIDE_AGENT });
  const { copilotkit } = useCopilotKit();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'voice' | 'text'>('text');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [spoken, setSpoken] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const origin = useRef<HTMLElement | undefined>(undefined);
  const focusCleanup = useRef<(() => void) | undefined>(undefined);
  const live = useRef(true);
  const stopSpeech = useCallback(() => {
    if (utterance.current) {
      utterance.current.onstart = null; utterance.current.onend = null; utterance.current.onerror = null;
      utterance.current = null;
    }
    window.speechSynthesis?.cancel();
    if (live.current) setSpeaking(false);
  }, []);
  const dictation = useCopilotVoice(text => {
    if (!agent || agent.isRunning) { setSendError('Copilot is still working. Wait for this run to finish, then try again.'); return; }
    openSetCopilot(); setSending(true); setSendError('');
    void askAgent(agent, text).catch(() => { if (live.current) setSendError('The voice message could not finish. Review the chat and retry.'); })
      .finally(() => { if (live.current) setSending(false); });
  });


  const native = useCodexVoice(async (text, signal) => {
    if (signal.aborted) return { success: false, text: 'Voice cancelled.' };
    openSetCopilot(); setSending(true); setSendError('');
    try { return await runVoiceCopilot(agent, text, signal, askAgent); }
    finally { if (live.current) setSending(false); }
  }, spoken);
  const voiceGeneration = useRef(0);
  const cancelVoice = useCallback(() => {
    voiceGeneration.current++; native.cancel(); dictation.cancel(); stopSpeech();
  }, [native.cancel, dictation.cancel, stopSpeech]);
  const voice = {
    state: native.state !== 'idle' ? native.state : dictation.state,
    error: native.selected ? native.error : dictation.error,
    interim: native.selected ? native.interim : dictation.interim,
    ready: dictation.ready,
    cancel: cancelVoice,
    stop: () => native.state !== 'idle' ? native.cancel() : dictation.stop(),
    start: async () => {
      cancelVoice();
      const current = voiceGeneration.current;
      if (!(await native.start()) && current === voiceGeneration.current) await dictation.start();
    },
  };

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
          voice.cancel(); setMode('text');
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
    const hidden = () => { if (document.hidden) { voice.cancel(); } };
    const reset = () => { voice.cancel(); setMode('text'); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('set:copilot-reset-input', reset);
    return () => {
      live.current = false; mounting.disconnect(); buttonObserver?.disconnect();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('set:copilot-reset-input', reset);
      voice.cancel(); focusCleanup.current?.();
    };
  }, [voice.cancel]);

  // Read the current capture state without unsubscribing (and cancelling speech)
  // when transcription finishes while a fast assistant response starts playing.
  const captureState = useRef(voice.state); captureState.current = voice.state;
  useEffect(() => {
    if (!agent || native.selected || mode !== 'voice' || !spoken || !('speechSynthesis' in window)) return;
    const sub = agent.subscribe({ onTextMessageEndEvent: (params: any) => {
      if (captureState.current === 'listening' || captureState.current === 'requesting' || document.hidden) return;
      const text = String(params?.textMessageBuffer ?? '').replace(/[#*`_>\[\]]/g, '').slice(0, 1600).trim();
      if (!text) return;
      stopSpeech();
      const reply = new SpeechSynthesisUtterance(text);
      utterance.current = reply;
      reply.onstart = () => { if (live.current && utterance.current === reply) setSpeaking(true); };
      const ended = () => {
        if (live.current && utterance.current === reply) { utterance.current = null; setSpeaking(false); }
      };
      reply.onend = ended; reply.onerror = ended;
      window.speechSynthesis.speak(reply);
    } });
    return () => { sub.unsubscribe(); stopSpeech(); };
  }, [agent, mode, spoken, native.selected, stopSpeech]);

  const ensureOpen = (source?: HTMLElement) => {
    if (!open && source) origin.current = source;
    if (!openSetCopilot()) { setSendError('Copilot is not ready yet. Try again in a moment.'); return false; }
    return true;
  };
  const text = (source?: HTMLElement) => {
    voice.cancel(); setMode('text'); setSendError('');
    if (ensureOpen(source)) { focusCleanup.current?.(); focusCleanup.current = focusCopilotInput(); }
  };
  const toggleVoice = (source?: HTMLElement) => {
    // Select the visual modality immediately, even if permission/capabilities
    // are pending or the shared agent is working. Never reveal text on failure.
    focusCleanup.current?.(); setMode('voice'); setSendError('');
    if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
    if (!ensureOpen(source)) return;
    if (voice.state === 'listening' || voice.state === 'live') { voice.stop(); return; }
    if (voice.state === 'requesting' || voice.state === 'transcribing') { voice.cancel(); return; }
    if (sending || agent?.isRunning) return;
    void voice.start();
  };
  const value: Interaction = {
    open, mode, state: voice.state, error: mode === 'voice' ? sendError || voice.error : sendError, interim: voice.interim,
    sending: sending || !!agent?.isRunning, ready: voice.ready, spoken, speaking,
    inputStream: native.selected ? native.inputStream : dictation.inputStream,
    outputStream: spoken ? native.outputStream : null,
    text, voice: toggleVoice,
    toggleSpoken: () => { setSpoken(v => !v); stopSpeech(); },
    stopRun: () => {
      voice.cancel();
      try { copilotkit.stopAgent({ agent }); }
      catch { try { agent.abortRun(); } catch { setSendError('Copilot could not stop. Switch to text to review the run.'); } }
    },
  };
  return <InteractionContext.Provider value={value}>{children}</InteractionContext.Provider>;
}

export function CopilotModeControls({ compact = false }: { compact?: boolean }) {
  const i = useCopilotInteraction();
  // Standalone chat fixtures can omit the application dock.
  if (!i) return null;
  const recording = i.state === 'listening';
  const active = i.state !== 'idle';
  const label = i.state === 'live' ? 'End Codex voice conversation' : recording ? 'Stop recording and send to Copilot' : active ? 'Cancel voice input' : 'Talk to Copilot';
  return (
    <div className={`set-copilot-mode${compact ? ' set-copilot-mode--compact' : ''}`}>
      <div className="set-copilot-rocker" role="group" aria-label="Copilot voice and text" data-listening={recording || i.state === 'live' || undefined}>
        <button type="button" className="set-copilot-rocker-voice" aria-label={label} title={label}
          aria-pressed={i.open && i.mode === 'voice'}
          onClick={e => i.voice(e.currentTarget)}>
          {active ? <Square size={24} strokeWidth={1.65} aria-hidden /> : <Mic size={27} strokeWidth={1.65} aria-hidden />}
        </button>
        <span className="set-copilot-rocker-divider" aria-hidden />
        <button type="button" className="set-copilot-rocker-text" aria-label="Type to Copilot" title="Type to Copilot"
          aria-pressed={i.open && i.mode === 'text'} onClick={e => i.text(e.currentTarget)}>
          <Keyboard size={28} strokeWidth={1.65} aria-hidden />
        </button>
      </div>
      {i.error && i.mode === 'text' && <div className="set-copilot-voice-status" data-error>
        <span role="alert">{i.error}</span>
      </div>}
    </div>
  );
}

/** Takes layout space: no content hidden behind a floating, oversized launcher. */
export default function CopilotDock({ children }: { children: ReactNode }) {
  const interaction = useCopilotInteraction();
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
