import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { canGrantCredits, canRunInProcessJs } from '../src/lib/privileged-actions.js';
import { billingRoutes } from '../src/billing/routes.js';
import { runJs } from '../src/code/routes.js';
import { signToken } from '../src/lib/tokens.js';
const id = '12345678-1234-1234-1234-123456789012';

test('workspace ownership never implicitly grants platform credits in either edition', () => {
  for (const SET_DEPLOYMENT_MODE of ['self-hosted', 'cloud']) {
    assert.equal(canGrantCredits(id, { SET_DEPLOYMENT_MODE }), false);
    assert.equal(canGrantCredits(id, { SET_DEPLOYMENT_MODE, SET_PLATFORM_ADMIN_IDS: id }), true);
    assert.equal(canGrantCredits('set-service', { SET_PLATFORM_ADMIN_IDS: 'set-service' }), false);
  }
  assert.equal(canGrantCredits(id, { SET_PLATFORM_ADMIN_IDS: ` ${id},another-id` }), true);
  assert.equal(canGrantCredits(id, { SET_PLATFORM_ADMIN_IDS: '*' }), false);
});
test('public self-hosted and cloud both deny the in-process runner; private behavior remains', () => {
  assert.equal(canRunInProcessJs({ SET_DEPLOYMENT_MODE: 'self-hosted' }), true);
  assert.equal(canRunInProcessJs({ SET_DEPLOYMENT_MODE: 'self-hosted', SET_EXPOSURE: 'public' }), false);
  assert.equal(canRunInProcessJs({ SET_DEPLOYMENT_MODE: 'cloud', SET_EXPOSURE: 'private' }), false);
});
test('the real runJs implementation enforces the public boundary before evaluating code', () => {
  const saved = process.env.SET_EXPOSURE;
  process.env.SET_EXPOSURE = 'public';
  try {
    const result = runJs('throw new Error("must-not-run")');
    assert.equal(result.ok, false);
    assert.match(result.result, /disabled on public/);
    assert.doesNotMatch(result.result, /must-not-run/);
  } finally {
    if (saved === undefined) delete process.env.SET_EXPOSURE; else process.env.SET_EXPOSURE = saved;
  }
});
test('actual grant route denies ordinary signed users before any ledger/database access', async () => {
  const saved = process.env.SET_PLATFORM_ADMIN_IDS;
  delete process.env.SET_PLATFORM_ADMIN_IDS;
  const app = Fastify();
  try {
    await billingRoutes(app);
    const response = await app.inject({ method: 'POST', url: `/spaces/${id}/billing/grant`,
      headers: { authorization: `Bearer ${signToken({ id, name: 'Normal customer', email: 'customer@example.test' })}` }, payload: { amountCents: 1000 } });
    assert.equal(response.statusCode, 403);
    assert.match(response.json().error, /Platform administrator/);
    const anonymous = await app.inject({ method: 'POST', url: `/spaces/${id}/billing/grant`, payload: { amountCents: 1000 } });
    assert.equal(anonymous.statusCode, 401);
  } finally {
    await app.close();
    if (saved === undefined) delete process.env.SET_PLATFORM_ADMIN_IDS; else process.env.SET_PLATFORM_ADMIN_IDS = saved;
  }
});
