import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../../lib/api';
import { useApp } from '../../stores/app';
import type { VoiceCapabilities } from './voiceCapabilities';
import { CodexVoiceClient, type CodexVoiceCatalog, type CopilotVoiceResult } from './codexVoiceClient';

/** Session-scoped voice choice: in-memory only, reset when the signed-in user changes. */
let chosenVoice: string | null = null;
let chosenVoiceUser = '';

export interface VoiceOption { name: string; generation: 'v1' | 'v2' }
export function useCodexVoice(onRequest: (text: string, signal: AbortSignal) => Promise<CopilotVoiceResult>, spoken: boolean) {
  const userId = useApp(s => s.user?.id);
  // Per-user in-memory reset. Evaluated during render; same user = keep the choice.
  if ((userId ?? '') !== chosenVoiceUser) { chosenVoiceUser = userId ?? ''; chosenVoice = null; }
  const setVoice = useCallback((voice: string | null) => { chosenVoice = voice; }, []);
  const [state, setState] = useState<'idle' | 'requesting' | 'live'>('idle');
  const [error, setError] = useState('');
  const [interim, setInterim] = useState('');
  const [selected, setSelected] = useState(false);
  const [catalog, setCatalog] = useState<CodexVoiceCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [inputStream, setInputStream] = useState<MediaStream | null>(null);
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  const client = useRef<CodexVoiceClient | undefined>(undefined);
  const generation = useRef(0);
  const request = useRef(onRequest); request.current = onRequest;
  const muted = useRef(!spoken); muted.current = !spoken;
  const cancel = useCallback(() => {
    generation.current++; client.current?.stop(); client.current = undefined;
    setState('idle'); setInterim(''); setInputStream(null); setOutputStream(null);
  }, []);
  useEffect(() => cancel, [cancel]);
  useEffect(() => { client.current?.setMuted(!spoken); }, [spoken]);

  /** Live catalog for the picker. Fails closed: an error leaves the selector unusable, never a stale list. */
  const loadCatalog = useCallback(async () => {
    const current = ++generation.current;
    setCatalog(null); setCatalogError('');
    try {
      const spaceId = useApp.getState().currentSpaceId ?? '';
      const response = await fetch(`/api/copilot/voice/codex/voices?spaceId=${encodeURIComponent(spaceId)}`, {
        headers: { authorization: `Bearer ${getToken()}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Voice catalog could not be loaded.');
      if (current !== generation.current) return;
      if (!data || !Array.isArray(data.v1) || !Array.isArray(data.v2)) throw new Error('The server returned an unreadable voice catalog.');
      setCatalog(data);
    } catch (e: any) {
      if (current !== generation.current) return;
      setCatalog(null); setCatalogError(e?.message ?? 'Voice catalog could not be loaded.');
    }
  }, []);

  const start = useCallback(async (capabilities: VoiceCapabilities) => {
    cancel(); setError(''); setSelected(true); setState('requesting');
    const current = generation.current;
    const c = new CodexVoiceClient(getToken(), useApp.getState().currentSpaceId ?? '', {
      onConnecting: () => { if (current === generation.current) setState('requesting'); },
      onInputStream: stream => { if (current === generation.current) setInputStream(stream); },
      onOutputStream: stream => { if (current === generation.current) setOutputStream(stream); },
      onLive: () => { if (current === generation.current) setState('live'); },
      onTranscript: text => { if (current === generation.current) setInterim(text); },
      onError: message => { if (current === generation.current) { setError(message); setState('idle'); } },
      onRequest: (text, signal) => request.current(text, signal),
    }, chosenVoice ?? undefined);
    client.current = c; c.setMuted(muted.current);
    const handled = await c.start(capabilities);
    if (current !== generation.current) return true;
    if (!handled) { cancel(); setSelected(false); }
    return handled;
  }, [cancel]);

  return { state, error, interim, selected, inputStream, outputStream, start, cancel, catalog, catalogError, loadCatalog, voice: chosenVoice, setVoice };
}
