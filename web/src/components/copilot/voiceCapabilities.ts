import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '../../lib/api';
import { useApp } from '../../stores/app';

export interface VoiceCapabilities {
  serverTranscription: boolean;
  codexRealtime?: { enabled: boolean; selected: boolean; experimental?: boolean };
}
export const AI_CONNECTION_CHANGED = 'set:ai-connection-changed';
export function nativeVoiceSelected(cap: VoiceCapabilities | null): boolean {
  return cap?.codexRealtime?.enabled === true && cap.codexRealtime.selected === true;
}
export function useVoiceCapabilities() {
  const userId = useApp(s => s.user?.id);
  const [data, setData] = useState<VoiceCapabilities | null>(null);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setData(null); setError('');
    const timer = setTimeout(() => controller.abort(), 10_000);
    void fetch('/api/copilot/voice/capabilities', {
      headers: { authorization: `Bearer ${getToken()}` }, signal: controller.signal, cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw new Error('Voice setup could not be checked. Open AI setup or retry.');
      const next = await response.json();
      if (typeof next.serverTranscription !== 'boolean') throw new Error('The server returned incomplete voice capabilities. Open AI setup.');
      if (request.current === controller && !controller.signal.aborted) setData(next);
    }).catch(e => {
      if (request.current === controller) setError(e?.name === 'AbortError' ? 'Checking voice setup timed out. Tap Voice to retry.' : e.message);
    }).finally(() => clearTimeout(timer));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(AI_CONNECTION_CHANGED, refresh);
    return () => { const current = request.current; request.current = null; current?.abort(); window.removeEventListener(AI_CONNECTION_CHANGED, refresh); };
  }, [userId, refresh]);
  return { data, error, refresh };
}
