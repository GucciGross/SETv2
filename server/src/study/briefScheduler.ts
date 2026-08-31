import { one, q } from '../db.js';
import { computeBrief, writeBriefToDaily } from './brief.js';

/**
 * Scheduled brief delivery. Users opt in per account (Settings →
 * Notifications): briefHour (local hour, 0-23) + optional IANA timezone.
 * A 5-minute in-process tick — same single-instance assumption as the
 * channels heartbeat — finds users whose local hour matches and who haven't
 * been served today, then for each of their editor spaces: computes the
 * brief, stamps it into the space's daily note (idempotent), drops an
 * in-app notification and fires a web push. Delivery date is recorded in the
 * preference row itself, so restarts never double-send.
 */

export interface UserPreferences {
  briefEnabled?: boolean;
  briefHour?: number | null;
  briefTz?: string;
  briefLastDate?: string;
  [key: string]: unknown;
}

export async function getPreferences(userId: string): Promise<UserPreferences> {
  const row = await one<{ data: UserPreferences }>(`SELECT data FROM user_preferences WHERE user_id = $1`, [userId]);
  return row?.data ?? {};
}

export async function setPreferences(userId: string, patch: UserPreferences): Promise<UserPreferences> {
  const current = await getPreferences(userId);
  delete (patch as any).briefLastDate; // internal bookkeeping — never client-settable
  const next = { ...current, ...patch };
  await q(
    `INSERT INTO user_preferences (user_id, data) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [userId, JSON.stringify(next)]
  );
  return next;
}

function hourInTz(date: Date, tz?: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz || undefined }).format(date));
  } catch {
    return date.getHours();
  }
}

function todayInTz(tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined }).format(new Date()); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export interface DeliveryResult {
  spaceId: string;
  pageId?: string;
  written: boolean;
  skipped?: 'empty';
}

/** Deliver the brief for one user: stamp the daily note + in-app notification + push. */
export async function deliverBrief(userId: string, onlySpaceId?: string): Promise<DeliveryResult[]> {
  const memberships = await q<{ space_id: string; role: string }>(
    `SELECT space_id, role FROM memberships WHERE user_id = $1 AND role <> 'viewer'`,
    [userId]
  );
  const spaces = onlySpaceId ? memberships.filter((m) => m.space_id === onlySpaceId) : memberships;
  const { notifyUser } = await import('../team/push.js');
  const results: DeliveryResult[] = [];

  for (const space of spaces) {
    try {
      const brief = await computeBrief(space.space_id, userId);
      const empty = brief.reviews.dueNow === 0 && !brief.decaying.length && !brief.next.length && !brief.builds.length;
      if (empty) {
        results.push({ spaceId: space.space_id, written: false, skipped: 'empty' });
        continue;
      }
      const { pageId, written } = await writeBriefToDaily(space.space_id, userId);
      await q(`INSERT INTO notifications (user_id, space_id, type, payload) VALUES ($1, $2, 'brief', $3)`, [
        userId,
        space.space_id,
        JSON.stringify({
          pageId,
          reviewsDue: brief.reviews.dueNow,
          decaying: brief.decaying.length,
          next: brief.next[0]?.title ?? null,
        }),
      ]);
      void notifyUser(userId, {
        title: 'Your daily brief is ready',
        body: [
          brief.reviews.dueNow > 0 ? `${brief.reviews.dueNow} cards due` : null,
          brief.decaying.length > 0 ? `${brief.decaying.length} pages going amber` : null,
          brief.next[0] ? `next: ${brief.next[0].title}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Open SET to see today’s plan',
        url: `/app/space/${space.space_id}/page/${pageId}`,
      });
      results.push({ spaceId: space.space_id, pageId, written });
    } catch (error) {
      console.warn(`[brief] delivery failed for user ${userId} space ${space.space_id}:`, error);
    }
  }
  return results;
}

/** One scheduler pass — also the unit of work for tests and manual triggers. */
export async function runBriefTick(now = new Date()): Promise<number> {
  const rows = await q<{ user_id: string; data: UserPreferences }>(
    `SELECT user_id, data FROM user_preferences WHERE (data->>'briefEnabled')::boolean = true AND data->>'briefHour' ~ '^[0-9]+$'`
  );
  let delivered = 0;
  for (const row of rows) {
    const { briefHour, briefTz, briefLastDate } = row.data;
    const today = todayInTz(briefTz);
    if (hourInTz(now, briefTz) !== Number(briefHour) || briefLastDate === today) continue;
    const results = await deliverBrief(row.user_id);
    if (results.some((r) => r.written)) delivered += 1;
    // mark the day served whether or not anything was written (quiet days
    // shouldn't retry every tick)
    await q(
      `UPDATE user_preferences SET data = jsonb_set(data, '{briefLastDate}', $2::jsonb), updated_at = now() WHERE user_id = $1`,
      [row.user_id, JSON.stringify(today)]
    );
  }
  return delivered;
}

export function initBriefScheduler() {
  const tick = async () => {
    try {
      await runBriefTick();
    } catch (error) {
      console.warn('[brief] scheduler tick failed:', error);
    }
  };
  const timer = setInterval(tick, 5 * 60_000);
  timer.unref?.();
  setTimeout(tick, 30_000).unref?.(); // shortly after boot, in case the hour struck while down
}
