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

/** After every answer: is the salon's database down (x-lx-stale: read from the server's memory; 503: nothing saved)? */
const storeHealth = new Set<(down: boolean) => void>();
export function onStoreHealth(fn: (down: boolean) => void) { storeHealth.add(fn); return () => { storeHealth.delete(fn); }; }

export function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

/** The requests still on their way, and when the last one came back: a page whose data is loading is not done (the
 *  guided tour waits for it before it passes over a part the page does not show). */
let pending = 0, lastBack = 0;
/** How long nothing has been on its way (0: something still is). */
export const netIdle = () => (pending ? 0 : Date.now() - lastBack);

async function request<T>(method: string, path: string, body?: unknown, opts: { requestId?: string; signal?: AbortSignal } = {}): Promise<T> {
  pending++;
  try { return await send<T>(method, path, body, opts); } finally { pending--; lastBack = Date.now(); }
}
async function send<T>(method: string, path: string, body: unknown, opts: { requestId?: string; signal?: AbortSignal }): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-request-id'] = opts.requestId || uuid();
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: opts.signal });
  } catch (e) {
    if ((e as any)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Pas de connexion. Vérifie le Wi-Fi puis réessaie.');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  // a 503 that is not about the database (too many writes at once) says nothing about it
  const other = res.status === 503 && data && typeof data === 'object' && data.error && data.error.code !== 'store_down';
  if (!other) { const down = res.headers.get('x-lx-stale') === '1' || res.status === 503; storeHealth.forEach((fn) => fn(down)); }
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

/**
 * Sends again what failed for a reason that says nothing about the request itself: no network (status 0), a gateway that answered
 * 502, 503 or 504. Waits 1, 2, 4 and 8 s between tries; the caller passes the same request id each time, so a request the server
 * had in fact received is answered, not done twice. Anything else (a 400, a 409, a 500) is thrown at once.
 */
export async function withRetry<T>(fn: () => Promise<T>, o: { waits?: number[]; sleep?: (ms: number) => Promise<void>; onWait?: (n: number, e: ApiError) => void } = {}): Promise<T> {
  const waits = o.waits ?? [1000, 2000, 4000, 8000];
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const st = e instanceof ApiError ? e.status : -1;
      if (!(st === 0 || st === 502 || st === 503 || st === 504) || i >= waits.length) throw e;
      o.onWait?.(i + 1, e as ApiError);
      await sleep(waits[i]);
    }
  }
}

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? '?' + s : '';
}
