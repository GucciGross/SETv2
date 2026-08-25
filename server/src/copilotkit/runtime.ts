import { CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2';
import { verifyToken, type JwtUser } from '../lib/tokens.js';
import { SetAgent } from './agent.js';
import { SetTranscriptionService, transcriptionConfigured } from './transcribe.js';

/**
 * CopilotKit v2 runtime, mounted on the Fastify server via the fetch-handler
 * bridge (route.ts). Agents are created per request so the authenticated user
 * flows into the engine; the same membership rules as the REST API apply.
 *
 * Endpoints (multi-route mode, under /api/copilotkit):
 *   GET  /info                     — agent discovery + capability flags
 *   POST /agent/:agentId/run       — AG-UI SSE run (set | set_guide)
 *   POST /transcribe               — voice input (when a provider is configured)
 */

export const COPILOTKIT_BASE_PATH = '/api/copilotkit';

/** Bearer token or ?token= → SET user, or null. */
export function userFromRequest(request: Request): JwtUser | null {
  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : new URL(request.url).searchParams.get('token');
  return token ? verifyToken(token) : null;
}

export function buildCopilotKitHandler() {
  const runtime = new CopilotRuntime({
    agents: ({ request }) => {
      const user = userFromRequest(request);
      if (!user) throw new Error('Unauthenticated');
      return {
        set: new SetAgent(user),
        set_guide: new SetAgent(user, { guide: true }),
      };
    },
    a2ui: {},
    ...(transcriptionConfigured() ? { transcriptionService: new SetTranscriptionService() } : {}),
  });

  return createCopilotRuntimeHandler({
    runtime,
    basePath: COPILOTKIT_BASE_PATH,
    hooks: {
      onRequest: async ({ request }) => {
        console.log(`[copilotkit] ${request.method} ${new URL(request.url).pathname}`);
        if (!userFromRequest(request)) {
          throw new Response('Unauthorized', { status: 401 });
        }
      },
      onError: async ({ error, request }) => {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[copilotkit] handler error ${request.method} ${new URL(request.url).pathname}:`, msg);
      },
    },
  });
}
