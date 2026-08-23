import { one } from '../db.js';
import { config } from '../config.js';
import { hybridSearch, type SearchHit } from './search.js';

/**
 * Retrieval provider abstraction.
 * - `builtin`: SET's own engine (Postgres FTS + embeddings fused with RRF).
 * - `ragflow`: route retrieval through a RAGFlow instance (deep document
 *   understanding, layout-aware chunks) when RAGFLOW_URL is configured.
 * Selection is automatic: ragflow is used for notebooks that have a RAGFlow
 * dataset bound; everything else falls back to the builtin engine.
 */
export interface RetrievalProvider {
  name: string;
  retrieve(notebookId: string, query: string, limit: number): Promise<SearchHit[]>;
}

export const builtinProvider: RetrievalProvider = {
  name: 'builtin',
  async retrieve(notebookId, query, limit) {
    const { getProvider } = await import('../llm/router.js');
    const space = await one<{ space_id: string }>(`SELECT space_id FROM notebooks WHERE id = $1`, [notebookId]);
    const provider = space ? await getProvider(space.space_id) : null;
    return hybridSearch(notebookId, query, provider, limit);
  },
};

export const ragflowProvider: RetrievalProvider = {
  name: 'ragflow',
  async retrieve(notebookId, query, limit) {
    const nb = await one<any>(`SELECT ragflow_dataset_id FROM notebooks WHERE id = $1`, [notebookId]);
    if (!nb?.ragflow_dataset_id) {
      return builtinProvider.retrieve(notebookId, query, limit); // not bound — graceful fallback
    }
    const res = await fetch(`${(config.ragflowUrl ?? '').replace(/\/$/, '')}/api/v1/retrieval`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.ragflowApiKey}`,
      },
      body: JSON.stringify({
        question: query,
        dataset_ids: [nb.ragflow_dataset_id],
        top_k: limit,
        page_size: limit,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      // degrade rather than fail the chat
      return builtinProvider.retrieve(notebookId, query, limit);
    }
    const json: any = await res.json();
    const chunks: any[] = json?.data?.chunks ?? [];
    return chunks.map((c) => ({
      chunkId: String(c.chunk_id ?? c.id ?? Math.random()),
      sourceId: String(c.document_id ?? c.doc_id ?? 'ragflow'),
      sourceName: c.document_keyword ?? 'RAGFlow source',
      heading: c.highlight ? String(c.highlight).replace(/<[^>]+>/g, '').slice(0, 80) : '',
      content: c.content ?? c.content_with_weight ?? '',
      pageLabel: c.page ?? null,
      score: c.similarity ?? 0,
      vectorScore: c.vector_similarity ?? 0,
      keywordScore: c.term_similarity ?? 0,
    }));
  },
};

export async function retrieve(notebookId: string, query: string, limit = 8): Promise<SearchHit[]> {
  if (config.ragflowUrl && config.ragflowApiKey) {
    return ragflowProvider.retrieve(notebookId, query, limit);
  }
  return builtinProvider.retrieve(notebookId, query, limit);
}
