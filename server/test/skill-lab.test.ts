import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, parsePlan, parseGeneratedPlan, validateGrounding, draftHash, evidenceRefs, assertFresh, assertReviewed, skillFiles, SkillLabError, sha256, type SkillDraft, type SkillInput, type SkillPlan, type Evidence } from '../src/skills/lab-core.js';
import { createSkillLabService, type LabDependencies } from '../src/skills/lab-service.js';

const spaceId = '11111111-1111-4111-8111-111111111111';
const notebookId = '22222222-2222-4222-8222-222222222222';
const sourceId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const quote = 'Save the Blender project before exporting the selected mesh.';
const input: SkillInput = { notebookId, sourceIds: [sourceId], name: 'robotic-part', goal: 'Create a robotic part from the demonstrated Blender workflow.', mcpRequirements: [{ server: 'blender', purpose: 'Inspect and export the selected mesh' }] };
const plan: SkillPlan = { description: 'Use when creating and exporting the demonstrated robotic part.', prerequisites: ['Use a copy of the project.'], steps: [{ title: 'Save the project', action: 'Save the demonstrated Blender project in the approved workspace.', expected: 'An editable project file.', verify: 'Reopen the saved file.', evidence: [{ sourceId, quote }] }], outputs: ['Editable project'], checks: ['Reopening the project preserves the selected mesh.'], pitfalls: ['Do not overwrite another project.'], gaps: ['Unreal import was not demonstrated.'] };
const evidence: Evidence[] = [{ id: sourceId, name: 'Recorded lesson transcript', kind: 'transcript', text: quote, digest: sha256(quote) }];
const ctx = { spaceId, userId: otherId, role: 'editor' };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const approved = (): SkillDraft => ({ id: otherId, space_id: spaceId, input: clone(input), plan: clone(plan), evidence: evidenceRefs(evidence), content_hash: draftHash(input, plan, evidenceRefs(evidence)), status: 'approved', reviewed_by: otherId, reviewed_at: '2026-09-09T00:00:00Z', created_at: '2026-09-09T00:00:00Z' });

for (const name of ['../escape', 'UPPER', 'bad/name', '-edge', 'two--dashes', 'trailing-', 'a'.repeat(61), 'x\n---']) {
  test(`rejects unsafe skill name ${JSON.stringify(name)}`, () => assert.throws(() => parseInput({ ...input, name }), SkillLabError));
}
test('valid input round trips', () => assert.deepEqual(parseInput(input), input));
test('rejects duplicate sources', () => assert.throws(() => parseInput({ ...input, sourceIds: [sourceId, sourceId] })));
test('rejects empty source selection', () => assert.throws(() => parseInput({ ...input, sourceIds: [] })));
test('rejects malformed IDs', () => assert.throws(() => parseInput({ ...input, notebookId: 'not-an-id' })));
test('rejects unknown permission fields', () => assert.throws(() => parseInput({ ...input, approve: true })));
test('MCP requirements are aliases, not URLs or commands', () => {
  for (const server of ['https://host/mcp', 'npx some-server', '$(shell)', '../local'])
    assert.throws(() => parseInput({ ...input, mcpRequirements: [{ server, purpose: 'execute' }] }));
});
test('refuses empty procedural output', () => assert.throws(() => parsePlan({ ...plan, steps: [] })));
test('requires concrete outputs and acceptance checks', () => {
  assert.throws(() => parsePlan({ ...plan, outputs: [] })); assert.throws(() => parsePlan({ ...plan, checks: [] }));
});
test('model cannot add executable bundle files', () => assert.throws(() => parsePlan({ ...plan, scripts: ['evil.py'] })));
test('unknown source citation rejected', () => {
  const bad = clone(plan); bad.steps[0].evidence[0].sourceId = otherId;
  assert.throws(() => validateGrounding(bad, evidence));
});
test('invented quotation rejected', () => {
  const bad = clone(plan); bad.steps[0].evidence[0].quote = 'The import to Unreal was tested and successful.';
  assert.throws(() => validateGrounding(bad, evidence));
});
test('valid exact quotations accepted', () => assert.doesNotThrow(() => validateGrounding(plan, evidence)));
test('malformed model output returns a useful provider error', () => {
  assert.throws(() => parseGeneratedPlan('not JSON', evidence), (e: unknown) => e instanceof SkillLabError && e.statusCode === 502);
});
test('empty and oversized model output rejected', () => {
  assert.throws(() => parseGeneratedPlan(null, evidence)); assert.throws(() => parseGeneratedPlan('x'.repeat(90001), evidence));
});
test('optional JSON code fence accepted', () => assert.deepEqual(parseGeneratedPlan('```json\n' + JSON.stringify(plan) + '\n```', evidence), plan));
test('draft hash binds plan changes', () => {
  const changed = clone(plan); changed.steps[0].action = 'Save under a different approved filename.';
  assert.notEqual(draftHash(input, plan, evidenceRefs(evidence)), draftHash(input, changed, evidenceRefs(evidence)));
});
test('draft hash binds source and tool requirements', () => {
  assert.notEqual(draftHash(input, plan, evidenceRefs(evidence)), draftHash({ ...input, mcpRequirements: [] }, plan, evidenceRefs(evidence)));
  assert.notEqual(draftHash(input, plan, evidenceRefs(evidence)), draftHash(input, plan, [{ ...evidenceRefs(evidence)[0], digest: 'changed' }]));
});
test('changed or missing evidence blocks export', () => {
  assert.throws(() => assertFresh(evidenceRefs(evidence), []));
  assert.throws(() => assertFresh(evidenceRefs(evidence), [{ ...evidence[0], digest: 'changed' }]));
});
test('draft and revoked states cannot export', () => {
  for (const status of ['draft', 'revoked'] as const) assert.throws(() => skillFiles({ ...approved(), status }));
});
test('unattributed approval and content tampering cannot export', () => {
  assert.throws(() => assertReviewed({ ...approved(), reviewed_by: null }));
  const tampered = approved(); tampered.plan.description = 'Modified after review'; assert.throws(() => skillFiles(tampered));
});
test('portable bundle has fixed safe files and honest execution state', () => {
  const files = skillFiles(approved());
  assert.equal(Object.keys(files).length, 7);
  assert.ok(Object.keys(files).every(path => path.startsWith('robotic-part/') && !path.includes('..') && !path.startsWith('/')));
  assert.match(files['robotic-part/SKILL.md'], /^---\nname: "robotic-part"\ndescription:/);
  assert.match(files['robotic-part/agents/openai.yaml'], /allow_implicit_invocation: false/);
  assert.equal(JSON.parse(files['robotic-part/manifest.json']).operationalValidation, 'not-run');
  assert.match(files['robotic-part/references/verification.md'], /Status: NOT RUN/);
});

function harness() {
  const drafts = new Map<string, SkillDraft>();
  const source = { content: quote, status: 'ready', exists: true };
  const calls: { sql: string; values: any[] }[] = [];
  let next = 10, generations = 0;
  const query: LabDependencies['query'] = async <T>(sql: string, values: any[] = []): Promise<T[]> => {
    calls.push({ sql, values });
    let result: any[] = [];
    if (sql.includes('COALESCE(SUM(length')) {
      if (source.exists && values[0] === spaceId && values[1] === notebookId && values[2].includes(sourceId))
        result = [{ id: sourceId, name: 'Transcript', kind: 'transcript', uri: null, status: source.status, size: source.content.length + 16 }];
    } else if (sql.includes('SELECT c.source_id')) {
      if (source.exists && source.status === 'ready' && values[0] === spaceId && values[1] === notebookId)
        result = [{ source_id: sourceId, id: otherId, heading: null, page_label: '00:12', content: source.content }];
    } else if (sql.startsWith('INSERT INTO skill_drafts')) {
      const id = `55555555-5555-4555-8555-${String(next++).padStart(12, '0')}`;
      const row = { id, space_id: values[0], parent_id: values[2], input: JSON.parse(values[3]), plan: JSON.parse(values[4]), evidence: JSON.parse(values[5]), content_hash: values[6], status: 'draft', reviewed_by: null, reviewed_at: null, created_at: new Date().toISOString() } as SkillDraft;
      drafts.set(id, row); result = [clone(row)];
    } else if (sql.startsWith('SELECT * FROM skill_drafts')) {
      const row = drafts.get(values[0]); if (row?.space_id === values[1]) result = [clone(row)];
    } else if (sql.startsWith('UPDATE skill_drafts')) {
      const row = drafts.get(values[0]);
      if (row && row.space_id === values[1]) {
        if (sql.includes("status = 'approved'")) {
          if (row.status === 'draft' && row.content_hash === values[3]) {
            row.status = 'approved'; row.reviewed_by = values[2]; row.reviewed_at = new Date().toISOString(); result = [clone(row)];
          }
        } else { row.status = 'revoked'; result = [clone(row)]; }
      }
    } else if (sql.startsWith('DELETE FROM skill_drafts')) {
      if (drafts.get(values[0])?.space_id === values[1]) drafts.delete(values[0]);
    } else if (sql.includes("input->>'name'")) result = [...drafts.values()].filter(d => d.space_id === values[0]);
    else throw new Error(`Unexpected query: ${sql}`);
    return result as T[];
  };
  const service = createSkillLabService({ query, generate: async () => { generations++; return JSON.stringify(plan); } });
  return { service, source, calls, drafts, get generations() { return generations; } };
}
const review = (h: ReturnType<typeof harness>, d: SkillDraft) => h.service.review(ctx, d.id, { expectedHash: d.content_hash, acknowledgeUnverified: true });
test('service: compile → review → portable export', async () => {
  const h = harness(), draft = await h.service.compile(ctx, input);
  assert.equal(draft.status, 'draft'); assert.equal(draft.reviewed_by, null);
  await assert.rejects(h.service.export(ctx, draft.id));
  const approvedDraft = await review(h, draft); assert.equal(approvedDraft.status, 'approved');
  const bundle = await h.service.export(ctx, draft.id); assert.ok(bundle.files['robotic-part/SKILL.md']);
});
test('service: viewer compilation denied before model or database work', async () => {
  const h = harness(); await assert.rejects(h.service.compile({ ...ctx, role: 'viewer' }, input));
  assert.equal(h.generations, 0); assert.equal(h.calls.length, 0);
});
test('service: forged/unknown roles cannot write', async () => {
  const h = harness(); await assert.rejects(h.service.compile({ ...ctx, role: 'administrator' }, input));
  assert.equal(h.generations, 0);
});
test('service: cross-space and cross-notebook sources rejected', async () => {
  const h = harness();
  await assert.rejects(h.service.compile({ ...ctx, spaceId: otherId }, input));
  await assert.rejects(h.service.compile(ctx, { ...input, notebookId: otherId }));
  assert.equal(h.generations, 0);
});
test('service: private draft cannot be read or exported from another space', async () => {
  const h = harness(), d = await h.service.compile(ctx, input); await review(h, d);
  await assert.rejects(h.service.get({ ...ctx, spaceId: otherId }, d.id));
  await assert.rejects(h.service.export({ ...ctx, spaceId: otherId }, d.id));
});
test('service: source pending/error states block compilation', async () => {
  const h = harness();
  for (const status of ['pending', 'chunking', 'embedding', 'error']) { h.source.status = status; await assert.rejects(h.service.compile(ctx, input)); }
  assert.equal(h.generations, 0);
});
test('service: large source refused before the provider is called', async () => {
  const h = harness(); h.source.content = 'x'.repeat(60001);
  await assert.rejects(h.service.compile(ctx, input), (e: unknown) => e instanceof SkillLabError && e.statusCode === 413);
  assert.equal(h.generations, 0);
});
test('service: exact hash and untested acknowledgement required for review', async () => {
  const h = harness(), d = await h.service.compile(ctx, input);
  await assert.rejects(h.service.review(ctx, d.id, { expectedHash: d.content_hash, acknowledgeUnverified: false }));
  await assert.rejects(h.service.review(ctx, d.id, { expectedHash: 'f'.repeat(64), acknowledgeUnverified: true }));
  assert.equal(h.drafts.get(d.id)?.status, 'draft');
});
test('service: revisions are new unapproved records', async () => {
  const h = harness(), d = await h.service.compile(ctx, input); await review(h, d);
  const changed = clone(plan); changed.steps[0].action = 'Save a new copy in the approved directory.';
  const revised = await h.service.revise(ctx, d.id, { expectedHash: d.content_hash, plan: changed });
  assert.notEqual(d.id, revised.id); assert.notEqual(d.content_hash, revised.content_hash);
  assert.equal(revised.status, 'draft'); assert.equal(h.drafts.get(d.id)?.status, 'approved');
});
test('service: stale source blocks review and approved export', async () => {
  const h = harness(), d = await h.service.compile(ctx, input); await review(h, d);
  h.source.content += '\nCorrection: use a different export.';
  await assert.rejects(h.service.export(ctx, d.id)); await assert.rejects(review(h, d));
});
test('service: source deletion blocks export even after approval', async () => {
  const h = harness(), d = await h.service.compile(ctx, input); await review(h, d); h.source.exists = false;
  await assert.rejects(h.service.export(ctx, d.id));
});
test('service: revocation blocks reapproval and future exports', async () => {
  const h = harness(), d = await h.service.compile(ctx, input); await review(h, d);
  await h.service.revoke(ctx, d.id); await assert.rejects(h.service.export(ctx, d.id)); await assert.rejects(review(h, d));
});
test('service: viewers cannot approve, revise, revoke or delete', async () => {
  const h = harness(), d = await h.service.compile(ctx, input), viewer = { ...ctx, role: 'viewer' };
  await assert.rejects(h.service.review(viewer, d.id, { expectedHash: d.content_hash, acknowledgeUnverified: true }));
  await assert.rejects(h.service.revise(viewer, d.id, { expectedHash: d.content_hash, plan }));
  await assert.rejects(h.service.revoke(viewer, d.id)); await assert.rejects(h.service.remove(viewer, d.id));
});
test('service: deleting a draft leaves notebook source unchanged', async () => {
  const h = harness(), d = await h.service.compile(ctx, input); await h.service.remove(ctx, d.id);
  await assert.rejects(h.service.get(ctx, d.id)); assert.equal(h.source.content, quote);
});
