// @ts-check
// The weekly carnet bought with its dates (« 5 coupes sur 5 semaines d'affilée »), over HTTP:
//   site      GET  /api/public/formule/series    the dates proposed after the first one
//             POST /api/public/formule/holds     every chosen slot kept together (all or none)
//             POST /api/public/account/join      a code for a number the salon may not know yet (the account it asks for)
//   client    GET  /api/me/formule               the card of /moi; POST buys it (signed in: the file is the session's)
//             GET  /api/me/formule/:id/weeks/:k  what is free in a week without a date; POST books it
//   Comptoir  GET  /api/v1/formule/series, POST /api/v1/formules, POST /api/v1/formules/:id/weeks
// Buying it online needs the client's account: nothing here takes a file from the body.
import { HttpError, guard, limited } from './kit.js';
import { signLink } from '../auth/session.js';
import { normPhone } from '../lib/util.js';
import { isDay, addDays } from '../../shared/dates.js';
import { freeSlots } from '../domain/availability.js';
import { offerOf, proposeSeries, formulesOfFiles, formuleView, running, personOf, weeksOf } from '../domain/formule.js';
import { holdSeries, bookFormule, addFormuleWeek, joinAccount } from '../commands/formule.js';
import { expirePending } from '../commands/agenda.js';
import { CLIENT_ACTOR, DEMO_PURGE_MS, sendCode, rootFile } from '../commands/accounts.js';
import { accountOf } from '../projections/accounts.js';
import { accountsOn } from '../settings/accounts.js';
import { fileIds } from '../commands/clients.js';
import { otpCode } from '../domain/otp.js';
import { LINK_IP_PER_HOUR, LINK_PER_DAY, linkIpKey, linkPhoneKey } from '../domain/linkcap.js';
import { requireMe, isPersona, runSigningIn } from './me-kit.js';
import { isDemo, payLive, startPayment } from './routes-public.js';
import { START_MESSAGE } from './routes-me.js';
import * as sched from './scheduler.js';
import { createHmac } from 'node:crypto';

const HOUR = 3600000, DAY = 86400000;
const DEMO_BUY = 'Démo : ce compte de démonstration n’achète rien. Ouvre un espace avec ton numéro de test.';
const minuteOf = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n < 1440 ? n : null; };
const visitorOf = (r) => (r.ip ? createHmac('sha256', String(r.rt.secret)).update('lx-hold|' + r.local.day + '|' + r.ip).digest('base64url').slice(0, 12) : '');
const header = (r) => r.req.headers.get('x-request-id') || '';

/** The series proposed after a first slot, for the site (online rules) or the desk. */
function seriesOf(r, online) {
  const offer = offerOf(r.s);
  if (!offer || (online && (!offer.online || !accountsOn(r.s)))) throw new HttpError(404, 'not_found', 'Cette formule n’est plus proposée.');
  const day = r.query.get('day') || '', start = minuteOf(r.query.get('start')), staffId = r.query.get('staff') || '';
  if (!isDay(day) || start == null || !r.s.staff.get(staffId)) throw new HttpError(400, 'invalid', 'Choisis d’abord ton premier rendez-vous.');
  const weeks = proposeSeries(r.s, { serviceId: offer.coverId, staffId, day, start, weeks: offer.credits, now: r.now, local: r.local, online });
  return { weeks, credits: offer.credits, days: offer.days, end: addDays(day, offer.days - 1), missed: offer.missed, price: offer.price };
}

/** A command as the signed-in client, with what the purchase needs to know of the payment (never a file from the body). */
function asMe(r, me, what) {
  const h = header(r);
  return { actor: CLIENT_ACTOR, caps: new Set(), meta: { ...r.meta, me: { cid: me.cid }, payLive: payLive(r), payProvider: r.rt.pay.name }, ...(h ? { requestId: 'me' + me.cid + ':' + what + ':' + h } : {}) };
}

function cardOf(r, me) {
  const s = r.s;
  const offer = offerOf(s);
  const fenceFrom = me.account && me.account.fenced && me.account.historyFrom ? me.account.historyFrom : '';
  const ctx = { today: r.local.day, now: r.now, tokenFor: (a) => signLink(r.rt.secret, 'appt', a.code), receiptFor: r.meta.receiptLink };
  const all = formulesOfFiles(s, me.ids);
  const items = all.map((f) => formuleView(s, f, ctx)).filter((v) => !fenceFrom || v.start >= fenceFrom);
  const mine = all.filter((f) => !personOf(f));
  const busy = mine.some((f) => running(s, f, r.local.day));
  const sell = !!offer && offer.online && accountsOn(s);
  return {
    offer: sell ? { id: offer.id, slug: offer.slug, name: offer.name, price: offer.price, credits: offer.credits, missed: offer.missed, pay: payLive(r) ? 'online' : 'salon' } : null,
    // the open ones first, then the last finished one (its receipts stay at hand)
    items: [...items.filter((v) => v.status === 'open'), ...items.filter((v) => v.status !== 'open').slice(0, 1)],
    // « Reprendre 5 coupes »: his last one is finished and none is running
    renew: sell && !busy && mine.length > 0 && items.some((v) => !v.forFirst && v.status === 'ended'),
    demo: isPersona(me)
  };
}

export function formuleRoutes(app) {
  /* ---------------- the site ---------------- */

  app.get('/api/public/formule/series', (r) => {
    guard('fos|' + r.ip, 60, 60000);
    return seriesOf(r, true);
  });

  app.post('/api/public/formule/holds', async (r) => {
    guard('hold|' + r.ip, 30, 60000);
    guard('holdh|' + r.ip, 120, HOUR, 'Trop de créneaux regardés d’un coup. Patiente un peu, ou appelle le salon.');
    const h = header(r);
    return r.rt.engine.run(holdSeries, r.body, { actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { ...r.meta, visitor: visitorOf(r) }, ...(h ? { requestId: 'fhold:' + h } : {}) });
  });

  // « Cette formule demande un compte »: the code goes to the number typed, whose file is made if the salon does not
  // know it yet. The same words whatever the number; the code is checked by /api/public/account/verify, which signs in
  app.post('/api/public/account/join', async (r) => {
    if (!accountsOn(r.s)) throw new HttpError(409, 'disabled', 'L’espace client n’est pas encore ouvert.');
    guard(linkIpKey(r.ip), LINK_IP_PER_HOUR, HOUR, 'Trop de demandes depuis cet appareil. Réessaie dans une heure ou appelle le salon.');
    const b = r.body || {};
    const phone = normPhone(String(b.phone || '').slice(0, 32));
    if (!phone) throw new HttpError(400, 'invalid', 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
    let demoCode = null;
    // past 3 asks a day the number gets nothing more, and the asker is not told
    if (!limited(linkPhoneKey(phone), LINK_PER_DAY, DAY)) {
      const signing = runSigningIn(r, { otpCode: (msgId) => otpCode(r.rt.secret, msgId) });
      await signing(joinAccount, { first: String(b.first || '').slice(0, 40), last: b.last ? String(b.last).slice(0, 40) : undefined, phone });
      const res = await signing(sendCode, { phone });
      if (res.sent && res.msgId) {
        try { if (typeof sched.dispatchNow === 'function') await sched.dispatchNow(r.rt, [res.msgId]); } catch (e) { console.error('[lx] account join', e && /** @type {any} */ (e).message); }
      }
      // the demo sends no text: a visitor's own fresh file gets its code on the page (never a seeded client's)
      const c = res.cid ? rootFile(r.s, res.cid) : null;
      if (res.msgId && isDemo(r) && c && c.source === 'site' && !c.demo && r.now - c.createdAt < DEMO_PURGE_MS && !accountOf(r.s, fileIds(r.s, c))) demoCode = otpCode(r.rt.secret, res.msgId);
    }
    return { ok: true, message: START_MESSAGE, ...(demoCode ? { demoCode } : {}) };
  });

  /* ---------------- the signed-in client ---------------- */

  app.get('/api/me/formule', (r) => cardOf(r, requireMe(r)));

  app.post('/api/me/formule', async (r) => {
    const me = requireMe(r);
    if (isPersona(me)) throw new HttpError(409, 'demo', DEMO_BUY);
    guard('fo|' + me.cid, 8, HOUR, 'Trop d’essais d’un coup. Réessaie dans un moment, ou appelle le salon.');
    const b = r.body || {};
    const ctx = asMe(r, me, 'formule');
    const again = !!ctx.requestId && r.rt.engine.knows(ctx.actor, ctx.requestId) === 'answered';
    const res = await r.rt.engine.run(bookFormule, { serviceId: b.serviceId, first: b.first, weeks: b.weeks, guest: b.guest, note: b.note, sms: b.sms }, ctx);
    const s = r.s;
    const head = s.appts.get(res.appts[0].id);
    const token = (a) => signLink(r.rt.secret, 'appt', a.code);
    let payment = null;
    if (res.pay === 'online') {
      if (again && (!head || head.status === 'cancelled')) throw new HttpError(409, 'gone', 'Cet achat n’a pas abouti : rien n’est enregistré. Choisis tes créneaux à nouveau.');
      const open = again ? [...s.payments.values()].find((p) => p.apptId === head.id && p.kind === 'deposit' && p.status === 'pending') : null;
      if (open) payment = { id: open.id, url: open.url };
      else if (head.status === 'pending') {
        const offer = offerOf(s);
        try {
          payment = await startPayment(r, { kind: 'deposit', amount: res.amount, label: (offer ? offer.name : 'Carnet') + ' · ' + res.appts.length + ' rendez-vous', apptId: head.id, returnPath: '/r/' + token(head), email: typeof b.email === 'string' ? b.email.slice(0, 120) : undefined });
        } catch (e) {
          // no page to pay on: every date is taken back at once, and said plainly (as a booking's deposit, routes-public.js)
          console.error('[lx] formule checkout failed, dates taken back', res.id, e && (/** @type {any} */ (e).detail || /** @type {any} */ (e).message));
          try { await r.rt.engine.run(expirePending, { id: head.id, reason: 'Paiement en ligne indisponible' }, { actor: { t: 'system', id: 'payments' }, caps: new Set(), meta: r.meta }); }
          catch (e2) { console.error('[lx] formule not taken back', res.id, e2 && /** @type {any} */ (e2).message); }
          if (e && /** @type {any} */ (e).expose) throw e;
          throw new HttpError(503, 'pay_unavailable', 'Le paiement en ligne est momentanément indisponible : rien n’est enregistré et rien n’est débité. Réessaie dans un instant, ou appelle le salon.', { retry: true, phone: s.settings.shop.phone });
        }
      }
    }
    return {
      id: res.id, pay: res.pay, amount: res.amount, payment,
      appts: res.appts.map((x, i) => { const a = s.appts.get(x.id) || x; return { code: x.code, token: token(x), manage: r.origin + '/r/' + token(x), day: x.day, start: x.start, staffId: x.staffId, status: a.status, n: i + 1 }; })
    };
  });

  // a week without a date: the usual slot when it is free (same weekday, hour and barber as the others), and what else
  // is free that week
  app.get('/api/me/formule/:id/weeks/:k', (r) => {
    const me = requireMe(r);
    const s = r.s;
    const f = s.formules.get(r.params.id);
    if (!f || !formulesOfFiles(s, me.ids).includes(f)) throw new HttpError(404, 'not_found', 'Formule introuvable.');
    const w = weeksOf(s, f, r.local.day).find((x) => String(x.k) === String(r.params.k));
    if (!w || w.state !== 'open') throw new HttpError(409, 'weeks', 'Cette semaine a déjà son rendez-vous, ou elle est passée.');
    const sv = s.services.get(f.coverId);
    if (!sv) throw new HttpError(404, 'not_found', 'Prestation introuvable.');
    const dur = sv.dur + (sv.buffer || 0);
    const usual = f.apptIds.map((i) => s.appts.get(i)).filter((a) => a && a.status !== 'cancelled').sort((a, b) => b.day.localeCompare(a.day))[0] || null;
    const days = [];
    for (let d = w.from < r.local.day ? r.local.day : w.from; d <= w.to; d = addDays(d, 1)) {
      const mine = usual ? freeSlots(s, { day: d, dur, serviceIds: [sv.id], staffId: usual.staffId, now: r.now, local: r.local, online: true }) : [];
      const list = mine.length ? mine : freeSlots(s, { day: d, dur, serviceIds: [sv.id], staffId: 'any', now: r.now, local: r.local, online: true });
      if (list.length) days.push({ day: d, slots: list.map((x) => ({ m: x.m, s: x.staffId })) });
    }
    const wd = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
    let proposal = null;
    if (usual) {
      const same = days.find((d) => wd(d.day) === wd(usual.day));
      const hit = same ? same.slots.find((x) => x.m === usual.start && x.s === usual.staffId) : null;
      if (same && hit) proposal = { day: same.day, start: hit.m, staffId: hit.s };
    }
    if (!proposal && days.length) proposal = { day: days[0].day, start: days[0].slots[0].m, staffId: days[0].slots[0].s };
    const names = Object.fromEntries([...s.staff.values()].filter((x) => x.active && x.chair).map((x) => [x.id, x.name]));
    return { k: w.k, from: w.from, to: w.to, proposal, days, staff: names };
  });

  app.post('/api/me/formule/:id/weeks', async (r) => {
    const me = requireMe(r);
    if (isPersona(me)) throw new HttpError(409, 'demo', DEMO_BUY);
    guard('fow|' + me.cid, 20, HOUR, 'Trop d’essais d’un coup. Réessaie dans un moment.');
    const b = r.body || {};
    await r.rt.engine.run(addFormuleWeek, { id: r.params.id, day: b.day, start: b.start, staffId: b.staffId, holdId: b.holdId }, asMe(r, me, 'foweek'));
    return cardOf(r, me);
  });

  /* ---------------- the Comptoir: sold at the desk, its five dates in the same sheet ---------------- */

  app.get('/api/v1/formule/series', (r) => seriesOf(r, false), { cap: 'agenda.own' });
  app.post('/api/v1/formules', (r) => r.run(bookFormule, r.body), { cap: 'agenda.own' });
  app.post('/api/v1/formules/:id/weeks', (r) => r.run(addFormuleWeek, { ...r.body, id: r.params.id }), { cap: 'agenda.own' });
}
