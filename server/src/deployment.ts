/** Product edition and network exposure are independent operator choices.
 * A self-hosted installation on a public VPS is still self-hosted.
 * Never derive the edition (or Codex entitlement) from a hostname.
 */
type Env = Record<string, string | undefined>;
export function deploymentSettings(env: Env = process.env) {
  const edition = env.SET_DEPLOYMENT_MODE || 'unconfigured';
  if (!['self-hosted', 'cloud', 'unconfigured'].includes(edition)) throw new Error('Invalid SET_DEPLOYMENT_MODE');
  const exposure = env.SET_EXPOSURE || (edition === 'cloud' ? 'public' : 'private');
  if (!['public', 'private'].includes(exposure)) throw new Error('Invalid SET_EXPOSURE');
  if (edition === 'cloud' && exposure !== 'public') throw new Error('Cloud edition requires SET_EXPOSURE=public');
  const proxies = (env.SET_TRUST_PROXY || '').split(',').map(s => s.trim()).filter(Boolean);
  if (proxies.some(p => ['true', '*', '0.0.0.0/0', '::/0'].includes(p))) throw new Error('SET_TRUST_PROXY must list trusted proxy addresses/CIDRs, not every address');
  return { edition, exposure, revision: env.SET_BUILD_REVISION || 'unknown', trustProxy: proxies.length ? proxies : false as false };
}

export function validatePublicDeployment(env: Env = process.env): void {
  const deployment = deploymentSettings(env);
  if (deployment.exposure !== 'public') return;
  const failures: string[] = [];
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || /^(change-me-in-production|set-dev-secret-change-me)$/.test(env.JWT_SECRET)) failures.push('JWT_SECRET must be a unique random secret of at least 32 characters');
  let origin = '';
  try {
    const url = new URL(env.APP_URL || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    origin = url.origin;
  } catch { failures.push('APP_URL must be the canonical HTTPS origin, with no path, credentials, query or fragment'); }
  const origins = (env.WEB_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length || !origins.includes(origin) || origins.some(value => {
    try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value; } catch { return true; }
  })) failures.push('WEB_ORIGIN must contain exact HTTPS origins including APP_URL (no wildcard)');
  try {
    const url = new URL(env.DATABASE_URL || '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.password).length < 16) throw new Error();
  } catch { failures.push('DATABASE_URL must use a non-default database password of at least 16 characters'); }
  if (env.SEED_DEMO === '1') failures.push('SEED_DEMO must be disabled on public installations');
  if (deployment.edition === 'cloud' && (env.LLM_BASE_URL || env.LLM_API_KEY)) failures.push('Cloud server must not receive shared LLM_* bootstrap credentials; configure GATEWAY_UPSTREAM_* on the gateway instead');
  if (failures.length) throw new Error(`Unsafe public SET configuration:\n- ${failures.join('\n- ')}`);
}
