/** Server-owned controls: never accept these choices from a workspace or request. */
type Env = Record<string, string | undefined>;
export function canRunInProcessJs(env: Env = process.env): boolean {
  // node:vm is NOT an untrusted-code security boundary. Public self-hosted
  // installations need the same protection as the managed cloud edition.
  return env.SET_DEPLOYMENT_MODE !== 'cloud' && env.SET_EXPOSURE !== 'public';
}

export function canGrantCredits(userId: string, env: Env = process.env): boolean {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return false;
  const admins = (env.SET_PLATFORM_ADMIN_IDS || '').split(',').map(id => id.trim().toLowerCase()).filter(Boolean);
  return admins.includes(userId.toLowerCase());
}
