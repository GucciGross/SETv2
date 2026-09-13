import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { deploymentSettings, validatePublicDeployment } from './deployment.js';
import { migrate } from './migrate.js';
import { bus } from './lib/events.js';
import { authRoutes } from './auth/routes.js';
import { oidcRoutes } from './auth/oidc.js';
import { spaceRoutes } from './spaces/routes.js';
import { pageRoutes } from './pages/routes.js';
import { databaseRoutes, pathRoutes } from './databases/routes.js';
import { ragRoutes } from './rag/routes.js';
import { subjectRoutes } from './subjects/routes.js';
import { researchRoutes } from './research/routes.js';
import { companionRoutes } from './companion/routes.js';
import { llmRoutes } from './llm/routes.js';
import { agentRoutes } from './agents/routes.js';
import { h5pRoutes } from './h5p/routes.js';
import { studyRoutes } from './study/routes.js';
import { modelsRoutes } from './models3d/routes.js';
import { collabRoutes } from './collab/routes.js';
import { fileRoutes } from './files/routes.js';
import { installAssetAccess } from './files/access.js';
import { libraryRoutes } from './library/routes.js';
import { codeRoutes, terminalRoutes } from './code/routes.js';
import { notificationRoutes, commentRoutes, pathProgressRoutes } from './team/routes.js';
import { pushRoutes } from './team/push.js';
import { myTasksRoutes, kitRoutes } from './team/mytasks.js';
import { waitlistRoutes } from './waitlist.js';
import { activityRoutes } from './team/activity.js';
import { importZipRoutes } from './team/importZip.js';
import { codegraphRoutes } from './team/codegraph.js';
import { mcpRoutes } from './mcp/routes.js';
import { skillsRoutes, seedSkills, getActiveSkillPrompt } from './skills/routes.js';
import { onboardingRoutes } from './onboarding/routes.js';
import { copilotKitRoutes } from './copilotkit/route.js';
import { copilotVoiceRoutes } from './copilotkit/voice.js';
import { codexRoutes } from './codex/routes.js';
import { channelRoutes } from './channels/routes.js';
import { wandgxRoutes } from './wandgx/routes.js';
import { clipRoutes } from './clip/routes.js';
import { billingRoutes } from './billing/routes.js';
import { seed } from './seed.js';

async function main() {
  validatePublicDeployment();
  const deployment = deploymentSettings();
  const app = Fastify({ logger: true, bodyLimit: 64 * 1024 * 1024, maxParamLength: 2048, trustProxy: deployment.trustProxy });

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/clip')) return;
    reply.header('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    reply.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      reply.code(204).send();
      return reply;
    }
  });

  await app.register(cors, { origin: config.webOrigin === '*' ? true : config.webOrigin.split(',').map(s => s.trim()), credentials: true });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  await app.register(websocket);
  installAssetAccess(app);

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = body as string;
    (req as any).rawBody = text ?? '';
    if (!text?.trim()) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch (err: any) {
      err.statusCode = 400;
      done(err);
    }
  });

  app.get('/health', async () => ({ ok: true, name: 'SET', version: '2.1.0' }));

  await app.register(clipRoutes, { prefix: '/api' });

  await app.register(async (api) => {
    await authRoutes(api);
    await oidcRoutes(api);
    api.get('/meta', async () => {
      const { oidcEnabled } = await import('./auth/oidc.js');
      const { edition, exposure, revision } = deployment;
      return { version: '2.1.0', deployment: { edition, exposure, revision }, sso: { enabled: oidcEnabled(), name: config.oidc.displayName } };
    });
    await spaceRoutes(api);
    await onboardingRoutes(api);
    await pageRoutes(api);
    await databaseRoutes(api);
    await pathRoutes(api);
    await ragRoutes(api);
    await subjectRoutes(api);
    await researchRoutes(api);
    await companionRoutes(api);
    await llmRoutes(api);
    await agentRoutes(api);
    await studyRoutes(api);
    await h5pRoutes(api);
    await modelsRoutes(api);
    await collabRoutes(api);
    await fileRoutes(api);
    await libraryRoutes(api);
    await codeRoutes(api);
    await terminalRoutes(api);
    await notificationRoutes(api);
    await pushRoutes(api);
    await commentRoutes(api);
    await pathProgressRoutes(api);
    await myTasksRoutes(api);
    await kitRoutes(api);
    await waitlistRoutes(api);
    await activityRoutes(api);
    await importZipRoutes(api);
    await codegraphRoutes(api);
    await mcpRoutes(api);
    await billingRoutes(api);
    await skillsRoutes(api);
    await copilotKitRoutes(api);
    await copilotVoiceRoutes(api);
    await codexRoutes(api);
    await channelRoutes(api);
    await wandgxRoutes(api);
  }, { prefix: '/api' });

  await migrate();
  await bus.init();
  if (config.seedDemo) await seed();
  const { initBriefScheduler } = await import('./study/briefScheduler.js');
  initBriefScheduler();

  const { provisionBundledLibraries } = await import('./h5p/bundle.js');
  const bundle = await provisionBundledLibraries(join(config.dataDir, 'h5p', 'libraries'));
  console.log(`[H5P] ${bundle.contentTypes} bundled content types; ${bundle.changed.length} library versions installed or repaired`);
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
