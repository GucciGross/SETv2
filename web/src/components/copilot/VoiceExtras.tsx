import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { api } from '../../lib/api';
import { browserDictationAvailable, startDictation, type Dictation } from '../../lib/voiceFallback';
import { Sparkline } from '../dither-kit';

/**
 * Voice mode extras:
 *  - server STT (runtime /transcribe) makes CopilotChat's built-in mic appear
 *    automatically; when the server has no transcription provider this header
 *    mic falls back to the browser's Web Speech API — dictated text is sent as
 *    the next message when dictation stops
 *  - a speak-replies toggle (speechSynthesis) turns the panel into a full
 *    talk-to-SET loop; the dithered sparkline visualizes recording
 */

let serverTranscriptionCache: Promise<boolean> | null = null;
export function serverTranscriptionEnabled(): Promise<boolean> {
  if (!serverTranscriptionCache) {
    serverTranscriptionCache = api
      .get('/copilotkit/info')
      .then((info: any) => !!info?.audioFileTranscriptionEnabled)
      .catch(() => false);
  }
  return serverTranscriptionCache;
}

/** Header mic: browser dictation fallback for when server STT is unavailable. */
export function FallbackMicButton({ onText }: { onText: (text: string) => void }) {
  const [serverStt, setServerStt] = useState<boolean | null>(null);
  const [dictating, setDictating] = useState(false);
  const dictationRef = useRef<Dictation | null>(null);
  const finalRef = useRef('');
  const insecure = typeof window !== 'undefined' && !window.isSecureContext;

  useEffect(() => {
    void serverTranscriptionEnabled().then(setServerStt);
  }, []);

  const stopDictation = () => {
    dictationRef.current?.stop();
    dictationRef.current = null;
    setDictating(false);
    const text = finalRef.current.trim();
    finalRef.current = '';
    if (text) onText(text);
  };

  const toggle = () => {
    if (dictating) return stopDictation();
    if (!browserDictationAvailable()) return;
    finalRef.current = '';
    setDictating(true);
    dictationRef.current = startDictation(
      (text, final) => {
        if (final) finalRef.current = `${finalRef.current} ${text}`.trim();
      },
      () => {
        // mic ended on its own (permission denied / silent stop) — flush what we have
        setDictating(false);
        const text = finalRef.current.trim();
        finalRef.current = '';
        if (text) onText(text);
        dictationRef.current = null;
      }
    );
  };

  // Browsers block mic/speech APIs on insecure origins (LAN IP over plain
  // HTTP). Say so instead of silently showing nothing.
  if (serverStt !== false || (!browserDictationAvailable() && !insecure)) return null;
  if (!browserDictationAvailable() && insecure) {
    return (
      <button
        className="p-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300"
        title="Voice input needs HTTPS — browsers block microphone access on plain HTTP. Enable SET_TLS=1 or use a localhost/https URL."
        aria-label="Voice unavailable without HTTPS"
        disabled
      >
        <MicOff size={14} />
      </button>
    );
  }

  return (
    <button
      className={`relative p-1.5 rounded-md border transition-colors ${dictating ? 'border-red-400/60 bg-red-500/20 text-red-300' : 'border-set-border bg-set-panel2/60 text-set-dim hover:text-set-text'}`}
      title={dictating ? 'Stop & send' : 'Talk to SET (browser speech)'}
      aria-label={dictating ? 'Stop dictation and send' : 'Dictate a message'}
      onClick={toggle}
    >
      {dictating ? <MicOff size={14} /> : <Mic size={14} />}
      {dictating && (
        <span className="absolute left-1/2 -translate-x-1/2 -top-6 w-24 h-5 pointer-events-none">
          <Sparkline data={[3, 8, 5, 10, 6, 11, 4, 9, 7, 12, 5, 8]} color="purple" variant="dotted" animate />
        </span>
      )}
    </button>
  );
}

/** Header toggle: speak assistant replies aloud via speechSynthesis. */
export function SpeakToggle({ agent }: { agent: any }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem('set_speak_replies') === '1');
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    localStorage.setItem('set_speak_replies', enabled ? '1' : '0');
  }, [enabled]);

  useEffect(() => {
    if (!agent || !enabled) return;
    const speak = (text: string) => {
      if (!text.trim() || !('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text.replace(/[#*`_>\[\]]/g, '').slice(0, 1200));
      u.rate = 1.05;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    };
    const sub = agent.subscribe({
      onTextMessageEndEvent: (params: any) => speak(params?.textMessageBuffer ?? ''),
    });
    return () => {
      sub.unsubscribe();
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    };
  }, [agent, enabled]);

  return (
    <button
      className={`relative p-1.5 rounded-md border transition-colors ${enabled ? 'border-violet-400/50 bg-violet-500/15 text-violet-200' : 'border-set-border bg-set-panel2/60 text-set-dim hover:text-set-text'}`}
      title={enabled ? 'Voice replies on — click to mute' : 'Speak replies aloud'}
      aria-label="Toggle spoken replies"
      onClick={() => setEnabled((v) => !v)}
    >
      {enabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
      {speaking && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-violet-300 animate-ping" aria-hidden />}
    </button>
  );
}
