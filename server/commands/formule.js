// @ts-check
// The weekly carnet bought with its dates (« 5 coupes sur 5 semaines d'affilée »): the slots kept together while the
// client types, the purchase itself (every date booked or none), a week booked later, and what follows a first cut
// missed while nothing was paid. A purchase from the site is ALWAYS made by a signed-in client: the file is
// ctx.meta.me.cid (http/me-kit.js runAs), never a number of the body. The carnet itself (s.packs, the cuts a client may
// take at 0 €) only ever comes from a ticket that took the money (commands/sales.js): no date gives a cut for free.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, day, id, oneOf, parse } from '../lib/validate.js';
import { isFree, canDo } from '../domain/availability.js';
import { payWindowMin, clientMayChange, payDeadline } from '../domain/policy.js';
import { busyIntervals } from '../domain/availability.js';
import { queueMessage, apptVars } from '../domain/messages.js';
import { mailConfirmation, mailOwner } from '../domain/mails.js';
import { offerOf, formuleOfAppt, formulesOfFiles, running, personOf, weeksRefusal, weeksOf, paidOnline, payState, anchorOf, endOf } from '../domain/formule.js';
import { accountOf } from '../projections/accounts.js';
import { accountsOn } from '../settings/accounts.js';
import { cgvVersionOf } from '../settings/shop.js';
import { getStaff, getClient, snapshotServices, totalDur, totalPrice, needChair } from './common.js';
import { upsertClient, fileIds } from './clients.js';
import { rootFile } from './accounts.js';
import { chairFor, onlineSlot, uniqueCode, childFile, confirmText } from './agenda.js';
import { normPhone, capFirst } from '../lib/util.js';
import { addDays, dayLong, dayParts, fmtTime, pad2 } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';

const LIVE = new Set(['pending', 'booked', 'arrived', 'in_chair']);
const minute = () => int({ min: 0, max: 1439 });
const nameStr = (min) => str({ min, max: 40, pattern: /^[^:/]*$/ });
const slotSchema = obj({ holdId: opt(id()), staffId: str({ min: 1, max: 64 }), day: day(), start: minute() });
const byTime = (a, b) => a.day.localeCompare(b.day) || a.start - b.start;

export const ACCOUNT_NEEDED = 'Cette formule demande un compte : c’est ce qui garde tes 5 coupes.';
const PERSONAL = 'Cette formule est personnelle : elle ne se prend pas pour une autre personne. Pour ton enfant, choisis « Mon enfant ».';
export const RELEASE_REASON = 'Formule non réglée : première coupe manquée';

/** The offer, or 404/409 in the client's words. */
function offerFor(s, ctx, serviceId, staffSide) {
  const offer = offerOf(s);
  if (!offer || (serviceId && serviceId !== offer.id)) fail(404, 'not_found', 'Cette formule n’est plus proposée.');
  if (!staffSide) {
    if (!offer.online) fail(409, 'not_online', 'Cette formule se prend au salon.');
    if (!s.settings.booking.enabled) fail(409, 'closed', 'La réservation en ligne est momentanément fermée. Appelle le salon.');
  }
  return /** @type {NonNullable<ReturnType<typeof offerOf>>} */ (offer);
}

/** The signed-in client's own file, with an account open on it; 401 otherwise (the site then asks for the code). */
function ownAccount(s, ctx) {
  const cid = ctx.actor.t === 'client' && ctx.meta && ctx.meta.me && ctx.meta.me.cid;
  const c = cid ? rootFile(s, cid) : null;
  if (!c || c.erased || !accountsOn(s) || !accountOf(s, fileIds(s, c))) fail(401, 'account_required', ACCOUNT_NEEDED);
  return c;
}

/* ---------------- the slots kept together ---------------- */

const holdsSchema = obj({ serviceId: opt(id()), slots: arr(obj({ staffId: str({ min: 1, max: 64 }), day: day(), start: minute() }), { min: 1, max: 10 }), replace: opt(arr(id(), { max: 12 })) });
/**
 * Keep every chosen slot of the formule while the client types his details or his code: all of them or none (`week`
 * says which one was just taken). The visitor's earlier holds go back: he is on one purchase.
 */
export const holdSeries = {
  run(s, input, ctx) {
    const q = parse(holdsSchema, input);
    const offer = offerFor(s, ctx, q.serviceId, ctx.actor.t !== 'client');
    const services = snapshotServices(s, [offer.coverId]);
    const dur = totalDur(services);
    const old = new Set(q.replace || []);
    const vk = ctx.actor.t === 'client' && ctx.meta.visitor ? String(ctx.meta.visitor).slice(0, 24) : '';
    const mine = [...s.holds.values()].filter((h) => old.has(h.id) || (vk && h.vk === vk));
    const got = q.slots.map((p, i) => {
      // his own earlier hold on that day does not stand in his way
      const same = mine.find((h) => h.day === p.day);
      const slot = onlineSlot(s, ctx, { day: p.day, start: p.start, dur, serviceIds: [offer.coverId], staffId: p.staffId, ignoreHold: same ? same.id : null });
      if (!slot) fail(409, 'taken', i ? 'Le créneau du ' + dayLong(p.day) + ' vient d’être pris. Choisis-en un autre, le reste est gardé.' : 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.', { week: i });
      return { p, staffId: slot.staffId };
    });
    for (const h of mine) ctx.emit('hold.released', { id: h.id });
    const exp = ctx.now + s.settings.booking.holdMin * 60000;
    const holds = got.map((x) => {
      const hid = ctx.id('ho');
      ctx.emit('appt.held', { id: hid, staffId: x.staffId, day: x.p.day, start: x.p.start, dur, serviceIds: [offer.coverId], exp, by: ctx.actor.t, ...(vk ? { vk } : {}) });
      return { holdId: hid, staffId: x.staffId, day: x.p.day, start: x.p.start };
    });
    return { holds, exp };
  }
};

/* ---------------- the confirmation: one text for the five dates ---------------- */

const ddmm = (d) => { const p = dayParts(d); return p.d + '/' + pad2(p.m); };
/**
 * One text listing every date (and the first date's e-mail with its calendar file). `appts`: as booked, in order.
 * @param {any} s @param {any} ctx @param {{ id: string, pay: string, price: number }} f
 * @param {any[]} appts @param {{ id: string, first: string, phone: string, email?: string, sms?: boolean }} c @param {string} [forFirst]
 */
export function confirmFormule(s, ctx, f, appts, c, forFirst = '') {
  const list = [...appts].sort(byTime);
  const head = list[0];
  if (!head) return;
  const v = apptVars(s, head, ctx.meta.linkFor);
  const sameChair = list.every((a) => a.staffId === head.staffId);
  const dates = list.map((a, i) => (i ? ddmm(a.day) : v.date) + (i && a.start === head.start ? '' : ' à ' + fmtTime(a.start)) + (sameChair ? '' : ' (' + ((s.staff.get(a.staffId) || {}).name || '') + ')')).join(', ');
  const due = f.pay === 'salon' ? ' ' + fmtEur(f.price) + ' à régler à la 1re coupe.' : '';
  const text = "L'Architecte : c'est noté {prenom} ! " + (forFirst ? 'Les ' + list.length + ' coupes de ' + forFirst : 'Tes ' + list.length + ' coupes') + (sameChair ? ' avec {barbier}' : '') + ' : ' + dates + '.' + due + ' Gérer : {lien}';
  if (s.settings.messages.confirmation && c.phone && c.sms !== false) queueMessage(s, ctx, { key: 'fconf_' + f.id, template: 'confirmation', text, to: c.phone, cid: c.id, apptId: head.id, vars: { ...v, prenom: c.first || v.prenom } });
  if (c.email) mailConfirmation(s, ctx, { ...head, status: 'booked', moves: 0 }, { to: c.email, first: c.first, link: ctx.meta.linkFor ? ctx.meta.linkFor(head) : '' });
}

/* ---------------- the purchase ---------------- */

const weekSchema = obj({ later: opt(bool()), holdId: opt(id()), staffId: opt(str({ min: 1, max: 64 })), day: opt(day()), start: opt(minute()) });
const bookSchema = obj({
  serviceId: opt(id()), first: slotSchema, weeks: arr(weekSchema, { max: 12 }),
  guest: opt(obj({ kind: oneOf(/** @type {const} */ (['other', 'child'])), first: nameStr(2), phone: opt(str({ max: 24 })), age: opt(int({ min: 0, max: 17 })) })),
  note: opt(str({ max: 200 })), sms: opt(bool()),
  // at the desk only: the client's file, or his name and number
  clientId: opt(id()), client: opt(obj({ first: str({ min: 1, max: 40 }), last: opt(str({ max: 40 })), phone: opt(str({ max: 24 })) }))
});

/**
 * Buy the formule with its dates. From the site: the signed-in client's file (ctx.meta.me), slots as offered online,
 * 80 € online when a real payment exists (every date then waits `pending` for it, as a deposit does) and at the salon
 * otherwise. From the Comptoir: any client, any free slot of a chair the person may book, paid at the first visit.
 * Every date is booked or none; `week` in a refusal says which slot went (0: the first).
 * @returns {{ id: string, pay: 'online'|'salon', amount: number, appts: { id: string, code: string, status: string, staffId: string, day: string, start: number }[] }}
 */
export const bookFormule = {
  run(s, input, ctx) {
    const b = parse(bookSchema, input);
    const staffSide = ctx.actor.t === 'staff' || ctx.actor.t === 'system';
    const offer = offerFor(s, ctx, b.serviceId, staffSide);
    const today = ctx.local.day;
    if (b.guest && b.guest.kind !== 'child') fail(400, 'personal', PERSONAL);
    // who holds it
    /** @type {{ id: string, first: string, last: string, phone: string, email: string, sms: boolean, created: boolean }} */
    let c;
    if (staffSide) {
      if (!ctx.can('agenda.own') && !ctx.can('agenda.edit')) fail(403, 'forbidden', 'Action réservée à l’équipe.');
      if (b.clientId) { const x = getClient(s, b.clientId); if (x.erased) fail(409, 'erased', 'Cette fiche a été effacée.'); c = { id: x.id, first: x.first, last: x.last || '', phone: x.phone || '', email: x.email || '', sms: x.sms !== false, created: false }; }
      else if (b.client) {
        if (b.client.phone && !normPhone(b.client.phone)) fail(400, 'invalid', 'Numéro de téléphone invalide.');
        const r = upsertClient(s, ctx, { first: b.client.first, last: b.client.last || '', phone: b.client.phone || '' }, 'salon');
        const x = r.created ? null : getClient(s, r.id);
        c = x ? { id: x.id, first: x.first, last: x.last || '', phone: x.phone || '', email: x.email || '', sms: x.sms !== false, created: false }
          : { id: r.id, first: capFirst(b.client.first), last: capFirst(b.client.last || ''), phone: normPhone(b.client.phone || ''), email: '', sms: true, created: true };
      } else fail(400, 'invalid', 'Choisis le client : la formule est à son nom.');
    } else {
      const x = ownAccount(s, ctx);
      c = { id: x.id, first: x.first, last: x.last || '', phone: x.phone || '', email: x.email || '', sms: x.sms !== false, created: false };
    }
    c = /** @type {any} */ (c);
    // the person served: the holder, or his child (the child's own file, linked to the parent, without a phone)
    /** @type {any} */
    let guest = null;
    let name = '';
    if (b.guest) {
      name = capFirst(b.guest.first);
      let kid = c.created ? null : childFile(s, c.id, name);
      let kidId = kid ? kid.id : null;
      if (!kidId) {
        kidId = ctx.id('cl');
        const notes = b.guest.age != null ? b.guest.age + ' ans (dit à la réservation du ' + today.split('-').reverse().join('/') + ')' : '';
        ctx.emit('client.added', { id: kidId, cid: kidId, source: staffSide ? 'salon' : 'site', sms: false, marketing: false, tags: [], ext: { parent: c.id } }, { first: name, last: c.last, ...(notes ? { notes } : {}) });
      }
      guest = { kind: 'child', cid: kidId };
    }
    // one formule at a time per person: the cuts left are in his space, a renewal comes after the last one
    const ids = c.created ? [] : fileIds(s, rootFile(s, c.id) || { id: c.id });
    const person = guest ? guest.cid : '';
    if (formulesOfFiles(s, ids).some((f) => running(s, f, today) && personOf(f) === person)) {
      fail(409, 'has_formule', guest ? 'Une formule est déjà en cours pour ' + name + ' : ses coupes sont dans ton espace.' : staffSide ? 'Ce client a déjà une formule en cours.' : 'Tu as déjà une formule en cours : tes coupes sont dans ton espace.');
    }
    // a carnet already paid at the desk and not started (no date, no cut): its dates are fixed now, nothing more to pay
    const linked = new Set([...s.formules.values()].map((f) => f.packId).filter(Boolean));
    const paidPack = guest ? null : [...s.packs.values()].find((k) => ids.includes(k.clientId) && k.serviceId === offer.id && !k.voided && k.used < k.total && k.expires >= today && !linked.has(k.id)) || null;
    if (paidPack && (!staffSide || paidPack.used > 0)) fail(409, 'has_formule', staffSide ? 'Ce client a déjà un carnet en cours : réserve ses coupes une à une.' : 'Tu as déjà un carnet en cours : réserve tes coupes une à une, il les paie.');

    // the dates: the first one, then one a week at most inside the formule's weeks
    const later = b.weeks.filter((w) => w.later).length;
    const picked = [b.first, ...b.weeks.filter((w) => !w.later)];
    if (picked.length + later > offer.credits || picked.some((p) => !p.day || p.start == null || !p.staffId)) fail(400, 'invalid', 'Choisis ' + offer.credits + ' rendez-vous au plus : un par semaine.');
    const refusal = weeksRefusal({ days: offer.days, credits: offer.credits }, picked.map((p) => p.day), b.first.day);
    if (refusal) fail(400, 'weeks', refusal);
    if (b.first.day < today) fail(400, 'invalid', 'Cette journée est passée.');
    const services = snapshotServices(s, [offer.coverId]);
    const dur = totalDur(services);
    const taken = [];
    const plan = picked.map((p, i) => {
      const q = { holdId: p.holdId, serviceIds: [offer.coverId], staffId: /** @type {string} */ (p.staffId), day: /** @type {string} */ (p.day), start: /** @type {number} */ (p.start) };
      const gone = i ? 'Le créneau du ' + dayLong(q.day) + ' vient d’être pris. Choisis-en un autre, le reste est gardé.' : 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.';
      if (s.closures.has(q.day)) fail(409, 'taken', 'Le salon a fermé ses réservations ' + dayLong(q.day) + '. Choisis un autre jour, le reste est gardé.', { week: i });
      let staffId, hold = null;
      if (staffSide) {
        const st = getStaff(s, q.staffId);
        needChair(ctx, st.id);
        if (!st.active || !st.chair) fail(409, 'no_chair', st.name + ' ne prend pas de rendez-vous.');
        if (!canDo(st, q.serviceIds)) fail(409, 'cannot', st.name + ' ne fait pas cette prestation.');
        if (!isFree(s, st.id, q.day, q.start, dur, { now: ctx.now })) fail(409, 'taken', 'Le créneau du ' + dayLong(q.day) + ' avec ' + st.name + ' n’est pas libre.', { week: i });
        staffId = st.id;
      } else {
        const got = chairFor(s, ctx, q, dur, taken);
        if (!got) fail(409, 'taken', gone, { week: i });
        staffId = got.staffId; hold = got.hold;
      }
      taken.push({ staffId, day: q.day, start: q.start, dur });
      return { q, staffId, hold };
    });

    const online = !staffSide && !paidPack && ctx.meta.payLive !== false;
    const until = online ? ctx.now + payWindowMin(s, { stripe: ctx.meta.payProvider === 'stripe' }) * 60000 : 0;
    const fid = ctx.id('fo');
    const cgv = cgvVersionOf(s.settings.shop);
    const price = totalPrice(services);
    const sms = b.sms !== false && c.sms !== false && !!c.phone;
    const booked = plan.map((x, i) => {
      const aid = ctx.id('ap');
      const a = {
        id: aid, code: uniqueCode(s, ctx), clientId: c.id, staffId: x.staffId, anyStaff: x.q.staffId === 'any', day: x.q.day, start: x.q.start, dur,
        services, price, source: staffSide ? 'salon' : 'site', status: online ? 'pending' : 'booked', sms,
        // the 80 € ride on the first date like a deposit: its page, its deadline, its refund; the other dates wait with it
        deposit: online && i === 0 ? { amount: offer.price, paid: 0, paymentId: null, until } : null, holdId: x.hold ? x.hold.id : null, cid: c.id, cgv,
        ext: { formule: fid, ...(online ? { until } : {}), ...(guest ? { guest } : {}) }
      };
      const note = i === 0 && b.note ? b.note : '';
      ctx.emit('appt.booked', a, note || name ? { ...(note ? { note } : {}), ...(name ? { name } : {}) } : undefined);
      return a;
    });
    const startDay = paidPack ? booked[0].day : null;
    ctx.emit('formule.booked', {
      id: fid, clientId: c.id, cid: c.id, serviceId: offer.id, coverId: offer.coverId, apptIds: booked.map((a) => a.id), credits: offer.credits, days: offer.days, missed: offer.missed,
      pay: online ? 'online' : 'salon', source: staffSide ? 'salon' : 'site', ...(guest ? { guest } : {}),
      ...(paidPack ? { packId: paidPack.id, startDay, expires: addDays(/** @type {string} */ (startDay), offer.days - 1) } : {})
    });
    if (!online) {
      confirmFormule(s, ctx, { id: fid, pay: paidPack ? 'paid' : 'salon', price: offer.price }, booked, c, name);
      if (!staffSide) mailOwner(s, ctx, booked[0], 'booked', { first: name || c.first });
    }
    return { id: fid, pay: online ? 'online' : 'salon', paid: !!paidPack, amount: offer.price, appts: booked.map((a) => ({ id: a.id, code: a.code, status: a.status, staffId: a.staffId, day: a.day, start: a.start })) };
  }
};

/* ---------------- a week booked later (« réserver cette semaine ») ---------------- */

const weekAddSchema = obj({ id: id(), holdId: opt(id()), staffId: str({ min: 1, max: 64 }), day: day(), start: minute() });
/** Whose formule a client may touch: his own file's (and what is merged into it). */
function ownFormule(s, ctx, fid) {
  const f = s.formules.get(fid);
  if (!f) fail(404, 'not_found', 'Formule introuvable.');
  if (ctx.actor.t === 'client') {
    const c = ownAccount(s, ctx);
    if (!fileIds(s, c).includes(f.clientId) && (rootFile(s, f.clientId) || {}).id !== c.id) fail(404, 'not_found', 'Formule introuvable.');
  } else if (!ctx.can('agenda.own') && !ctx.can('agenda.edit')) fail(403, 'forbidden', 'Action réservée à l’équipe.');
  return f;
}
export const addFormuleWeek = {
  run(s, input, ctx) {
    const x = parse(weekAddSchema, input);
    const f = ownFormule(s, ctx, x.id);
    const staffSide = ctx.actor.t !== 'client';
    const today = ctx.local.day;
    if (!running(s, f, today)) fail(409, 'ended', 'Cette formule est terminée.');
    if (payState(s, f) === 'pending') fail(409, 'unpaid', 'Règle d’abord la formule : ses rendez-vous attendent le paiement.');
    const w = weeksOf(s, f, today).find((k) => x.day >= k.from && x.day <= k.to);
    if (!w || w.state !== 'open') fail(409, 'weeks', !w ? 'Ta formule se termine le ' + dayLong(endOf(s, f)) + ' : choisis un jour avant.' : 'Une coupe par semaine : tu as déjà un rendez-vous cette semaine-là.');
    const pk = f.packId ? s.packs.get(f.packId) : null;
    const standing = f.apptIds.map((i) => s.appts.get(i)).filter((a) => a && (LIVE.has(a.status) || a.status === 'done'));
    if (standing.length >= f.credits || (pk && pk.used + standing.filter((a) => LIVE.has(a.status)).length >= pk.total)) fail(409, 'full', 'Tes ' + f.credits + ' coupes ont déjà leur rendez-vous.');
    const services = snapshotServices(s, [f.coverId]);
    const dur = totalDur(services);
    if (s.closures.has(x.day)) fail(409, 'taken', 'Le salon a fermé ses réservations pour ce jour-là.');
    let staffId, hold = null;
    if (staffSide) {
      const st = getStaff(s, x.staffId);
      needChair(ctx, st.id);
      if (!isFree(s, st.id, x.day, x.start, dur, { now: ctx.now })) fail(409, 'taken', 'Ce créneau n’est pas libre.');
      staffId = st.id;
    } else {
      const got = chairFor(s, ctx, { holdId: x.holdId, serviceIds: [f.coverId], staffId: x.staffId, day: x.day, start: x.start }, dur, []);
      if (!got) fail(409, 'taken', 'Ce créneau vient d’être pris. Choisis-en un autre.');
      staffId = got.staffId; hold = got.hold;
    }
    const c = getClient(s, f.clientId);
    const kid = f.guest && f.guest.cid ? s.clients.get(f.guest.cid) : null;
    const aid = ctx.id('ap');
    const a = {
      id: aid, code: uniqueCode(s, ctx), clientId: c.id, staffId, anyStaff: x.staffId === 'any', day: x.day, start: x.start, dur, services, price: totalPrice(services),
      source: staffSide ? 'salon' : 'site', status: 'booked', sms: c.sms !== false && !!c.phone, deposit: null, holdId: hold ? hold.id : null, cid: c.id, cgv: cgvVersionOf(s.settings.shop),
      ext: { formule: f.id, ...(f.guest ? { guest: f.guest } : {}) }
    };
    const name = kid && !kid.erased ? kid.first : '';
    ctx.emit('appt.booked', a, name ? { name } : undefined);
    ctx.emit('formule.apptAdded', { id: f.id, apptId: aid, cid: c.id });
    confirmText(s, ctx, { ...a, moves: 0 }, c.phone, c.first, undefined, name ? { barbier: ((s.staff.get(staffId) || {}).name || 'ton barbier') + ' pour ' + name } : null);
    return { id: aid, code: a.code, staffId, day: a.day, start: a.start };
  }
};

/* ---------------- what the other commands ask ---------------- */

/** A client moving one of its dates: one cut a week at most, inside its weeks. Returns the refusal, or ''. */
export function moveRefusal(s, a, toDay) {
  const f = formuleOfAppt(s, a.id);
  if (!f || f.status !== 'open') return '';
  const days = f.apptIds.map((i) => s.appts.get(i)).filter((x) => x && (LIVE.has(x.status) || x.status === 'done')).map((x) => (x.id === a.id ? toDay : x.day));
  return weeksRefusal(f, days, f.startDay || '');
}

/**
 * The first cut of a formule was missed (absent, or cancelled too late) and nothing was paid, neither online nor at
 * the till: the other dates go back to everyone and the client is told why, once. Returns how many were freed, or null
 * when this is not that case (something paid, a cut already done, an earlier date still standing).
 */
export function releaseIfFirstMissed(s, ctx, a) {
  const f = formuleOfAppt(s, a.id);
  if (!f || f.status !== 'open' || f.packId || paidOnline(s, f)) return null;
  const appts = f.apptIds.map((i) => s.appts.get(i)).filter(Boolean);
  if (appts.some((x) => x.status === 'done' || x.saleId)) return null;
  const standing = appts.filter((x) => x.id !== a.id && LIVE.has(x.status)).sort(byTime);
  if (standing.some((x) => byTime(x, a) < 0)) return null;
  for (const x of standing) ctx.emit('appt.cancelled', { id: x.id, by: 'system', reason: RELEASE_REASON, cid: x.clientId || undefined });
  ctx.emit('formule.released', { id: f.id, reason: RELEASE_REASON, cid: f.clientId });
  const c = s.clients.get(f.clientId);
  if (standing.length && c && !c.erased && c.phone && c.sms !== false) {
    queueMessage(s, ctx, { key: 'frel_' + f.id, template: 'formuleReleased', to: c.phone, cid: c.id, vars: { prenom: c.first || '', nombre: String(standing.length), lien: ctx.meta.siteUrl || '' } });
  }
  return { released: standing.length };
}
/** Is this booking inside the window where a cancellation counts as a missed cut? */
export const lateCancel = (s, a, now) => !clientMayChange(s, a, now);

/**
 * The 80 € paid online: the first date is confirmed by the caller (commands/payments.js); the other dates follow, each
 * one unless its slot went to someone else after the deadline; one text lists what stands.
 */
export function formulePaid(s, ctx, f, head) {
  const kept = [{ ...head, status: 'booked' }];
  for (const x of f.apptIds.map((i) => s.appts.get(i)).filter(Boolean)) {
    if (x.id === head.id || x.status !== 'pending') continue;
    const lost = payDeadline(s, x) < ctx.now && busyIntervals(s, x.staffId, x.day, { now: ctx.now, ignoreAppt: x.id }).some(([p, q]) => p < x.start + x.dur && x.start < q);
    if (lost) ctx.emit('appt.cancelled', { id: x.id, by: 'system', reason: 'Créneau repris avant le paiement', cid: x.clientId || undefined });
    else { ctx.emit('appt.confirmed', { id: x.id, cid: x.clientId || undefined }); kept.push({ ...x, status: 'booked' }); }
  }
  const c = s.clients.get(f.clientId);
  const kid = f.guest && f.guest.cid ? s.clients.get(f.guest.cid) : null;
  const sv = s.services.get(f.serviceId);
  if (c && !c.erased) confirmFormule(s, ctx, { id: f.id, pay: 'online', price: sv ? sv.price : 0 }, kept, c, kid && !kid.erased ? kid.first : '');
  if (head.source === 'site') mailOwner(s, ctx, { ...head, status: 'booked' }, 'booked');
}
/** Its first date went (unpaid in time, or paid too late): the other dates still waiting go with it. */
export function formuleUnpaid(s, ctx, f, head, reason) {
  for (const x of f.apptIds.map((i) => s.appts.get(i)).filter(Boolean)) {
    if (x.id !== head.id && x.status === 'pending') ctx.emit('appt.cancelled', { id: x.id, by: 'system', reason, cid: x.clientId || undefined });
  }
}

/* ---------------- an account for a number the salon does not know yet ---------------- */

const joinSchema = obj({ first: nameStr(2), last: opt(str({ max: 40, pattern: /^[^:/]*$/ })), phone: str({ min: 6, max: 32 }) });
/**
 * The first step of « Cette formule demande un compte » for a number with no file: the file is made (as a booking
 * would), so the sign-in code can be sent to it. Nothing for a number already on file; the answer never tells which.
 */
export const joinAccount = {
  run(s, input, ctx) {
    const x = parse(joinSchema, input);
    if (!accountsOn(s)) return { ok: false };
    const phone = normPhone(x.phone);
    if (!phone) fail(400, 'invalid', 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
    if (s.clientByPhone.get(phone)) return { ok: true, created: false };
    const r = upsertClient(s, ctx, { first: x.first, last: x.last || '', phone, sms: true, marketing: false }, 'site');
    return { ok: true, created: r.created };
  }
};

export { anchorOf };
