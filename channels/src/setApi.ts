import jwt from 'jsonwebtoken';
import { channelsConfig } from './config.js';

/**
 * HTTP client for the SET server. All calls carry a short-lived service JWT
 * minted from the shared JWT_SECRET (identity "set-service" — see
 * server/src/lib/tokens.ts SERVICE_IDENTITY). The channel agent run endpoint
 * lives in server/src/channels/routes.ts.
 */

const SERVICE_IDENTITY = { id: 'set-service', email: 'service@set.local', name: 'SET Service', kind: 'service' };

let cachedToken: { token: string; exp: number } | null = null;

export function serviceToken(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - now > 60) return cachedToken.token;
  const token = jwt.sign(SERVICE_IDENTITY, channelsConfig.jwtSecret, { expiresIn: '1h' });
  cachedToken = { token, exp: now + 3600 };
  return token;
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${serviceToken()}` };
}

export interface SpaceResolution {
  linked: boolean;
  spaceId: string | null;
  actingUserId: string | null;
}

/** Resolve a platform workspace id → SET space through the channel_links table. */
export async function resolveSpace(platformId: string): Promise<SpaceResolution> {
  const res = await fetch(
    `${channelsConfig.setApiUrl}/api/channels/resolve?platform=slack&platformId=${encodeURIComponent(platformId)}`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error(`resolve failed ${res.status}: ${await res.text().catch(() => '')}`);
  return (await res.json()) as SpaceResolution;
}

export async function heartbeat(online = true): Promise<void> {
  try {
    await fetch(`${channelsConfig.setApiUrl}/api/channels/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ channelCode: channelsConfig.channelCode, online }),
    });
  } catch {
    /* server may be restarting — retried on the next interval */
  }
}

export interface AgentRunOptions {
  spaceId: string;
  message: string;
  threadId?: string;
  onEvent: (type: string, payload: any) => void;
  signal?: AbortSignal;
}

/**
 * Run the SET agent over the service-only SSE endpoint and pump engine events
 * to the caller. Returns the SET thread id (agent_runs row) for continuation.
 */
export async function runSetAgent(opts: AgentRunOptions): Promise<string | null> {
  const res = await fetch(`${channelsConfig.setApiUrl}/api/channels/agent/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ spaceId: opts.spaceId, message: opts.message, threadId: opts.threadId }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`agent run failed ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let setThreadId: string | null = opts.threadId ?? null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let type = '';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) type = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!type) continue;
      let payload: any = {};
      try {
        payload = data ? JSON.parse(data) : {};
      } catch {
        /* keep empty payload */
      }
      if (type === 'RUN_STARTED' && !setThreadId && payload.threadId) setThreadId = payload.threadId;
      opts.onEvent(type, payload);
    }
  }
  return setThreadId;
}
