import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { one, q } from '../db.js';
import { requireUser, requireSpace } from '../lib/http.js';
import { getProvider } from '../llm/router.js';
import { ingestSource } from '../rag/search.js';

/**
 * First-run onboarding: persona capture, an activation checklist whose
 * completion is derived from real workspace data (never self-reported),
 * and persona-shaped starter content so a fresh space is never empty.
 */

export type OnboardingState = {
  persona?: 'personal' | 'team' | 'study' | 'builder';
  welcomed?: boolean;
  seededSpaces?: string[];
  checklistHidden?: boolean;
  tourDone?: boolean;
};

const patchSchema = z.object({
  persona: z.enum(['personal', 'team', 'study', 'builder']).optional(),
  welcomed: z.boolean().optional(),
  seededSpaces: z.array(z.string().uuid()).optional(),
  checklistHidden: z.boolean().optional(),
  tourDone: z.boolean().optional(),
});

async function getState(userId: string): Promise<OnboardingState> {
  const row = await one<{ onboarding: OnboardingState | null }>(`SELECT onboarding FROM users WHERE id = $1`, [userId]);
  return row?.onboarding ?? {};
}

async function patchState(userId: string, patch: OnboardingState): Promise<OnboardingState> {
  const next = { ...(await getState(userId)), ...patch };
  await q(`UPDATE users SET onboarding = $2 WHERE id = $1`, [userId, JSON.stringify(next)]);
  return next;
}

/** Checklist completion derived from workspace data — the source of truth. */
async function deriveChecklist(userId: string, spaceId: string) {
  const [pageActs, linkRows, providerRows, runRows, memberRows] = await Promise.all([
    one<{ n: string }>(
      `SELECT count(*)::text AS n FROM activities WHERE space_id = $1 AND user_id = $2 AND type = 'page_created'`,
      [spaceId, userId]
    ),
    one<{ n: string }>(`SELECT count(*)::text AS n FROM links WHERE space_id = $1`, [spaceId]),
    one<{ n: string }>(`SELECT count(*)::text AS n FROM providers WHERE space_id = $1`, [spaceId]),
    one<{ n: string }>(`SELECT count(*)::text AS n FROM agent_runs WHERE user_id = $1 AND space_id = $2`, [userId, spaceId]),
    one<{ n: string }>(`SELECT count(*)::text AS n FROM memberships WHERE space_id = $1`, [spaceId]),
  ]);
  return [
    { id: 'page', done: Number(pageActs?.n ?? 0) > 0 },
    { id: 'link', done: Number(linkRows?.n ?? 0) > 0 },
    { id: 'provider', done: Number(providerRows?.n ?? 0) > 0 },
    { id: 'copilot', done: Number(runRows?.n ?? 0) > 0 },
    { id: 'invite', done: Number(memberRows?.n ?? 0) > 1 },
  ];
}

export async function onboardingRoutes(app: FastifyInstance) {
  app.get('/users/onboarding', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const spaceId = (req.query as any).spaceId;
    const state = await getState(user.id);
    const checklist = spaceId ? await deriveChecklist(user.id, spaceId) : [];
    return { onboarding: state, checklist };
  });

  app.put('/users/onboarding', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const patch = patchSchema.parse(req.body);
    const onboarding = await patchState(user.id, patch);
    return { onboarding };
  });

  /** Seed persona-shaped starter content into a space. Idempotent per user. */
  app.post('/spaces/:spaceId/onboarding/seed', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const { persona } = z.object({ persona: z.enum(['personal', 'team', 'study', 'builder']) }).parse(req.body);

    const state = await getState(user.id);
    if (state.seededSpaces?.includes(spaceId)) return { seeded: false, alreadySeeded: true };

    const col = (name: string, type: string, options?: string[]) => ({
      id: crypto.randomUUID(),
      name,
      type,
      ...(options ? { config: { options: options.map((value) => ({ value, color: 'slate' })) } } : {}),
    });

    const mkPage = async (title: string, markdown: string) => {
      const p = await one<{ id: string }>(
        `INSERT INTO pages (space_id, title, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [spaceId, title, user.id]
      );
      await q(`UPDATE pages SET markdown = $2, updated_at = now() WHERE id = $1`, [p!.id, markdown]);
      return p!.id;
    };
    const mkDb = async (name: string, schema: any[]) =>
      (await one<{ id: string }>(`INSERT INTO databases (space_id, name, schema) VALUES ($1, $2, $3) RETURNING id`, [
        spaceId,
        name,
        JSON.stringify(schema),
      ]))!.id;
    const mkRow = async (dbId: string, cells: Record<string, string>, sort: number) => {
      const page = await one<{ id: string }>(
        `INSERT INTO pages (space_id, title, created_by, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`,
        [spaceId, cells.Name ?? 'Item', user.id, sort]
      );
      const db = await one<{ schema: any[] }>(`SELECT schema FROM databases WHERE id = $1`, [dbId]);
      const byName = new Map<string, string>((db?.schema ?? []).map((c: any) => [String(c.name).toLowerCase(), c.id]));
      const values: Record<string, any> = {};
      for (const [k, v] of Object.entries(cells)) {
        const c = byName.get(k.toLowerCase());
        if (c) values[c] = v;
      }
      await q(`INSERT INTO db_rows (database_id, page_id, cells, sort_order) VALUES ($1, $2, $3, $4)`, [
        dbId,
        page!.id,
        JSON.stringify(values),
        sort,
      ]);
    };
    const mkNotebookSource = async (title: string, text: string) => {
      const nb = await one<{ id: string }>(
        `INSERT INTO notebooks (space_id, title, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [spaceId, title, user.id]
      );
      const src = await one<{ id: string }>(
        `INSERT INTO sources (notebook_id, kind, name, size_bytes, text_content, status) VALUES ($1, 'text', $2, $3, $4, 'pending') RETURNING id`,
        [nb!.id, title, text.length, text]
      );
      const provider = await getProvider(spaceId).catch(() => null);
      void ingestSource(src!.id, provider).catch(() => {});
      return nb!.id;
    };

    if (persona === 'personal') {
      const home = await mkPage('Home', `# Home\n\nYour second brain starts here.\n\n- Capture ideas in [[Reading Notes]]\n- Track what you are working on in the Projects database below\n- Link anything with double brackets and it appears in the graph\n`);
      await mkPage('Reading Notes', `# Reading Notes\n\n**Source:** _title_ · **Author:** _name_\n\n## Summary\n\nThree sentences in your own words.\n\n## Highlights\n\n> Quote that stuck with you.\n\n## What changes?\n\n- [ ] One action from this reading\n\nSee also [[Home]]\n`);
      await mkPage('Ideas', `# Ideas\n\nA parking lot for half-formed thoughts.\n\n- Idea one — what it is, who it is for\n- Idea two\n\nRefine the good ones into [[Home]] projects.\n`);
      void home;
      const db = await mkDb('Projects', [col('Name', 'text'), col('Status', 'select', ['Idea', 'Active', 'Done']), col('Due', 'date')]);
      await mkRow(db, { Name: 'Set up my workspace', Status: 'Active' }, 0);
      await mkRow(db, { Name: 'Migrate my old notes', Status: 'Idea' }, 1);
    } else if (persona === 'team') {
      await mkPage('Team Home', `# Team Home\n\nThe front door for the team.\n\n- New here? Follow [[Onboarding Path]]\n- How we work: [[SOPs]]\n- Weekly sync notes live under this page as subpages\n`);
      await mkPage('Onboarding Path', `# Onboarding Path\n\nDay one:\n\n- [ ] Read the [[SOPs]]\n- [ ] Get access to the tools\n- [ ] Meet your onboarding buddy\n\nWeek one:\n\n- [ ] Ship something small\n- [ ] Skim the [[Team Home]] notes\n`);
      await mkPage('SOPs', `# SOPs\n\n## How we release\n\n1. Branch from main\n2. Review, approve, merge\n3. Tag and ship\n\n## How we write docs\n\nEvery doc links back to [[Team Home]]. Keep it short.\n`);
      const db = await mkDb('Team Tasks', [col('Name', 'text'), col('Owner', 'text'), col('Status', 'select', ['Todo', 'Doing', 'Done'])]);
      await mkRow(db, { Name: 'Invite the team', Owner: 'you', Status: 'Doing' }, 0);
      await mkRow(db, { Name: 'Import existing docs', Status: 'Todo' }, 1);
    } else if (persona === 'study') {
      await mkPage('Study Home', `# Study Home\n\n- Current subjects live in notebooks (sidebar)\n- Make flashcards from any notebook with one click\n- Daily plan: review due cards, then one new source\n\nNotes on method: [[How I Study]]\n`);
      await mkPage('How I Study', `# How I Study\n\n1. Skim the source, note questions\n2. Read actively — summarize each section in one line\n3. Generate flashcards, review daily\n4. Teach it: write an explainer page from memory\n\nTrack it all from [[Study Home]].\n`);
      await mkNotebookSource(
        'Sample Notebook — Getting Started',
        'What is SET\n\nSET is a Knowledge and Learning OS. You upload sources to notebooks, ask grounded questions with citations, and turn any notebook into flashcards and quizzes. This sample source exists so you can try search and citations immediately. Ask the copilot: what is SET?\n\nWhy notebooks\n\nEvery answer the copilot gives in a notebook cites the exact chunk it came from, so you can verify anything in one click. Sources can be PDFs, markdown, plain text, web pages or transcripts.'
      );
    } else {
      // builder
      await mkPage('Engineering Home', `# Engineering Home\n\n- Enable work surfaces in Settings: Coding, Terminal, Library\n- Keep runbooks under this page\n- The copilot can search, read and write pages for you\n\nStart with [[Runbook Template]]\n`);
      await mkPage('Runbook Template', `# Runbook: _task_\n\n**Owner:** · **Last tested:**\n\n## Symptoms\n\nWhat the user sees.\n\n## Diagnosis\n\nCommands and queries that narrow it down.\n\n## Fix\n\nSteps, in order, verified.\n\n## Post-incident\n\n- [ ] File follow-up\n\nLinked from [[Engineering Home]]\n`);
      const db = await mkDb('Services', [col('Name', 'text'), col('Tier', 'select', ['1', '2', '3']), col('Repo', 'text')]);
      await mkRow(db, { Name: 'set-api', Tier: '1', Repo: 'SETv2/server' }, 0);
      await mkRow(db, { Name: 'set-web', Tier: '1', Repo: 'SETv2/web' }, 1);
    }

    await patchState(user.id, { persona, seededSpaces: [...(state.seededSpaces ?? []), spaceId] });
    return { seeded: true };
  });
}
