import { one, q } from '../db.js';
import { getProvider, chatCompletion } from '../llm/router.js';
import { mdToDoc } from '../lib/markdown.js';
import { syncLinks, relinkSpace } from '../pages/routes.js';
import { bus } from '../lib/events.js';

// Don't summarise beyond this — keeps cost bounded on huge PDFs
const MAX_SOURCE_CHARS = 16000;
const MIN_SOURCE_CHARS = 200;

/**
 * Capture → notes loop. When a source finishes ingesting, auto-write a notes
 * page for it (summary, key points, self-test questions) so captured material
 * flows into Pages without a manual step. Best-effort: skipped entirely when
 * no LLM provider is configured, and never blocks or fails ingestion.
 */
export async function maybeAutoNotes(sourceId: string): Promise<void> {
  try {
    const src = await one<any>(`SELECT * FROM sources WHERE id = $1`, [sourceId]);
    if (!src || src.status !== 'ready') return;
    if (src.meta?.notes_page_id) return; // one notes page per source
    if (src.meta?.research_run_id) return; // deep research writes its own paper — don't spam notes pages
    const nb = await one<any>(`SELECT * FROM notebooks WHERE id = $1`, [src.notebook_id]);
    if (!nb) return;
    const provider = await getProvider(nb.space_id);
    if (!provider) return;
    const text = (src.text_content ?? '').slice(0, MAX_SOURCE_CHARS);
    if (text.trim().length < MIN_SOURCE_CHARS) return;

    const res = await chatCompletion(provider, null, {
      messages: [
        { role: 'system', content: 'You turn raw study material into clean, structured markdown notes. Ground every claim in the source; never invent facts.' },
        {
          role: 'user',
          content: `Source: "${src.name}" (kind: ${src.kind})${nb.title ? ` — notebook: ${nb.title}` : ''}.\n\nWrite markdown notes with:\n- a 2-3 sentence summary at the top\n- "## Key points" as tight bullets\n- "## Details" — concise sections that follow the source's own structure\n- "## Questions to test yourself" — 3-5 questions\n\n---\n\n${text}`,
        },
      ],
      temperature: 0.2,
    });
    const md = (res.content ?? '').trim();
    if (!md) return;

    const title = `Notes — ${src.name}`.slice(0, 120);
    const page = await one<any>(
      `INSERT INTO pages (space_id, title, icon, markdown, content) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [nb.space_id, title, '📝', md, JSON.stringify(mdToDoc(md))]
    );
    await syncLinks(page!.id, nb.space_id, md);
    await relinkSpace(nb.space_id);
    await q(`UPDATE sources SET meta = $2 WHERE id = $1`, [sourceId, JSON.stringify({ ...(src.meta ?? {}), notes_page_id: page!.id })]);
    bus.publish({ spaceId: nb.space_id, type: 'page_created', payload: { pageId: page!.id } });
  } catch {
    /* auto-notes is best-effort — ingestion result stands on its own */
  }
}
