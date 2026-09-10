import type { FastifyInstance } from 'fastify';
import { codexVoiceRoutes } from './codex-voice.js';
import { codexSessions } from '../codex/service.js';
import { codexVoiceEnabled } from '../codex/policy.js';
import { requireUser } from '../lib/http.js';
import { transcribeBuffer, transcriptionConfigured } from './transcribe.js';

/** Reuses SET's transcription service; Codex OAuth is never an audio API key. */
export async function copilotVoiceRoutes(app: FastifyInstance) {
  await codexVoiceRoutes(app);
  const inFlight = new Set<string>();
  app.get('/copilot/voice/capabilities', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    reply.header('Cache-Control', 'no-store');
    return { serverTranscription: transcriptionConfigured(), codexRealtime: {
      enabled: codexVoiceEnabled(), selected: codexVoiceEnabled() && await codexSessions.selected(user.id), experimental: true,
    } };
  });
  app.post('/copilot/voice/transcribe', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!transcriptionConfigured()) return reply.code(503).send({ error: 'No speech-to-text provider is configured.' });
    if (inFlight.has(user.id) || inFlight.size >= 8) return reply.code(429).send({ error: 'Another transcription is in progress. Try again shortly.' });
    inFlight.add(user.id);
    const abort = new AbortController();
    const close = () => { if (!reply.raw.writableEnded) abort.abort(); };
    reply.raw.once('close', close);
    try {
      let audio: Buffer | undefined;
      let ext = 'webm';
      for await (const file of req.parts({ limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 1 } })) {
        if (file.type !== 'file' || file.fieldname !== 'file' || !/^audio\/(webm|mp4|ogg|wav|x-wav|mpeg)(;|$)/i.test(file.mimetype)) {
          if (file.type === 'file') file.file.resume();
          return reply.code(400).send({ error: 'Upload one supported audio recording.' });
        }
        audio = await file.toBuffer();
        if (file.file.truncated) return reply.code(413).send({ error: 'Recording exceeds the 8 MB limit.' });
        ext = ({ 'audio/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3' } as Record<string, string>)[file.mimetype.toLowerCase().split(';')[0]] ?? 'webm';
      }
      if (!audio?.length) return reply.code(400).send({ error: 'The recording is empty.' });
      if (abort.signal.aborted) return;
      const text = await transcribeBuffer(audio, `speech.${ext}`, AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]));
      reply.header('Cache-Control', 'no-store');
      return { text };
    } catch (error: any) {
      if (abort.signal.aborted) return;
      if (['FST_FILES_LIMIT', 'FST_FIELDS_LIMIT', 'FST_PARTS_LIMIT', 'FST_INVALID_MULTIPART_CONTENT_TYPE'].includes(error?.code)) return reply.code(400).send({ error: 'Upload one supported audio recording.' });
      if (error?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'Recording exceeds the 8 MB limit.' });
      return reply.code(502).send({ error: 'Speech transcription failed. Check the configured transcription provider, or use text.' });
    } finally {
      reply.raw.off('close', close); inFlight.delete(user.id);
    }
  });
}
