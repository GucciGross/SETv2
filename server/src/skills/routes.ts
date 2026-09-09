import type { FastifyInstance } from 'fastify';
import { skillsRoutes as workspaceSkillsRoutes } from './workspace-routes.js';
import { skillLabRoutes } from './lab-routes.js';
export { seedSkills, getActiveSkillPrompt } from './workspace-routes.js';

/** Existing manual/active skills stay unchanged. Compiled skills are reviewed separately. */
export async function skillsRoutes(app: FastifyInstance) {
  await workspaceSkillsRoutes(app);
  await skillLabRoutes(app);
}
