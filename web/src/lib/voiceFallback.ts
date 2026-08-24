/**
 * Browser speech-to-text fallback for voice input when the server runtime has
 * no transcription provider configured (pure-local BYOK setups). Uses the Web
 * Speech API (Chrome/Edge/Safari).
 */

export function browserDictationAvailable(): boolean {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export interface Dictation {
  stop: () => void;
}

/** Start dictation; onResult fires with interim/final transcripts. Resumes automatically until stopped. */
export function startDictation(onResult: (text: string, final: boolean) => void, onEnd?: () => void): Dictation | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';
  let stopped = false;
  const restart = () => {
    if (!stopped) {
      try {
        rec.start();
      } catch {
        /* already started */
      }
    }
  };
  rec.onresult = (e: any) => {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (final) onResult(final.trim(), true);
    else if (interim) onResult(interim.trim(), false);
  };
  rec.onend = () => {
    if (stopped) onEnd?.();
    else restart(); // Chrome stops after silence; keep going until user stops
  };
  rec.onerror = (e: any) => {
    if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
      stopped = true;
      onEnd?.();
    }
  };
  try {
    rec.start();
  } catch {
    /* ignore double-start */
  }
  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* not started */
      }
    },
  };
}
