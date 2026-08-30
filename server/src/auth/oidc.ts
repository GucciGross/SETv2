import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, q } from '../db.js';
import { config } from '../config.js';
import { signToken } from '../lib/tokens.js';
import { createPersonalSpace } from './routes.js';

/**
 * Single sign-on via any OIDC provider (env-configured: OIDC_ISSUER,
 * OIDC_CLIENT_ID, OIDC_CLIENT_SECRET). Authorization-code flow with a
 * state cookie; users are matched by email and auto-provisioned with an
 * unguessable password (SSO-only accounts).
 */

const STATE_COOKIE = 'set_oidc_state';

export function oidcEnabled(): boolean {
  return !!(config.oidc.issuer && config.oidc.clientId && config.oidc.clientSecret);
}

interface Disco {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

let discoCache: { at: number; doc: Disco } | null = null;

async function discover(): Promise<Disco> {
  if (discoCache && Date.now() - discoCache.at < 10 * 60_000) return discoCache.doc;
  const url = `${config.oidc.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) — check OIDC_ISSUER`);
  const doc = (await res.json()) as Disco;
  for (const key of ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint'] as const) {
    if (!doc[key]) throw new Error(`OIDC discovery document is missing ${key}`);
  }
  discoCache = { at: Date.now(), doc };
  return doc;
}

function callbackUrl(): string {
  return `${config.appUrl.replace(/\/+$/, '')}/api/auth/oidc/callback`;
}

export async function oidcRoutes(app: FastifyInstance) {
  // public availability probe (Login page button)
  app.get('/auth/oidc/enabled', async () => ({
    enabled: oidcEnabled(),
    name: config.oidc.displayName,
  }));

  app.get('/auth/oidc/login', async (req, reply) => {
    if (!oidcEnabled()) return reply.code(404).send({ error: 'SSO is not configured' });
    let disco: Disco;
    try {
      disco = await discover();
    } catch (e: any) {
      return reply.code(502).send({ error: e.message });
    }
    const state = crypto.randomBytes(16).toString('base64url');
    reply.header(
      'set-cookie',
      `${STATE_COOKIE}=${state}; HttpOnly; Max-Age=600; Path=/api/auth/oidc; SameSite=Lax`
    );
    const url = new URL(disco.authorization_endpoint);
    url.searchParams.set('client_id', config.oidc.clientId);
    url.searchParams.set('redirect_uri', callbackUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    return reply.redirect(url.toString());
  });

  app.get('/auth/oidc/callback', async (req, reply) => {
    if (!oidcEnabled()) return reply.code(404).send({ error: 'SSO is not configured' });
    const fail = (why: string) => reply.redirect(`${config.appUrl.replace(/\/+$/, '')}/login?sso_error=${encodeURIComponent(why)}`);
    reply.header('set-cookie', `${STATE_COOKIE}=; HttpOnly; Max-Age=0; Path=/api/auth/oidc; SameSite=Lax`);

    const query = req.query as any;
    const cookieState = (req.headers.cookie ?? '')
      .split(/;\s*/)
      .map((c) => c.split('='))
      .find(([k]) => k === STATE_COOKIE)?.[1];
    if (!query.code || !query.state || query.state !== cookieState) return fail('invalid_state');

    let disco: Disco;
    try {
      disco = await discover();
    } catch {
      return fail('provider_unavailable');
    }

    // code → tokens
    const tokenRes = await fetch(disco.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(query.code),
        client_id: config.oidc.clientId,
        client_secret: config.oidc.clientSecret,
        redirect_uri: callbackUrl(),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenRes.ok) return fail('token_exchange_failed');
    const tokens = (await tokenRes.json()) as any;

    // tokens → identity
    const infoRes = await fetch(disco.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!infoRes.ok) return fail('userinfo_failed');
    const info = (await infoRes.json()) as { email?: string; name?: string };
    if (!info.email) return fail('no_email');
    const email = info.email.toLowerCase();

    // find-or-provision by email; SSO accounts get an unguessable password
    let user = await one<{ id: string; email: string; name: string }>(
      `SELECT id, email, name FROM users WHERE email = $1`,
      [email]
    );
    if (!user) {
      user = await one<{ id: string; email: string; name: string }>(
        `INSERT INTO users (email, name, password_hash, onboarding)
         VALUES ($1, $2, $3, '{"via":"sso"}'::jsonb) RETURNING id, email, name`,
        [email, info.name ?? email.split('@')[0], await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10)]
      );
      if (user) await createPersonalSpace(user.id, user.name);
    }
    if (!user) return fail('provisioning_failed');

    const jwt = signToken({ id: user.id, email: user.email, name: user.name });
    return reply.redirect(`${config.appUrl.replace(/\/+$/, '')}/login?set_token=${jwt}`);
  });
}
