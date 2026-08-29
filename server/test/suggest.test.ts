import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySuggestion, findPlainMention, findSuggestions } from '../src/pages/suggest.js';

test('findPlainMention finds plain text, case-insensitively', () => {
  assert.equal(findPlainMention('notes about sensor fusion here', 'Sensor Fusion'), 12);
  assert.equal(findPlainMention('nothing relevant', 'Sensor Fusion'), -1);
});

test('findPlainMention skips mentions already inside [[wiki links]]', () => {
  assert.equal(findPlainMention('see [[Sensor Fusion]] for details', 'Sensor Fusion'), -1);
  // but a plain one after a linked one is found
  assert.equal(findPlainMention('see [[Sensor Fusion]] and also sensor fusion again', 'Sensor Fusion'), 31);
});

test('findPlainMention: whole-word short titles match, fragments do not', () => {
  assert.equal(findPlainMention('we ship rag here', 'RAG'), 8); // whole word is a real mention
  assert.equal(findPlainMention('braggadocio', 'rag'), -1); // word fragment rejected
});

test('applySuggestion wraps the first plain mention, keeping author casing', () => {
  const next = applySuggestion('notes about sensor fusion here', 'Sensor Fusion');
  assert.equal(next, 'notes about [[sensor fusion]] here');
  // after wrapping there is no plain mention left
  assert.equal(applySuggestion(next ?? '', 'Sensor Fusion'), null);
});

test('findSuggestions pairs mentions and skips existing links', () => {
  const pages = [
    { id: 'a', title: 'Robotics', markdown: 'we use sensor fusion heavily' },
    { id: 'b', title: 'Sensor Fusion', markdown: 'feeds the robotics work' },
    { id: 'c', title: 'RAG Pipelines', markdown: 'robotics could cite the rag pipelines notebook' },
  ];
  const s = findSuggestions(pages, new Set());
  assert.deepEqual(
    s.map((x) => `${x.sourceTitle} → ${x.targetTitle}`).sort(),
    ['RAG Pipelines → Robotics', 'Robotics → Sensor Fusion', 'Sensor Fusion → Robotics']
  );
  // an existing link suppresses its suggestion (the reverse pair stays valid)
  const withLink = findSuggestions(pages, new Set(['a→b']));
  assert.ok(!withLink.some((x) => x.sourceId === 'a' && x.targetId === 'b'));
});

test('findSuggestions respects the cap and is deterministic', () => {
  const pages = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    title: `Topic ${i}`,
    markdown: `mentions topic 0, topic 1 and topic 2`,
  }));
  const a = findSuggestions(pages, new Set(), 5);
  const b = findSuggestions(pages, new Set(), 5);
  assert.equal(a.length, 5);
  assert.deepEqual(a, b);
});
