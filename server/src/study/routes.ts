import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';
import { generateDeck, sm2, createDeckRecord } from './generate.js';

export async function studyRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/decks', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const notebookId = (req.query as any).notebookId;
    const rows = await q(
      `SELECT id, notebook_id, kind, title, jsonb_array_length(items) AS item_count, created_at
       FROM decks WHERE space_id = $1 AND ($2::uuid IS NULL OR notebook_id = $2::uuid) ORDER BY created_at DESC`,
      [spaceId, notebookId ?? null]
    );
    return { decks: rows };
  });

  app.post('/notebooks/:id/generate', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'notebooks', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({ kind: z.enum(['flashcards', 'quiz', 'studyguide', 'audio']), topic: z.string().optional(), count: z.number().int().min(3).max(40).optional() })
      .parse(req.body);
    try {
      const result = await generateDeck(ctx.spaceId, id, body.kind, body.topic, body.count ?? 12);
      const titles: Record<string, string> = {
        flashcards: 'Flashcards',
        quiz: 'Quiz',
        studyguide: 'Study guide',
        audio: 'Audio overview',
      };
      const deck = await createDeckRecord(ctx.spaceId, id, body.kind, `${titles[body.kind]}${body.topic ? ' — ' + body.topic : ''}`, result);
      return { deck };
    } catch (e: any) {
      return reply.code(502).send({ error: e.message ?? String(e) });
    }
  });

  app.get('/decks/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'decks', id);
    if (!ctx) return;
    const deck = await one<any>(`SELECT * FROM decks WHERE id = $1`, [id]);
    const reviews = await q(
      `SELECT item_index, ease, interval_days, reps, due_at, last_grade FROM reviews WHERE deck_id = $1 AND user_id = $2`,
      [id, req.user!.id]
    );
    return { deck, reviews };
  });

  app.delete('/decks/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'decks', id, 'editor');
    if (!ctx) return;
    await q(`DELETE FROM decks WHERE id = $1`, [id]);
    return { ok: true };
  });

  app.post('/decks/:id/review', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'decks', id);
    if (!ctx) return;
    const body = z.object({ itemIndex: z.number().int().min(0), grade: z.number().int().min(0).max(3) }).parse(req.body);
    const current = await one<{ ease: number; interval_days: number; reps: number }>(
      `SELECT ease, interval_days, reps FROM reviews WHERE deck_id = $1 AND user_id = $2 AND item_index = $3`,
      [id, req.user!.id, body.itemIndex]
    );
    const next = sm2(body.grade, current?.ease ?? 2.5, current?.interval_days ?? 0, current?.reps ?? 0);
    await q(
      `INSERT INTO reviews (deck_id, user_id, item_index, ease, interval_days, reps, due_at, last_grade)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (deck_id, user_id, item_index) DO UPDATE SET
         ease = EXCLUDED.ease, interval_days = EXCLUDED.interval_days, reps = EXCLUDED.reps,
         due_at = EXCLUDED.due_at, last_grade = EXCLUDED.last_grade`,
      [id, req.user!.id, body.itemIndex, next.ease, next.intervalDays, next.reps, next.dueAt, body.grade]
    );
    return { review: next };
  });
}
