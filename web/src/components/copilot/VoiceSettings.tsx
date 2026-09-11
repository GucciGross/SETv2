import { browserDictationAvailable } from '../../lib/voiceFallback';
import { AI_CONNECTION_CHANGED, nativeVoiceSelected, useVoiceCapabilities } from './voiceCapabilities';

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
    <button type="button" className="set-btn mt-3 min-h-11" onClick={() => window.dispatchEvent(new Event(AI_CONNECTION_CHANGED))}>Recheck voice setup</button>
  </section>;
}
