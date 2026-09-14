import { useEffect, useState } from 'react';
import { getToken } from '../../lib/api';
import { useApp } from '../../stores/app';
import { browserDictationAvailable } from '../../lib/voiceFallback';
import { AI_CONNECTION_CHANGED, nativeVoiceSelected, useVoiceCapabilities } from './voiceCapabilities';
import { useCodexVoiceChoice } from './useCodexVoice';
import type { CodexVoiceCatalog } from './codexVoiceClient';

/** Diagnostics only: checking setup never requests the microphone or records. */
export default function VoiceSettings() {
  const { data, error } = useVoiceCapabilities();
  const secure = window.isSecureContext;
  const browser = browserDictationAvailable();
  const native = nativeVoiceSelected(data);
  return <section className="set-card p-4 mt-4" aria-labelledby="voice-setup-heading">
    <h2 id="voice-setup-heading" className="font-semibold">Voice setup</h2>
    <p className="mt-2 text-sm text-set-dim">Voice uses the same Copilot conversation and selected LLM. Connecting a chat model alone does not add speech-to-text.</p>
    <dl className="mt-3 space-y-2 text-sm">
      <div><dt className="font-medium">Microphone access</dt><dd className="text-set-dim">{secure ? 'Secure connection. Tap Voice to request microphone permission.' : 'Blocked on HTTP. Open this SET server using trusted HTTPS on your phone.'}</dd></div>
      <div><dt className="font-medium">Voice transport</dt><dd className="text-set-dim">{!data ? error || 'Checking…' : native ? 'Experimental Codex realtime is selected. Connection failures will not switch to another voice provider.' : data.serverTranscription ? 'Server transcription, then Copilot, with browser spoken replies.' : browser ? 'Browser speech recognition, then Copilot, with browser spoken replies. Recognition may use the browser vendor’s online service.' : 'No speech recognizer is available. Configure a transcription server to use voice in this browser.'}</dd></div>
    </dl>
    {!secure && <p role="alert" className="mt-3 text-sm text-amber-300">A LAN IP over HTTP cannot use the microphone on iPhone. Enable HTTPS on the SET server and trust its certificate on the phone; changing the CSS cannot bypass this browser security requirement.</p>}
    {!native && <details className="mt-3 text-sm">
      <summary className="cursor-pointer min-h-11 flex items-center">Configure server transcription</summary>
      <p className="text-set-dim">On your SET server, set TRANSCRIBE_BASE_URL to a service with /audio/transcriptions, TRANSCRIBE_MODEL to its speech model, and TRANSCRIBE_API_KEY only if required. Restart SET, then recheck here. A plain Ollama chat endpoint is not a transcription service. Do not put credentials in a URL.</p>
    </details>}
    {native && <p className="mt-3 text-xs text-set-dim">This uses the existing opt-in Codex voice integration. Successful ChatGPT sign-in does not prove that this account/runtime supports native realtime audio.</p>}
    <VoicePicker visible={native} />
    <button type="button" className="set-btn mt-3 min-h-11" onClick={() => window.dispatchEvent(new Event(AI_CONNECTION_CHANGED))}>Recheck voice setup</button>
  </section>;
}

/** Live per-user catalog, separate from the audio session lifecycle. Fails closed with retry. */
function VoicePicker({ visible }: { visible: boolean }) {
  const userId = useApp(s => s.user?.id ?? '');
  const spaceId = useApp(s => s.currentSpaceId ?? '');
  const choice = useCodexVoiceChoice();
  const [catalog, setCatalog] = useState<CodexVoiceCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let current = true; // late-response guard: user/space changes and unmounts discard stale responses
    setCatalog(null); setCatalogError('');
    (async () => {
      try {
        const response = await fetch(`/api/copilot/voice/codex/voices?spaceId=${encodeURIComponent(spaceId)}`, {
          headers: { authorization: `Bearer ${getToken()}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Voice catalog could not be loaded.');
        if (!data || !Array.isArray(data.v1) || !Array.isArray(data.v2)) throw new Error('The server returned an unreadable voice catalog.');
        if (current) setCatalog(data);
      } catch (e: any) {
        if (current) { setCatalog(null); setCatalogError(e?.message ?? 'Voice catalog could not be loaded.'); }
      }
    })();
    return () => { current = false; };
  }, [visible, userId, spaceId, attempt]);
  if (!visible) return null;
  if (!catalog && !catalogError) return <p role="status" className="text-xs text-set-dim mt-3">Loading voices…</p>;
  if (!catalog) return <p role="status" className="text-xs text-set-dim mt-3">
    <button type="button" className="set-btn text-xs min-h-9" onClick={() => { setCatalogError(''); setAttempt(n => n + 1); }}>Could not load voices: {catalogError}. Retry</button>
  </p>;
  // Neutral protocol-group names: v1/v2 are wire protocol generations of
  // thread/realtime/listVoices, not model tiers. No compatibility is claimed.
  const groups = [
    catalog.v1.length > 0 && { label: 'Voices (v1 protocol)', voices: catalog.v1 },
    catalog.v2.length > 0 && { label: 'Voices (v2 protocol)', voices: catalog.v2 },
  ].filter(Boolean) as { label: string; voices: string[] }[];
  return <label className="flex flex-wrap items-center gap-2 text-sm mt-3 min-h-11">
    <span>Voice</span>
    <select className="set-input text-sm min-h-11" aria-label="Voice" value={choice.voice ?? ''} onChange={e => choice.setVoice(e.target.value || null)}>
      <option value="">Account default</option>
      {groups.map(g => <optgroup key={g.label} label={g.label}>{g.voices.map(v => <option key={v} value={v}>{v}</option>)}</optgroup>)}
    </select>
    <span className="text-xs text-set-dim">Applies to the next voice conversation. No compatibility is claimed for any specific voice; the account default is preferred.</span>
  </label>;
}
