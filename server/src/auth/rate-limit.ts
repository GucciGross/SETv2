import { createHash } from 'node:crypto';
import { one, q } from '../db.js';
let requests = 0;
/** Shared atomic limiter: restarts/replicas cannot reset buckets. No raw email/IP keys. */
export async function authRateLimited(route: string, ip: string, max = 10, windowMs = 60_000): Promise<boolean> {
  const key = createHash('sha256').update(`${route}\0${ip}`).digest('hex');
  const row = await one<{ hits: number }>(
    `INSERT INTO auth_rate_limits(key, hits, expires_at) VALUES ($1, 1, now() + $2 * interval '1 millisecond')
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1 ELSE auth_rate_limits.hits + 1 END,
       expires_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END
     RETURNING hits`, [key, windowMs]);
  if (++requests % 256 === 0) {
    void q(`DELETE FROM auth_rate_limits WHERE expires_at < now() - interval '1 hour'`).catch(() => {});
    void q(`DELETE FROM revoked_sessions WHERE expires_at < now()`).catch(() => {});
  }
  return !row || row.hits > max;
}
