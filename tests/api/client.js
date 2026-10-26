// A tiny browser for API tests: same-origin headers and a cookie jar, straight into the handler.
import { handle } from '../../server/http/app.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';

export const ORIGIN = 'https://salon.test';

export async function testRuntime({ clock, env = {} } = {}) {
  return createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789', ...env }, clock, store: memoryStore() });
}

export function browser(rt, { ip = '10.0.0.' + Math.floor(Math.random() * 250 + 1) } = {}) {
  const jar = new Map();
  async function call(method, path, body, headers = {}) {
    const h = new Headers({ origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-real-ip': ip, ...headers });
    if (jar.size) h.set('cookie', [...jar].map(([k, v]) => k + '=' + v).join('; '));
    if (body !== undefined && !h.has('content-type')) h.set('content-type', 'application/json');
    const res = await handle(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), { runtime: rt });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = decodeURIComponent(pair.slice(i + 1));
      if (attrs.some((a) => /max-age=0/i.test(a.trim())) || !value) jar.delete(name); else jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  return {
    jar, ip,
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b = {}, h) => call('POST', p, b, h),
    patch: (p, b = {}, h) => call('PATCH', p, b, h),
    del: (p, h) => call('DELETE', p, undefined, h),
    raw: call
  };
}
