/** Bound native H5P's dependency request burst while preserving insertion order.
 * Only in-flight requests are deduplicated: a later content-type selection may
 * deliberately reload a different version into H5P's shared browser namespace.
 */
export function createScriptQueue(start: (url: string) => Promise<void>, concurrency = 4) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid script concurrency.');
  type Job = { url: string; resolve: () => void; reject: (error: Error) => void };
  const queued: Job[] = [];
  const pending = new Map<string, Promise<void>>();
  let active = 0;
  let failure: Error | undefined;
  function stop(reason: Error) {
    failure ??= reason;
    for (const job of queued.splice(0)) { pending.delete(job.url); job.reject(failure); }
  }
  function pump() {
    while (!failure && active < concurrency && queued.length) {
      const job = queued.shift()!;
      active++;
      // Calls are started in FIFO order, including when the executor throws.
      Promise.resolve().then(() => {
        if (failure) throw failure;
        return start(job.url);
      }).then(() => { if (failure) job.reject(failure); else job.resolve(); }, reason => {
        const error = reason instanceof Error ? reason : new Error('H5P script loading failed.');
        stop(error); job.reject(error);
      }).finally(() => { active--; pending.delete(job.url); pump(); });
    }
  }
  return {
    load(url: string): Promise<void> {
      if (failure) return Promise.reject(failure);
      const existing = pending.get(url);
      if (existing) return existing;
      const result = new Promise<void>((resolve, reject) => queued.push({ url, resolve, reject }));
      pending.set(url, result); pump(); return result;
    },
    dispose() { stop(new DOMException('Editor closed', 'AbortError')); },
  };
}
