import { describe, expect, it } from 'vitest';
import { filterGraph } from './filter';
import { edgeIds, type GraphData } from './types';

const data: GraphData = {
  nodes: [
    { id: 'a', title: 'Robotics Log', icon: null },
    { id: 'b', title: 'Servo Tuning', icon: null },
    { id: 'c', title: 'RAG Pipelines', icon: null },
    { id: 'd', title: 'Grocery Ideas', icon: null },
  ],
  edges: [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
    { source: 'b', target: 'd' },
  ],
};

describe('filterGraph', () => {
  it('returns the input untouched for an empty or whitespace query', () => {
    expect(filterGraph(data, '')).toBe(data);
    expect(filterGraph(data, '   ')).toBe(data);
  });

  it('keeps matching nodes plus their 1-hop neighborhood', () => {
    const r = filterGraph(data, 'servo');
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'd']);
    expect(r.edges.map(edgeIds).sort()).toEqual([
      ['a', 'b'],
      ['b', 'd'],
    ]);
  });

  it('drops edges that leave the kept set', () => {
    const r = filterGraph(data, 'rag');
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(r.edges.map(edgeIds)).toEqual([['a', 'c']]);
  });

  it('matches case-insensitively on title substrings', () => {
    const r = filterGraph(data, 'ROBOT');
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns no nodes when nothing matches', () => {
    const r = filterGraph(data, 'zzz');
    expect(r.nodes).toEqual([]);
    expect(r.edges).toEqual([]);
  });
});
