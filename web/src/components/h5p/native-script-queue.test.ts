import { describe, expect, it } from 'vitest';
import { createScriptQueue } from './native-script-queue';

const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
describe('native dependency queue', () => {
  it('caps the request burst and starts dependencies in original order', async () => {
    const started: string[] = [], finish: Array<() => void> = [];
    const queue = createScriptQueue(url => new Promise<void>(resolve => { started.push(url); finish.push(resolve); }), 2);
    const work = ['a', 'b', 'c', 'd'].map(url => queue.load(url));
    await tick(); expect(started).toEqual(['a', 'b']);
    finish[0](); await tick(); expect(started).toEqual(['a', 'b', 'c']);
    finish[1](); await tick(); expect(started).toEqual(['a', 'b', 'c', 'd']);
    finish[2](); finish[3](); await Promise.all(work);
  });
  it('coalesces in-flight dependencies but permits a deliberate later reload', async () => {
    let calls = 0; let finish!: () => void;
    const queue = createScriptQueue(() => new Promise<void>(resolve => { calls++; finish = resolve; }));
    const a = queue.load('same'), b = queue.load('same');
    expect(a).toBe(b); await tick(); expect(calls).toBe(1);
    finish(); await a; await tick();
    const c = queue.load('same'); await tick(); expect(calls).toBe(2); finish(); await c;
  });
  it('fails closed after a missing dependency instead of executing downstream code', async () => {
    const started: string[] = [];
    const queue = createScriptQueue(async url => { started.push(url); throw new Error('network failed'); }, 1);
    const results = await Promise.allSettled(['a', 'b', 'c'].map(url => queue.load(url)));
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(started).toEqual(['a']); await expect(queue.load('d')).rejects.toThrow('network failed');
  });
  it('disposal prevents queued work and rejects late completion', async () => {
    let finish!: () => void; const started: string[] = [];
    const queue = createScriptQueue(url => new Promise<void>(resolve => { started.push(url); finish = resolve; }), 1);
    const work = Promise.allSettled([queue.load('a'), queue.load('b')]);
    await tick(); queue.dispose(); finish();
    const results = await work;
    expect(results.every(result => result.status === 'rejected')).toBe(true); expect(started).toEqual(['a']);
  });
  it('rejects invalid concurrency rather than leaving the editor waiting forever', () => {
    expect(() => createScriptQueue(async () => {}, 0)).toThrow('concurrency');
  });
});
