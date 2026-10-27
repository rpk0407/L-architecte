// @ts-check
// TEAM-02: what is each person's own in the Comptoir. His phone, linked by a 10-minute QR (POST …/phone-link, then
// POST /api/auth/link in routes-auth.js) and removed by himself or the owner; his prefs; his photo; his agenda in his
// phone's calendar (a webcal feed read by Apple's and Google's servers: services and visit count, the client's first
// name only when he asks for it, never a number, a note or a price).
import { HttpError, guard } from './kit.js';
import { signLink, checkLink } from '../auth/session.js';
import { issuePhoneLink, setPrefs, setPhoto, revokeDevice } from '../commands/team.js';
import { prefsOf } from '../projections/staffprefs.js';
import { buildCalendar } from '../lib/ics.js';
import { addDays } from '../../shared/dates.js';

/** the feed: a week back (what was done), six weeks ahead */
const CAL_BACK = 7, CAL_AHEAD = 45;
const IMMUTABLE = 'private, max-age=31536000, immutable';

/** Himself, or `team` for a colleague. */
function selfOrTeam(r, id) {
  if (r.me.id !== id && !r.caps.has('team')) throw new HttpError(403, 'forbidden', 'Réservé au gérant.');
  const st = r.s.staff.get(id);
  if (!st) throw new HttpError(404, 'not_found', 'Membre introuvable.');
  return st;
}

/** The photo's bytes, for an active member who has one (and the version asked, when one is). */
function photoResponse(r, id) {
  const st = r.s.staff.get(id);
  const ph = st && st.active ? r.s.staffPhotos.get(id) : null;
  const v = r.query.get('v');
  if (!ph || (v && v !== String(ph.v))) throw new HttpError(404, 'not_found', 'Pas de photo.');
  const m = /^data:(image\/(?:jpeg|webp));base64,(.+)$/.exec(ph.data);
  if (!m) throw new HttpError(404, 'not_found', 'Pas de photo.');
  // the URL carries the version: a new photo is a new URL, so the old one may be kept for good
  return new Response(Buffer.from(m[2], 'base64'), { status: 200, headers: { 'content-type': m[1], 'cache-control': IMMUTABLE, 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' } });
}

const calToken = (r, staffId, gen) => signLink(r.rt.secret, 'teamcal', staffId + '~' + gen);
function calUrls(r, staffId, gen) {
  const https = r.origin + '/api/cal/team/' + calToken(r, staffId, gen) + '.ics';
  return { https, url: https.replace(/^https?:/, 'webcal:') };
}

const ord = (n) => (n === 1 ? '1re' : n + 'e');
/**
 * The feed's events: the barber's appointments in the window, a cancellation kept as cancelled. Each says the services
 * and which visit it is for the client: what came before it on his file (visits done, the old site's included, walk-in
 * tickets, and the appointments still booked ahead of it), as the Agenda counts them; the first name only with calName.
 * Exported for the tests.
 * @param {any} s @param {string} staffId @param {string} today @param {{ calName?: boolean }} prefs
 */
export function teamCalendarEvents(s, staffId, today, prefs) {
  const mine = [];
  for (let d = addDays(today, -CAL_BACK); d <= addDays(today, CAL_AHEAD); d = addDays(d, 1)) {
    for (const id of s.apptsByDay.get(d) || []) { const a = s.appts.get(id); if (a && a.staffId === staffId) mine.push(a); }
  }
  const cids = new Set(mine.map((a) => a.clientId).filter(Boolean));
  /** @type {Map<string, string[]>} each file's visits (done or still booked, not cancelled or missed), as sortable keys */
  const done = new Map();
  const add = (cid, k) => { const l = done.get(cid) || []; l.push(k); done.set(cid, l); };
  if (cids.size) {
    for (const a of s.appts.values()) if (cids.has(a.clientId) && a.status !== 'cancelled' && a.status !== 'no_show') add(a.clientId, a.day + ':' + String(a.start).padStart(4, '0'));
    // a ticket without an appointment (a walk-in rung up directly) is a visit too (domain/insights.js clientStats)
    for (const x of s.sales.values()) if (x.clientId && cids.has(x.clientId) && !x.apptId && x.lines.some((l) => l.kind === 'service')) add(x.clientId, x.day + ':0000');
  }
  return mine.sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start).map((a) => {
    const c = a.clientId ? s.clients.get(a.clientId) : null;
    const key = a.day + ':' + String(a.start).padStart(4, '0');
    const nth = c ? (done.get(c.id) || []).filter((k) => k < key).length + 1 : 0;
    const visit = nth ? ord(nth) + ' visite' : '';
    const first = prefs.calName ? (c ? (c.erased ? '' : c.first) : String(a.name || '').trim().split(/\s+/)[0]) : '';
    const what = a.services.map((x) => x.name).join(' + ');
    return {
      uid: a.id + '@larchitecte-equipe', day: a.day, start: a.start, dur: a.dur, sequence: (a.moves || 0) + (a.status === 'cancelled' ? 1 : 0),
      cancel: a.status === 'cancelled', summary: [first, what, visit].filter(Boolean).join(' · '),
      description: a.source === 'site' ? 'Réservé en ligne' : undefined
    };
  });
}

export function teamMeRoutes(app) {
  /* ---------------- my phone ---------------- */

  /** A QR for the person's own phone: valid 10 minutes, once. */
  app.post('/api/v1/staff/:id/phone-link', async (r) => {
    guard('phone-link|' + r.me.id, 20, 15 * 60000);
    const res = await r.run(issuePhoneLink, { staffId: r.params.id });
    const token = signLink(r.rt.secret, 'phone', res.staffId + '~' + res.exp.toString(36) + '~' + res.id);
    return { url: r.origin + '/comptoir/lier/' + token, exp: res.exp };
  });
  /** His linked phones (any he still has: a revoked one is gone). */
  app.get('/api/v1/staff/:id/phones', (r) => {
    const st = selfOrTeam(r, r.params.id);
    const items = [...r.s.devices.values()].filter((d) => d.personal && d.staffId === st.id && !d.revoked).sort((a, b) => b.at - a.at)
      .map((d) => ({ id: d.id, name: d.name, at: d.at, current: !!r.device && r.device.id === d.id }));
    return { items };
  });
  app.del('/api/v1/staff/:id/phones/:did', async (r) => {
    selfOrTeam(r, r.params.id);
    const d = r.s.devices.get(r.params.did);
    if (!d || !d.personal || d.staffId !== r.params.id) throw new HttpError(404, 'not_found', 'Téléphone introuvable.');
    return r.run(revokeDevice, { id: d.id });
  });

  /* ---------------- my prefs ---------------- */

  app.patch('/api/v1/prefs', async (r) => {
    // the calendar's generation is the calendar route's: a stale screen never brings an old link back
    const { cal, ...prefs } = r.body || {};
    return r.run(setPrefs, { staffId: r.me.id, prefs });
  });
  const calOn = (r) => r.s.settings.team.staffCalendar !== false;
  app.get('/api/v1/prefs/calendar', (r) => {
    const p = prefsOf(r.s, r.me);
    return { allowed: calOn(r), on: calOn(r) && p.cal > 0, ...(calOn(r) && p.cal > 0 ? calUrls(r, r.me.id, p.cal) : { url: null, https: null }) };
  });
  /** On: a new link (the old one stops answering). Off: no feed at all. */
  app.post('/api/v1/prefs/calendar', async (r) => {
    if (!calOn(r)) throw new HttpError(403, 'cal_off', 'Le salon n’a pas activé l’agenda dans le téléphone.');
    const on = r.body.on !== false;
    // the command picks the generation (above any given before) and the address is built from what it stored: a retry
    // gets the same link, a concurrent write never a stale one
    const res = await r.run(setPrefs, { staffId: r.me.id, prefs: { cal: on ? 'next' : 0 } });
    const gen = on ? (res.prefs && res.prefs.cal) || prefsOf(r.s, r.me).cal : 0;
    return { allowed: true, on, ...(on && gen ? calUrls(r, r.me.id, gen) : { url: null, https: null }) };
  });

  /* ---------------- my photo ---------------- */

  app.post('/api/v1/staff/:id/photo', (r) => r.run(setPhoto, { staffId: r.params.id, data: r.body.data }));
  app.get('/api/v1/staff/:id/photo', (r) => photoResponse(r, r.params.id));
  /** The sign-in faces: only on a salon device (a linked phone: its own person's), before anyone signs in. */
  app.get('/api/auth/photo/:id', (r) => {
    if (!r.device || (r.device.personal && r.device.staffId !== r.params.id)) throw new HttpError(404, 'not_found', 'Pas de photo.');
    return photoResponse(r, r.params.id);
  }, { auth: false });

  /* ---------------- my agenda in my phone ---------------- */

  app.get('/api/cal/team/:file', (r) => {
    guard('teamcal|' + r.ip, 60, 60000);
    const none = () => new HttpError(404, 'not_found', 'Agenda introuvable.');
    const id = checkLink(r.rt.secret, 'teamcal', String(r.params.file).replace(/\.ics$/, ''));
    const [staffId, gen] = id ? id.split('~') : [];
    const st = staffId ? r.s.staff.get(staffId) : null;
    if (!st || !st.active || !calOn(r)) throw none();
    const p = prefsOf(r.s, st);
    if (!p.cal || String(p.cal) !== gen) throw none();
    const body = buildCalendar(teamCalendarEvents(r.s, st.id, r.local.day, p), { name: r.s.settings.shop.name + ' · ' + st.name, now: r.now });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="agenda.ics"', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' } });
  }, { auth: false });
}
