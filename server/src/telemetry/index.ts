import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/**
 * SET anonymous usage telemetry.
 *
 * Collects aggregated feature counters so we can understand how self-hosted
 * instances are used (enterprise licensing depends on it). Design constraints:
 *
 *  - NO user content, NO page/notebook data, NO emails, NO IPs — only feature
 *    counters (e.g. agent_run_copilot: 12) and coarse instance metadata
 *    (version, uptime, flag states).
 *  - One random instance id per deployment, persisted under DATA_DIR.
 *  - Batched: counters accumulate in memory and flush as a single payload on
 *    boot and every TELEMETRY_FLUSH_MINUTES (default 6h). A failed POST is
 *    retried on the next flush — telemetry must never break or slow the app.
 *  - Opt out with TELEMETRY_ENABLED=0 (documented in .env.example); the
 *    receiver URL is configurable for self-hosted fleets (TELEMETRY_URL).
 */

interface TelemetryPayload {
  product: 'set';
  instanceId: string;
  version: string;
  sentAt: string;
  uptimeSeconds: number;
  events: Record<string, number>;
  meta: {
    seedDemo: boolean;
    mcpEnabled: boolean;
    voiceTranscription: boolean;
    channelsLinked: number;
    providersConfigured: number;
    hasRedis: boolean;
    hasRagflow: boolean;
  };
}

const VERSION = '2.1.0';

class Telemetry {
  private events = new Map<string, number>();
  private bootedAt = Date.now();
  private instanceId = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  init(dataDir: string) {
    if (!config.telemetry.enabled) {
      console.log('[telemetry] disabled (TELEMETRY_ENABLED=0)');
      return;
    }
    try {
      const file = path.join(dataDir, 'telemetry-instance.json');
      if (fs.existsSync(file)) {
        this.instanceId = JSON.parse(fs.readFileSync(file, 'utf8')).instanceId ?? '';
      }
      if (!this.instanceId) {
        this.instanceId = crypto.randomUUID();
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ instanceId: this.instanceId, createdAt: new Date().toISOString() }));
      }
    } catch {
      this.instanceId = crypto.randomUUID(); // ephemeral id is fine too
    }

    this.track('server_start');
    void this.flush(); // boot report (also proves the pipeline works early)
    this.timer = setInterval(() => void this.flush(), config.telemetry.flushMinutes * 60_000);
    this.timer.unref();
    console.log(`[telemetry] anonymous usage stats enabled — opt out with TELEMETRY_ENABLED=0 (instance ${this.instanceId.slice(0, 8)}…)`);
  }

  track(name: string, n = 1) {
    if (!config.telemetry.enabled) return;
    this.events.set(name, (this.events.get(name) ?? 0) + n);
  }

  async flush() {
    if (!config.telemetry.enabled || !this.instanceId) return;
    const events = Object.fromEntries(this.events);
    if (!Object.keys(events).length) return;

    // coarse instance shape, gathered fresh each flush (cheap queries, fail-safe)
    let meta: TelemetryPayload['meta'] = {
      seedDemo: config.seedDemo,
      mcpEnabled: config.mcpEnabled,
      voiceTranscription: !!config.transcribe.baseUrl,
      channelsLinked: -1,
      providersConfigured: -1,
      hasRedis: !!config.redisUrl,
      hasRagflow: !!config.ragflowUrl,
    };
    try {
      const { one } = await import('../db.js');
      const ch = await one<{ n: number }>('SELECT count(*)::int AS n FROM channel_links');
      const pr = await one<{ n: number }>('SELECT count(*)::int AS n FROM providers');
      meta = { ...meta, channelsLinked: ch?.n ?? 0, providersConfigured: pr?.n ?? 0 };
    } catch {
      /* keep defaults */
    }

    const payload: TelemetryPayload = {
      product: 'set',
      instanceId: this.instanceId,
      version: VERSION,
      sentAt: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - this.bootedAt) / 1000),
      events,
      meta,
    };

    try {
      const res = await fetch(config.telemetry.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) this.events.clear();
      // non-2xx: keep counters, retry next flush
    } catch {
      /* receiver unreachable — keep counters, retry next flush */
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const telemetry = new Telemetry();
