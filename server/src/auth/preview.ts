import { z } from 'zod';

/** Private-preview gate: opt-in server env, off by default so normal
 * GitHub self-hosts are unaffected. While on, new sign-ups are refused and
 * SSO is disabled so the preview owner remains the only account source. */
const previewEnv = z.object({ SET_PRIVATE_PREVIEW: z.string().optional() }).passthrough();

export function previewSettings(env: Record<string, string | undefined> = process.env) {
  const parsed = previewEnv.parse(env);
  return { enabled: parsed.SET_PRIVATE_PREVIEW === '1' };
}

export function previewEnabled(): boolean {
  return previewSettings().enabled;
}

export const CLOUD_NOT_READY = 'SET Cloud is not ready yet. Self-host SET: https://github.com/GucciGross/SETv2#readme';
