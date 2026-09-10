/** Browser STT fallback. Availability does not mean offline processing. */
export function browserDictationAvailable(): boolean {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export interface Dictation { stop: () => void; cancel: () => void }

/** Existing two-argument callers retain continuous dictation. The dock uses one utterance. */
export function startDictation(
  onResult: (text: string, final: boolean) => void,
  onEnd?: () => void,
  options: { continuous?: boolean; onError?: (message: string) => void } = {},
): Dictation | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  const continuous = options.continuous ?? true;
  rec.continuous = continuous;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';
  let stopped = false;
  let cancelled = false;
  let ended = false;
  const finish = () => { if (!ended && !cancelled) { ended = true; onEnd?.(); } };
  rec.onresult = (e: any) => {
    if (cancelled) return;
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result.isFinal) final += result[0].transcript;
      else interim += result[0].transcript;
    }
    if (final.trim()) onResult(final.trim(), true);
    if (interim.trim()) onResult(interim.trim(), false);
  };
  rec.onend = () => {
    if (cancelled) return;
    if (stopped || !continuous) return finish();
    try { rec.start(); }
    catch { stopped = true; options.onError?.('Voice input stopped. Tap the microphone to try again.'); finish(); }
  };
  rec.onerror = (e: any) => {
    if (cancelled || e?.error === 'aborted') return;
    stopped = true;
    if (e?.error !== 'no-speech') {
      options.onError?.(['not-allowed', 'service-not-allowed'].includes(e?.error)
        ? 'Microphone permission was denied. Allow it in your browser settings, or use text.'
        : 'Browser speech recognition failed. Check your connection, or use text.');
    }
    finish();
  };
  try { rec.start(); }
  catch { stopped = true; options.onError?.('Voice input could not start. Check microphone access, or use text.'); finish(); }
  return {
    stop: () => { stopped = true; try { rec.stop(); } catch { finish(); } },
    cancel: () => { cancelled = true; stopped = true; try { rec.abort(); } catch { /* already ended */ } },
  };
}
