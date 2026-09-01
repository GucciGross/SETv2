import { clsx, type ClassValue } from 'clsx';
export function cn(...inputs: ClassValue[]) { return clsx(inputs); }

/**
 * Notebooks auto-created by a deep-research run ("Research: <question>",
 * description stamped by the server). They belong to the Deep Research view —
 * keeping them out of the user's notebook lists is what stops the same
 * question from piling up as five near-identical cards.
 */
export function isRunNotebook(n: { description?: string | null } | null | undefined): boolean {
  return n?.description === 'Deep research run';
}


/**
 * crypto.randomUUID() is only exposed in secure contexts (HTTPS / localhost).
 * LAN deployments over plain http:// would crash without this fallback.
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC4122 v4-ish fallback for insecure contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
