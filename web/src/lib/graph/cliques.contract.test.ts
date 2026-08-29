import { describe, expect, it } from 'vitest';
import { detectCliques as detectCliquesWeb } from './cliques';
// Intentionally reaches into the server tree: this is the sync contract
// between the two cliques engines. The copilot names neighborhoods with the
// server twin; the map draws them with the client engine. If one side drifts
// — word lists, hashing, bend of the algorithm — this test fails and the
// copilot would be naming neighborhoods the map doesn't have.
import { detectCliques as detectCliquesServer } from '../../../../server/src/agents/cliques';

const node = (id: string) => ({ id, title: id, icon: null });

const fixtures = [
  {
    name: 'two disconnected triangles plus strays',
    graph: {
      nodes: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(node),
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' },
        { source: 'd', target: 'e' },
        { source: 'e', target: 'f' },
        { source: 'f', target: 'd' },
        { source: 'g', target: 'h' },
      ],
    },
  },
  {
    name: 'two triangles bridged into one community',
    graph: {
      nodes: ['a', 'b', 'c', 'd', 'e', 'f'].map(node),
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' },
        { source: 'd', target: 'e' },
        { source: 'e', target: 'f' },
        { source: 'f', target: 'd' },
        { source: 'c', target: 'd' },
      ],
    },
  },
  {
    name: 'empty graph',
    graph: { nodes: [], edges: [] },
  },
];

describe('cliques engine sync contract (client ↔ server)', () => {
  for (const f of fixtures) {
    it(`client and server agree on: ${f.name}`, () => {
      const web = detectCliquesWeb(f.graph);
      const server = detectCliquesServer(f.graph);
      // cliques: ids, generated names, members, hubs and hues must match exactly
      expect(web.cliques).toEqual(server.cliques);
      expect([...web.strays].sort()).toEqual([...server.strays].sort());
      expect([...web.byNode.entries()].map(([id, c]) => [id, c.id]).sort())
        .toEqual([...server.byNode.entries()].map(([id, c]) => [id, c.id]).sort());
    });
  }

  it('the pinned names the copilot says are the names the map shows', () => {
    const r = detectCliquesWeb(fixtures[0].graph);
    expect(r.cliques.map((c) => c.name).sort()).toEqual(['Copper Archive', 'Fractal Harbor']);
  });
});
