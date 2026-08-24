import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { bus } from './lib/events.js';
import { authRoutes } from './auth/routes.js';
import { spaceRoutes } from './spaces/routes.js';
import { pageRoutes } from './pages/routes.js';
import { databaseRoutes, pathRoutes } from './databases/routes.js';
import { ragRoutes } from './rag/routes.js';
import { llmRoutes } from './llm/routes.js';
import { agentRoutes } from './agents/routes.js';
import { studyRoutes } from './study/routes.js';
import { modelsRoutes } from './models3d/routes.js';
import { collabRoutes } from './collab/routes.js';
import { fileRoutes } from './files/routes.js';
import { libraryRoutes } from './library/routes.js';
import { codeRoutes, terminalRoutes } from './code/routes.js';
import { notificationRoutes, commentRoutes, pathProgressRoutes } from './team/routes.js';
import { myTasksRoutes, kitRoutes } from './team/mytasks.js';
import { waitlistRoutes } from './waitlist.js';
import { activityRoutes } from './team/activity.js';
import { importZipRoutes } from './team/importZip.js';
import { mcpRoutes } from './mcp/routes.js';
import { skillsRoutes, seedSkills, getActiveSkillPrompt } from './skills/routes.js';
import { onboardingRoutes } from './onboarding/routes.js';
import { copilotKitRoutes } from './copilotkit/route.js';
import { channelRoutes } from './channels/routes.js';
import { seed } from './seed.js';

async function main() {
  const app = Fastify({ logger: true, bodyLimit: 64 * 1024 * 1024 });

  await app.register(cors, { origin: config.webOrigin === '*' ? true : config.webOrigin.split(','), credentials: true });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  await app.register(websocket);

  // tolerate POSTs with a JSON content-type but no body (e.g. curl without -d)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = body as string;
    if (!text?.trim()) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.get('/health', async () => ({ ok: true, name: 'SET', version: '2.1.0' }));

  await app.register(async (api) => {
    await authRoutes(api);
    await spaceRoutes(api);
    await onboardingRoutes(api);
    await pageRoutes(api);
    await databaseRoutes(api);
    await pathRoutes(api);
    await ragRoutes(api);
    await llmRoutes(api);
    await agentRoutes(api);
    await studyRoutes(api);
    await modelsRoutes(api);
    await collabRoutes(api);
    await fileRoutes(api);
    await libraryRoutes(api);
    await codeRoutes(api);
    await terminalRoutes(api);
    await notificationRoutes(api);
    await commentRoutes(api);
    await pathProgressRoutes(api);
    await myTasksRoutes(api);
    await kitRoutes(api);
    await waitlistRoutes(api);
    await activityRoutes(api);
    await importZipRoutes(api);
    await mcpRoutes(api);
    await skillsRoutes(api);
    await copilotKitRoutes(api);
    await channelRoutes(api);
  }, { prefix: '/api' });

  await migrate();
  await bus.init();
  if (config.seedDemo) await seed();

  await app.listen({ port: config.port, host: config.host });
  console.log(`[SET] server listening on :${config.port}`);

  const { telemetry } = await import('./telemetry/index.js');
  telemetry.init(config.dataDir);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      telemetry.stop();
      void telemetry.flush();
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
