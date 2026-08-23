import { one, q } from '../db.js';
import { embedTexts, hashEmbed, type Provider } from '../llm/router.js';
import { chunkText } from './chunker.js';

export interface ChunkRow {
  id: string;
  source_id: string;
  notebook_id: string;
  idx: number;
  heading: string | null;
  content: string;
  page_label: string | null;
  embedding: number[] | null;
  meta: any;
}

export interface SearchHit {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  heading: string;
  content: string;
  pageLabel: string | null;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Reciprocal-rank fusion of keyword + vector result lists. */
export function rrf(...lists: string[][]): Map<string, number> {
  const K = 60;
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (K + rank + 1));
    });
  }
  return scores;
}

export async function ingestSource(sourceId: string, provider: Provider | null): Promise<void> {
  const source = await one<any>(`SELECT * FROM sources WHERE id = $1`, [sourceId]);
  if (!source) return;
  const notebook = await one<any>(`SELECT * FROM notebooks WHERE id = $1`, [source.notebook_id]);
  try {
    await q(`UPDATE sources SET status = 'chunking' WHERE id = $1`, [sourceId]);
    await q(`DELETE FROM chunks WHERE source_id = $1`, [sourceId]);
    const raw = chunkText(source.text_content);
    if (!raw.length) throw new Error('No extractable text in source');
    await q(`UPDATE sources SET status = 'embedding' WHERE id = $1`, [sourceId]);
    const texts = raw.map((c) => `${c.heading ? c.heading + '\n' : ''}${c.content}`);
    let vectors: number[][];
    let dim = notebook.embedding_dim;
    if (provider?.embed_model) {
      const res = await embedTexts(provider, texts);
      vectors = res.vectors;
      dim = res.dim;
      await q(`UPDATE notebooks SET embedding_dim = $2 WHERE id = $1`, [notebook.id, dim]);
    } else {
      vectors = texts.map((t) => hashEmbed(t));
    }
    for (const c of raw) {
      await q(
        `INSERT INTO chunks (source_id, notebook_id, idx, heading, content, page_label, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sourceId, source.notebook_id, c.idx, c.heading, c.content, c.pageLabel, JSON.stringify(vectors[c.idx])]
      );
    }
    await q(`UPDATE sources SET status = 'ready', error = NULL WHERE id = $1`, [sourceId]);
  } catch (e: any) {
    await q(`UPDATE sources SET status = 'error', error = $2 WHERE id = $1`, [sourceId, e.message ?? String(e)]);
  }
}

export async function hybridSearch(
  notebookId: string,
  query: string,
  provider: Provider | null,
  limit = 8
): Promise<SearchHit[]> {
  const rows = await q<ChunkRow>(
    `SELECT c.id, c.source_id, c.notebook_id, c.idx, c.heading, c.content, c.page_label, c.embedding
     FROM chunks c JOIN sources s ON s.id = c.source_id
     WHERE c.notebook_id = $1`,
    [notebookId]
  );
  if (!rows.length) return [];

  // keyword ranking (Postgres FTS)
  const kwRows = await q<{ id: string; rank: number }>(
    `SELECT c.id, ts_rank(c.tsv, websearch_to_tsquery('english', $2)) AS rank
     FROM chunks c WHERE c.notebook_id = $1 AND c.tsv @@ websearch_to_tsquery('english', $2)
     ORDER BY rank DESC LIMIT 40`,
    [notebookId, query]
  );
  const kwIds = kwRows.map((r) => r.id);

  // vector ranking
  const qv = provider?.embed_model
    ? (await embedTexts(provider, [query])).vectors[0]
    : hashEmbed(query);
  const vecScored = rows
    .filter((r) => r.embedding)
    .map((r) => ({ id: r.id, score: cosine(qv, r.embedding as number[]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
  const vecIds = vecScored.map((r) => r.id);

  const fused = rrf(kwIds, vecIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kwRank = new Map(kwIds.map((id, i) => [id, kwRows[i]?.rank ?? 0]));
  const vecRank = new Map(vecScored.map((r) => [r.id, r.score]));

  const sources = await q<{ id: string; name: string }>(
    `SELECT id, name FROM sources WHERE notebook_id = $1`,
    [notebookId]
  );
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));

  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => {
      const c = byId.get(id)!;
      return {
        chunkId: id,
        sourceId: c.source_id,
        sourceName: sourceName.get(c.source_id) ?? 'Unknown',
        heading: c.heading ?? '',
        content: c.content,
        pageLabel: c.page_label,
        score,
        vectorScore: vecRank.get(id) ?? 0,
        keywordScore: kwRank.get(id) ?? 0,
      };
    });
}

/** Build a grounded prompt with numbered citations the model must use. */
export function buildGroundedPrompt(query: string, hits: SearchHit[]) {
  const context = hits
    .map((h, i) => `[${i + 1}] ${h.sourceName}${h.pageLabel ? ` (${h.pageLabel})` : ''}${h.heading ? ` — ${h.heading}` : ''}\n${h.content}`)
    .join('\n\n---\n\n');
  const system = `You are SET Research, a source-grounded research assistant.
Rules:
- Answer ONLY from the provided sources, citing them inline like [1], [2].
- If the sources do not contain the answer, say so plainly.
- Be precise, structured and concise. Use markdown headings and lists where helpful.`;
  const user = `Sources:\n${context}\n\nQuestion: ${query}`;
  return { system, user };
}
