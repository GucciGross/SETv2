import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import AdmZip from 'adm-zip';
import { requireSpace } from '../lib/http.js';
import { SkillLabError } from './lab-core.js';
import { skillLab } from './lab-runtime.js';
import type { LabContext } from './lab-service.js';

export async function skillLabRoutes(app: FastifyInstance) {
  const handle = (write: boolean, action: (ctx: LabContext, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const spaceId = (req.params as { spaceId: string }).spaceId;
        const role = await requireSpace(req, reply, spaceId, write ? 'editor' : 'viewer');
        if (!role) return;
        reply.header('Cache-Control', 'no-store');
        return await action({ spaceId, role, userId: req.user!.id }, req, reply);
      } catch (error) {
        if (error instanceof SkillLabError) return reply.code(error.statusCode).send({ error: error.message });
        req.log.error({ errorType: error instanceof Error ? error.name : 'unknown' }, 'Skill Lab request failed');
        return reply.code(500).send({ error: 'Skill Lab request failed. Nothing was activated; please retry.' });
      }
    };
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;
  const base = '/spaces/:spaceId/skill-drafts';
  app.get(base, handle(false, async ctx => ({ drafts: await skillLab.list(ctx), limit: 50, canEdit: ['owner', 'editor'].includes(ctx.role) })));
  app.post(base, handle(true, async (ctx, req, reply) => reply.code(201).send({ draft: await skillLab.compile(ctx, req.body) })));
  app.get(base + '/:id', handle(false, async (ctx, req) => ({ draft: await skillLab.get(ctx, id(req)) })));
  app.post(base + '/:id/revisions', handle(true, async (ctx, req, reply) => reply.code(201).send({ draft: await skillLab.revise(ctx, id(req), req.body) })));
  app.post(base + '/:id/review', handle(true, async (ctx, req) => ({ draft: await skillLab.review(ctx, id(req), req.body) })));
  app.post(base + '/:id/revoke', handle(true, async (ctx, req) => ({ draft: await skillLab.revoke(ctx, id(req)) })));
  app.delete(base + '/:id', handle(true, async (ctx, req) => { await skillLab.remove(ctx, id(req)); return { ok: true }; }));
  app.get(base + '/:id/export.zip', handle(false, async (ctx, req, reply) => {
    const bundle = await skillLab.export(ctx, id(req));
    const zip = new AdmZip();
    for (const [file, content] of Object.entries(bundle.files)) zip.addFile(file, Buffer.from(content, 'utf8'));
    return reply.header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="set-skill-${bundle.draftId}.zip"`).send(zip.toBuffer());
  }));
}
