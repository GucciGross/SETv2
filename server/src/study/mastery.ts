import { q } from '../db.js';

/**
 * Per-page mastery for the graph's "Mastery" color mode. Three signals, all
 * user-scoped:
 *
 * - paths:    learning-path item progress (any done item → strong; assigned
 *             but unfinished → learning)
 * - quizzes:  best graded/submitted attempt on a page-linked deck
 *             (≥80% mastered, ≥50% learning, below → decaying)
 * - reviews:  SM-2 state on page-linked decks (≥1/3 overdue → decaying;
 *             else ease ≥ 2.3 with reps → mastered; else learning)
 *
 * Decaying outranks everything (needs attention now), then mastered, then
 * learning. Untested pages are omitted from the map — the client renders
 * them with the default node color.
 */

export type MasteryState = 'mastered' | 'learning' | 'decaying';

export interface PageMastery {
  state: MasteryState;
  signals: {
    paths: { done: number; total: number };
    quizzes: { attempts: number; bestRatio: number };
    reviews: { total: number; overdue: number; avgEase: number };
  };
}

const RANK: Record<MasteryState, number> = { learning: 1, mastered: 2, decaying: 3 };

const combine = (a: MasteryState | null, b: MasteryState | null): MasteryState | null => {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
};

export async function computeMastery(spaceId: string, userId: string): Promise<Record<string, PageMastery>> {
  const byPage = new Map<string, PageMastery>();
  const touch = (pageId: string): PageMastery => {
    let m = byPage.get(pageId);
    if (!m) {
      m = {
        state: 'learning',
        signals: { paths: { done: 0, total: 0 }, quizzes: { attempts: 0, bestRatio: 0 }, reviews: { total: 0, overdue: 0, avgEase: 0 } },
      };
      byPage.set(pageId, m);
    }
    return m;
  };

  // 1. learning paths + this user's item progress
  const paths = await q<{ id: string; items: { pageId?: string }[] }>(
    `SELECT id, items FROM learning_paths WHERE space_id = $1`,
    [spaceId]
  );
  const progress = await q<{ path_id: string; item_index: number; done: boolean }>(
    `SELECT pp.path_id, pp.item_index, pp.done FROM path_progress pp
     JOIN learning_paths lp ON lp.id = pp.path_id WHERE lp.space_id = $1 AND pp.user_id = $2`,
    [spaceId, userId]
  );
  const doneByKey = new Map(progress.map((p) => [`${p.path_id}:${p.item_index}`, p.done]));
  for (const path of paths) {
    (path.items ?? []).forEach((item, index) => {
      const pageId = typeof item?.pageId === 'string' ? item.pageId : null;
      if (!pageId) return;
      const m = touch(pageId);
      m.signals.paths.total += 1;
      if (doneByKey.get(`${path.id}:${index}`)) m.signals.paths.done += 1;
    });
  }

  // 2 + 3. page-linked decks: quiz attempts and SM-2 review state
  const pageDecks = await q<{ id: string; page_id: string }>(
    `SELECT id, page_id FROM decks WHERE space_id = $1 AND page_id IS NOT NULL`,
    [spaceId]
  );
  if (pageDecks.length) {
    const deckIds = pageDecks.map((d) => d.id);
    const attempts = await q<{ deck_id: string; ratio: number }>(
      `SELECT deck_id, COALESCE(final_score, auto_score) / NULLIF(total_points, 0) AS ratio
       FROM quiz_attempts
       WHERE space_id = $1 AND user_id = $2 AND status IN ('submitted', 'graded')
         AND total_points > 0 AND deck_id = ANY($3::uuid[])`,
      [spaceId, userId, deckIds]
    );
    const reviews = await q<{ deck_id: string; ease: number; due_at: string }>(
      `SELECT r.deck_id, r.ease, r.due_at FROM reviews r JOIN decks d ON d.id = r.deck_id
       WHERE d.space_id = $1 AND r.user_id = $2 AND d.page_id IS NOT NULL`,
      [spaceId, userId]
    );
    const deckToPage = new Map(pageDecks.map((d) => [d.id, d.page_id]));
    const attemptByPage = new Map<string, number>();
    for (const a of attempts) {
      const pageId = deckToPage.get(a.deck_id);
      if (!pageId || !Number.isFinite(a.ratio)) continue;
      attemptByPage.set(pageId, Math.max(attemptByPage.get(pageId) ?? 0, Number(a.ratio)));
    }
    const reviewRows = new Map<string, { ease: number; due_at: string }[]>();
    for (const r of reviews) {
      const pageId = deckToPage.get(r.deck_id);
      if (!pageId) continue;
      reviewRows.set(pageId, [...(reviewRows.get(pageId) ?? []), { ease: Number(r.ease), due_at: r.due_at }]);
    }
    for (const [pageId, best] of attemptByPage) {
      const m = touch(pageId);
      m.signals.quizzes = { attempts: attempts.filter((a) => deckToPage.get(a.deck_id) === pageId).length, bestRatio: Math.round(best * 100) / 100 };
    }
    for (const [pageId, rows] of reviewRows) {
      const overdue = rows.filter((r) => new Date(r.due_at).getTime() < Date.now()).length;
      const avgEase = rows.reduce((sum, r) => sum + r.ease, 0) / rows.length;
      touch(pageId).signals.reviews = { total: rows.length, overdue, avgEase: Math.round(avgEase * 100) / 100 };
    }
  }

  // aggregate signal states
  const out: Record<string, PageMastery> = {};
  for (const [pageId, m] of byPage) {
    let state: MasteryState | null = null;
    if (m.signals.paths.done > 0) state = combine(state, 'mastered');
    else if (m.signals.paths.total > 0) state = combine(state, 'learning');

    const { attempts, bestRatio } = m.signals.quizzes;
    if (attempts > 0) {
      const quizState: MasteryState = bestRatio >= 0.8 ? 'mastered' : bestRatio >= 0.5 ? 'learning' : 'decaying';
      state = combine(state, quizState);
    }

    const { total, overdue, avgEase } = m.signals.reviews;
    if (total > 0) {
      const reviewState: MasteryState = overdue / total >= (1 / 3) ? 'decaying' : avgEase >= 2.3 ? 'mastered' : 'learning';
      state = combine(state, reviewState);
    }
    m.state = state ?? 'learning';
    out[pageId] = m;
  }
  return out;
}
