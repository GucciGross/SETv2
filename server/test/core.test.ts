import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, extractDates } from '../src/rag/chunker.ts';
import { mdToDoc, docToMd, extractWikiTargets } from '../src/lib/markdown.ts';
import { rrf } from '../src/rag/search.ts';
import { sm2 } from '../src/study/generate.ts';
import { parseUrdf } from '../src/models3d/routes.ts';
import { hashEmbed } from '../src/llm/router.ts';

test('chunker: respects headings and size budget', () => {
  const md = '# Intro\n\n' + 'word '.repeat(100) + '\n\n# Next\n\nshort section';
  const chunks = chunkText(md);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].heading, 'Intro');
  assert.ok(chunks.every((c) => c.content.length <= 1700));
  assert.equal(chunks[chunks.length - 1].heading, 'Next');
});

test('chunker: extracts page labels and dates', () => {
  const chunks = chunkText('[[page:3]]\n# Heading\n\nOn 2024-09-01 we tested the actuator.');
  assert.equal(chunks[0].pageLabel, 'p.3');
  const dates = extractDates('Shipped on August 12, 2025 and again 2025-09-01');
  assert.equal(dates.length, 2);
});

test('markdown: md -> doc -> md round trip keeps headings and wiki links', () => {
  const md = '# Title\n\nHello [[Other Page]] world.\n\n- one\n- two\n';
  const doc = mdToDoc(md);
  assert.equal(doc.content![0].type, 'heading');
  const wikiNode = JSON.stringify(doc).includes('wikiLink');
  assert.ok(wikiNode, 'wikiLink mark present');
  const back = docToMd(doc);
  assert.ok(back.includes('# Title'));
  assert.ok(back.includes('[[Other Page]]'));
  assert.deepEqual(extractWikiTargets(back), ['Other Page']);
});

test('markdown: tables round-trip as table nodes (not code blocks)', () => {
  const md = '| A | B |\n| :--- | ---: |\n| 1 | 2 |\n| three | four |';
  const doc = mdToDoc(md);
  const table = doc.content!.find((n) => n.type === 'table');
  assert.ok(table, 'table node parsed');
  assert.equal(table!.content!.length, 3); // header + 2 rows
  assert.equal(table!.content![0].content![0].type, 'tableHeader');
  assert.equal(table!.content![0].content![0].attrs.alignment, 'left');
  assert.equal(table!.content![0].content![1].attrs.alignment, 'right');
  assert.equal(table!.content![1].content![0].content![0].content![0].text, '1');
  const back = docToMd(doc);
  assert.ok(back.includes('| A | B |'));
  assert.ok(back.includes('| :--- | ---: |'));
  assert.ok(back.includes('| 1 | 2 |'));
  assert.ok(!back.includes('```markdown'), 'no code-block fallback');
});

test('markdown: images, strike, highlight round-trip', () => {
  const md = 'Inline ![logo](/api/files/abc.png) image.\n\n**bold** ~~gone~~ ==key== and `code`.';
  const doc = mdToDoc(md);
  const flat = JSON.stringify(doc);
  assert.ok(flat.includes('"image"'), 'image node parsed');
  assert.ok(flat.includes('"strike"'), 'strike mark parsed');
  assert.ok(flat.includes('"highlight"'), 'highlight mark parsed');
  const back = docToMd(doc);
  assert.ok(back.includes('![logo](/api/files/abc.png)'));
  assert.ok(back.includes('~~gone~~'));
  assert.ok(back.includes('==key=='));
});

test('markdown: youtube video embeds parse and serialize', () => {
  const doc = mdToDoc('Before.\n\n@[video](https://www.youtube.com/watch?v=abc123)\n\nAfter.');
  const yt = doc.content!.find((n) => n.type === 'youtube');
  assert.ok(yt, 'youtube node parsed');
  assert.equal(yt!.attrs!.src, 'https://www.youtube.com/watch?v=abc123');
  const back = docToMd(doc);
  assert.ok(back.includes('@[video](https://www.youtube.com/watch?v=abc123)'));
});

test('markdown: block references parse and serialize', () => {
  const blockId = '9b41c2d0-1111-2222-3333-444455556666';
  const doc = mdToDoc(`Before.\n\n((${blockId}))\n\nAfter.`);
  const ref = doc.content!.find((n) => n.type === 'blockRef');
  assert.ok(ref, 'blockRef node parsed');
  assert.equal(ref!.attrs!.blockId, blockId);
  const back = docToMd(doc);
  assert.ok(back.includes(`((${blockId}))`));
});

test('rrf: fuses ranked lists', () => {
  const scores = rrf(['a', 'b', 'c'], ['b', 'a']);
  assert.ok((scores.get('b') ?? 0) > (scores.get('c') ?? 0));
  assert.ok((scores.get('a') ?? 0) > (scores.get('c') ?? 0));
});

test('sm2: again resets, easy grows interval', () => {
  const fail = sm2(0, 2.5, 10, 5);
  assert.equal(fail.reps, 0);
  assert.equal(fail.intervalDays, 0);
  const easy = sm2(3, 2.5, 10, 5);
  assert.ok(easy.intervalDays > 10);
  assert.ok(easy.ease > 2.5);
});

test('urdf parser: links, joints, materials', () => {
  const xml = `<robot name="t"><link name="base"><visual><geometry><box size="1 2 3"/></geometry><material name="m"><color rgba="1 0 0 1"/></material></visual></link>
  <link name="arm"/><joint name="j1" type="revolute"><parent link="base"/><child link="arm"/><axis xyz="0 1 0"/><limit lower="-1" upper="1" effort="2" velocity="3"/></joint></robot>`;
  const { links, joints } = parseUrdf(xml);
  assert.equal(links.length, 2);
  assert.equal(links[0].visual?.geometry.type, 'box');
  assert.equal(links[0].visual?.material?.color, '1 0 0 1');
  assert.equal(joints.length, 1);
  assert.equal(joints[0].parent, 'base');
  assert.equal(joints[0].limit?.upper, '1');
});

test('hash embeddings: normalized, deterministic, semantically ordered', () => {
  const a1 = hashEmbed('robot arm actuator torque');
  const a2 = hashEmbed('robot arm actuator torque');
  const b = hashEmbed('chocolate cake recipe dessert');
  assert.deepEqual(a1, a2);
  const norm = Math.sqrt(a1.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 0.01);
  const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
  // shared words 'robot arm' should make a1 closer to a variant than to an unrelated text
  const c = hashEmbed('robot arm encoder feedback');
  assert.ok(cos(a1, c) > cos(a1, b));
});
