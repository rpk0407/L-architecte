// @ts-check
// Zero-configuration store on Vercel Blob (the token Vercel provides with a Blob store).
//
// Layout: a small head document (epoch, version, list of sealed segments, the latest events)
// replaced with a conditional write (ETag If-Match), and immutable segments of older events.
// The conditional write is the compare-and-swap: if anyone wrote since we read, ours is refused.
import { randomBytes } from 'node:crypto';

/** @typedef {import('./memory.js').Store} Store */
/** @typedef {import('../core/journal.js').JEvent} JEvent */

const TAIL_MAX = 300;
const SEGMENT = 1000;

async function realSdk() {
  const m = await import('@vercel/blob');
  return { get: m.get, put: m.put, del: m.del, list: m.list, isPrecondition: (e) => e instanceof m.BlobPreconditionFailedError || /precondition/i.test(String(e && e.message)) };
}

/**
 * @param {{ prefix?: string, access?: 'private'|'public', sdk?: any }} o
 * @returns {Store}
 */
export function blobStore(o = {}) {
  const prefix = (o.prefix || 'lx2').replace(/\/+$/, '');
  const access = o.access || 'private';
  const HEAD = prefix + '/head.json';
  /** @type {any} */
  let sdk = o.sdk || null;
  const api = async () => { if (!sdk) sdk = await realSdk(); return sdk; };

  /** @type {{ epoch: string, version: number, sealed: { key: string, from: number, to: number }[], tail: JEvent[] } | null} */
  let head = null;
  let etag = '';
  /** immutable segments, cached for the life of the instance */
  const segments = new Map();

  async function readJson(path, ifNoneMatch) {
    const s = await api();
    let r;
    try { r = await s.get(path, { access, useCache: false, ...(ifNoneMatch ? { ifNoneMatch } : {}) }); }
    catch (e) { if (/not.?found/i.test(String(e && (e.name || e.message)))) return { status: 404 }; throw e; }
    if (!r) return { status: 404 };
    if (r.statusCode === 304) return { status: 304 };
    const text = await new Response(r.stream).text();
    return { status: 200, etag: r.blob && r.blob.etag, body: JSON.parse(text) };
  }
  async function writeJson(path, body, opt = {}) {
    const s = await api();
    return s.put(path, JSON.stringify(body), { access, contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60, allowOverwrite: true, ...opt });
  }

  async function loadHead() {
    const r = await readJson(HEAD, etag && head ? etag : '');
    if (r.status === 304) return /** @type {any} */ (head);
    if (r.status === 404) {
      const fresh = { epoch: 'b' + randomBytes(6).toString('hex'), version: 0, sealed: [], tail: [] };
      try {
        const out = await writeJson(HEAD, fresh, { allowOverwrite: false });
        head = fresh; etag = out.etag || '';
      } catch { return loadHead(); } // someone created it first
      return head;
    }
    if (head && r.body.epoch !== head.epoch) segments.clear();
    head = r.body; etag = r.etag || '';
    return head;
  }
  async function segment(key) {
    if (!segments.has(key)) {
      const r = await readJson(key);
      if (r.status !== 200) throw new Error('segment manquant : ' + key);
      segments.set(key, r.body);
    }
    return segments.get(key);
  }
  /** Replace the head only if nobody else did since we read it. */
  async function swapHead(next) {
    const s = await api();
    try {
      const out = await writeJson(HEAD, next, { ifMatch: etag });
      head = next; etag = out.etag || '';
      return true;
    } catch (e) {
      if (s.isPrecondition(e)) return false;
      throw e;
    }
  }
  async function writeSegment(events) {
    const key = `${prefix}/seg/${/** @type {any} */ (head).epoch}-${events[0].v}-${events[events.length - 1].v}-${randomBytes(4).toString('hex')}.json`;
    await writeJson(key, events, { allowOverwrite: false });
    segments.set(key, events);
    return { key, from: events[0].v, to: events[events.length - 1].v };
  }

  async function readFrom(after) {
    const h = await loadHead();
    const need = h.sealed.filter((sg) => sg.to > after && !segments.has(sg.key));
    for (let i = 0; i < need.length; i += 8) await Promise.all(need.slice(i, i + 8).map((sg) => segment(sg.key)));
    /** @type {JEvent[]} */
    const out = [];
    for (const sg of h.sealed) { if (sg.to <= after) continue; for (const e of await segment(sg.key)) if (e.v > after) out.push(e); }
    for (const e of h.tail) if (e.v > after) out.push(e);
    return { epoch: h.epoch, events: out };
  }

  return {
    kind: 'blob',
    async read(after, retried = false) {
      try { return await readFrom(after); }
      catch (e) {
        // a segment compacted away by another instance: start again from a fresh head
        if (retried || !/segment manquant/.test(String(e && e.message))) throw e;
        head = null; etag = '';
        return readFrom(after);
      }
    },
    async append(list, ep) {
      if (!list.length) return { ok: true };
      const h = head || (await loadHead());
      if (h.epoch !== ep || list[0].v !== h.version + 1) return { ok: false };
      let all = h.tail.concat(list);
      let sealed = h.sealed, tail = all;
      /** @type {string[]} */
      let replaced = [];
      if (all.length > TAIL_MAX) {
        // move the bulk into immutable segments of ~SEGMENT events; keep the head small
        sealed = h.sealed.slice();
        const last = sealed[sealed.length - 1];
        if (last && last.to - last.from + 1 < SEGMENT) { all = (await segment(last.key)).concat(all); sealed.pop(); replaced = [last.key]; }
        const keep = all.length % SEGMENT > TAIL_MAX ? 0 : all.length % SEGMENT;
        const toSeal = all.slice(0, all.length - keep);
        for (let i = 0; i < toSeal.length; i += SEGMENT) sealed.push(await writeSegment(toSeal.slice(i, i + SEGMENT)));
        tail = all.slice(all.length - keep);
      }
      const ok = await swapHead({ epoch: h.epoch, version: list[list.length - 1].v, sealed, tail });
      if (!ok) { head = null; etag = ''; }
      else if (replaced.length) await (await api()).del(replaced).catch(() => {});
      return { ok };
    },
    async redact(match) {
      let n = 0;
      for (let attempt = 0; attempt < 5; attempt++) {
        const h = await loadHead();
        const sealed = [];
        let changed = 0;
        for (const sg of h.sealed) {
          const evs = await segment(sg.key);
          if (!evs.some((e) => e.pii != null && match(e))) { sealed.push(sg); continue; }
          const clean = evs.map((e) => { if (e.pii != null && match(e)) { changed++; const { pii, ...rest } = e; return rest; } return e; });
          sealed.push(await writeSegment(clean));
        }
        const tail = h.tail.map((e) => { if (e.pii != null && match(e)) { changed++; const { pii, ...rest } = e; return rest; } return e; });
        if (!changed) return 0;
        if (await swapHead({ ...h, sealed, tail })) {
          n = changed;
          // the old segments still hold the personal data: delete them
          const keep = new Set(sealed.map((x) => x.key));
          const gone = h.sealed.filter((x) => !keep.has(x.key)).map((x) => x.key);
          if (gone.length) await (await api()).del(gone).catch(() => {});
          return n;
        }
      }
      return n;
    },
    async reset() {
      const h = await loadHead();
      const next = { epoch: 'b' + randomBytes(6).toString('hex'), version: 0, sealed: [], tail: [] };
      const out = await writeJson(HEAD, next);
      head = next; etag = out.etag || '';
      segments.clear();
      const old = h.sealed.map((x) => x.key);
      if (old.length) await (await api()).del(old).catch(() => {});
      return next.epoch;
    },
    async secret(name, make) {
      const path = `${prefix}/secret-${name}.json`;
      const r = await readJson(path);
      if (r.status === 200) return r.body.v;
      try { await writeJson(path, { v: make() }, { allowOverwrite: false }); } catch { /* created by someone else */ }
      const again = await readJson(path);
      return again.body.v;
    }
  };
}

/** An in-memory stand-in for the Blob SDK, with real ETag semantics (tests). */
export function fakeBlobSdk() {
  const files = new Map();
  let n = 0;
  const err = (name, msg) => Object.assign(new Error(msg), { name });
  return {
    files,
    async get(path, opt) {
      const f = files.get(path);
      if (!f) throw err('BlobNotFoundError', 'not found');
      if (opt && opt.ifNoneMatch && opt.ifNoneMatch === f.etag) return { statusCode: 304, stream: null, blob: { etag: f.etag } };
      return { statusCode: 200, stream: new Response(f.body).body, blob: { etag: f.etag } };
    },
    async put(path, body, opt) {
      const f = files.get(path);
      if (opt.ifMatch !== undefined && (!f || f.etag !== opt.ifMatch)) throw err('BlobPreconditionFailedError', 'precondition failed');
      if (f && opt.allowOverwrite === false) throw err('BlobError', 'already exists');
      const etag = '"e' + ++n + '"';
      files.set(path, { body, etag });
      return { pathname: path, etag };
    },
    async del(paths) { for (const p of [].concat(paths)) files.delete(p); },
    async list() { return { blobs: [...files.keys()].map((pathname) => ({ pathname })) }; },
    isPrecondition: (e) => e && e.name === 'BlobPreconditionFailedError'
  };
}
