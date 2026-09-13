import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export interface SetEvent { spaceId: string; type: string; payload: any }
class Bus {
  private local = new EventEmitter();
  private pub: any = null;
  private sub: any = null;
  private instance = randomUUID();
  async init() {
    this.local.setMaxListeners(0);
    if (!config.redisUrl) return;
    try {
      const mod: any = await import('ioredis');
      const Redis = mod.default ?? mod;
      const options = { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 2000 };
      this.pub = new Redis(config.redisUrl, options);
      this.sub = new Redis(config.redisUrl, options);
      this.pub.on('error', () => {});
      this.sub.on('error', () => {});
      await Promise.all([this.pub.connect(), this.sub.connect()]);
      await this.sub.subscribe('set:events');
      this.sub.on('message', (_ch: string, raw: string) => {
        try {
          const ev = JSON.parse(raw) as SetEvent & { origin?: string };
          if (ev.origin !== this.instance) this.local.emit(ev.spaceId, ev);
        } catch { /* ignore malformed */ }
      });
      console.log('[bus] redis pub/sub connected');
    } catch {
      this.pub?.disconnect(); this.sub?.disconnect();
      this.pub = null; this.sub = null;
      console.warn('[bus] redis unavailable; readiness will fail while configured Redis is offline');
    }
  }
  async ready(): Promise<boolean> {
    if (!config.redisUrl) return true;
    if (this.pub?.status !== 'ready' || this.sub?.status !== 'ready') return false;
    return await this.pub.ping() === 'PONG';
  }
  close() { this.pub?.disconnect(); this.sub?.disconnect(); this.local.removeAllListeners(); }
  publish(ev: SetEvent) {
    this.local.emit(ev.spaceId, ev);
    if (this.pub) this.pub.publish('set:events', JSON.stringify({ ...ev, origin: this.instance })).catch(() => {});
  }
  subscribe(spaceId: string, fn: (ev: SetEvent) => void): () => void {
    this.local.on(spaceId, fn);
    return () => this.local.off(spaceId, fn);
  }
}
export const bus = new Bus();
