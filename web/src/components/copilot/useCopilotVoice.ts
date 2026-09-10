import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../../lib/api';
import { browserDictationAvailable, startDictation, type Dictation } from '../../lib/voiceFallback';

export type VoiceState = 'idle' | 'requesting' | 'listening' | 'transcribing';

export function useCopilotVoice(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState('');
  const [interim, setInterim] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const dictationRef = useRef<Dictation | null>(null);
  const finalRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort(); abortRef.current = null;
    dictationRef.current?.stop(); dictationRef.current = null;
    try { if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop(); } catch {}
    cleanupStream(); chunksRef.current = []; finalRef.current = ''; setInterim(''); setState('idle');
  }, [cleanupStream]);

  useEffect(() => cancel, [cancel]);

  const startBrowserDictation = useCallback(() => {
    if (!browserDictationAvailable()) return false;
    finalRef.current = '';
    setState('listening');
    dictationRef.current = startDictation((text, final) => {
      if (final) finalRef.current = `${finalRef.current} ${text}`.trim();
      else setInterim(text);
    }, () => {
      const text = finalRef.current.trim();
      finalRef.current = ''; setInterim(''); setState('idle'); dictationRef.current = null;
      if (text) onText(text);
    });
    return !!dictationRef.current;
  }, [onText]);

  const start = useCallback(async () => {
    setError(''); setInterim('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      if (!startBrowserDictation()) setError('Voice input is unavailable in this browser.');
      return;
    }
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onerror = () => { setError('Recording failed.'); cleanupStream(); setState('idle'); };
      recorder.start(); setState('listening');
    } catch {
      cleanupStream();
      if (!startBrowserDictation()) { setState('idle'); setError('Microphone permission was denied or unavailable.'); }
    }
  }, [cleanupStream, startBrowserDictation]);

  const stop = useCallback(() => {
    if (dictationRef.current) { dictationRef.current.stop(); return; }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') { setState('idle'); return; }
    recorder.onstop = async () => {
      cleanupStream();
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      chunksRef.current = [];
      if (!blob.size) { setState('idle'); return; }
      setState('transcribing');
      const form = new FormData();
      form.append('file', blob, 'copilot.webm');
      const abort = new AbortController(); abortRef.current = abort;
      try {
        const res = await fetch('/api/copilot-voice/transcribe', {
          method: 'POST', headers: { authorization: `Bearer ${getToken()}` }, body: form, signal: abort.signal,
        });
        if (!res.ok) throw new Error('transcription failed');
        const json = await res.json();
        const text = String(json?.text ?? '').trim();
        setState('idle');
        if (text) onText(text);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError('Could not transcribe that recording.');
        setState('idle');
      } finally { abortRef.current = null; }
    };
    recorder.stop();
  }, [cleanupStream, onText]);

  return { state, error, interim, ready: typeof window !== 'undefined', start, stop, cancel };
}
