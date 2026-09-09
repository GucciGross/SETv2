import test from 'node:test';
import assert from 'node:assert/strict';
import { draftHash, assertReviewed, type SkillInput, type SkillPlan, type SkillDraft } from '../src/skills/lab-core.js';

// JSONB may reorder object keys. A content hash must survive a persistence round trip.
const id = '11111111-1111-4111-8111-111111111111';
const input: SkillInput = { notebookId: id, sourceIds: [id], name: 'saved-workflow', goal: 'Save and inspect the demonstrated project.', mcpRequirements: [{ server: 'blender', purpose: 'Save project' }] };
const plan: SkillPlan = { description: 'Save the demonstrated project.', prerequisites: [], steps: [{ title: 'Save', action: 'Save a copy.', expected: 'Project file', verify: 'Reopen the copy.', evidence: [{ sourceId: id, quote: 'Save a copy of the project.' }] }], outputs: ['Project file'], checks: ['The copy reopens.'], pitfalls: [], gaps: [] };
const evidence = [{ id, name: 'Transcript', kind: 'txt', digest: 'a'.repeat(64) }];
const reverseKeys = (value: unknown): any => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reverseKeys(v)]));
  return value;
};
test('content hash survives reordered JSONB keys at every depth', () => {
  assert.equal(draftHash(input, plan, evidence), draftHash(reverseKeys(input), reverseKeys(plan), reverseKeys(evidence)));
});
test('persisted approval remains exportable after key reordering', () => {
  const draft: SkillDraft = { id, space_id: id, input, plan, evidence, status: 'approved', content_hash: draftHash(input, plan, evidence), reviewed_by: id, reviewed_at: '2026-09-09T00:00:00Z', created_at: '2026-09-09T00:00:00Z' };
  assert.doesNotThrow(() => assertReviewed(reverseKeys(draft)));
});
