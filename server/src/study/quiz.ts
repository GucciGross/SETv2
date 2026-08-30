/**
 * Quiz integrity logic — pure functions so shuffling, drawing, answer
 * stripping and grading are unit-testable without a DB.
 *
 * Item shapes (normalized):
 *   mcq:  { type:'mcq', question, options[], answerIndex, explanation?, points }
 *   open: { type:'open', question, answerReference?, points }
 * Legacy generated items (no `type`) are treated as mcq.
 */

export interface QuizItem {
  type: 'mcq' | 'open';
  question: string;
  options?: string[];
  answerIndex?: number;
  explanation?: string;
  answerReference?: string;
  points: number;
}

export interface QuizSettings {
  shuffle?: boolean;
  shuffleOptions?: boolean;
  timeLimitSec?: number | null;
  attemptLimit?: number | null;
  drawCount?: number | null;
}

export function normalizeQuizItems(raw: any[]): QuizItem[] {
  return (raw ?? [])
    .filter((it) => it && typeof it.question === 'string')
    .map((it) => {
      if (it.type === 'open') {
        return { type: 'open', question: it.question, answerReference: it.answerReference ?? '', points: Number(it.points) > 0 ? Number(it.points) : 2 };
      }
      const options: string[] = Array.isArray(it.options) ? it.options.map(String) : [];
      const answerIndex = Number.isInteger(it.answerIndex) && it.answerIndex >= 0 && it.answerIndex < options.length ? it.answerIndex : 0;
      return { type: 'mcq', question: it.question, options, answerIndex, explanation: it.explanation ?? '', points: 1 };
    });
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build the exact item set served for one attempt: optional bank draw
 * (serve N of M questions), question-order shuffle, and option shuffle with
 * answerIndex remap. Returns the full-fidelity snapshot (kept server-side).
 */
export function buildAttemptItems(items: QuizItem[], settings: QuizSettings): QuizItem[] {
  let set = items;
  const draw = Number(settings.drawCount) > 0 ? Math.floor(Number(settings.drawCount)) : 0;
  if (draw > 0 && draw < set.length) set = shuffle(set).slice(0, draw);
  if (settings.shuffle) set = shuffle(set);
  if (settings.shuffleOptions) {
    set = set.map((it) => {
      if (it.type !== 'mcq' || !it.options || it.options.length < 2) return it;
      const perm = shuffle(it.options.map((_, i) => i));
      const options = perm.map((i) => it.options![i]);
      const answerIndex = perm.indexOf(it.answerIndex ?? 0);
      return { ...it, options, answerIndex };
    });
  }
  return set;
}

/** What a student's browser may see while an attempt is open: no answers. */
export function stripAnswers(items: QuizItem[]) {
  return items.map((it) => {
    if (it.type === 'open') return { type: 'open' as const, question: it.question, points: it.points };
    return { type: 'mcq' as const, question: it.question, options: it.options ?? [], points: it.points };
  });
}

export interface ManualGrade { index: number; score: number; feedback?: string }

/**
 * Grade an attempt. MCQ items score automatically; open items score 0 until
 * a teacher grades them. `manual` entries beyond an item's points are clamped.
 */
export function gradeAttempt(items: QuizItem[], answers: Record<string, any>, manual: ManualGrade[] = []) {
  const totalPoints = items.reduce((s, it) => s + it.points, 0);
  let autoScore = 0;
  let openCount = 0;
  let openGraded = 0;
  items.forEach((it, i) => {
    if (it.type === 'open') {
      openCount++;
      const g = manual.find((m) => m.index === i);
      if (g) openGraded++;
    } else if (Number(answers[String(i)]) === it.answerIndex) {
      autoScore += it.points;
    }
  });
  const clamped = manual.map((m) => {
    const it = items[m.index];
    const max = it ? it.points : 0;
    return { ...m, score: Math.max(0, Math.min(Number(m.score) || 0, max)) };
  });
  const manualScore = clamped.reduce((s, m) => s + m.score, 0);
  const complete = openCount === 0 || openGraded >= openCount;
  return {
    totalPoints,
    autoScore,
    manual: clamped,
    manualScore,
    finalScore: autoScore + manualScore,
    complete, // true when nothing awaits manual grading
    openCount,
  };
}
