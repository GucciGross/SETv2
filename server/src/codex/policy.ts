/** Server-owned, fail-closed Codex OAuth gate. */
export function codexOAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SET_DEPLOYMENT_MODE === 'self-hosted' && env.SET_CODEX_OAUTH_ENABLED === '1';
}

export class CodexError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message); }
}
