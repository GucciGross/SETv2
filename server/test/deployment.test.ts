import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentSettings, validatePublicDeployment } from '../src/deployment.js';
import { codexOAuthEnabled } from '../src/codex/policy.js';
const publicEnv = {
  SET_DEPLOYMENT_MODE: 'self-hosted', SET_EXPOSURE: 'public',
  JWT_SECRET: 'a-test-only-secret-that-is-long-enough',
  DATABASE_URL: 'postgres://set:test-only-password-123@db/set',
  APP_URL: 'https://trainwithset.com', WEB_ORIGIN: 'https://trainwithset.com',
  SET_CODEX_OAUTH_ENABLED: '1',
};
test('public self-hosting retains its edition and personal Codex gate', () => {
  validatePublicDeployment(publicEnv);
  assert.equal(deploymentSettings(publicEnv).edition, 'self-hosted');
  assert.equal(codexOAuthEnabled(publicEnv), true);
});
test('cloud is explicit and cannot inherit personal Codex or private exposure', () => {
  const env = { ...publicEnv, SET_DEPLOYMENT_MODE: 'cloud' };
  validatePublicDeployment(env);
  assert.equal(codexOAuthEnabled(env), false);
  assert.throws(() => deploymentSettings({ ...env, SET_EXPOSURE: 'private' }));
  assert.throws(() => validatePublicDeployment({ ...env, LLM_API_KEY: 'operator-secret' }));
});
test('private development remains usable without production secrets', () => {
  validatePublicDeployment({});
  assert.equal(deploymentSettings({}).exposure, 'private');
});
test('public startup rejects weak secrets, invalid origins and demo data without leaking values', () => {
  for (const patch of [
    { JWT_SECRET: 'change-me-in-production' }, { WEB_ORIGIN: '*' },
    { APP_URL: '' }, { APP_URL: 'http://trainwithset.com' },
    { APP_URL: 'https://trainwithset.com/app' },
    { WEB_ORIGIN: 'https://wrong.example' }, { SEED_DEMO: '1' },
    { DATABASE_URL: 'postgres://set:set@db/set' }, { SET_TRUST_PROXY: 'true' },
  ]) assert.throws(() => validatePublicDeployment({ ...publicEnv, ...patch }));
  assert.throws(() => validatePublicDeployment({ ...publicEnv, JWT_SECRET: 'do-not-print-me' }), error => !String(error).includes('do-not-print-me'));
});
test('diagnostics do not expose credentials and proxy trust is explicit', () => {
  const d = deploymentSettings({ ...publicEnv, SET_BUILD_REVISION: 'abc123', SET_TRUST_PROXY: '172.20.0.0/16' });
  assert.deepEqual(d, { edition: 'self-hosted', exposure: 'public', revision: 'abc123', trustProxy: ['172.20.0.0/16'] });
});
