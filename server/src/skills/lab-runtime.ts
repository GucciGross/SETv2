import { q } from '../db.js';
import { getProvider, ensureBootstrapProvider, chatCompletion } from '../llm/router.js';
import { COMPILER_INSTRUCTIONS, SkillLabError } from './lab-core.js';
import { createSkillLabService } from './lab-service.js';

export const skillLab = createSkillLabService({
  query: q,
  async generate(input, evidence, ctx) {
    await ensureBootstrapProvider(ctx.spaceId);
    const provider = await getProvider(ctx.spaceId);
    if (!provider) throw new SkillLabError('Configure an AI provider in Settings before compiling a skill.', 409);
    try {
      const result = await chatCompletion(provider, null, {
        messages: [
          { role: 'system', content: COMPILER_INSTRUCTIONS },
          { role: 'user', content: JSON.stringify({ goal: input.goal, mcpRequirements: input.mcpRequirements,
            untrustedTeachingEvidence: evidence.map(({ id, name, kind, text }) => ({ id, name, kind, text })) }) },
        ],
        // This call has no tools. Teaching material cannot execute code or approve itself.
        temperature: 0.2, signal: AbortSignal.timeout(45000),
      });
      if (result.tool_calls.length) throw new Error('Unexpected tool calls');
      return result.content;
    } catch {
      // Provider errors can contain private URLs, keys or source excerpts: never forward them.
      throw new SkillLabError('Skill generation failed or timed out. Check your provider and retry; nothing was activated.', 502);
    }
  },
});
