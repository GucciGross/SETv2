import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttemptItems, gradeAttempt, normalizeQuizItems, stripAnswers } from '../src/study/quiz.ts';

const mcq = (q: string, answerIndex = 0, points = 1) => ({ question: q, options: ['a', 'b', 'c'], answerIndex, explanation: 'why', points });
const open = (q: string, points = 2) => ({ type: 'open' as const, question: q, answerReference: 'model', points });

test('quiz: legacy items without type normalize to mcq', () => {
  const items = normalizeQuizItems([mcq('Q1', 1), open('Q2')]);
  assert.equal(items[0].type, 'mcq');
  assert.equal(items[0].points, 1);
  assert.equal(items[1].type, 'open');
  assert.equal(items[1].points, 2);
  assert.equal(items[1].answerReference, 'model');
});

test('quiz: invalid answerIndex is clamped, non-questions dropped', () => {
  const items = normalizeQuizItems([{ ...mcq('Q'), answerIndex: 99 }, { options: ['x'] } as any]);
  assert.equal(items.length, 1);
  assert.ok(items[0].answerIndex! >= 0 && items[0].answerIndex! < 3);
});

test('quiz: shuffleOptions remaps answerIndex to the right option', () => {
  const items = normalizeQuizItems([mcq('Capital of France?', 1)]);
  for (let i = 0; i < 20; i++) {
    const built = buildAttemptItems(items, { shuffleOptions: true });
    const it = built[0];
    assert.equal(it.options![it.answerIndex!], 'b'); // the correct answer follows the shuffle
    assert.equal(new Set(it.options).size, 3);
  }
});

test('quiz: drawCount serves a subset', () => {
  const items = normalizeQuizItems([mcq('Q1'), mcq('Q2'), mcq('Q3'), mcq('Q4'), mcq('Q5')]);
  const built = buildAttemptItems(items, { drawCount: 2, shuffle: true });
  assert.equal(built.length, 2);
  const questions = new Set(items.map((i) => i.question));
  for (const it of built) assert.ok(questions.has(it.question));
});

test('quiz: stripAnswers hides answers, references and explanations', () => {
  const items = normalizeQuizItems([mcq('Q1', 2), open('Q2')]);
  const stripped = stripAnswers(items);
  assert.equal((stripped[0] as any).answerIndex, undefined);
  assert.equal((stripped[0] as any).explanation, undefined);
  assert.equal((stripped[0] as any).options.length, 3);
  assert.equal((stripped[1] as any).answerReference, undefined);
  assert.equal(stripped[1].points, 2); // points are fine to show
});

test('quiz: mcq-only attempts grade completely with no manual work', () => {
  const items = normalizeQuizItems([mcq('Q1', 1), mcq('Q2', 0)]);
  const graded = gradeAttempt(items, { '0': 1, '1': 2 });
  assert.equal(graded.totalPoints, 2);
  assert.equal(graded.autoScore, 1);
  assert.equal(graded.finalScore, 1);
  assert.equal(graded.complete, true);
});

test('quiz: open answers wait for manual grading, scores clamp to points', () => {
  const items = normalizeQuizItems([mcq('Q1', 0), open('Q2', 2), open('Q3', 2)]);
  const half = gradeAttempt(items, { '0': 0, '1': 'essay', '2': 'essay' }, [{ index: 1, score: 99 }]);
  assert.equal(half.complete, false); // Q3 still ungraded
  assert.equal(half.finalScore, 1 + 2); // clamped 99 -> 2

  const done = gradeAttempt(items, { '0': 0, '1': 'essay', '2': 'essay' }, [
    { index: 1, score: 1.5, feedback: 'partial' },
    { index: 2, score: 2 },
  ]);
  assert.equal(done.complete, true);
  assert.equal(done.finalScore, 1 + 1.5 + 2);
});
