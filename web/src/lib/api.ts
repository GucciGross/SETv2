const TOKEN_KEY = 'set_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? '';
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(method: string, path: string, body?: any, opts: { raw?: boolean } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${getToken()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new ApiError(401, 'Session expired');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, err.error ?? 'Request failed');
  }
  return res.json();
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: any) => request<T>('POST', path, body),
  patch: <T = any>(path: string, body?: any) => request<T>('PATCH', path, body),
  put: <T = any>(path: string, body?: any) => request<T>('PUT', path, body),
  del: <T = any>(path: string) => request<T>('DELETE', path),
  upload: async <T = any>(path: string, files: File[], fields?: Record<string, string>) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v);
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${getToken()}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, err.error ?? 'Upload failed');
    }
    return res.json() as Promise<T>;
  },
  raw: (path: string) => fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } }),
};

/** Parse an SSE stream (fetch-based, since EventSource can't POST). */
export async function sse(
  path: string,
  body: any,
  handlers: Record<string, (data: any) => void>,
  signal?: AbortSignal
) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, err.error ?? 'Stream failed');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      let event = 'message';
      let data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;
      try {
        handlers[event]?.(JSON.parse(data));
      } catch {
        /* skip malformed */
      }
    }
  }
}
