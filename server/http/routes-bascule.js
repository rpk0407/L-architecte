// @ts-check
// Jour J, checked (Réglages › Reprendre WordPress › Jour J): what the journal knows (the first run, the freeze, a final
// sync after it, the switch, the owner's ticks) and what only the network knows (the domain's DNS, the old addresses on the
// live domain, the old site parked out of Google). Each network check is time-boxed, cached for a minute per instance and
// never throws: a failure reads « Vérification impossible : … ». The demo checks nothing on the network.
// Also the CSV of the bookings taken here since the freeze (the return plan's list to re-enter in WordPress), the owner's
// ticks and the list of features waiting for the switch (domain/features.js). Owner only ('settings').
import dns from 'node:dns';
import { HttpError, guard } from './kit.js';
import { cutoverHold, heldByCutover, finalSync, lateBookings } from '../projections/bascule.js';
import { freezeWordpress, markSwitched, tickBascule } from '../commands/bascule.js';
import { featuresOf } from '../domain/features.js';
import { staleReason } from './scheduler.js';
import { CASES } from '../../shared/redirects.js';
import { localParts, dayParts, MONTHS_FR, hhmm } from '../../shared/dates.js';
import { fmtPhone } from '../lib/util.js';
import { csv } from '../lib/csv.js';

const DAY = 86400000;
/** The addresses Vercel gives an apex domain (the long-standing one and the newer range), and the CNAME of a subdomain, the
 *  generic one or a project's own (xxxx.vercel-dns-017.com): docs/operations.md, « DNS chez IONOS ». */
const VERCEL_A = ['76.76.21.21', '216.198.79.1'];
const VERCEL_CNAME = /\.vercel-dns(-\d+)?\.com\.?$/i;
/** a hostname with at least one dot and a letters-only ending: not an IP, not « localhost », no port, no path */
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const CACHE_MS = 60000;
const REDIRECTS_MS = 20000;
const CHECK_MS = 8000;
/** the old site's home page is read up to this much to find its robots tag */
const READ_MAX = 65536;

const pl = (n, one, many = /s$/.test(one) ? one : one + 's') => n + ' ' + (n > 1 ? many : one);
/** « 27 octobre » on the salon's calendar */
const dm = (ms) => { const p = dayParts(localParts(ms).day); return p.d + (p.d === 1 ? 'er ' : ' ') + MONTHS_FR[p.m - 1]; };
const reason = (err) => String((err && err.message) || err).slice(0, 160);

/** A promise that gives up after ms. */
function within(p, ms) {
  let timer;
  return Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(new Error('délai dépassé')), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * The domain the salon will be served on: typed (a one-off check), else the public address (unless it is Vercel's or
 * local), else the old site's last run, else the one the card remembers (the owner's browser: a fallback, never an override).
 * @param {any} s @param {any} cfg @param {string} [typed] @param {string} [remembered]
 */
export function domainOf(s, cfg, typed = '', remembered = '') {
  const host = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
  const clean = (h) => h.replace(/^(www|ancien)\./, '');
  const own = host(cfg.publicUrl || '');
  if (typed) return clean(typed.toLowerCase());
  if (own && HOSTNAME.test(own) && !/(^|\.)vercel\.app$/.test(own)) return clean(own);
  for (const id of [...(s.imports ? s.imports.order : [])].reverse()) {
    const r = s.imports.runs.get(id);
    const h = r && r.site && r.site.url ? host(r.site.url) : '';
    if (h && HOSTNAME.test(h)) return clean(h);
  }
  return remembered ? clean(remembered.toLowerCase()) : '';
}

/** The salon's own https address, not Vercel's provisional one. */
function ownAddress(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && !/(^|\.)vercel\.app$/.test(x.hostname); } catch { return false; }
}

/** A Location on the same domain, written as the cases write it: path, query and anchor. */
function local(loc, origin) {
  if (!loc) return '';
  try { const u = new URL(loc, origin); return u.origin === origin ? u.pathname + u.search + u.hash : u.href; } catch { return String(loc); }
}

/** @typedef {{ id: string, state: 'ok'|'todo'|'warn'|'err'|'info', line: string, at?: number, field?: string }} Step */

/** The DNS of the domain: Vercel's address or CNAME, else the old host's. @returns {Promise<Step>} */
async function dnsStep(rt, domain) {
  const resolve = rt.dnsResolve || ((h, t) => dns.promises.resolve(h, t));
  const [a, c] = await Promise.allSettled([within(resolve(domain, 'A'), CHECK_MS), within(resolve(domain, 'CNAME'), CHECK_MS)]);
  const ips = a.status === 'fulfilled' ? a.value.map(String) : [];
  const names = c.status === 'fulfilled' ? c.value.map(String) : [];
  if (ips.some((ip) => VERCEL_A.includes(ip)) || names.some((n) => VERCEL_CNAME.test(n))) return { id: 'dns', state: 'ok', line: domain + ' pointe vers le nouveau site.' };
  if (ips.length || names.length) return { id: 'dns', state: 'todo', line: domain + ' pointe vers ' + [...ips, ...names].join(', ') + ', pas vers le nouveau site : change les DNS chez IONOS, tableau du jour J.' };
  // neither answered: an unknown name is a step to do, anything else (a timeout, a refusing resolver) is a doubt
  const errs = [a, c].map((x) => (x.status === 'rejected' ? x.reason : null)).filter(Boolean);
  if (errs.every((e) => e && (e.code === 'ENODATA' || e.code === 'ENOTFOUND'))) return { id: 'dns', state: 'todo', line: domain + ' n’a pas d’adresse pour l’instant : change les DNS chez IONOS, tableau du jour J.' };
  return { id: 'dns', state: 'warn', line: 'Vérification impossible : ' + reason(errs[0]) };
}

/** Every old address on the live domain answers with its redirect (the cases of the end-to-end test). @returns {Promise<Step>} */
async function redirectsStep(rt, publicUrl) {
  const f = rt.fetch || fetch;
  let origin;
  try { origin = new URL(publicUrl).origin; } catch { return { id: 'redirects', state: 'todo', line: 'L’adresse du site (PUBLIC_URL) n’est pas réglée : rien à vérifier.' }; }
  const wrong = [], left = [...CASES];
  let checked = 0;
  const stop = Date.now() + REDIRECTS_MS;
  async function worker() {
    for (let c = left.shift(); c; c = left.shift()) {
      if (Date.now() > stop) { left.length = 0; return; }
      const [from, status, to] = c;
      try {
        const r = await f(origin + from, { redirect: 'manual', signal: AbortSignal.timeout(CHECK_MS) });
        const loc = local(r.headers.get('location'), origin);
        if (r.status !== status || loc !== to) wrong.push(from + ' → ' + r.status + ' ' + (loc || '(sans Location)') + ', attendu ' + status + ' ' + to);
      } catch (err) { wrong.push(from + ' → ' + reason(err)); }
      checked++;
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  if (checked < CASES.length) return { id: 'redirects', state: 'warn', line: 'Vérification impossible : ' + (CASES.length - checked) + ' adresses sur ' + CASES.length + ' n’ont pas répondu à temps.' };
  if (wrong.length) return { id: 'redirects', state: 'err', line: pl(wrong.length, 'ancienne adresse', 'anciennes adresses') + ' sur ' + CASES.length + ' ne redirige' + (wrong.length > 1 ? 'nt' : '') + ' pas comme prévu : ' + wrong.slice(0, 5).join(' ; ') + (wrong.length > 5 ? '…' : '') };
  return { id: 'redirects', state: 'ok', line: pl(CASES.length, 'ancienne adresse redirige', 'anciennes adresses redirigent') + ' comme prévu.' };
}

/** An IPv4-mapped IPv6 address (::ffff:10.0.0.1, or ::ffff:a00:1) read as the IPv4 it stands for. */
function plain(ip) {
  const d = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (d) return d[1];
  const h = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!h) return ip;
  const x = parseInt(h[1], 16), y = parseInt(h[2], 16);
  return [x >> 8, x & 255, y >> 8, y & 255].join('.');
}
/** 0.x, 10.x, 127.x, 169.254.x, 172.16-31.x, 192.168.x, 100.64-127.x, ::, ::1, fc00::/7, fe80::/10 (also written IPv4-mapped): never fetched for the owner. */
const privateIp = (raw) => { const ip = plain(String(raw).trim()); return /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || /^(::1?$|f[cd]|fe[89ab])/i.test(ip); };

/** The first bytes of a response body, no more than max: the rest is never downloaded. @param {Response} r @param {number} max */
async function head(r, max) {
  if (!r.body || typeof r.body.getReader !== 'function') return (await r.text()).slice(0, max);
  const rd = r.body.getReader(), dec = new TextDecoder();
  let out = '', n = 0;
  try {
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      n += value.length; out += dec.decode(value, { stream: true });
      if (n >= max) break;
    }
  } finally { rd.cancel().catch(() => {}); }
  return out.slice(0, max);
}

/** The old site, parked at ancien.{domain}: it answers, and Google is told to stay away. @returns {Promise<Step>} */
async function ancienStep(rt, domain) {
  const host = 'ancien.' + domain;
  const resolve = rt.dnsResolve || ((h, t) => dns.promises.resolve(h, t));
  try {
    // the host is typed by the owner: an address inside the datacenter is never read
    const got = await within(Promise.allSettled(['A', 'AAAA'].map((type) => Promise.resolve(resolve(host, type)))), CHECK_MS);
    const ips = got.flatMap((x) => (x.status === 'fulfilled' ? x.value : [])).map(String);
    // no address at all: nothing is read. An unknown name is a step to do; a resolver that failed is a doubt
    if (!ips.length) {
      const errs = got.map((x) => (x.status === 'rejected' ? x.reason : null)).filter(Boolean);
      if (errs.length && !errs.every((e) => e && (e.code === 'ENODATA' || e.code === 'ENOTFOUND'))) return { id: 'ancien', state: 'warn', line: 'Vérification impossible : ' + reason(errs[0]) };
      return { id: 'ancien', state: 'todo', line: host + ' n’existe pas encore : crée le sous-domaine chez IONOS, sur l’hébergement WordPress.' };
    }
    if (ips.some((ip) => privateIp(ip))) return { id: 'ancien', state: 'warn', line: 'Vérification impossible : ' + host + ' pointe vers une adresse privée.' };
    const r = await (rt.fetch || fetch)('https://' + host + '/', { redirect: 'manual', signal: AbortSignal.timeout(CHECK_MS), headers: { accept: 'text/html' } });
    // the sub-domain exists but sends back to the main one: WordPress's own two addresses are not yet moved to it
    if (r.status >= 300 && r.status < 400) return { id: 'ancien', state: 'todo', line: host + ' renvoie vers ' + (String(r.headers.get('location') || 'une autre adresse').slice(0, 100)) + ' : passe les deux adresses de WordPress à https://' + host + ' (Réglages › Général).' };
    if (r.status !== 200) return { id: 'ancien', state: 'todo', line: host + ' ne répond pas encore (code ' + r.status + ') : crée le sous-domaine chez IONOS, sur l’hébergement WordPress.' };
    const tag = r.headers.get('x-robots-tag') || '';
    let noindex = /noindex/i.test(tag);
    if (!noindex) {
      // the first bytes of the page only: <meta name='robots' content='noindex, nofollow'> sits in the head
      const html = await within(head(r, READ_MAX), CHECK_MS);
      noindex = [...html.matchAll(/<meta\b[^>]*>/gi)].some((m) => /name\s*=\s*["']robots["']/i.test(m[0]) && /content\s*=\s*["'][^"']*noindex/i.test(m[0]));
    }
    return noindex ? { id: 'ancien', state: 'ok', line: host + ' répond et reste hors de Google.' }
      : { id: 'ancien', state: 'warn', line: host + ' répond mais reste indexable : coche « Demander aux moteurs de recherche de ne pas indexer ce site » dans WordPress (Réglages › Lecture).' };
  } catch (err) {
    const code = err && (err.code || (err.cause && err.cause.code));
    if (code === 'ENOTFOUND') return { id: 'ancien', state: 'todo', line: host + ' n’existe pas encore : crée le sous-domaine chez IONOS, sur l’hébergement WordPress.' };
    return { id: 'ancien', state: 'warn', line: 'Vérification impossible : ' + reason(err) };
  }
}

/** One network check, never throwing, and cached for a minute per instance (key: what it was asked about). */
const memo = new WeakMap();
async function cached(rt, key, refresh, fn, id) {
  let m = memo.get(rt);
  if (!m) memo.set(rt, m = new Map());
  const hit = m.get(key);
  if (hit && !refresh && Date.now() - hit.t < CACHE_MS) return hit.v;
  /** @type {Step} */
  let v;
  try { v = await fn(); } catch (err) { v = { id, state: 'warn', line: 'Vérification impossible : ' + reason(err) }; }
  m.set(key, { t: Date.now(), v });
  return v;
}

/**
 * The bookings taken here since the freeze that WordPress does not know: booked or pending, not brought by an import. The
 * freeze is the moment WordPress stopped hearing about bookings, so the list starts there even after the switch (a switch
 * with no freeze, forced, starts at the switch).
 * @param {any} s
 */
export function takenHere(s) {
  const since = s.bascule.frozenAt || s.bascule.switchedAt;
  if (!since) return [];
  return [...s.appts.values()].filter((a) => a.source !== 'import' && !a.demo && a.createdAt > since && (a.status === 'booked' || a.status === 'pending'))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.start - b.start));
}

/** Texts waiting for the switch: queued for a client, not expired. @param {any} s @param {number} now */
export function heldQueued(s, now) {
  if (!cutoverHold(s)) return 0;
  let n = 0;
  for (const m of s.messages.values()) if (m.status === 'queued' && heldByCutover(m) && !staleReason(s, m, now)) n++;
  return n;
}

/**
 * Everything GET /api/v1/bascule returns.
 * @param {any} rt @param {{ domain?: string, remembered?: string, refresh?: boolean }} [o]
 */
export async function basculeOf(rt, o = {}) {
  const e = rt.engine;
  const s = e.state;
  const now = e.clock();
  const B = s.bascule;
  const demo = s.mode !== 'production';
  const runs = [...s.imports.order].map((id) => s.imports.runs.get(id)).filter((r) => r && r.finishedAt && !r.undoneAt);
  const first = runs[0];
  const domain = domainOf(s, rt.cfg, o.domain || '', o.remembered || '');
  const tick = (id) => B.ticks[id] || 0;
  /** @type {Step[]} */
  const steps = [];

  if (first) {
    const c = first.counts || {}, a = c.appts || {}, cl = c.clients || {};
    const made = (a.done || 0) + (a.noShow || 0) + (a.cancelled || 0) + (a.booked || 0);
    steps.push({ id: 'first-run', state: 'ok', at: first.finishedAt, line: pl(cl.added || 0, 'client') + ', ' + pl(made, 'rendez-vous') + ' · ' + dm(first.finishedAt) });
  } else steps.push({ id: 'first-run', state: 'todo', line: 'Pas de premier passage : dépose les exports de WordPress.' });

  steps.push(B.frozenAt ? { id: 'freeze', state: 'ok', at: B.frozenAt, line: 'WordPress est bloqué depuis le ' + dm(B.frozenAt) + ' à ' + hhmm(localParts(B.frozenAt).min) + '.' }
    : { id: 'freeze', state: 'todo', line: 'Dès que c’est fait sur WordPress, dis-le ici : la synchro finale devra venir après.' });

  // WordPress's own reminders, cut by hand with the freeze (the Comptoir cannot see Salon Booking's settings)
  steps.push(tick('reminders-off') ? { id: 'reminders-off', state: 'ok', at: tick('reminders-off'), line: 'Les rappels de WordPress sont coupés : dès ce soir, ce sont ceux du nouveau salon.' }
    : { id: 'reminders-off', state: B.frozenAt ? 'warn' : 'todo', line: 'Coupe les rappels SMS et e-mail de WordPress, sinon les clients en recevraient deux.' });

  const sync = finalSync(s);
  const late = lateBookings(s);
  steps.push(late ? { id: 'final-sync', state: 'err', at: sync.finishedAt, line: pl(late, 'rendez-vous pris') + ' sur WordPress après le gel : la réservation en ligne est-elle bien coupée ? Coupe-la, puis refais la synchro.' }
    : sync ? { id: 'final-sync', state: 'ok', at: sync.finishedAt, line: 'Faite à ' + hhmm(localParts(sync.finishedAt).min) + ', après le gel.' }
      : { id: 'final-sync', state: 'todo', line: B.frozenAt ? 'Refais l’export de WordPress et dépose-le : seul ce qui a changé depuis le gel est repris.' : 'Elle vient après le gel de WordPress : refais l’export et dépose-le.' });

  steps.push(tick('cold-backup') ? { id: 'cold-backup', state: 'ok', at: tick('cold-backup'), line: 'Copie rangée hors ligne, chiffrée. À effacer dans 12 mois.' }
    : { id: 'cold-backup', state: 'todo', line: 'Prends la base et le dossier wp-content de l’ancien site avant de résilier : rien d’autre ne les garde.' });

  if (demo) for (const id of ['dns', 'redirects', 'ancien']) steps.push({ id, state: 'info', line: 'Démo : rien n’est vérifié sur le réseau.' });
  else {
    const refresh = !!o.refresh;
    // side by side: the function has 30 s in all
    const [dnsS, redirS, parked] = await Promise.all([
      domain ? cached(rt, 'dns|' + domain, refresh, () => dnsStep(rt, domain), 'dns') : { id: 'dns', state: /** @type {const} */ ('todo'), line: 'Indique ton domaine pour vérifier ses DNS.', field: 'domain' },
      rt.cfg.publicUrl ? cached(rt, 'redirects|' + rt.cfg.publicUrl, refresh, () => redirectsStep(rt, rt.cfg.publicUrl), 'redirects')
        : { id: 'redirects', state: /** @type {const} */ ('todo'), line: 'L’adresse du site (PUBLIC_URL) n’est pas réglée : rien à vérifier.' },
      domain ? cached(rt, 'ancien|' + domain, refresh, () => ancienStep(rt, domain), 'ancien') : { id: 'ancien', state: /** @type {const} */ ('todo'), line: 'Indique ton domaine pour vérifier l’ancien site.', field: 'domain' }
    ]);
    steps.push(dnsS, redirS);
    // the owner's word when the check cannot say (IONOS blocks the request, the page is behind a login)
    steps.push(parked.state !== 'ok' && tick('ancien-noindex') ? { id: 'ancien', state: 'ok', at: tick('ancien-noindex'), line: 'Confirmé à la main : l’ancien site reste hors de Google.' } : parked);
  }

  const held = heldQueued(s, now);
  steps.push(B.switchedAt ? { id: 'switch', state: 'ok', at: B.switchedAt, line: 'Bascule faite le ' + dm(B.switchedAt) + '. Les rappels partent.' + (B.forced ? ' (Forcée : ' + B.forced.reason + ')' : '') }
    : { id: 'switch', state: 'todo', line: held ? pl(held, 'message attend', 'messages attendent') + ' la bascule.' : 'Aucun message n’attend la bascule.' });

  // the providers are plugged on the day, right after the DNS: before the switch that is the plan, after it a gap
  const miss = [rt.cfg.sms ? '' : 'SMS', rt.cfg.email ? '' : 'e-mail', ownAddress(rt.cfg.publicUrl) ? '' : 'adresse du site'].filter(Boolean);
  steps.push(!B.switchedAt ? { id: 'providers', state: 'info', line: 'Branchés au jour J, après les DNS' + (miss.length ? '' : ' (déjà fait)') + '.' }
    : miss.length ? { id: 'providers', state: 'todo', line: 'Il manque : ' + miss.join(', ') + '.' } : { id: 'providers', state: 'ok', line: 'SMS, e-mail et adresse du site sont branchés.' });

  steps.push(tick('app-password') ? { id: 'app-password', state: 'ok', at: tick('app-password'), line: 'Mot de passe d’application révoqué.' }
    : { id: 'app-password', state: B.switchedAt ? 'todo' : 'info', line: 'Révoque-le dans WordPress (Utilisateurs › Profil) le lendemain de la bascule.' });

  const due = B.switchedAt ? B.switchedAt + 30 * DAY : 0;
  steps.push(tick('licences') ? { id: 'licences', state: 'ok', at: tick('licences'), line: 'Licences et hébergement résiliés.' }
    : { id: 'licences', state: due && now >= due ? 'todo' : 'info', line: due && now >= due ? 'Un mois a passé : résilie les licences WordPress (thème, Salon Booking) et l’hébergement.' : 'Dans un mois : résilie les licences et l’hébergement de l’ancien site' + (due ? ' (à partir du ' + dm(due) + ').' : '.') });
  steps.push(tick('ancien-removed') ? { id: 'ancien-removed', state: 'ok', at: tick('ancien-removed'), line: 'Sous-domaine de l’ancien site supprimé.' }
    : { id: 'ancien-removed', state: 'info', line: 'Une fois les licences résiliées, ton prestataire supprime le sous-domaine ancien.' });

  const taken = takenHere(s);
  return { steps, hold: { on: cutoverHold(s), queued: held }, since: { at: B.frozenAt || B.switchedAt || 0, count: taken.length }, domain, demo };
}

// UTF-8 BOM, `;`, CRLF, no formula run in Excel (a foreign phone number, +41 79…, kept as typed): the shared writer
export { csv };
const dmy = (day) => day.split('-').reverse().join('/');

/** The return plan's CSV: date;heure;barbier;prestations;client;téléphone;e-mail;état;pris le. @param {any} s */
export function sinceCsv(s) {
  const rows = [['date', 'heure', 'barbier', 'prestations', 'client', 'téléphone', 'e-mail', 'état', 'pris le']];
  for (const a of takenHere(s)) {
    const c = a.clientId ? s.clients.get(a.clientId) : null;
    const f = c && c.mergedInto ? s.clients.get(c.mergedInto) || c : c;
    const gone = !!f && f.erased;
    const st = s.staff.get(a.staffId);
    const made = localParts(a.createdAt);
    rows.push([dmy(a.day), hhmm(a.start), st ? st.name : '', a.services.map((x) => x.name).join(' + '), gone ? 'Client effacé' : f ? [f.first, f.last].filter(Boolean).join(' ') : a.name || '',
      f && !gone ? fmtPhone(f.phone) : '', f && !gone ? f.email : '', a.status === 'pending' ? 'en attente d’acompte' : 'confirmé', dmy(made.day) + ' ' + hhmm(made.min)]);
  }
  return csv(rows);
}

/** Was this domain checked in the last minute on this instance? (then asking again costs the network nothing) */
function isCached(rt, domain) {
  const m = memo.get(rt), hit = m && m.get('dns|' + domain);
  return !!hit && Date.now() - hit.t < CACHE_MS;
}

export function basculeRoutes(app) {
  // `domain`: typed by the owner for a one-off check; `remembered`: what his browser kept, used only when nothing else names the domain
  app.get('/api/v1/bascule', (r) => {
    const clean = (k) => { const v = String(r.query.get(k) || '').trim().toLowerCase(); if (v && !HOSTNAME.test(v)) throw new HttpError(400, 'invalid', k + ' : indique un nom de domaine, par exemple barberlarchitecte.com.'); return v; };
    const domain = clean('domain'), remembered = clean('remembered');
    const refresh = r.query.get('refresh') === '1';
    // each new domain starts DNS lookups and an outgoing request: the one the config names is free, any other is paced
    const eff = domainOf(r.s, r.rt.cfg, domain, remembered);
    if (refresh || (r.s.mode === 'production' && eff && eff !== domainOf(r.s, r.rt.cfg) && !isCached(r.rt, eff))) guard('bascule|' + r.me.id, 12, 60000, 'Trop de vérifications. Réessaie dans une minute.');
    return basculeOf(r.rt, { domain, remembered, refresh });
  }, { cap: 'settings' });

  // the return plan's list: what clients booked here since the freeze (the switch once made), to re-enter in WordPress
  app.get('/api/v1/bascule/since', (r) => new Response(sinceCsv(r.s), { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="rendez-vous-pris-ici-${r.local.day}.csv"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }), { cap: 'settings' });

  // « C'est fait » on the freeze also ticks WordPress's reminders: both belong to the same gesture
  app.post('/api/v1/bascule/freeze', async (r) => {
    const out = await r.run(freezeWordpress, {});
    await r.run(tickBascule, { item: 'reminders-off', done: true });
    return out;
  }, { cap: 'settings' });
  app.post('/api/v1/bascule/switch', (r) => r.run(markSwitched, r.body), { cap: 'settings' });
  app.post('/api/v1/bascule/tick', (r) => r.run(tickBascule, r.body), { cap: 'settings' });

  // Mise en route › Nouveautés: the switches that wait for something, from each settings section's `golive`
  app.get('/api/v1/features', (r) => ({ features: featuresOf(r.s, r.rt) }), { cap: 'settings' });
}
