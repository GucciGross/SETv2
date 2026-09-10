import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/http.js';
import { transcribeBuffer } from './transcribe.js';

/** Small authenticated voice endpoint for the persistent voice/text launcher. */
export async function copilotVoiceRoutes(app: FastifyInstance) {
  app.post('/copilot-voice/transcribe', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Audio file required' });
    const buf = await file.toBuffer();
    if (!buf.length) return reply.code(400).send({ error: 'Empty audio file' });
    if (buf.length > 25 * 1024 * 1024) return reply.code(413).send({ error: 'Audio file too large' });
    const text = await transcribeBuffer(buf, file.filename || 'copilot.webm');
    return { text };
  });
}
