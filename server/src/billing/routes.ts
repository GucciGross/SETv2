import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { one, q } from '../db.js';
import { requireResourceSpace, requireSpace } from '../lib/http.js';
import { config } from '../config.js';
import { recordActivity } from '../team/activity.js';

/**
 * Prepaid SET Cloud credits — Phase 5 money path v1 (PLAN.md).
 *
 * Stripe Checkout sells fixed credit packs as one-time payments; the
 * webhook credits the space's ledger (idempotent by checkout session id)
 * and the gateway draws the balance down as it meters usage. No
 * subscriptions, no dunning — the existing per-space caps still apply.
 */

export const CREDIT_PACKS_CENTS = [1000, 2000, 5000] as const;
export type PackCents = (typeof CREDIT_PACKS_CENTS)[number];

const stripeKey = process.env.STRIPE_SECRET_KEY || '';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = stripeKey ? new Stripe(stripeKey) : null;

/** Packs as Stripe Prices, created on first use and found again by lookup_key. */
const priceCache = new Map<number, { at: number; price: Stripe.Price }>();

async function packPrice(cents: number): Promise<Stripe.Price | null> {
  if (!stripe) return null;
  const cached = priceCache.get(cents);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.price;
  const lookupKey = `set-credit-${Math.round(cents / 100)}`;
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  let price = found.data[0];
  if (!price) {
    const product = await stripe.products.create({ name: 'SET Cloud credits', description: 'Prepaid metered LLM credit for a SET workspace' });
    price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: cents,
      lookup_key: lookupKey,
      nickname: `$${(cents / 100).toFixed(0)} SET Cloud credit`,
    });
  }
  priceCache.set(cents, { at: Date.now(), price });
  return price;
}

async function balanceCents(spaceId: string): Promise<number> {
  const row = await one<{ balance: string }>(
    `SELECT COALESCE(SUM(amount_cents), 0)::text AS balance FROM credit_ledger WHERE space_id = $1`,
    [spaceId]
  );
  return Math.round(Number(row?.balance ?? 0));
}

export async function billingRoutes(app: FastifyInstance) {
  app.get('/spaces/:spaceId/billing', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId))) return;
    const [balance, history, space] = await Promise.all([
      balanceCents(spaceId),
      q(
        `SELECT id, kind, amount_cents, ref, note, created_at FROM credit_ledger
         WHERE space_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [spaceId]
      ),
      one<{ name: string }>(`SELECT name FROM spaces WHERE id = $1`, [spaceId]),
    ]);
    return {
      enabled: !!stripe,
      balanceCents: balance,
      packs: CREDIT_PACKS_CENTS,
      spaceName: space?.name ?? '',
      history,
    };
  });

  app.post('/spaces/:spaceId/billing/checkout', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    if (!stripe) return reply.code(503).send({ error: 'Stripe is not configured on this server (STRIPE_SECRET_KEY)' });
    const body = z.object({ amountCents: z.number().int() }).parse(req.body);
    if (!(CREDIT_PACKS_CENTS as readonly number[]).includes(body.amountCents)) {
      return reply.code(400).send({ error: `Pick one of the packs: ${CREDIT_PACKS_CENTS.join(', ')}` });
    }
    const price = await packPrice(body.amountCents);
    if (!price) return reply.code(503).send({ error: 'Could not create the Stripe price' });
    const space = await one<{ name: string }>(`SELECT name FROM spaces WHERE id = $1`, [spaceId]);
    const origin = config.appUrl.replace(/\/+$/, '');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: spaceId,
      metadata: { spaceId, packCents: String(body.amountCents) },
      customer_creation: 'always',
      success_url: `${origin}/app/space/${spaceId}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app/space/${spaceId}/settings?billing=cancel`,
    });
    return { url: session.url };
  });

  /** Manual credit/refund — the support lever (owner only). */
  app.post('/spaces/:spaceId/billing/grant', async (req, reply) => {
    const spaceId = (req.params as any).spaceId;
    if (!(await requireSpace(req, reply, spaceId, 'owner'))) return;
    const body = z
      .object({ amountCents: z.number().int().min(1).max(100_000_00), note: z.string().max(300).optional() })
      .parse(req.body);
    await q(
      `INSERT INTO credit_ledger (space_id, kind, amount_cents, ref, note)
       VALUES ($1, 'grant', $2, $3, $4)`,
      [spaceId, body.amountCents, `grant:${Date.now()}`, body.note ?? 'manual grant']
    );
    void recordActivity(spaceId, req.user!.id, 'credits_granted', { amountCents: body.amountCents });
    return { balanceCents: await balanceCents(spaceId) };
  });

  // Stripe webhook — signature verification needs the exact raw bytes the
  // sender signed; the root JSON parser stashes them on req.rawBody.
  app.post('/billing/webhook', async (req, reply) => {
    if (!stripe || !webhookSecret) return reply.code(503).send({ error: 'Stripe webhook not configured' });
    const sig = req.headers['stripe-signature'] as string | undefined;
    if (!sig) return reply.code(400).send({ error: 'Missing stripe-signature header' });
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent((req as any).rawBody as string, sig, webhookSecret);
    } catch (e: any) {
      return reply.code(400).send({ error: `Signature verification failed: ${e.message}` });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const spaceId = session.client_reference_id ?? session.metadata?.spaceId;
      const cents = session.amount_total ?? Number(session.metadata?.packCents ?? 0);
      if (spaceId && cents > 0 && session.payment_status === 'paid') {
        // UNIQUE(kind, ref): replays of the same checkout session credit once
        const inserted = await one<{ id: string }>(
          `INSERT INTO credit_ledger (space_id, kind, amount_cents, ref, note)
           VALUES ($1, 'purchase', $2, $3, 'Stripe checkout')
           ON CONFLICT (kind, ref) DO NOTHING RETURNING id`,
          [spaceId, cents, session.id]
        );
        if (inserted) {
          const owner = await one<{ user_id: string }>(
            `SELECT user_id FROM memberships WHERE space_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1`,
            [spaceId]
          );
          if (owner) void recordActivity(spaceId, owner.user_id, 'credits_purchased', { amountCents: cents });
        }
      }
    }
    return { received: true };
  });
}
