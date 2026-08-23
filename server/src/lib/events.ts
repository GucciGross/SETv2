import { EventEmitter } from 'node:events';
import { config } from '../config.js';

/**
 * Space-scoped pub/sub used for real-time collaboration and presence.
 * Uses Redis when REDIS_URL is set (multi-instance), otherwise in-process emitter.
 */
export interface SetEvent {
  spaceId: string;
  type: string; // page_updated | page_created | page_deleted | db_updated | presence | ...
  payload: any;
}

class Bus {
  private local = new EventEmitter();
  private pub: any = null;
  private sub: any = null;

  async init() {
    this.local.setMaxListeners(0);
    if (!config.redisUrl) return;
    try {
      const mod: any = await import('ioredis');
      const Redis = mod.default ?? mod;
      this.pub = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
      this.sub = new Redis(config.redisUrl, { lazyConnect: true });
      await Promise.all([this.pub.connect(), this.sub.connect()]);
      await this.sub.subscribe('set:events');
      this.sub.on('message', (_ch: string, raw: string) => {
        try {
          const ev = JSON.parse(raw) as SetEvent;
          this.local.emit(ev.spaceId, ev);
        } catch {
          /* ignore malformed */
        }
      });
      console.log('[bus] redis pub/sub connected');
    } catch (e) {
      console.warn('[bus] redis unavailable, falling back to in-process bus');
      this.pub = null;
      this.sub = null;
    }
  }

  publish(ev: SetEvent) {
    this.local.emit(ev.spaceId, ev);
    if (this.pub) this.pub.publish('set:events', JSON.stringify(ev)).catch(() => {});
  }

  subscribe(spaceId: string, fn: (ev: SetEvent) => void): () => void {
    this.local.on(spaceId, fn);
    return () => this.local.off(spaceId, fn);
  }
}

export const bus = new Bus();
