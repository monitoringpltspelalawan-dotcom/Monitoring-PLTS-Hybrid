export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export async function api<T = any>(path: string, options: Omit<RequestInit, 'body'> & { body?: any } = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  if (options.method && options.method !== 'GET' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...options, body, headers, credentials: 'include' });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let payload: any = null;
    if (contentType.includes('application/json')) payload = await res.json().catch(() => null);
    const err = payload?.error;
    throw new ApiError(res.status, err?.code || 'HTTP_ERROR', err?.message || `Request failed (${res.status})`, err?.details);
  }
  if (res.status === 204) return undefined as T;
  if (contentType.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: any) => api<T>(path, { method: 'POST', body });
export const patch = <T = any>(path: string, body?: any) => api<T>(path, { method: 'PATCH', body });
export const put = <T = any>(path: string, body?: any) => api<T>(path, { method: 'PUT', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
