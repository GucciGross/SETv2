import { TranscriptionService, type TranscribeFileOptions } from '@copilotkit/runtime/v2';
import { config } from '../config.js';

/**
 * BYOK speech-to-text: POSTs the recorded audio to any OpenAI-compatible
 * /audio/transcriptions endpoint (Groq Whisper, whisper.cpp server, OpenAI, …).
 *
 * Configured via TRANSCRIBE_BASE_URL / TRANSCRIBE_API_KEY / TRANSCRIBE_MODEL,
 * falling back to the bootstrap LLM env. When neither is set the service is
 * not registered at all — /info then reports transcription as unavailable and
 * the web client falls back to the browser's Web Speech API.
 */

export function transcriptionConfigured(): boolean {
  return !!config.transcribe.baseUrl;
}

export class SetTranscriptionService extends TranscriptionService {
  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    const { baseUrl, apiKey, model } = config.transcribe;
    if (!baseUrl) {
      // Wording matters: the runtime maps errors containing "api key" to a 401
      // instead of an opaque 500, so the client can fall back cleanly.
      throw new Error('No transcription provider configured (api key missing): set TRANSCRIBE_BASE_URL or LLM_BASE_URL');
    }
    const form = new FormData();
    form.append('file', options.audioFile, options.audioFile.name || 'audio.webm');
    form.append('model', model);
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) throw new Error(`Transcription provider rejected credentials (api key invalid): ${text.slice(0, 200)}`);
      throw new Error(`Transcription error ${res.status}: ${text.slice(0, 300)}`);
    }
    const json: any = await res.json();
    const { telemetry } = await import('../telemetry/index.js');
    telemetry.track('transcription');
    return json.text ?? '';
  }
}
