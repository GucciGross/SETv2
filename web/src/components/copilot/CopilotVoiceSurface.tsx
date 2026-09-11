import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { useCopilotInteraction } from './CopilotDock';
import { VoiceApprovals } from './ApprovalWatcher';
import VoiceOrb from './VoiceOrb';
import { voiceOrbState } from './voiceOrbState';
import { observeVoiceAudio } from './voiceAudioMeter';
import './copilotVoice.css';

/** Rendered by CopilotChat's body slot. No transcript, textarea, starter
 * pills, hidden composer, iframe, second agent or separate conversation. */
export default function CopilotVoiceSurface() {
  const interaction = useCopilotInteraction();
  const inputStream = interaction?.inputStream;
  const outputStream = interaction?.outputStream;
  const level = useRef(0);
  const [audioSpeaking, setAudioSpeaking] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = root.current;
    if (element && !element.closest('[data-copilot-popup]')?.contains(document.activeElement)) element.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    let alive = true;
    let input = 0, output = 0, lastSpeech = -Infinity;
    setAudioSpeaking(false); level.current = 0;
    const refresh = () => { level.current = Math.max(input, output); };
    const stopInput = inputStream ? observeVoiceAudio(inputStream, value => { input = value; refresh(); }) : undefined;
    const stopOutput = outputStream ? observeVoiceAudio(outputStream, value => {
      output = value; refresh();
      if (value > 0.06) lastSpeech = performance.now();
      if (alive) setAudioSpeaking(performance.now() - lastSpeech < 220);
    }) : undefined;
    return () => { alive = false; stopInput?.(); stopOutput?.(); level.current = 0; };
  }, [inputStream, outputStream]);
  if (!interaction) return null;
  const state = voiceOrbState({ ...interaction, speaking: interaction.speaking || audioSpeaking });
  const active = interaction.state !== 'idle';
  const status = interaction.error || ({
    idle: 'Voice ready', connecting: 'Connecting voice', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', error: 'Voice unavailable',
  }[state]);
  const action = interaction.state === 'live' ? 'End voice conversation'
    : interaction.state === 'listening' ? 'Send voice message' : active ? 'Cancel voice connection' : 'Start listening';
  return <section ref={root} tabIndex={-1} className="set-copilot-voice-surface" role="region" aria-label="Copilot voice conversation" data-state={state}>
    <div className="set-voice-stage">
      <VoiceOrb state={state} level={level} />
      <div className="set-voice-state" role={interaction.error ? 'alert' : 'status'} aria-live={interaction.error ? 'assertive' : 'polite'}>{status}</div>
      <div className="set-voice-actions" role="group" aria-label="Voice conversation controls">
        <button type="button" onClick={interaction.toggleSpoken} aria-label={interaction.spoken ? 'Mute spoken replies' : 'Enable spoken replies'}
          aria-pressed={!interaction.spoken} title={interaction.spoken ? 'Mute spoken replies' : 'Enable spoken replies'}>
          {interaction.spoken ? <Volume2 size={20} aria-hidden /> : <VolumeX size={20} aria-hidden />}
        </button>
        <button type="button" onClick={e => interaction.voice(e.currentTarget)} disabled={!active && interaction.sending} aria-label={action} title={action}>
          {active ? <Square size={18} aria-hidden /> : <Mic size={20} aria-hidden />}
        </button>
        {interaction.sending && <button type="button" onClick={interaction.stopRun} aria-label="Stop Copilot work" title="Stop Copilot work"><Square size={18} aria-hidden /></button>}
      </div>
    </div>
    <VoiceApprovals />
  </section>;
}
