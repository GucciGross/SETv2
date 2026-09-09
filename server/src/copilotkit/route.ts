import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { buildCopilotKitHandler } from './runtime.js';

/**
 * Fastify bridge for the CopilotKit v2 fetch handler (no native Fastify
 * adapter exists). Hides the reply, converts the incoming request to a web
 * Request, and streams the handler's Response back through the raw socket.
 *
 * JSON bodies were already parsed by Fastify and are re-serialized; multipart
 * bodies (POST /transcribe) are forwarded as the untouched raw stream —
 * @fastify/multipart's parser does not consume it.
 */

export async function copilotKitRoutes(app: FastifyInstance) {
  const handler = buildCopilotKitHandler();

  app.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    url: '/copilotkit/*',
    handler: async (req, reply) => {
      reply.hijack();

      const url = new URL(req.raw.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v == null) continue;
        if (Array.isArray(v)) v.forEach((vv) => headers.append(k, String(vv)));
        else headers.set(k, String(v));
      }

      let body: ReadableStream | string | undefined;
      if (req.body !== undefined && req.body !== null) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        // unparsed (multipart) — forward the raw stream; drop length headers so
        // undici uses chunked encoding instead of a stale content-length.
        headers.delete('content-length');
        body = Readable.toWeb(req.raw) as ReadableStream;
      }

      const abort = new AbortController();
      let output: Readable | undefined;
      const onClose = () => {
        if (!reply.raw.writableEnded) { abort.abort(); output?.destroy(); }
      };
      reply.raw.once('close', onClose);
      try {
        const res = await handler(new Request(url, { method: req.method, headers, signal: abort.signal, body: body as any, duplex: body ? 'half' : undefined } as RequestInit));
        if (abort.signal.aborted) { await res.body?.cancel(); return; }
        reply.raw.writeHead(res.status, Object.fromEntries(res.headers.entries()));
        if (res.body) {
          output = Readable.fromWeb(res.body as any);
          output.on('error', () => { abort.abort(); reply.raw.destroy(); });
          output.pipe(reply.raw);
        } else {
          reply.raw.end();
        }
      } catch (e: any) {
        if (abort.signal.aborted) return;
        req.log.error(e, '[copilotkit] bridge failure');
        if (!reply.raw.headersSent) reply.raw.writeHead(502, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify({ error: 'CopilotKit bridge failure', message: e?.message }));
      }
    },
  });
}
