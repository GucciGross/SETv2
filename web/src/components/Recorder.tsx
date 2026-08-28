import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, AlertTriangle, BookOpen } from 'lucide-react';
import { api, getToken } from '../lib/api';

/**
 * Recorder mode: capture mic audio in the browser (MediaRecorder), upload it
 * to POST /notebooks/:id/transcribe, where the server STTs it (Whisper-
 * compatible endpoint) and files the transcript as an ingestable source.
 *
 * Opened pinned to a notebook (from inside one) or with a notebook picker
 * (sidebar "Record" action). One-tap flow: title → record → stop & done.
 */

interface Props {
  spaceId: string;
  notebookId?: string;
  onClose: () => void;
  onSaved: (notebookId: string) => void;
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function RecorderModal({ spaceId, notebookId, onClose, onSaved }: Props) {
  const [notebooks, setNotebooks] = useState<any[]>([]);
  const [nbId, setNbId] = useState(notebookId ?? '');
  const [title, setTitle] = useState(() => `Lecture — ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [sttAvailable, setSttAvailable] = useState<boolean | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const wakeRef = useRef<any>(null);

  const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    api.get('/transcribe/available').then((r) => setSttAvailable(!!r.available)).catch(() => setSttAvailable(false));
    if (!notebookId) {
      api.get(`/spaces/${spaceId}/notebooks`).then((r) => {
        setNotebooks(r.notebooks);
        setNbId((cur) => cur || r.notebooks[0]?.id || '');
      }).catch(() => {});
    }
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try { wakeRef.current?.release?.(); } catch { /* already released */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // iOS stops mic capture the moment the app backgrounds or the screen locks.
  // When that happens mid-recording, save what was captured instead of
  // dropping it silently. (Wake Lock below keeps the screen awake so this
  // rarely triggers on iOS 16.4+; it's the fallback for everything else.)
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && recRef.current?.state === 'recording') stop();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nbId, title]);

  const createDefaultNotebook = async () => {
    try {
      const { notebook } = await api.post(`/spaces/${spaceId}/notebooks`, { title: 'My Notebook', description: 'Captures — recordings, notes and sources' });
      setNotebooks((n) => [notebook, ...n]);
      setNbId(notebook.id);
    } catch (e: any) {
      setError(e.message ?? 'Could not create notebook');
    }
  };

  const start = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => void save(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }));
      rec.start(2000);
      recRef.current = rec;
      setSeconds(0);
      setPhase('recording');
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
      // keep the screen on through a lecture (iOS 16.4+, Android Chrome); the
      // visibilitychange handler is the safety net where it's unsupported
      try { void (navigator as any).wakeLock?.request('screen')?.then?.((l: any) => { wakeRef.current = l; }); } catch { /* unsupported */ }
    } catch (e: any) {
      setError(
        e?.name === 'NotAllowedError'
          ? 'Microphone permission denied — allow mic access in your browser and try again.'
          : `Could not start recording: ${e.message ?? e}`
      );
    }
  };

  const teardown = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    try { wakeRef.current?.release?.(); } catch { /* already released */ }
    wakeRef.current = null;
  };

  const stop = () => {
    if (recRef.current?.state === 'recording') {
      setPhase('saving');
      recRef.current.stop();
    }
    teardown();
  };

  const cancel = () => {
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null as any;
      try { rec.stop(); } catch { /* already stopped */ }
    }
    teardown();
    onClose();
  };

  const save = async (blob: Blob) => {
    if (!nbId) {
      setPhase('idle');
      setError('Pick a notebook for this recording first.');
      return;
    }
    if (blob.size < 1000) {
      setPhase('idle');
      setError('That recording was silent — check your mic and try again.');
      return;
    }
    try {
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('audio', blob, `recording.${ext}`);
      form.append('title', title.trim() || 'Recording');
      const res = await fetch(`/api/notebooks/${nbId}/transcribe`, {
        method: 'POST',
        headers: { authorization: `Bearer ${getToken()}` },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? 'Upload failed');
      }
      onSaved(nbId);
    } catch (e: any) {
      setError(e.message ?? 'Failed to save the recording');
      setPhase('idle');
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={phase !== 'recording' ? onClose : undefined}>
      <div className="set-card bg-set-panel w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <Mic size={18} className="text-set-accent" />
          <h3 className="text-lg font-bold text-white flex-1">Record</h3>
          <button className="set-btn-ghost" onClick={cancel} aria-label="Close"><X size={16} /></button>
        </div>
        <p className="text-sm text-set-dim mb-4">
          {phase === 'saving'
            ? 'Transcribing — this can take a minute for long recordings. Keep this open.'
            : 'Talk, lecture, brainstorm. When you stop, it becomes a transcript source — indexed, searchable and study-ready.'}
        </p>

        {!canRecord && (
          <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mb-3">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> This browser doesn't support audio recording.
          </div>
        )}
        {sttAvailable === false && (
          <div className="flex items-start gap-2 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mb-3">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              Voice transcription isn't configured on this server (set <code className="set-mono">TRANSCRIBE_BASE_URL</code> to any Whisper-compatible endpoint).
            </span>
          </div>
        )}

        {!notebookId && (
          <div className="mb-3">
            <label className="text-xs text-set-dim mb-1 block">Save to notebook</label>
            {notebooks.length ? (
              <div className="flex items-center gap-1.5">
                <BookOpen size={14} className="text-set-dim shrink-0" />
                <select className="set-input flex-1" value={nbId} onChange={(e) => setNbId(e.target.value)}>
                  {notebooks.map((n) => (
                    <option key={n.id} value={n.id}>{n.title}</option>
                  ))}
                </select>
              </div>
            ) : (
              <button className="set-btn text-sm" onClick={createDefaultNotebook}>Create “My Notebook”</button>
            )}
          </div>
        )}

        <div className="mb-3">
          <label className="text-xs text-set-dim mb-1 block">Title</label>
          <input className="set-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </div>

        {phase === 'recording' ? (
          <div className="flex flex-col items-center gap-3 py-3">
            <div className="flex items-center gap-2 text-white">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-xl tabular-nums">{fmt(seconds)}</span>
            </div>
            <div className="flex gap-2 w-full">
              <button className="set-btn-ghost text-sm flex-1" onClick={cancel}>Discard</button>
              <button className="set-btn-primary text-sm flex-1 flex items-center gap-1.5 justify-center" onClick={stop}>
                <Square size={13} /> Stop & transcribe
              </button>
            </div>
            <p className="text-[11px] text-set-dim text-center">Keep this screen open — locking the phone or switching apps ends capture (we'll save what was recorded).</p>
          </div>
        ) : phase === 'saving' ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-amber-300">
            <span className="w-3 h-3 rounded-full bg-amber-300 animate-pulse" /> Transcribing…
          </div>
        ) : (
          <button
            className="set-btn-primary w-full flex items-center gap-2 justify-center py-2.5"
            disabled={!canRecord || sttAvailable === false}
            onClick={start}
          >
            <Mic size={15} /> Start recording
          </button>
        )}

        {error && <p className="text-xs text-red-300 mt-3">{error}</p>}
      </div>
    </div>
  );
}
