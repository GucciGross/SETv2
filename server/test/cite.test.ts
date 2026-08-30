import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourcesToBibTeX, texEscape } from '../src/rag/cite.ts';

test('cite: escapes LaTeX specials in titles', () => {
  assert.equal(texEscape('100% R&D _test'), '100\\% R\\&D \\_test');
  assert.equal(texEscape('braces {x} and ~tilde'), 'braces \\{x\\} and \\textasciitilde{}tilde');
});

test('cite: entries carry title, url, year and a deterministic key', () => {
  const bib = sourcesToBibTeX([
    { id: '1', name: 'Actuator Torque Limits', uri: 'https://example.com/paper', kind: 'web', created_at: '2026-01-15' },
  ]);
  assert.match(bib, /@misc\{set2026actuatortorquelimi,/);
  assert.match(bib, /title = \{Actuator Torque Limits\}/);
  assert.match(bib, /url = \{https:\/\/example\.com\/paper\}/);
  assert.match(bib, /year = \{2026\}/);
});

test('cite: duplicate titles get suffixed keys; missing uri omits the url field', () => {
  const bib = sourcesToBibTeX([
    { id: '1', name: 'Same Title', uri: null, kind: 'pdf', created_at: '2026-02-01' },
    { id: '2', name: 'Same Title', uri: null, kind: 'pdf', created_at: '2026-02-02' },
  ]);
  assert.match(bib, /set2026sametitle,/);
  assert.match(bib, /set2026sametitlea,/);
  assert.ok(!bib.includes('url ='));
});
