import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken } from '../../lib/api';
import { browserDictationAvailable, startDictation, type Dictation } from '../../lib/voiceFallback';

export type VoiceState = 'idle' | 'requesting' | 'listening' | 'transcribing';

/** One microphone owner, cancelled on close, modality change, workspace change or unmount. */
export function useCopilotVoice(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState('');
  const [interim, setInterim] = useState('');
  const [serverStt, setServerStt] = useState<boolean | null>(null);
  const generation = useRef(0);
  const dictation = useRef<Dictation | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const upload = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const done = useRef(onText); done.current = onText;

  const cancel = useCallback(() => {
    generation.current++;
    clearTimeout(timer.current);
    dictation.current?.cancel(); dictation.current = null;
    const r = recorder.current; recorder.current = null;
    if (r && r.state !== 'inactive') { r.onstop = null; r.stop(); }
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    upload.current?.abort(); upload.current = null;
    setState('idle'); setInterim('');
  }, []);

  useEffect(() => {
    let active = true;
    api.get('/copilot/voice/capabilities').then(v => { if (active) setServerStt(v.serverTranscription === true); })
      .catch(() => { if (active) setServerStt(false); });
    return () => { active = false; cancel(); };
  }, [cancel]);

  const start = async () => {
    cancel(); setError('');
    const current = generation.current;
    if (!window.isSecureContext) { setError('Voice needs HTTPS or localhost. Text is still available.'); return; }
    if (serverStt === null) { setError('Voice capabilities are still loading. Try again in a moment.'); return; }
    window.speechSynthesis?.cancel();
    if (!serverStt) {
      if (!browserDictationAvailable()) { setError('This browser has no speech recognition. Configure a transcription provider in SET, or use text.'); return; }
      let final = '';
      let failed = false;
      setState('listening');
      dictation.current = startDictation((text, isFinal) => {
        if (current !== generation.current) return;
        if (isFinal) { final = `${final} ${text}`.trim(); setInterim(''); }
        else setInterim(text);
      }, () => {
        if (current !== generation.current) return;
        clearTimeout(timer.current); dictation.current = null; setState('idle'); setInterim('');
        if (final && !failed) done.current(final);
      }, { continuous: false, onError: message => { failed = true; if (current === generation.current) setError(message); } });
      timer.current = setTimeout(() => dictation.current?.stop(), 60_000);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Recording is unavailable in this browser. Use text or a supported browser.'); return;
    }
    setState('requesting');
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (current !== generation.current) { audio.getTracks().forEach(t => t.stop()); return; }
      stream.current = audio;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(audio, mimeType ? { mimeType } : undefined);
      recorder.current = r;
      const chunks: BlobPart[] = [];
      let bytes = 0;
      r.ondataavailable = e => {
        if (e.data.size) { chunks.push(e.data); bytes += e.data.size; }
        if (bytes > 8 * 1024 * 1024 && current === generation.current) { cancel(); setError('Recording was too large. Try a shorter message.'); }
      };
      r.onerror = () => { if (current === generation.current) { cancel(); setError('Recording failed. Check the microphone or use text.'); } };
      r.onstop = () => {
        audio.getTracks().forEach(t => t.stop());
        if (current !== generation.current) return;
        clearTimeout(timer.current); stream.current = null; recorder.current = null;
        setState('transcribing');
        const controller = new AbortController(); upload.current = controller;
        const ext = r.mimeType.startsWith('audio/mp4') ? 'mp4' : r.mimeType.startsWith('audio/ogg') ? 'ogg' : 'webm';
        const form = new FormData();
        form.append('file', new Blob(chunks, { type: r.mimeType || 'audio/webm' }), `speech.${ext}`);
        const timeout = setTimeout(() => controller.abort(), 65_000);
        void fetch('/api/copilot/voice/transcribe', { method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: form, signal: controller.signal })
          .then(async response => {
            const data = await response.json();
            if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Transcription failed.');
            if (current === generation.current && typeof data.text === 'string' && data.text.trim()) done.current(data.text.trim());
          })
          .catch(e => { if (current === generation.current) setError(e?.name === 'AbortError' ? 'Transcription timed out. Try again or use text.' : e.message); })
          .finally(() => { clearTimeout(timeout); if (current === generation.current) { upload.current = null; setState('idle'); } });
      };
      r.start(250); setState('listening');
      timer.current = setTimeout(() => { if (r.state === 'recording') r.stop(); }, 60_000);
    } catch (e: any) {
      if (current !== generation.current) return;
      cancel(); setError(e?.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in browser settings, or use text.' : 'The microphone could not start. Check the device, or use text.');
    }
  };

  const stop = () => {
    clearTimeout(timer.current);
    if (dictation.current) dictation.current.stop();
    else if (recorder.current?.state === 'recording') recorder.current.stop();
  };
  return { state, error, interim, start, stop, cancel, ready: serverStt !== null };
}
