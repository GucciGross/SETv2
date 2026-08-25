import { clsx, type ClassValue } from 'clsx';
export function cn(...inputs: ClassValue[]) { return clsx(inputs); }

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
