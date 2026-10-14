// Live store for the L'Architecte demo.
// The site and the Comptoir share one append-only log of entries (bookings, holds, cancels, blocks, waits).
// State lives in memory and is snapshotted to Vercel Blob so it survives cold starts.
// Only demo data: a first name, a last-name initial, the last two phone digits, an optional note.
import { put, get } from '@vercel/blob';

const KEY = 'lx/state.json';
const TYPES = new Set(['booking', 'cancel', 'block', 'hold', 'wait']);
const KEEP_MS = 7 * 24 * 3600 * 1000;   // test data is wiped after 7 days
const MAX_ENTRIES = 800;
const RECHECK_MS = 45 * 1000;           // how often an instance looks for writes made elsewhere
const HAS_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const ACCESS = process.env.LX_BLOB_ACCESS === 'public' ? 'public' : 'private';

const STR = { id: 40, t: 8, day: 10, code: 12, f: 4, barber: 12, first: 24, init: 2, last2: 2, note: 140, hold: 40, ref: 40, by: 8, why: 12, src: 8, label: 30, moved: 40 };
const NUM = { time: [0, 1440], dur: [5, 600], exp: [0, 9e15], from: [0, 1440], to: [0, 1440] };
const BOOL = ['any', 'sms', 'mail'];

let S = null;
let loading = null;
let checkedAt = 0;
let etag = '';
let saving = Promise.resolve();
const puts = [];
const hits = new Map();

function fresh() { return { entries: [], resetAt: 0, v: 0 }; }

function prune(now) {
  const min = Math.max(S.resetAt, now - KEEP_MS);
  if (S.entries.length && (S.entries[0].at <= min || S.entries.length > MAX_ENTRIES)) {
    S.entries = S.entries.filter((x) => x.at > min).slice(-MAX_ENTRIES);
  }
}

function mergeFrom(j, now) {
  if (!j || !Array.isArray(j.entries)) return;
  if ((j.resetAt || 0) > S.resetAt) {
    S.resetAt = j.resetAt;
    S.entries = S.entries.filter((x) => x.at > S.resetAt);
  }
  const ids = new Set(S.entries.map((x) => x.id));
  let added = false;
  for (const x of j.entries) {
    if (x && x.id && !ids.has(x.id) && x.at > S.resetAt) { S.entries.push(Object.assign({}, x, { rx: now })); ids.add(x.id); added = true; }
  }
  if (added) S.entries.sort((a, b) => a.at - b.at);
  S.v = Math.max(S.v, j.v || 0);
}

async function readBlob() {
  if (!HAS_BLOB) return null;
  try {
    const r = await get(KEY, etag ? { access: ACCESS, useCache: false, ifNoneMatch: etag } : { access: ACCESS, useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    etag = r.blob.etag || '';
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) {
    return null; // first run: nothing stored yet
  }
}

async function state() {
  const now = Date.now();
  if (!S) {
    if (!loading) {
      loading = readBlob().then((j) => {
        S = fresh();
        mergeFrom(j, Date.now());
        checkedAt = Date.now();
      }).finally(() => { loading = null; });
    }
    await loading;
  } else if (HAS_BLOB && now - checkedAt > RECHECK_MS) {
    checkedAt = now;
    mergeFrom(await readBlob(), Date.now());
  }
  prune(now);
  return S;
}

// one write at a time, and no more than 90 snapshots an hour whatever happens
function persist() {
  if (!HAS_BLOB) return Promise.resolve();
  const now = Date.now();
  while (puts.length && puts[0] < now - 3600 * 1000) puts.shift();
  if (puts.length >= 90) return Promise.resolve();
  puts.push(now);
  S.v = now;
  const body = JSON.stringify({ entries: S.entries, resetAt: S.resetAt, v: S.v });
  saving = saving.then(() => put(KEY, body, {
    access: ACCESS, addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60
  })).then((out) => { if (out && out.etag) etag = out.etag; }).catch(() => {});
  return saving;
}

function limited(req, kind, max) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const k = kind + '|' + ip;
  const now = Date.now();
  const list = (hits.get(k) || []).filter((t) => t > now - 60000);
  list.push(now);
  hits.set(k, list);
  if (hits.size > 2000) hits.clear();
  return list.length > max;
}

function clean(e) {
  if (!e || typeof e !== 'object' || JSON.stringify(e).length > 2000) return null;
  const o = {};
  for (const k in STR) {
    if (e[k] == null) continue;
    if (typeof e[k] !== 'string') return null;
    o[k] = e[k].slice(0, STR[k]);
  }
  for (const k in NUM) {
    if (e[k] == null) continue;
    const n = Number(e[k]);
    if (!Number.isFinite(n) || n < NUM[k][0] || n > NUM[k][1]) return null;
    o[k] = Math.round(n);
  }
  for (const k of BOOL) if (e[k] != null) o[k] = !!e[k];
  if (!o.id || !/^[\w-]+$/.test(o.id) || !TYPES.has(o.t)) return null;
  if (o.day && !/^\d{4}-\d{2}-\d{2}$/.test(o.day)) return null;
  if ((o.t === 'booking' || o.t === 'hold' || o.t === 'block') && (!o.day || o.time == null || !o.dur || !o.barber)) return null;
  if (o.t === 'cancel' && !o.ref) return null;
  const now = Date.now();
  if (o.t === 'hold') o.exp = Math.min(o.exp || now + 300000, now + 360000);
  o.at = now;
  o.rx = now;
  return o;
}

// the last check before a booking or a hold lands: nobody else holds or owns that time
function taken(o) {
  if (o.t !== 'booking' && o.t !== 'hold') return false;
  const now = Date.now();
  const cancelled = new Set();
  const used = new Set();
  for (const x of S.entries) {
    if (x.t === 'cancel') cancelled.add(x.ref);
    if (x.t === 'booking' && x.hold) used.add(x.hold);
  }
  const end = o.time + o.dur;
  return S.entries.some((x) => {
    if (x.day !== o.day || x.barber !== o.barber || cancelled.has(x.id)) return false;
    if (x.t === 'hold') {
      if (x.id === o.hold || x.id === o.id || used.has(x.id) || x.exp <= now) return false;
    } else if (x.t !== 'booking' && x.t !== 'block') return false;
    if (o.moved && x.id === o.moved) return false;
    return x.time < end && o.time < x.time + x.dur;
  });
}

function send(res, code, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(code).json(data);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const st = await state();
      const since = Number(req.query && req.query.since) || 0;
      const list = since ? st.entries.filter((x) => (x.rx || x.at) > since) : st.entries;
      return send(res, 200, { entries: list, resetAt: st.resetAt, now: Date.now() });
    }
    if (req.method === 'POST') {
      if (limited(req, 'w', 40)) return send(res, 429, { error: 'slow down' });
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      const o = clean(body && body.entry);
      if (!o) return send(res, 400, { error: 'invalid entry' });
      const st = await state();
      if (st.entries.some((x) => x.id === o.id)) return send(res, 200, { ok: true, entries: [] });
      if (taken(o)) return send(res, 409, { error: 'taken' });
      st.entries.push(o);
      prune(Date.now());
      await persist();
      return send(res, 200, { ok: true, entries: [o] });
    }
    if (req.method === 'DELETE') {
      if (limited(req, 'd', 4)) return send(res, 429, { error: 'slow down' });
      await state();
      S = { entries: [], resetAt: Date.now(), v: Date.now() };
      await persist();
      return send(res, 200, { ok: true, resetAt: S.resetAt });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return send(res, 405, { error: 'method' });
  } catch (e) {
    return send(res, 500, { error: 'server' });
  }
}
