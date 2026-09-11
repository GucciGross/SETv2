/** Chat endpoints and credentials must never implicitly enable audio upload. */
export function transcriptionConfig(env: {
  TRANSCRIBE_BASE_URL?: string;
  TRANSCRIBE_API_KEY?: string;
  TRANSCRIBE_MODEL?: string;
}) {
  return {
    baseUrl: env.TRANSCRIBE_BASE_URL?.trim() || undefined,
    apiKey: env.TRANSCRIBE_API_KEY?.trim() || undefined,
    model: env.TRANSCRIBE_MODEL?.trim() || 'whisper-1',
  };
}
