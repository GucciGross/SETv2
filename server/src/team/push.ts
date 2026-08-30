import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireUser } from '../lib/http.js';
import { config } from '../config.js';

/**
 * Web push notifications (PWA). VAPID keys: env first
 * (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY), else generated once into
 * DATA_DIR/vapid.json so subscriptions stay valid across restarts.
 */

let vapidReady = false;
let vapidKeys: { publicKey: string; privateKey: string } | null = null;

function ensureVapid() {
  if (vapidReady) return;
  let keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const file = path.join(config.dataDir, 'vapid.json');
  if (!keys.publicKey || !keys.privateKey) {
    try {
      if (fs.existsSync(file)) {
        keys = JSON.parse(fs.readFileSync(file, 'utf8'));
      } else {
        keys = webpush.generateVAPIDKeys();
        fs.mkdirSync(config.dataDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(keys, null, 2));
        console.log('[push] generated VAPID keys →', file);
      }
    } catch (e: any) {
      console.error('[push] VAPID setup failed:', e.message);
      return;
    }
  }
  webpush.setVapidDetails(`mailto:support@${new URL(config.appUrl).hostname.replace(/^www\./, '')}`, keys.publicKey!, keys.privateKey!);
  vapidKeys = keys as { publicKey: string; privateKey: string };
  vapidReady = true;
}

export function vapidPublicKey(): string | null {
  ensureVapid();
  return vapidKeys?.publicKey ?? null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Fire-and-forget push to every subscription of a user; prunes dead endpoints. */
export async function notifyUser(userId: string, payload: PushPayload) {
  ensureVapid();
  if (!vapidReady) return;
  const subs = await q<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId]
  );
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
        );
        void q(`UPDATE push_subscriptions SET last_push_at = now() WHERE id = $1`, [s.id]);
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          void q(`DELETE FROM push_subscriptions WHERE id = $1`, [s.id]);
        }
      }
    })
  );
}

export async function pushRoutes(app: FastifyInstance) {
  app.get('/push/vapid-key', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const key = vapidPublicKey();
    return key ? { publicKey: key } : reply.code(503).send({ error: 'Push not configured' });
  });

  app.post('/push/subscribe', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z
      .object({
        endpoint: z.string().url().max(2048),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      })
      .parse(req.body);
    await q(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [user.id, body.endpoint, body.keys.p256dh, body.keys.auth]
    );
    return { ok: true };
  });

  app.delete('/push/subscribe', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const body = z.object({ endpoint: z.string().url() }).parse({ ...(req.body as any), ...((req.query as any) ?? {}) });
    await q(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [body.endpoint, user.id]);
    return { ok: true };
  });
}
