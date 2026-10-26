// Fetch wrapper for the Comptoir: JSON both ways, French error messages from the server,
// and an idempotency key on every write so a retried tap never records twice.

export class ApiError extends Error {
  status: number;
  code: string;
  extra: any;
  constructor(status: number, code: string, message: string, extra?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

type Listener = (e: ApiError) => void;
const signedOut = new Set<Listener>();
export function onSignedOut(fn: Listener) { signedOut.add(fn); return () => { signedOut.delete(fn); }; }

export function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

async function request<T>(method: string, path: string, body?: unknown, opts: { requestId?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-request-id'] = opts.requestId || uuid();
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    if ((e as any)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Pas de connexion. Vérifie le Wi-Fi, on réessaie.');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const err = data && typeof data === 'object' && data.error ? new ApiError(res.status, data.error.code, data.error.message, data.error.extra) : new ApiError(res.status, 'http', 'Erreur ' + res.status);
    if (res.status === 401 && path.startsWith('/api/v1/')) signedOut.forEach((fn) => fn(err));
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T = any>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, { signal }),
  post: <T = any>(path: string, body: unknown = {}, requestId?: string) => request<T>('POST', path, body, { requestId }),
  patch: <T = any>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  del: <T = any>(path: string) => request<T>('DELETE', path)
};

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? '?' + s : '';
}
