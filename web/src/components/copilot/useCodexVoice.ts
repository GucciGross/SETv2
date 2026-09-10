import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../../lib/api';
import { useApp } from '../../stores/app';
import { CodexVoiceClient, type CopilotVoiceResult } from './codexVoiceClient';

export function useCodexVoice(onRequest: (text: string, signal: AbortSignal) => Promise<CopilotVoiceResult>, spoken: boolean) {
  const [state, setState] = useState<'idle' | 'requesting' | 'live'>('idle');
  const [error, setError] = useState('');
  const [interim, setInterim] = useState('');
  const [selected, setSelected] = useState(false);
  const client = useRef<CodexVoiceClient | undefined>(undefined);
  const generation = useRef(0);
  const request = useRef(onRequest); request.current = onRequest;
  const muted = useRef(!spoken); muted.current = !spoken;
  const cancel = useCallback(() => {
    generation.current++; client.current?.stop(); client.current = undefined;
    setState('idle'); setInterim('');
  }, []);
  useEffect(() => cancel, [cancel]);
  useEffect(() => { client.current?.setMuted(!spoken); }, [spoken]);
  const start = useCallback(async () => {
    cancel(); setError(''); setSelected(true); setState('idle');
    const current = generation.current;
    const c = new CodexVoiceClient(getToken(), useApp.getState().currentSpaceId ?? '', {
      onConnecting: () => { if (current === generation.current) setState('requesting'); },
      onLive: () => { if (current === generation.current) setState('live'); },
      onTranscript: text => { if (current === generation.current) setInterim(text); },
      onError: message => { if (current === generation.current) { setError(message); setState('idle'); } },
      onRequest: (text, signal) => request.current(text, signal),
    });
    client.current = c; c.setMuted(muted.current);
    const handled = await c.start();
    if (current !== generation.current) return true;
    if (!handled) { cancel(); setSelected(false); }
    return handled;
  }, [cancel]);
  return { state, error, interim, selected, start, cancel };
}
