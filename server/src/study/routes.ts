import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace, rid } from '../lib/http.js';
import { generateDeck, sm2, createDeckRecord } from './generate.js';
import { computeMastery } from './mastery.js';
import { deckToH5P } from './h5p.js';
import { buildAttemptItems, gradeAttempt, normalizeQuizItems, stripAnswers, type QuizSettings } from './quiz.js';
import { recordActivity } from '../team/activity.js';
import { buildAssignmentsICS } from './ics.js';
import { config } from '../config.js';

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Members × quiz best-score % × path progress with at-risk flags (HTTP export + MCP tool share this). */
export async function buildGradebookCsv(spaceId: string): Promise<{ csv: string; memberCount: number; deckCount: number; pathCount: number }> {
  const members = await q(
    `SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.space_id = $1 ORDER BY u.name`,
    [spaceId]
  );
  const decks = await q<{ id: string; title: string }>(
    `SELECT id, title FROM decks WHERE space_id = $1 AND kind = 'quiz' ORDER BY created_at`,
    [spaceId]
  );
  const paths = await q<{ id: string; title: string; due_date: string; item_count: number }>(
    `SELECT id, title, due_date, jsonb_array_length(items) AS item_count FROM learning_paths WHERE space_id = $1 ORDER BY created_at`,
    [spaceId]
  );
  const attempts = await q(
    `SELECT user_id, deck_id, final_score, total_points, status FROM quiz_attempts
     WHERE space_id = $1 AND status = 'graded'`,
    [spaceId]
  );
  const progress = await q(
    `SELECT user_id, path_id, count(*) FILTER (WHERE done)::int AS done FROM path_progress
     WHERE path_id IN (SELECT id FROM learning_paths WHERE space_id = $1)
     GROUP BY user_id, path_id`,
    [spaceId]
  );

  const best = new Map<string, number>(); // userId|deckId -> best pct
  for (const a of attempts as any[]) {
    if (!a.total_points) continue;
    const pct = Math.round((Number(a.final_score) / Number(a.total_points)) * 100);
    const key = `${a.user_id}|${a.deck_id}`;
    best.set(key, Math.max(best.get(key) ?? -1, pct));
  }
  const pathTotals = new Map(paths.map((p: any) => [p.id, Number(p.item_count ?? 0)]));
  const doneFor = new Map<string, number>(); // userId|pathId -> done
  for (const p of progress as any[]) doneFor.set(`${p.user_id}|${p.path_id}`, p.done);

  const header = ['Member', 'Email', 'Role', ...decks.flatMap((d: any) => [`${d.title} (best %)`, `${d.title} attempts`]), ...paths.flatMap((p: any) => [`${p.title} progress`, `${p.title} overdue?`]), 'At risk'];
  const attemptCount = new Map<string, number>();
  for (const a of attempts as any[]) attemptCount.set(`${a.user_id}|${a.deck_id}`, (attemptCount.get(`${a.user_id}|${a.deck_id}`) ?? 0) + 1);

  const lines = [header.map(csvCell).join(',')];
  for (const m of members as any[]) {
    const cells: unknown[] = [m.name, m.email, m.role];
    let atRisk = false;
    for (const d of decks as any[]) {
      const pct = best.get(`${m.id}|${d.id}`);
      if (pct != null && pct < 60) atRisk = true;
      cells.push(pct ?? '', attemptCount.get(`${m.id}|${d.id}`) ?? 0);
    }
    for (const p of paths as any[]) {
      const total = pathTotals.get(p.id) ?? 0;
      const done = doneFor.get(`${m.id}|${p.id}`) ?? 0;
      const overdue = p.due_date && new Date(p.due_date) < new Date(new Date().toDateString()) && done < total;
      if (overdue) atRisk = true;
      cells.push(total ? `${done}/${total}` : '', overdue ? 'yes' : '');
    }
    cells.push(atRisk ? 'yes' : '');
    lines.push(cells.map(csvCell).join(','));
  }
  return { csv: lines.join('\n'), memberCount: members.length, deckCount: decks.length, pathCount: paths.length };
}

export async function studyRoutes(app: FastifyInstance) {
  // deck → .h5p package download (LMS interop; libraries cached under DATA_DIR)
  app.get('/decks/:id/h5p', async (req, reply) => {
    const id = (req.params as any).id;
    const ctx = await requireResourceSpace(req, reply, 'decks', id);
    if (!ctx) return;
    const deck = await one<any>(`SELECT * FROM decks WHERE id = $1`, [id]);
    if (!deck) return reply.code(404).send({ error: 'Deck not found' });
    try {
      const buf = await deckToH5P(deck);
      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', `attachment; filename="${deck.title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'deck'}.h5p"`);
      return reply.send(buf);
    } catch (e: any) {
      return reply.code(500).send({ error: `H5P export failed: ${e?.message ?? e}` });
    }
  });

  app.get('/spaces/:spaceId/decks', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const notebookId = (req.query as any).notebookId;
    const rows = await q(
      `SELECT id, notebook_id, kind, title,
         (CASE WHEN jsonb_typeof(items) = 'array' THEN jsonb_array_length(items)
               WHEN items ? 'items' THEN jsonb_array_length(items->'items')
               WHEN items ? 'cards' THEN jsonb_array_length(items->'cards')
               WHEN items ? 'segments' THEN jsonb_array_length(items->'segments')
               ELSE 0 END) AS item_count,
         created_at
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
      .object({ kind: z.enum(['flashcards', 'quiz', 'studyguide', 'audio']), topic: z.string().optional(), count: z.number().int().min(3).max(40).optional(), openCount: z.number().int().min(0).max(10).optional() })
      .parse(req.body);
    try {
      const result = await generateDeck(ctx.spaceId, id, body.kind, body.topic, body.count ?? 12, body.openCount ?? 0);
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

  // Page-scoped study material: the page's markdown is the grounding source,
  // and the deck links back to the page so quiz/SRS results feed the
  // mastery map (GET /spaces/:id/mastery).
  app.post('/pages/:id/generate', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'pages', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({ kind: z.enum(['flashcards', 'quiz', 'studyguide', 'audio']), topic: z.string().optional(), count: z.number().int().min(3).max(40).optional(), openCount: z.number().int().min(0).max(10).optional() })
      .parse(req.body);
    try {
      const page = await one<{ title: string }>(`SELECT title FROM pages WHERE id = $1`, [id]);
      const result = await generateDeck(ctx.spaceId, null, body.kind, body.topic, body.count ?? 12, body.openCount ?? 0, id);
      const titles: Record<string, string> = {
        flashcards: 'Flashcards',
        quiz: 'Quiz',
        studyguide: 'Study guide',
        audio: 'Audio overview',
      };
      const deck = await createDeckRecord(ctx.spaceId, null, body.kind, `${titles[body.kind]} — ${page?.title ?? 'Page'}${body.topic ? ` — ${body.topic}` : ''}`, result, id);
      const { bus } = await import('../lib/events.js');
      bus.publish({ spaceId: ctx.spaceId, type: 'deck_created', payload: { deckId: deck.id } });
      return { deck };
    } catch (e: any) {
      return reply.code(502).send({ error: e.message ?? String(e) });
    }
  });

  /** Per-page mastery states (paths + page-linked quizzes + SM-2) for the graph's Mastery color mode. */
  app.get('/spaces/:spaceId/mastery', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const mastery = await computeMastery(spaceId, req.user!.id);
    return { mastery };
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
    const attempts = await q(
      `SELECT id, status, total_points, auto_score, final_score, late, started_at, submitted_at
       FROM quiz_attempts WHERE deck_id = $1 AND user_id = $2 ORDER BY started_at DESC`,
      [id, req.user!.id]
    );
    return { deck, reviews, attempts };
  });

  // ---- quiz integrity: per-deck settings, server-side attempts, grading ----

  const quizSettingsSchema = z.object({
    shuffle: z.boolean().optional(),
    shuffleOptions: z.boolean().optional(),
    timeLimitSec: z.number().int().min(30).max(24 * 3600).nullable().optional(),
    attemptLimit: z.number().int().min(1).max(100).nullable().optional(),
    drawCount: z.number().int().min(1).max(200).nullable().optional(),
  });

  app.patch('/decks/:id/settings', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'decks', id, 'editor');
    if (!ctx) return;
    const patch = quizSettingsSchema.parse(req.body);
    const deck = await one<{ settings: QuizSettings }>(`SELECT settings FROM decks WHERE id = $1`, [id]);
    const next = { ...(deck?.settings ?? {}), ...patch };
    await q(`UPDATE decks SET settings = $2 WHERE id = $1`, [id, JSON.stringify(next)]);
    return { settings: next };
  });

  /** Finalize an in-progress attempt from whatever answers are saved (used when a student starts fresh or abandons). */
  const closeAttempt = async (attemptId: string, late: boolean) => {
    const a = await one<any>(`SELECT * FROM quiz_attempts WHERE id = $1 FOR UPDATE`, [attemptId]);
    if (!a || a.status !== 'in_progress') return;
    const items = normalizeQuizItems(a.items_snapshot);
    const graded = gradeAttempt(items, a.answers ?? {}, []);
    await q(
      `UPDATE quiz_attempts SET status = $2, total_points = $3, auto_score = $4,
         final_score = CASE WHEN $5 THEN $6::numeric ELSE NULL END,
         late = $7, submitted_at = now(), graded_at = CASE WHEN $5 THEN now() END
       WHERE id = $1`,
      [attemptId, graded.complete ? 'graded' : 'submitted', graded.totalPoints, graded.autoScore, graded.complete, graded.finalScore, late]
    );
  };

  app.post('/decks/:id/attempts', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'decks', id);
    if (!ctx) return;
    const deck = await one<{ kind: string; items: any; settings: QuizSettings }>(
      `SELECT kind, items, settings FROM decks WHERE id = $1`, [id]
    );
    if (!deck || deck.kind !== 'quiz') return reply.code(400).send({ error: 'Not a quiz deck' });

    const settings = deck.settings ?? {};
    if (settings.attemptLimit) {
      const used = await one<{ n: number }>(
        `SELECT count(*)::int AS n FROM quiz_attempts WHERE deck_id = $1 AND user_id = $2 AND status <> 'in_progress'`,
        [id, req.user!.id]
      );
      if (used!.n >= settings.attemptLimit) {
        return reply.code(403).send({ error: `Attempt limit reached (${settings.attemptLimit})` });
      }
    }

    // a previously abandoned attempt is finalized from its saved answers
    const stale = await q<{ id: string }>(
      `SELECT id FROM quiz_attempts WHERE deck_id = $1 AND user_id = $2 AND status = 'in_progress'`,
      [id, req.user!.id]
    );
    for (const s of stale) await closeAttempt(s.id, true);

    const items = buildAttemptItems(normalizeQuizItems(deck.items?.items ?? deck.items ?? []), settings);
    const deadline = settings.timeLimitSec ? new Date(Date.now() + settings.timeLimitSec * 1000) : null;
    const attempt = await one<any>(
      `INSERT INTO quiz_attempts (deck_id, space_id, user_id, items_snapshot, deadline)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, deadline, started_at`,
      [id, ctx.spaceId, req.user!.id, JSON.stringify(items), deadline]
    );
    return { attempt: { ...attempt, items: stripAnswers(items) } };
  });

  app.get('/attempts/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'quiz_attempts', id);
    if (!ctx) return;
    const a = await one<any>(`SELECT * FROM quiz_attempts WHERE id = $1`, [id]);
    if (!a) return reply.code(404).send({ error: 'Attempt not found' });
    const mine = a.user_id === req.user!.id;
    if (!mine && ctx.role === 'viewer') return reply.code(403).send({ error: 'Requires editor access' });
    const items = normalizeQuizItems(a.items_snapshot);
    // students never see answers mid-attempt; editors grading a submitted attempt do
    const showAnswers = a.status !== 'in_progress' || ctx.role !== 'viewer';
    return {
      attempt: {
        id: a.id,
        deck_id: a.deck_id,
        user_id: a.user_id,
        status: a.status,
        deadline: a.deadline,
        late: a.late,
        started_at: a.started_at,
        submitted_at: a.submitted_at,
        total_points: a.total_points,
        auto_score: a.auto_score,
        final_score: a.final_score,
        manual: a.manual,
        answers: mine || a.status !== 'in_progress' ? a.answers : undefined,
        items: a.status === 'in_progress' && !showAnswers ? stripAnswers(items) : items,
      },
    };
  });

  app.patch('/attempts/:id', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'quiz_attempts', id);
    if (!ctx) return;
    const body = z.object({ answers: z.record(z.string(), z.any()) }).parse(req.body);
    const a = await one<any>(`SELECT * FROM quiz_attempts WHERE id = $1`, [id]);
    if (!a || a.user_id !== req.user!.id) return reply.code(403).send({ error: 'Not your attempt' });
    if (a.status !== 'in_progress') return reply.code(409).send({ error: 'Attempt already submitted' });
    if (a.deadline && new Date(a.deadline).getTime() < Date.now()) {
      return reply.code(409).send({ error: 'Time is up', closed: true });
    }
    await q(`UPDATE quiz_attempts SET answers = $2 WHERE id = $1`, [id, JSON.stringify(body.answers)]);
    return { ok: true };
  });

  app.post('/attempts/:id/submit', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'quiz_attempts', id);
    if (!ctx) return;
    const body = z.object({ answers: z.record(z.string(), z.any()).optional() }).parse(req.body ?? {});
    const a = await one<any>(`SELECT * FROM quiz_attempts WHERE id = $1`, [id]);
    if (!a || a.user_id !== req.user!.id) return reply.code(403).send({ error: 'Not your attempt' });
    if (a.status !== 'in_progress') return reply.code(409).send({ error: 'Already submitted' });
    const answers = { ...(a.answers ?? {}), ...(body.answers ?? {}) };
    const late = !!(a.deadline && Date.now() > new Date(a.deadline).getTime());
    const items = normalizeQuizItems(a.items_snapshot);
    const graded = gradeAttempt(items, answers, []);
    await q(
      `UPDATE quiz_attempts SET status = $2, answers = $3, total_points = $4, auto_score = $5,
         final_score = CASE WHEN $6 THEN $7::numeric ELSE NULL END, late = $8, submitted_at = now(),
         graded_at = CASE WHEN $6 THEN now() END
       WHERE id = $1`,
      [id, graded.complete ? 'graded' : 'submitted', JSON.stringify(answers), graded.totalPoints, graded.autoScore, graded.complete, graded.finalScore, late]
    );
    return {
      attempt: {
        id,
        status: graded.complete ? 'graded' : 'submitted',
        total_points: graded.totalPoints,
        auto_score: graded.autoScore,
        final_score: graded.complete ? graded.finalScore : null,
        late,
        open_count: graded.openCount,
      },
      items, // submitted → answers are visible to the student for review
      answers,
    };
  });

  app.get('/decks/:id/attempts', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'decks', id, 'editor');
    if (!ctx) return;
    const rows = await q(
      `SELECT a.id, a.user_id, a.status, a.total_points, a.auto_score, a.final_score, a.manual,
              a.late, a.started_at, a.submitted_at, u.name AS user_name, u.email AS user_email
       FROM quiz_attempts a JOIN users u ON u.id = a.user_id
       WHERE a.deck_id = $1 ORDER BY a.started_at DESC`,
      [id]
    );
    return { attempts: rows };
  });

  app.post('/attempts/:id/grade', async (req, reply) => {
    const id = rid((req.params as any).id);
    const ctx = await requireResourceSpace(req, reply, 'quiz_attempts', id, 'editor');
    if (!ctx) return;
    const body = z
      .object({ grades: z.array(z.object({ index: z.number().int().min(0), score: z.number().min(0), feedback: z.string().max(2000).optional() })) })
      .parse(req.body);
    const a = await one<any>(`SELECT * FROM quiz_attempts WHERE id = $1`, [id]);
    if (!a) return reply.code(404).send({ error: 'Attempt not found' });
    if (a.status === 'in_progress') return reply.code(409).send({ error: 'Attempt not submitted yet' });
    const items = normalizeQuizItems(a.items_snapshot);
    const graded = gradeAttempt(items, a.answers ?? {}, body.grades);
    await q(
      `UPDATE quiz_attempts SET manual = $2, status = $3, final_score = $4::numeric, graded_at = now(), graded_by = $5 WHERE id = $1`,
      [id, JSON.stringify(graded.manual), graded.complete ? 'graded' : 'submitted', graded.complete ? graded.finalScore : null, req.user!.id]
    );
    return { attempt: { id, status: graded.complete ? 'graded' : 'submitted', final_score: graded.complete ? graded.finalScore : null } };
  });

  // ---- my assignment deadlines as an .ics calendar (all-day events) ----

  app.get('/spaces/:spaceId/assignments.ics', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const rows = await q<{ id: string; title: string; due_date: string }>(
      `SELECT id, title, due_date FROM learning_paths
       WHERE space_id = $1 AND due_date IS NOT NULL AND assignees ? ($2::text)
       ORDER BY due_date`,
      [spaceId, req.user!.id]
    );
    const ics = buildAssignmentsICS(
      rows.map((r) => ({
        uid: `path-${r.id}`,
        title: r.title,
        dueDate: new Date(r.due_date).toISOString().slice(0, 10),
        url: `${config.appUrl.replace(/\/+$/, '')}/app/space/${spaceId}/paths`,
      }))
    );
    reply.header('content-type', 'text/calendar; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="set-assignments.ics"');
    return ics;
  });

  // ---- gradebook: members × quiz decks × learning paths, CSV for LMS import ----

  app.get('/spaces/:spaceId/gradebook.csv', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'editor'))) return;
    const { csv, memberCount, deckCount, pathCount } = await buildGradebookCsv(spaceId);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="gradebook-${spaceId.slice(0, 8)}.csv"`);
    void recordActivity(spaceId, req.user!.id, 'gradebook_exported', { members: memberCount, decks: deckCount, paths: pathCount });
    return csv;
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
