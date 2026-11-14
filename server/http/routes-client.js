// @ts-check
// What a client does without an account (public/mon-rendez-vous.html): find their appointment from a phone number.
// The answer never says whether the number is known: same words, same status, about the same time.
import { HttpError, guard, limited, failureGuard } from './kit.js';
import { signLink, checkLink } from '../auth/session.js';
import { contactAppts, contactCidOf, notifyOptions, viaOf, guestFirst } from '../domain/notify.js';
import { clientMayChange, startsAt } from '../domain/policy.js';
import { salonWhatsapp } from '../settings/messages.js';
import { rootFile } from '../commands/accounts.js';
import { fileIds } from '../commands/clients.js';
import { setNotifyVia, setEarlierAlert } from '../commands/me.js';
import { normPhone } from '../lib/util.js';
import { lookupAppointments } from '../commands/lookup.js';
import { LINK_IP_PER_HOUR, LINK_PER_DAY, linkIpKey, linkPhoneKey } from '../domain/linkcap.js';
import { dispatchNow } from './scheduler.js';
import { accountsOn } from '../settings/accounts.js';
import { waitUntil } from '@vercel/functions';

export const LOOKUP_MESSAGE = 'Si un rendez-vous existe à ce numéro, tu reçois un SMS dans un instant.';
const DAY_MS = 86400000, HOUR_MS = 3600000;
// a known number writes to the journal and an unknown one does not: the answer never waits for that work (it finishes
// in the background) and always leaves after this long plus a little noise, so the time it takes says nothing, on any store
const MIN_MS = 450, JITTER_MS = 200;

/**
 * AC-01: the text's last line, « Ton espace : salon.fr/moi », while the client space is open; nothing otherwise. The host
 * without its scheme (phones still make it a link), so the text for one booking stays one SMS (160 characters).
 */
export const espaceLine = (r) => (accountsOn(r.s) && r.origin ? ' Ton espace : ' + r.origin.replace(/^https?:\/\//, '') + '/moi' : '');
// the actor is chained and can never be erased: no name and no number in it (the number travels as pii)
const CLIENT = (r) => ({ actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { ...r.meta, espace: espaceLine(r) } });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** « LA-7KQ2 », « la7kq2 », « 7KQ2 » → « LA-7KQ2 » (codes are LA- and four letters or digits, lib/util.js humanCode). */
export function normCode(v) {
  const x = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const body = x.startsWith('LA') && x.length > 4 ? x.slice(2) : x;
  return body.length >= 4 ? 'LA-' + body : '';
}
const FIND_FAIL = 'Code ou numéro incorrect. Vérifie le code reçu par SMS (comme LA-7KQ2) et le numéro donné en réservant.';
/** The file of a booking's contact (who booked it), or null: a merged file is read at its root. */
const contactFile = (s, a) => { const cid = contactCidOf(a, s); return cid ? rootFile(s, cid) : null; };

/**
 * FEATURE B · What a booking's link opens about its contact: every booking still to come of the person who booked (his
 * own and those he made for a child or a friend), with what the /r/ page needs to show, move, cancel and add each one,
 * and how the salon reaches him. Built from the token's booking only: the token is the key.
 * @param {any} r @param {any} a the booking of the link
 */
export function contactView(r, a) {
  const s = r.s, now = r.rt.engine.clock();
  const c = contactFile(s, a);
  const ids = c && !c.erased ? fileIds(s, c) : [];
  const list = ids.length ? contactAppts(s, ids, now) : [];
  const sh = s.settings.shop;
  const hours = s.settings.booking.cancelUntilHours;
  const items = list.map((x) => {
    const st = s.staff.get(x.staffId);
    const pay = x.deposit && x.deposit.paymentId ? s.payments.get(x.deposit.paymentId) : null;
    return {
      token: signLink(r.rt.secret, 'appt', x.code), code: x.code, self: x.id === a.id, day: x.day, start: x.start, dur: x.dur, status: x.status,
      services: x.services.map((v) => ({ name: v.name, price: v.price, from: !!v.from })), price: x.price,
      staff: st ? { name: st.name, initials: st.initials, color: st.color } : null, anyStaff: !!x.anyStaff,
      deposit: x.deposit ? { amount: x.deposit.amount, paid: x.deposit.paid || 0, open: !!pay && pay.status === 'pending' } : null,
      canChange: clientMayChange(s, x, now), changeUntil: startsAt(x) - hours * 3600000,
      earlier: !!x.earlier, forFirst: guestFirst(s, x)
    };
  });
  return {
    items, cancelUntilHours: hours,
    notify: c && !c.erased ? { via: viaOf(s, c), options: notifyOptions(s, c) } : null,
    shop: { name: sh.name, address: [sh.address, [sh.zip, sh.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), phone: sh.phone, mapsUrl: sh.mapsUrl, whatsapp: salonWhatsapp(s.settings.messages) }
  };
}

/** The booking of a signed /r/ link, or 404. */
function apptOfLink(r) {
  const code = checkLink(r.rt.secret, 'appt', r.params.token);
  const id = code ? r.s.apptByCode.get(code) : null;
  const a = id ? r.s.appts.get(id) : null;
  if (!a) throw new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
  return a;
}
/** Commands for the contact of a link: the client actor, the file the link vouches for (never one from the body). */
function asContact(r, a, what) {
  const c = contactFile(r.s, a);
  if (!c || c.erased) throw new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
  const header = r.req.headers.get('x-request-id');
  return { actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { ...r.meta, contact: { cid: c.id } }, ...(header ? { requestId: what + ':' + c.id + ':' + header } : {}) };
}

/** @param {any} app @param {{ minMs?: number, jitterMs?: number, later?: (p: Promise<any>) => void }} [o] tests shorten the wait and await the work */
export function clientRoutes(app, o = {}) {
  const minMs = o.minMs ?? MIN_MS, jitterMs = o.jitterMs ?? JITTER_MS, later = o.later || waitUntil;

  app.post('/api/public/lookup', async (r) => {
    // one limit per device for every « send me a link » page (domain/linkcap.js), and the file's own cap in the command
    guard(linkIpKey(r.ip), LINK_IP_PER_HOUR, HOUR_MS, 'Trop de demandes depuis cet appareil. Réessaie dans une heure ou appelle le salon.');
    const phone = normPhone(String((r.body && r.body.phone) || '').slice(0, 32));
    if (!phone) throw new HttpError(400, 'invalid', 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
    const answer = wait(minMs + Math.random() * jitterMs);
    // past 3 asks a day the number gets nothing more, and the asker is not told (a 429 would say the number was tried)
    if (!limited(linkPhoneKey(phone), LINK_PER_DAY, DAY_MS)) later((async () => {
      try {
        const { id } = await r.rt.engine.run(lookupAppointments, { phone }, CLIENT(r));
        // the text leaves now, not at the next tick (a running one may be past its sending step): the client waits for it
        if (id) await dispatchNow(r.rt, [id]);
      } catch (e) {
        // a busy journal or a store hiccup must not answer differently for a known number
        console.error('[lx] lookup', e && e.message);
      }
    })());
    await answer;
    return { ok: true, message: LOOKUP_MESSAGE };
  });

  /**
   * « Retrouver mon rendez-vous » with the code of the confirmation and the number given when booking: the signed link of
   * that booking, whose page lists every booking to come of the same contact. Wrong code and wrong number answer the same
   * words; 5 wrong tries an hour per code and 10 asks an hour per device, whatever the answer.
   */
  app.post('/api/public/find', async (r) => {
    guard('find|' + r.ip, 10, HOUR_MS, 'Trop de tentatives depuis cet appareil. Réessaie dans une heure ou appelle le salon.');
    const code = normCode(r.body && r.body.code);
    const phone = normPhone(String((r.body && r.body.phone) || '').slice(0, 32));
    if (!code) throw new HttpError(400, 'invalid_code', 'Donne le code de ton rendez-vous, comme LA-7KQ2 (dans le SMS de confirmation).');
    if (!phone) throw new HttpError(400, 'invalid', 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
    const g = failureGuard('findc|' + code, 5, HOUR_MS, 'Trop d’essais pour ce code. Réessaie dans une heure ou appelle le salon.');
    const answer = wait(minMs + Math.random() * jitterMs);
    const id = r.s.apptByCode.get(code);
    const a = id ? r.s.appts.get(id) : null;
    // the number of whoever booked it, or of the person it is for: either phone may open it
    const phones = a ? [contactFile(r.s, a), a.clientId ? rootFile(r.s, a.clientId) : null].filter((x) => x && !x.erased).map((x) => x.phone) : [];
    await answer;
    if (!a || a.legacy || !phones.includes(phone)) { g.fail(); throw new HttpError(404, 'not_found', FIND_FAIL); }
    g.done();
    return { token: signLink(r.rt.secret, 'appt', a.code) };
  });

  /** Every booking to come of the link's contact (his own and those booked for someone else), and how he is reached. */
  app.get('/api/public/contact/:token', (r) => contactView(r, apptOfLink(r)));

  /** « Comment le salon te prévient » from a booking's link: { via: 'sms' | 'whatsapp' | 'email' }. */
  app.post('/api/public/contact/:token/notify', async (r) => {
    guard('cnt|' + r.ip, 30, HOUR_MS);
    const a = apptOfLink(r);
    await r.rt.engine.run(setNotifyVia, { via: r.body && r.body.via }, asContact(r, a, 'notify'));
    return contactView(r, r.s.appts.get(a.id));
  });

  /** « Préviens-moi si un créneau se libère plus tôt » on one of the contact's bookings: { code, on }. */
  app.post('/api/public/contact/:token/earlier', async (r) => {
    guard('cnt|' + r.ip, 30, HOUR_MS);
    const a = apptOfLink(r);
    const tid = r.s.apptByCode.get(normCode(r.body && r.body.code)) || '';
    await r.rt.engine.run(setEarlierAlert, { id: tid || 'none', on: !!(r.body && r.body.on) }, asContact(r, a, 'earlier'));
    return contactView(r, r.s.appts.get(a.id));
  });
}
