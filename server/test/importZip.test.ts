import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImportedMarkdown } from '../src/team/importZip.ts';

test('import: obsidian front-matter is stripped, tags survive as hashtags', () => {
  const out = normalizeImportedMarkdown(
    `---\ntitle: Note\ntags: [robotics, kinematics]\n---\n\n# My note\n\nBody.`,
    new Map()
  );
  assert.ok(!out.includes('---'));
  assert.ok(out.includes('# My note'));
  assert.ok(out.includes('#robotics #kinematics'));
});

test('import: ![[image.png]] embeds resolve to served urls, note embeds become links', () => {
  const images = new Map([['photo.png', '/api/files/abc']]);
  const out = normalizeImportedMarkdown(`![[]] text ![[photo.png|400]] and ![[Other Note]]`, images);
  assert.match(out, /!\[photo\.png\]\(\/api\/files\/abc\)/);
  assert.match(out, /\[\[Other Note\]\]/);
});

test('import: wiki links lose .md extensions and #heading anchors', () => {
  const out = normalizeImportedMarkdown(`[[Note.md]] [[Other.md#Section]] [[Third.md#Sec|alias]] [[Plain]]`, new Map());
  assert.ok(out.includes('[[Note]]'));
  assert.ok(out.includes('[[Other]]'));
  assert.ok(out.includes('[[Third|alias]]'));
  assert.ok(out.includes('[[Plain]]'));
});

test('import: plain markdown and notion links pass through untouched', () => {
  const src = `# Title\n\n[External](https://example.com) and [[Already Fine]] text.`;
  assert.equal(normalizeImportedMarkdown(src, new Map()), src);
});
