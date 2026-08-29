import { describe, expect, it } from 'vitest';
import { cliqueName, detectCliques, type Clique } from './cliques';
import type { GraphData } from './types';

const node = (id: string) => ({ id, title: id, icon: null });

/** Two triangles, one thin pair, one isolated node — no bridge between triangles. */
const twoTriangles: GraphData = {
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
};

/** Same graph with the node/edge arrays in a different order. */
const shuffled: GraphData = {
  nodes: ['i', 'c', 'a', 'g', 'e', 'b', 'h', 'd', 'f'].map(node),
  edges: [
    { source: 'f', target: 'd' },
    { source: 'c', target: 'a' },
    { source: 'h', target: 'g' },
    { source: 'b', target: 'c' },
    { source: 'e', target: 'f' },
    { source: 'a', target: 'b' },
    { source: 'd', target: 'e' },
  ],
};

const membersOf = (cliques: Clique[]) => cliques.map((c) => [...c.memberIds].sort()).sort();

describe('detectCliques', () => {
  it('finds the triangles and buckets pairs and isolates as strays', () => {
    const r = detectCliques(twoTriangles);
    expect(membersOf(r.cliques)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    expect([...r.strays].sort()).toEqual(['g', 'h', 'i']);
    expect(r.byNode.get('a')?.memberIds.sort()).toEqual(['a', 'b', 'c']);
    expect(r.byNode.has('g')).toBe(false);
  });

  it('merges two triangles bridged by a single edge into one community, hub at the bridge', () => {
    const r = detectCliques({
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
    });
    expect(membersOf(r.cliques)).toEqual([['a', 'b', 'c', 'd', 'e', 'f']]);
    expect(r.cliques[0].hubId).toBe('c'); // c and d have degree 3; c sorts first
    expect([...r.strays].sort()).toEqual([]);
  });

  it('picks the hub by degree in a star graph', () => {
    const r = detectCliques({
      nodes: ['s', 'l1', 'l2', 'l3', 'l4'].map(node),
      edges: [
        { source: 's', target: 'l1' },
        { source: 's', target: 'l2' },
        { source: 's', target: 'l3' },
        { source: 's', target: 'l4' },
      ],
    });
    expect(r.cliques).toHaveLength(1);
    expect(r.cliques[0].hubId).toBe('s');
  });

  it('breaks hub ties toward the smallest id', () => {
    const r = detectCliques({
      nodes: ['a', 'b', 'c'].map(node),
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' },
      ],
    });
    expect(r.cliques[0].hubId).toBe('a');
  });

  it('is deterministic: shuffled input order yields identical results', () => {
    const a = detectCliques(twoTriangles);
    const b = detectCliques(shuffled);
    expect(a.cliques).toEqual(b.cliques);
    expect([...a.strays].sort()).toEqual([...b.strays].sort());
    expect([...a.byNode.entries()].sort()).toEqual([...b.byNode.entries()].sort());
  });

  it('ignores self-loops and edges to unknown nodes', () => {
    const r = detectCliques({
      nodes: ['a', 'b', 'c'].map(node),
      edges: [
        { source: 'a', target: 'a' },
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' },
        { source: 'a', target: 'ghost' },
      ],
    });
    expect(membersOf(r.cliques)).toEqual([['a', 'b', 'c']]);
  });

  it('returns nothing for an empty graph', () => {
    const r = detectCliques({ nodes: [], edges: [] });
    expect(r.cliques).toEqual([]);
    expect(r.byNode.size).toBe(0);
    expect(r.strays.size).toBe(0);
  });
});

describe('clique identity', () => {
  it('generates the pinned word-pair name from a clique id', () => {
    expect(cliqueName('a,b,c')).toBe('Copper Garden');
    expect(cliqueName('d,e,f')).toBe('Glass Atelier');
  });

  it('gives each clique a hue in range and a stable id', () => {
    const r = detectCliques(twoTriangles);
    for (const c of r.cliques) {
      expect(c.hue).toBeGreaterThanOrEqual(0);
      expect(c.hue).toBeLessThan(360);
      expect(c.id).toMatch(/^\d+$/);
    }
    expect(r.cliques.map((c) => c.name).sort()).toEqual(['Copper Archive', 'Fractal Harbor']);
  });

  it('spreads hues so two cliques in one space never collide', () => {
    const r = detectCliques(twoTriangles);
    expect(r.cliques).toHaveLength(2);
    expect(r.cliques[0].hue).not.toBe(r.cliques[1].hue);
    // golden-angle spacing: consecutive cliques sit ~137.5° apart
    expect(Math.abs(r.cliques[0].hue - r.cliques[1].hue)).toBeGreaterThanOrEqual(100);
  });
});
