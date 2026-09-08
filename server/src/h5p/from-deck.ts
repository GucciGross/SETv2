import type { IContentMetadata, ILibraryName } from '@lumieducation/h5p-server';
import { randomUUID } from 'node:crypto';
import { one, q } from '../db.js';
import type { JwtUser } from '../lib/tokens.js';
import type { Role } from '../lib/http.js';
import { normalizeQuizItems } from '../study/quiz.js';
import { escapeHtml, saveSchema, StudioError } from './domain.js';
import { createActivity, saveActivity, spaceRole } from './service.js';
import { exportContent, forkContent, removeContent, runtime } from './runtime.js';

type Deck = { id?: string; space_id: string; notebook_id?: string | null; kind: string; title: string; items: any };
const paragraph = (text: unknown) => `<p>${escapeHtml(String(text ?? '')).replace(/\n/g, '<br>')}</p>`;

/** Convert a COPY to practice content; never change the original assessment or answer policy. */
export function deckParameters(deck: Deck, libraries: ILibraryName[]) {
  const library = (name: string) => {
    const installed = libraries.filter((l) => l.machineName === name && l.majorVersion === 1).sort((a, b) => b.minorVersion - a.minorVersion)[0];
    if (!installed) throw new StudioError(422, `Install ${name} (version 1.x) from the H5P Studio content-type catalog first.`);
    return `${installed.machineName} ${installed.majorVersion}.${installed.minorVersion}`;
  };
  let main: string, params: any;
  if (deck.kind === 'flashcards') {
    main = library('H5P.Dialogcards');
    const cards = deck.items?.cards;
    if (!Array.isArray(cards) || !cards.length) throw new StudioError(422, 'This deck has no flashcards to convert.');
    params = { title: deck.title, mode: 'normal', description: '', dialogs: cards.map((c: any) => ({ text: paragraph(c.front ?? c.q), answer: paragraph(c.back ?? c.a), tips: {} })), behaviour: { enableRetry: true, disableBackwardsNavigation: false, scaleTextNotCard: false, randomCards: false }, answer: 'Turn', next: 'Next', prev: 'Previous', retry: 'Retry', progressText: 'Card @card of @total' };
  } else if (deck.kind === 'quiz') {
    main = library('H5P.QuestionSet');
    const questionLibrary = library('H5P.MultiChoice');
    const questions = normalizeQuizItems(Array.isArray(deck.items) ? deck.items : deck.items?.items ?? []);
    if (!questions.length) throw new StudioError(422, 'This quiz has no questions to convert.');
    if (questions.some((question) => question.type === 'open' || !question.options?.length)) throw new StudioError(422, 'Open-response questions require manual grading. Keep this assessed quiz, or author a separate practice activity in H5P Studio.');
    params = {
      introPage: { showIntroPage: false, title: deck.title, introduction: paragraph('Practice copy. Your assessed quiz and grades remain unchanged.'), startButtonText: 'Start' },
      progressType: 'dots', passPercentage: 50, randomQuestions: false, disableBackwardsNavigation: false,
      questions: questions.map((question) => ({ library: questionLibrary, subContentId: randomUUID(), metadata: { title: question.question.slice(0, 255), contentType: 'Multiple Choice', license: 'U' }, params: {
        question: paragraph(question.question), answers: question.options!.map((answer, index) => ({ text: paragraph(answer), correct: index === question.answerIndex, tipsAndFeedback: { tip: '', chosenFeedback: '', notChosenFeedback: '' } })),
        overallFeedback: [{ from: 0, to: 100, feedback: paragraph(question.explanation ?? '') }],
        behaviour: { enableRetry: true, enableSolutionsButton: true, enableCheckButton: true, type: 'auto', singlePoint: true, randomAnswers: false, showSolutionsRequiresInput: true, confirmCheckDialog: false, confirmRetryDialog: false, autoCheck: false, passPercentage: 100 },
        UI: { checkAnswerButton: 'Check', submitAnswerButton: 'Submit', showSolutionButton: 'Show solution', tryAgainButton: 'Retry', tipsLabel: 'Tip', scoreBarLabel: 'You got :num out of :total points', tipAvailable: 'Tip available', feedbackAvailable: 'Feedback available', readFeedback: 'Read feedback', wrongAnswer: 'Wrong answer', correctAnswer: 'Correct answer', shouldCheck: 'Should have been checked', shouldNotCheck: 'Should not have been checked', noInput: 'Choose an answer before checking.' },
      } })),
      texts: { prevButton: 'Previous', nextButton: 'Next', finishButton: 'Finish', submitButton: 'Submit', textualProgress: 'Question @current of @total', jumpToQuestion: 'Question %d', questionLabel: 'Question', readSpeakerProgress: 'Question @current of @total', unansweredText: 'Unanswered', answeredText: 'Answered', currentQuestionText: 'Current question' },
      endGame: { showResultPage: true, showSolutionButton: true, showRetryButton: true, noResultMessage: 'Finished', message: 'Practice complete', scoreBarLabel: 'You got @score of @total points', overallFeedback: [{ from: 0, to: 100, feedback: '' }], solutionButtonText: 'Show solution', retryButtonText: 'Retry', finishButtonText: 'Finish', submitButtonText: 'Submit', showAnimations: false },
    };
  } else if (deck.kind === 'studyguide' || deck.kind === 'audio') {
    main = library('H5P.AdvancedText');
    // Source markdown/transcripts remain editable text, not unsanitized HTML or fake audio.
    const text = deck.kind === 'studyguide' ? deck.items?.markdown : (deck.items?.segments ?? []).map((segment: any) => `${segment.speaker}: ${segment.text}`).join('\n\n');
    if (!text) throw new StudioError(422, 'This deck has no text to convert.');
    params = { text: paragraph(text) };
  } else throw new StudioError(422, 'Create a native H5P activity for this content type. The original deck has not been changed.');
  return saveSchema.parse({ library: main, params: { metadata: { title: deck.title, license: 'U', defaultLanguage: 'en' }, params } });
}
export async function createFromDeck(id: string, user: JwtUser) {
  const deck = await one<Deck>('SELECT * FROM decks WHERE id=$1', [id]);
  if (!deck) throw new StudioError(404, 'Deck not found.');
  const role = await spaceRole(deck.space_id, user.id, 'editor');
  const rt = await runtime({ spaceId: deck.space_id, user, role, mode: 'edit', readable: [] });
  const input = deckParameters(deck, await rt.libraryStorage.getInstalledLibraryNames());
  const activity = await createActivity(deck.space_id, user, deck.title, deck.notebook_id ? { kind: 'notebook', id: deck.notebook_id } : undefined, id);
  try { return await saveActivity(activity.id, user, 0, input); }
  catch (error) { await q('DELETE FROM h5p_activities WHERE id=$1 AND draft_revision=0', [activity.id]); throw error; }
}
/** Legacy export remains a read operation: allocate, export with genuine libraries, then remove. */
export async function exportDeck(deck: Deck, user: JwtUser, role: Role): Promise<Buffer> {
  if (role === 'viewer') throw new StudioError(403, 'H5P exports contain reusable answers. Ask a workspace editor to export or publish a practice activity.');
  const content = await forkContent(deck.space_id);
  const scope = { spaceId: deck.space_id, user, role, mode: 'edit' as const, readable: [content], writable: [content], allocate: content };
  try {
    const rt = await runtime(scope);
    const input = deckParameters(deck, await rt.libraryStorage.getInstalledLibraryNames());
    await rt.editor.saveOrUpdateContent(undefined!, input.params.params, input.params.metadata as unknown as IContentMetadata, input.library, rt.user);
    return await exportContent(scope, content);
  } finally { await removeContent(deck.space_id, content); }
}
