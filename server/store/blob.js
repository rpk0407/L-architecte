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

/**
 * The encrypted backups, as private files under `backups/` (the Blob store must be created Private: Vercel
 * fixes a store's access at creation and refuses private files in a public one). Separate from the journal store, so they work
 * whatever the main store is (Postgres included) as long as BLOB_READ_WRITE_TOKEN is set.
 * `index.json` keeps what a listing shows (time, number of events) without opening each file;
 * `staging/` holds the parts of a file being uploaded for a restore (the function body limit is 4.5 MB).
 * @param {{ dir?: string, sdk?: any }} [o]
 */
export function blobBackups(o = {}) {
  const dir = (o.dir || 'backups').replace(/\/+$/, '');
  const access = 'private';
  const INDEX = dir + '/index.json';
  const NAME = /^(\d{4}-\d{2}-\d{2})\.json\.gz\.enc$/;
  /** @type {any} */
  let sdk = o.sdk || null;
  const api = async () => { if (!sdk) sdk = await realSdk(); return sdk; };
  const notFound = (e) => /not.?found/i.test(String(e && (e.name || e.message)));

  async function text(path) {
    const s = await api();
    let r;
    try { r = await s.get(path, { access, useCache: false }); } catch (e) { if (notFound(e)) return null; throw e; }
    return r && r.stream ? new Response(r.stream).text() : null;
  }
  async function write(path, body, contentType = 'application/octet-stream') {
    return (await api()).put(path, body, { access, contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
  }
  /** every file under a prefix, all pages */
  async function files(prefix) {
    const s = await api();
    const out = [];
    let cursor;
    do {
      const r = await s.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      out.push(...r.blobs);
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    return out;
  }
  /**
   * Missing or unreadable: empty. A failed read throws when about to rewrite it (strict), so a Blob hiccup
   * fails the backup (retried later) instead of rewriting the index without the other backups.
   */
  async function readIndex(strict = false) {
    let t = null;
    try { t = await text(INDEX); } catch (e) { if (strict) throw e; return {}; }
    try { return JSON.parse(t || '{}').items || {}; } catch { return {}; }
  }

  return {
    /** @param {string} name YYYY-MM-DD.json.gz.enc @param {string} body @param {{ at: number, count: number, head: string, salon: string }} meta */
    async putBackup(name, body, meta) {
      if (!NAME.test(name)) throw new Error('nom de sauvegarde invalide : ' + name);
      await write(dir + '/' + name, body);
      const items = await readIndex(true);
      items[name] = { ...meta, size: body.length };
      await write(INDEX, JSON.stringify({ items }), 'application/json');
    },
    /** Newest first. A file the index does not know (index lost) still lists, without its count. */
    async listBackups() {
      const items = await readIndex();
      return (await files(dir + '/')).map((b) => {
        const m = NAME.exec(String(b.pathname).slice(dir.length + 1));
        if (!m) return null;
        const meta = items[m[0]] || {};
        const up = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        return { name: m[0], day: m[1], at: meta.at || up, count: meta.count ?? null, head: meta.head || null, salon: meta.salon || null, size: b.size ?? meta.size ?? null };
      }).filter((x) => x != null).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.at - a.at));
    },
    /** The file as a stream (download) and as text on demand (restore); null when absent. */
    async getBackup(name) {
      if (!NAME.test(name)) return null;
      const s = await api();
      let r;
      try { r = await s.get(dir + '/' + name, { access, useCache: false }); } catch (e) { if (notFound(e)) return null; throw e; }
      if (!r || !r.stream) return null;
      return { stream: /** @type {ReadableStream} */ (r.stream), size: r.blob && r.blob.size, text: () => new Response(r.stream).text() };
    },
    /** @param {string[]} names */
    async deleteBackups(names) {
      if (!names.length) return;
      await (await api()).del(names.map((n) => dir + '/' + n));
      const items = await readIndex(true);
      for (const n of names) delete items[n];
      await write(INDEX, JSON.stringify({ items }), 'application/json');
    },
    /** One part of an uploaded file, staged until all of them are there. */
    async putChunk(i, n, body) { await write(`${dir}/staging/${n}-${String(i).padStart(4, '0')}.part`, body, 'text/plain'); },
    /** The n parts joined, or null when one is missing. */
    async readChunks(n) {
      const parts = [];
      for (let i = 0; i < n; i++) { const t = await text(`${dir}/staging/${n}-${String(i).padStart(4, '0')}.part`); if (t == null) return null; parts.push(t); }
      return parts.join('');
    },
    async clearChunks() {
      const list = (await files(dir + '/staging/')).map((b) => b.pathname);
      if (list.length) await (await api()).del(list).catch(() => {});
    }
  };
}
/** @typedef {ReturnType<typeof blobBackups>} BlobBackups */

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
      return { statusCode: 200, stream: new Response(f.body).body, blob: { etag: f.etag, size: String(f.body).length } };
    },
    async put(path, body, opt) {
      const f = files.get(path);
      if (opt.ifMatch !== undefined && (!f || f.etag !== opt.ifMatch)) throw err('BlobPreconditionFailedError', 'precondition failed');
      if (f && opt.allowOverwrite === false) throw err('BlobError', 'already exists');
      const etag = '"e' + ++n + '"';
      files.set(path, { body, etag, at: new Date() });
      return { pathname: path, etag };
    },
    async del(paths) { for (const p of [].concat(paths)) files.delete(p); },
    async list(opt = {}) {
      return { hasMore: false, blobs: [...files].filter(([p]) => !opt.prefix || p.startsWith(opt.prefix)).map(([pathname, f]) => ({ pathname, size: String(f.body).length, uploadedAt: f.at })) };
    },
    isPrecondition: (e) => e && e.name === 'BlobPreconditionFailedError'
  };
}
