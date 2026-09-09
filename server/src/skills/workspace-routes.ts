import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireSpace, requireResourceSpace, rid } from '../lib/http.js';

/** Copilot skills: SKILL.md-style capability documents that extend the agent. */

const BUILT_IN_SKILLS = [
  {
    name: 'study-coach',
    description: 'Guide learning: assess level, build plans, quiz, explain mistakes, celebrate wins.',
    content: `# Study Coach

## When to use
The user wants to learn something, study, or prepare for a test.

## Instructions
- Assess their current level before teaching (ask 1-2 questions)
- Break topics into small, ordered steps; use learning paths when helpful
- Generate practice questions via generate_study_material
- When they get something wrong, explain WHY before correcting
- Celebrate milestones with encouragement
- Use search_knowledge to ground explanations in the workspace's own sources`,
  },
  {
    name: 'research-assistant',
    description: 'Deep research over notebooks with citations, synthesis, and gap detection.',
    content: `# Research Assistant

## When to use
The user asks to research, analyze, summarize, or compare topics.

## Instructions
- ALWAYS use search_knowledge first — never answer from general knowledge when sources exist
- Cite sources by name and page label in every claim
- When sources conflict, present both perspectives with their citations
- Flag gaps: "This isn't covered in your sources" rather than filling from training data
- Synthesize across sources into structured outputs (tables, timelines, summaries)
- Suggest follow-up questions the user might not have thought of`,
  },
  {
    name: 'workspace-organizer',
    description: 'Keep the workspace tidy: suggest structures, find orphans, clean up naming.',
    content: `# Workspace Organizer

## When to use
The user wants to organize pages, clean up structure, or plan a workspace layout.

## Instructions
- Use list_pages and search_workspace before proposing any structure
- Respect existing conventions (naming patterns, nesting depth)
- Suggest wiki links between related pages using [[page title]] syntax
- Flag orphaned pages (no backlinks) and suggest where to link them
- Propose 3-7 top-level sections max — resist deep nesting
- When creating pages, always use create_page with wiki links to related content`,
  },
  {
    name: 'sop-writer',
    description: 'Write clear standard operating procedures from existing knowledge.',
    content: `# SOP Writer

## When to use
The user wants to document a process, create training material, or write an SOP.

## Instructions
- First search the workspace for existing documentation on the topic
- Structure: Purpose, Scope, Prerequisites, Steps (numbered), Verification, Troubleshooting
- Write at a reading level appropriate for new team members
- Include [[wiki links]] to any referenced pages
- Use create_page_template for reusable SOPs
- Suggest creating a learning path to assign the SOP to team members`,
  },
];

export async function seedSkills(spaceId: string, userId: string) {
  for (const skill of BUILT_IN_SKILLS) {
    await q(
      `INSERT INTO skills (space_id, name, description, content, built_in, created_by)
       VALUES ($1, $2, $3, $4, true, $5) ON CONFLICT (space_id, name) DO NOTHING`,
      [spaceId, skill.name, skill.description, skill.content, userId]
    );
  }
}

export async function skillsRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/skills', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q(
      `SELECT id, name, description, active, built_in, created_at FROM skills WHERE space_id = $1 ORDER BY built_in DESC, name`,
      [spaceId]
    );
    return { skills: rows };
  });

  app.get('/skills/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'skills', id);
    if (!ctx) return;
    const skill = await one<any>(`SELECT * FROM skills WHERE id = $1`, [id]);
    return { skill };
  });

  app.post('/spaces/:spaceId/skills', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const body = z
      .object({
        name: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, 'lowercase-kebab only'),
        description: z.string().max(200).default(''),
        content: z.string().max(20000),
      })
      .parse(req.body);
    const skill = await one<any>(
      `INSERT INTO skills (space_id, name, description, content, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [spaceId, body.name, body.description, body.content, req.user!.id]
    );
    return { skill };
  });

  app.patch('/skills/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'skills', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({
        name: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
        description: z.string().max(200).optional(),
        content: z.string().max(20000).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const sets: string[] = [];
    const vals: any[] = [id];
    for (const [key, col] of [['name', 'name'], ['description', 'description'], ['content', 'content'], ['active', 'active']] as const) {
      if ((body as any)[key] !== undefined) {
        vals.push((body as any)[key]);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (sets.length) await q(`UPDATE skills SET ${sets.join(', ')} WHERE id = $1`, vals);
    return { ok: true };
  });

  app.delete('/skills/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'skills', id, 'editor');
    if (!ctx) return;
    const skill = await one<{ built_in: boolean }>(`SELECT built_in FROM skills WHERE id = $1`, [id]);
    if (skill?.built_in) {
      // built-ins deactivate rather than delete
      await q(`UPDATE skills SET active = false WHERE id = $1`, [id]);
    } else {
      await q(`DELETE FROM skills WHERE id = $1`, [id]);
    }
    return { ok: true };
  });
}

/** Active skill content formatted for injection into the copilot system prompt. */
export async function getActiveSkillPrompt(spaceId: string): Promise<string> {
  const rows = await q<{ name: string; content: string }>(
    `SELECT name, content FROM skills WHERE space_id = $1 AND active`,
    [spaceId]
  );
  if (!rows.length) return '';
  return rows.map((r) => `--- Skill: ${r.name} ---\n${r.content}`).join('\n\n');
}
