/** A server-owned, fail-closed deployment gate. Never read these from a request. */
export function codexOAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SET_DEPLOYMENT_MODE === 'self-hosted' && env.SET_CODEX_OAUTH_ENABLED === '1';
}

export function requireCodexOAuth(): void {
  if (!codexOAuthEnabled()) throw new CodexError(404, 'Codex account sign-in is unavailable on this deployment.');
}

export class CodexError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}

/** Only this public device verification page may be sent to the browser. */
export function validateDeviceLogin(value: unknown) {
  const v = value as Record<string, unknown> | null;
  if (!v || v.type !== 'chatgptDeviceCode' || typeof v.loginId !== 'string' || !v.loginId || v.loginId.length > 200 ||
      typeof v.userCode !== 'string' || !/^[A-Za-z0-9-]{4,40}$/.test(v.userCode) ||
      v.verificationUrl !== 'https://auth.openai.com/codex/device') {
    throw new CodexError(502, 'Unsupported Codex device-login response. Update the Codex CLI and retry.');
  }
  return { loginId: v.loginId, userCode: v.userCode, verificationUrl: v.verificationUrl };
}

/** Experimental voice is separately opt-in and can never override the cloud gate. */
export function codexVoiceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return codexOAuthEnabled(env) && env.SET_CODEX_VOICE_ENABLED === '1';
}

export function requireCodexVoice(): void {
  if (!codexVoiceEnabled()) throw new CodexError(404, 'Codex subscription voice is unavailable on this deployment.');
}
