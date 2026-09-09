import {
  SkillLabError, object, uuid, text, parseInput, parsePlan, validateGrounding, parseGeneratedPlan,
  sha256, evidenceRefs, draftHash, assertFresh, assertReviewed, skillFiles,
  type SkillInput, type SkillPlan, type Evidence, type SkillDraft,
} from './lab-core.js';

export interface LabContext { spaceId: string; userId: string; role: string }
export interface LabDependencies {
  query: <T = any>(sql: string, values?: any[]) => Promise<T[]>;
  generate: (input: SkillInput, evidence: Evidence[], ctx: LabContext) => Promise<string | null>;
}
const editor = (ctx: LabContext) => {
  if (!['owner', 'editor'].includes(ctx.role)) throw new SkillLabError('Editor access required', 403);
};
const hashArgument = (value: unknown) => {
  const hash = text(value, 'Expected draft hash', 64, 64);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new SkillLabError('Invalid draft hash');
  return hash;
};

/** Domain service: no dependency on a transport or an agent framework. */
export function createSkillLabService(deps: LabDependencies) {
  const q = deps.query;
  async function get(ctx: LabContext, id: unknown): Promise<SkillDraft> {
    const [draft] = await q<SkillDraft>('SELECT * FROM skill_drafts WHERE id = $1 AND space_id = $2', [uuid(id), ctx.spaceId]);
    if (!draft) throw new SkillLabError('Skill draft not found', 404);
    return draft;
  }
  async function loadEvidence(ctx: LabContext, input: SkillInput): Promise<Evidence[]> {
    // Source selection is explicit. Never fetch a remote URL or use a source outside this notebook/space.
    const rows = await q<{ id: string; name: string; kind: string; uri: string | null; status: string; size: number }>(
      `SELECT s.id, s.name, s.kind, s.uri, s.status,
        COALESCE(SUM(length(c.content) + length(COALESCE(c.heading, '')) + length(COALESCE(c.page_label, '')) + 16), 0)::integer AS size
       FROM sources s JOIN notebooks n ON n.id = s.notebook_id LEFT JOIN chunks c ON c.source_id = s.id
       WHERE n.space_id = $1 AND s.notebook_id = $2 AND s.id = ANY($3::uuid[])
       GROUP BY s.id`, [ctx.spaceId, input.notebookId, input.sourceIds]);
    if (rows.length !== input.sourceIds.length) throw new SkillLabError('A selected source is unavailable in this notebook', 404);
    if (rows.some(s => s.status !== 'ready' || s.size < 1)) throw new SkillLabError('Wait for selected sources to finish indexing, or repair failed sources in the notebook.', 409);
    if (rows.reduce((sum, s) => sum + Number(s.size), 0) > 60000) throw new SkillLabError('Selected evidence exceeds the 60,000-character budget. Select fewer sources or create focused excerpts. Nothing was silently omitted.', 413);
    const chunks = await q<{ source_id: string; id: string; heading: string | null; page_label: string | null; content: string }>(
      `SELECT c.source_id, c.id, c.heading, c.page_label, c.content FROM chunks c
       JOIN sources s ON s.id = c.source_id JOIN notebooks n ON n.id = s.notebook_id
       WHERE n.space_id = $1 AND s.notebook_id = $2 AND s.status = 'ready' AND s.id = ANY($3::uuid[])
       ORDER BY c.source_id, c.idx, c.id`, [ctx.spaceId, input.notebookId, input.sourceIds]);
    // Recheck after the query, including concurrent source/chunk changes. Corrected chunks are canonical.
    const result = input.sourceIds.map(id => {
      const row = rows.find(r => r.id === id)!;
      const selected = chunks.filter(c => c.source_id === id);
      if (!selected.length) throw new SkillLabError('Source indexing changed. Retry compilation.', 409);
      const content = selected.map(c => [c.page_label, c.heading, c.content].filter(Boolean).join('\n')).join('\n\n');
      return { id, name: row.name, kind: row.kind, text: content,
        digest: sha256(JSON.stringify({ name: row.name, kind: row.kind, uri: row.uri, chunks: selected })) };
    });
    if (result.reduce((n, e) => n + e.text.length, 0) > 60000) throw new SkillLabError('Evidence changed beyond the 60,000-character budget. Retry with fewer sources.', 413);
    return result;
  }
  async function insert(ctx: LabContext, input: SkillInput, plan: SkillPlan, evidence: Evidence[], parentId: string | null = null) {
    const refs = evidenceRefs(evidence);
    const [draft] = await q<SkillDraft>(
      `INSERT INTO skill_drafts (space_id, created_by, parent_id, input, plan, evidence, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [ctx.spaceId, ctx.userId, parentId, JSON.stringify(input), JSON.stringify(plan), JSON.stringify(refs), draftHash(input, plan, refs)]);
    return draft;
  }
  return {
    get,
    async list(ctx: LabContext) {
      return q(`SELECT id, input->>'name' AS name, status, content_hash, parent_id, created_at, reviewed_at
        FROM skill_drafts WHERE space_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`, [ctx.spaceId]);
    },
    async compile(ctx: LabContext, raw: unknown) {
      editor(ctx);
      const input = parseInput(raw), evidence = await loadEvidence(ctx, input);
      const output = await deps.generate(input, evidence, ctx);
      const plan = parseGeneratedPlan(output, evidence);
      // A slow model must not approve a procedure based on sources edited while it was generating.
      assertFresh(evidenceRefs(evidence), await loadEvidence(ctx, input));
      return insert(ctx, input, plan, evidence);
    },
    async revise(ctx: LabContext, id: unknown, raw: unknown) {
      editor(ctx);
      const body = object(raw, ['expectedHash', 'plan']);
      const draft = await get(ctx, id);
      if (hashArgument(body.expectedHash) !== draft.content_hash) throw new SkillLabError('Draft changed. Reload before editing.', 409);
      const plan = parsePlan(body.plan), evidence = await loadEvidence(ctx, parseInput(draft.input));
      assertFresh(draft.evidence, evidence);
      validateGrounding(plan, evidence);
      // Immutable revisions preserve the approved version and always create an unapproved new draft.
      return insert(ctx, draft.input, plan, evidence, draft.id);
    },
    async review(ctx: LabContext, id: unknown, raw: unknown) {
      editor(ctx);
      const body = object(raw, ['expectedHash', 'acknowledgeUnverified']);
      if (body.acknowledgeUnverified !== true) throw new SkillLabError('Acknowledge that app execution has not been tested');
      const draft = await get(ctx, id), expected = hashArgument(body.expectedHash);
      if (expected !== draft.content_hash || expected !== draftHash(draft.input, draft.plan, draft.evidence))
        throw new SkillLabError('Draft changed. Reload and review this exact revision.', 409);
      const evidence = await loadEvidence(ctx, parseInput(draft.input));
      assertFresh(draft.evidence, evidence);
      validateGrounding(parsePlan(draft.plan), evidence);
      if (draft.status === 'approved') { assertReviewed(draft); return draft; }
      const [approved] = await q<SkillDraft>(`UPDATE skill_drafts SET status = 'approved', reviewed_by = $3, reviewed_at = now()
        WHERE id = $1 AND space_id = $2 AND content_hash = $4 AND status = 'draft' RETURNING *`, [draft.id, ctx.spaceId, ctx.userId, expected]);
      if (!approved) throw new SkillLabError('Draft state changed or was revoked. Reload before continuing.', 409);
      return approved;
    },
    async revoke(ctx: LabContext, id: unknown) {
      editor(ctx);
      const draft = await get(ctx, id);
      const [revoked] = await q<SkillDraft>(`UPDATE skill_drafts SET status = 'revoked' WHERE id = $1 AND space_id = $2 RETURNING *`, [draft.id, ctx.spaceId]);
      return revoked;
    },
    async remove(ctx: LabContext, id: unknown) {
      editor(ctx);
      const draft = await get(ctx, id);
      await q('DELETE FROM skill_drafts WHERE id = $1 AND space_id = $2', [draft.id, ctx.spaceId]);
    },
    async export(ctx: LabContext, id: unknown) {
      const draft = await get(ctx, id);
      assertReviewed(draft);
      const evidence = await loadEvidence(ctx, parseInput(draft.input));
      assertFresh(draft.evidence, evidence);
      validateGrounding(parsePlan(draft.plan), evidence);
      return { draftId: draft.id, contentHash: draft.content_hash, operationalValidation: 'not-run', files: skillFiles(draft) };
    },
  };
}
