import { one, q } from '../db.js';
import { getProvider, chatCompletion, type Provider, type ChatMessage } from '../llm/router.js';
import { hybridSearch } from '../rag/search.js';

export interface Flashcard { front: string; back: string }
export interface QuizItem { question: string; options: string[]; answerIndex: number; explanation: string }
export interface AudioSegment { speaker: 'Host' | 'Expert'; text: string }

/** Gather representative source context for a notebook (top chunks across broad query terms). */
async function notebookContext(notebookId: string, provider: Provider | null, topic?: string): Promise<string> {
  const chunks = await q<{ heading: string | null; content: string; source_id: string }>(
    `SELECT heading, content, source_id FROM chunks WHERE notebook_id = $1 ORDER BY random() LIMIT 40`,
    [notebookId]
  );
  const sources = await q<{ id: string; name: string }>(`SELECT id, name FROM sources WHERE notebook_id = $1`, [notebookId]);
  const nameOf = new Map(sources.map((s) => [s.id, s.name]));
  let ctx = chunks.map((c) => `[${nameOf.get(c.source_id) ?? ''}${c.heading ? ' — ' + c.heading : ''}]\n${c.content}`).join('\n\n');
  if (topic) {
    const hits = await hybridSearch(notebookId, topic, provider, 10);
    ctx = hits.map((h) => `[${h.sourceName}${h.heading ? ' — ' + h.heading : ''}]\n${h.content}`).join('\n\n') + '\n\n' + ctx.slice(0, 6000);
  }
  return ctx.slice(0, 24000);
}

/** Page-scoped context: the page's own markdown is the grounding source. */
async function pageContext(pageId: string, topic?: string): Promise<string> {
  const page = await one<{ title: string; markdown: string | null }>(
    `SELECT title, markdown FROM pages WHERE id = $1 AND deleted_at IS NULL`,
    [pageId]
  );
  if (!page) throw new Error('Page not found');
  const md = page.markdown ?? '';
  const scoped = topic
    ? md
        .split(/\n(?=#{1,3}\s)/)
        .filter((section) => section.toLowerCase().includes(topic.toLowerCase()))
        .join('\n\n')
    : md;
  return `# ${page.title}\n\n${(scoped.trim() || md).slice(0, 24000)}`;
}

async function llmJson(p: Provider, messages: ChatMessage[], fallback: any): Promise<any> {
  const res = await chatCompletion(p, null, {
    messages: [...messages, { role: 'system', content: 'Reply with ONLY valid JSON, no markdown fences.' }],
    temperature: 0.3,
  });
  const text = (res.content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { /* fall through */ }
    }
    throw new Error(`Model did not return valid JSON: ${text.slice(0, 200)}`);
  }
}

export async function generateDeck(
  spaceId: string,
  notebookId: string | null,
  kind: 'flashcards' | 'quiz' | 'studyguide' | 'audio',
  topic: string | undefined,
  count = 12,
  openCount = 0,
  pageId?: string | null
): Promise<any> {
  const provider = await getProvider(spaceId);
  if (!provider) throw new Error('No LLM provider configured — add one in Settings  AI Providers');
  if (!notebookId && !pageId) throw new Error('A notebook or a page is required');
  const ctx = pageId ? await pageContext(pageId, topic) : await notebookContext(notebookId!, provider, topic);

  if (kind === 'flashcards') {
    const out = await llmJson(
      provider,
      [
        { role: 'system', content: 'You generate high-quality study flashcards strictly grounded in the provided sources.' },
        { role: 'user', content: `Create ${count} flashcards from the sources${topic ? ` focused on: ${topic}` : ''}.\nReturn JSON: {"cards":[{"front":"...","back":"..."}]}\n\nSources:\n${ctx}` },
      ],
      { cards: [] }
    );
    return { cards: (out.cards ?? out).slice(0, 40) as Flashcard[] };
  }
  if (kind === 'quiz') {
    const openSpec = openCount > 0
      ? ` Also include exactly ${openCount} open short-answer questions as objects {"type":"open","question":"...","answerReference":"model answer in 1-3 sentences","points":2}.`
      : '';
    const out = await llmJson(
      provider,
      [
        { role: 'system', content: 'You generate multiple-choice quizzes strictly grounded in the provided sources.' },
        { role: 'user', content: `Create ${count} multiple-choice questions${topic ? ` about: ${topic}` : ''}.${openSpec}\nReturn JSON: {"items":[{"type":"mcq","question":"...","options":["A","B","C","D"],"answerIndex":0,"explanation":"..."}]}\n\nSources:\n${ctx}` },
      ],
      { items: [] }
    );
    return { items: (out.items ?? out).slice(0, 40) as QuizItem[] };
  }
  if (kind === 'studyguide') {
    const res = await chatCompletion(provider, null, {
      messages: [
        { role: 'system', content: 'You write clear, structured study guides in markdown, grounded ONLY in the provided sources.' },
        { role: 'user', content: `Write a study guide${topic ? ` on: ${topic}` : ''} with: overview, key concepts (### headings), glossary table, and 5 review questions.\n\nSources:\n${ctx}` },
      ],
      temperature: 0.3,
    });
    return { markdown: res.content ?? '' };
  }
  // audio overview: two-speaker script (rendered with browser speech synthesis)
  const out = await llmJson(
    provider,
    [
      { role: 'system', content: 'You write engaging two-host audio overview scripts grounded in the sources.' },
      { role: 'user', content: `Write a ~2 minute two-host audio overview${topic ? ` of: ${topic}` : ''}.\nReturn JSON: {"segments":[{"speaker":"Host","text":"..."},{"speaker":"Expert","text":"..."}]}\n\nSources:\n${ctx}` },
    ],
    { segments: [] }
  );
  return { segments: (out.segments ?? out).slice(0, 40) as AudioSegment[] };
}

/** SM-2 inspired spaced repetition update. grade: 0 again, 1 hard, 2 good, 3 easy */
export function sm2(grade: number, ease: number, intervalDays: number, reps: number) {
  let e = ease;
  if (grade === 0) e = Math.max(1.3, e - 0.2);
  else if (grade === 1) e = Math.max(1.3, e - 0.15);
  else if (grade === 3) e = Math.min(3.0, e + 0.15);
  let interval: number;
  if (grade === 0) interval = 0;
  else if (reps === 0) interval = 1;
  else if (reps === 1) interval = 3;
  else interval = Math.round(intervalDays * e * (grade === 1 ? 0.7 : grade === 3 ? 1.3 : 1.0));
  const reps2 = grade === 0 ? 0 : reps + 1;
  const due = new Date(Date.now() + Math.max(interval, grade === 0 ? 10 / 1440 : 1) * 86400_000);
  return { ease: e, intervalDays: interval, reps: reps2, dueAt: due };
}

export async function createDeckRecord(
  spaceId: string,
  notebookId: string | null,
  kind: string,
  title: string,
  items: any,
  pageId?: string | null
) {
  const deck = await one<any>(
    `INSERT INTO decks (space_id, notebook_id, kind, title, items, page_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [spaceId, notebookId, kind, title, JSON.stringify(items), pageId ?? null]
  );
  return deck;
}
