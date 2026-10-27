// @ts-check
// The agenda: holds, bookings (online and at the counter), moves, statuses, cancellations, blocks,
// the walk-in queue and the waiting list.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, day, id, oneOf, parse } from '../lib/validate.js';
import { freeSlots, isFree, staffIntervals, canDo, busyIntervals, intersect, subtract } from '../domain/availability.js';
import { normPhone, capFirst } from '../lib/util.js';
import { depositFor, clientMayChange, payWindowMin } from '../domain/policy.js';
import { riskDeposit } from '../domain/risk.js';
import { queueMessage, apptVars } from '../domain/messages.js';
import { mailConfirmation, mailCancellation, mailOwner } from '../domain/mails.js';
import { getStaff, getAppt, getClient, snapshotServices, totalDur, totalPrice, needChair } from './common.js';
import { upsertClient } from './clients.js';
import { diffDays } from '../../shared/dates.js';
import { cgvVersionOf } from '../settings/shop.js';

const serviceIds = () => arr(id(), { min: 1, max: 4 });
const minute = () => int({ min: 0, max: 1439 });
const ACTIVE = new Set(['pending', 'booked', 'arrived', 'in_chair']);

function uniqueCode(s, ctx) {
  for (let i = 0; i < 20; i++) { const c = ctx.code('LA'); if (!s.apptByCode.has(c)) return c; }
  return ctx.code('LA') + ctx.id('').slice(-2).toUpperCase();
}

/** A sealed day (Z done, even early) takes no booking from anyone: nothing more could be paid that day. */
function notSealed(s, day) {
  if (s.closures.has(day)) fail(409, 'day_closed', 'Cette journée est clôturée : plus aucun rendez-vous ce jour-là.');
}

/** Is that exact start offered online right now? Returns the chair that gets it. */
function onlineSlot(s, ctx, q) {
  const list = freeSlots(s, { ...q, now: ctx.now, local: ctx.local, online: true });
  return list.find((x) => x.m === q.start) || null;
}

/**
 * The confirmation: by SMS, and by e-mail with the calendar file when the client gave an address.
 * @param {string} [first] for a client created in this same batch, not yet in the state
 * @param {{ to: string, first: string }} [typed] the address typed with an online booking: it gets this booking's mail only
 */
function confirmText(s, ctx, a, clientPhone, first, typed) {
  // its own channel: a client who wants no SMS still gets the file for their agenda;
  // a booking waiting for its deposit gets it once paid (commands/payments.js), never before
  if (a.status !== 'pending') {
    const c = a.clientId ? s.clients.get(a.clientId) : null;
    const to = typed && typed.to ? typed : { to: (c && !c.erased && c.email) || '', first: (c && c.first) || first || '' };
    mailConfirmation(s, ctx, a, { ...to, link: ctx.meta.linkFor ? ctx.meta.linkFor(a) : '' });
  }
  if (!s.settings.messages.confirmation || !a.sms || !clientPhone) return;
  const vars = apptVars(s, a, ctx.meta.linkFor);
  if (first && !vars.prenom) vars.prenom = first;
  queueMessage(s, ctx, { key: 'conf_' + a.id + '_' + (a.moves || 0), template: 'confirmation', to: clientPhone, cid: a.clientId, apptId: a.id, vars });
}

/* ---------------- holds: a slot kept for a few minutes while the client types ---------------- */

const holdSchema = obj({ serviceIds: serviceIds(), staffId: str({ min: 1, max: 64 }), day: day(), start: minute(), replace: opt(id()), ignoreAppt: opt(id()) });
export const holdSlot = {
  run(s, input, ctx) {
    const q = parse(holdSchema, input);
    const services = snapshotServices(s, q.serviceIds);
    if (services.some((x) => !s.services.get(x.id)?.online) && ctx.actor.t === 'client') fail(409, 'not_online', 'Cette prestation se réserve au salon.');
    const dur = totalDur(services);
    const slot = onlineSlot(s, ctx, { day: q.day, start: q.start, dur, serviceIds: q.serviceIds, staffId: q.staffId, ignoreHold: q.replace || null, ignoreAppt: q.ignoreAppt || null });
    if (!slot) fail(409, 'taken', 'Ce créneau vient d’être pris.');
    if (q.replace && s.holds.has(q.replace)) ctx.emit('hold.released', { id: q.replace });
    const hid = ctx.id('ho');
    const exp = ctx.now + s.settings.booking.holdMin * 60000;
    ctx.emit('appt.held', { id: hid, staffId: slot.staffId, day: q.day, start: q.start, dur, serviceIds: q.serviceIds, exp, by: ctx.actor.t });
    return { holdId: hid, staffId: slot.staffId, exp };
  }
};
export const releaseHold = {
  run(s, input, ctx) {
    if (s.holds.has(input.id)) ctx.emit('hold.released', { id: input.id });
    return { ok: true };
  }
};

/* ---------------- online booking ---------------- */

const bookSchema = obj({
  holdId: opt(id()), serviceIds: serviceIds(), staffId: str({ min: 1, max: 64 }), day: day(), start: minute(),
  // no ':' or '/' in a name: it is written into mails, where a web address would read as the salon's own link
  first: str({ min: 2, max: 40, pattern: /^[^:/]*$/ }), last: opt(str({ max: 40, pattern: /^[^:/]*$/ })), phone: str({ min: 6, max: 24 }), email: opt(str({ max: 120, lower: true })),
  note: opt(str({ max: 200 })), sms: opt(bool()), marketing: opt(bool()), demo: opt(bool())
});
export const bookOnline = {
  run(s, input, ctx) {
    const b = parse(bookSchema, input);
    if (!s.settings.booking.enabled) fail(409, 'closed', 'La réservation en ligne est momentanément fermée. Appelle le salon.');
    const services = snapshotServices(s, b.serviceIds);
    if (services.some((x) => !s.services.get(x.id)?.online)) fail(409, 'not_online', 'Cette prestation se réserve au salon.');
    // a hold taken before an early Z must not slip through
    if (s.closures.has(b.day)) fail(409, 'taken', 'Le salon a fermé ses réservations pour ce jour-là. Choisis un autre jour, tes choix sont gardés.');
    const dur = totalDur(services);
    let staffId = null;
    const hold = b.holdId ? s.holds.get(b.holdId) : null;
    if (hold && hold.day === b.day && hold.start === b.start && hold.dur === dur && hold.exp > ctx.now - 60000) {
      if (isFree(s, hold.staffId, b.day, b.start, dur, { now: ctx.now, ignoreHold: hold.id })) staffId = hold.staffId;
    }
    if (!staffId) {
      const slot = onlineSlot(s, ctx, { day: b.day, start: b.start, dur, serviceIds: b.serviceIds, staffId: b.staffId, ignoreHold: hold ? hold.id : null });
      if (!slot) fail(409, 'taken', 'Ce créneau vient d’être pris. Choisis-en un autre, tes choix sont gardés.');
      staffId = slot.staffId;
    }
    const consent = b.marketing === true;
    const client = upsertClient(s, ctx, { first: b.first, last: b.last || '', phone: b.phone, email: b.email || '', sms: b.sms !== false, marketing: consent }, 'site');
    const existing = client.created ? null : getClient(s, client.id);
    // the proof of consent: when and where the client said yes (an unticked box takes nothing back)
    if (consent && (client.created || !existing.marketing)) ctx.emit('client.updated', { id: client.id, cid: client.id, patch: { marketing: true, marketingAt: ctx.now, marketingSrc: 'site' }, fields: [] });
    if (existing) {
      const upcoming = [...s.appts.values()].filter((a) => a.clientId === existing.id && ACTIVE.has(a.status) && diffDays(ctx.local.day, a.day) >= 0);
      if (upcoming.length >= 3) fail(409, 'too_many', 'Tu as déjà 3 rendez-vous à venir. Appelle le salon pour en ajouter.');
      // an address typed on the site never lands on an existing file: the phone alone does not prove who typed it, and
      // the file's address receives every later mail with its links to move or cancel (only the salon sets it there)
    }
    const price = totalPrice(services);
    // ctx.meta.payLive: the API says whether a deposit can really be paid online (false: production without Stripe);
    // the file found by the phone above brings its history: a client who already missed may owe one below the threshold
    const payLive = ctx.meta.payLive !== false;
    const deposit = depositFor(s, services, { payLive, risk: payLive && !!existing && riskDeposit(s, existing.id, ctx.local.day) });
    const aid = ctx.id('ap');
    const code = uniqueCode(s, ctx);
    const cgv = cgvVersionOf(s.settings.shop);
    const a = {
      id: aid, code, clientId: client.id, staffId, anyStaff: b.staffId === 'any', day: b.day, start: b.start, dur,
      services, price, source: 'site', status: deposit > 0 ? 'pending' : 'booked', sms: b.sms !== false,
      deposit: deposit > 0 ? { amount: deposit, paid: 0, paymentId: null, until: ctx.now + payWindowMin(s, { stripe: ctx.meta.payProvider === 'stripe' }) * 60000 } : null, holdId: hold ? hold.id : null, cid: client.id,
      // the CGV version in force when the client booked: the later of the owner's last rule change and the text's own date
      cgv,
      ...(b.demo && ctx.meta.demoSim === true ? { demo: true } : {})
    };
    ctx.emit('appt.booked', a, b.note ? { note: b.note } : undefined);
    // a place offered from the waiting list, taken: the person leaves the list
    if (hold) for (const w of s.waitlist.values()) if (w.status === 'offered' && w.offer && w.offer.holdId === hold.id) ctx.emit('waitlist.updated', { id: w.id, patch: { status: 'booked', apptId: aid } });
    const phone = existing ? existing.phone : normPhone(b.phone);
    if (a.status === 'booked') {
      // the typed address gets this booking's mail, greeted by the name typed with it (never the file's)
      confirmText(s, ctx, { ...a, moves: 0 }, phone, capFirst(b.first), b.email ? { to: b.email, first: capFirst(b.first) } : undefined);
      // a booking waiting for its deposit is told to the owner once paid (commands/payments.js)
      mailOwner(s, ctx, a, 'booked', { first: existing ? existing.first : capFirst(b.first) });
    }
    return { id: aid, code, status: a.status, staffId, deposit, price };
  }
};

/* ---------------- bookings at the counter / by phone ---------------- */

const createSchema = obj({
  clientId: opt(id()), client: opt(obj({ first: str({ min: 1, max: 40 }), last: opt(str({ max: 40 })), phone: opt(str({ max: 24 })) })),
  name: opt(str({ max: 40 })), serviceIds: serviceIds(), staffId: id(), day: day(), start: minute(), note: opt(str({ max: 300 })),
  sms: opt(bool()), force: opt(bool()), source: opt(oneOf(/** @type {const} */ (['phone', 'salon', 'walkin', 'site']))), seat: opt(bool()), demo: opt(bool())
});
export const createAppointment = {
  run(s, input, ctx) {
    const x = parse(createSchema, input);
    if (ctx.actor.t !== 'system') { if (x.source === 'site') x.source = 'salon'; delete x.demo; }
    needChair(ctx, x.staffId);
    notSealed(s, x.day);
    const st = getStaff(s, x.staffId);
    if (!st.active || !st.chair) fail(409, 'no_chair', st.name + ' ne prend pas de rendez-vous.');
    const services = snapshotServices(s, x.serviceIds);
    if (!canDo(st, x.serviceIds) && !x.force) fail(409, 'cannot', st.name + ' ne fait pas cette prestation.', { canForce: ctx.can('agenda.edit') });
    const dur = totalDur(services);
    const inHours = staffIntervals(s, st.id, x.day).some(([a, b]) => x.start >= a && x.start + dur <= b);
    const free = isFree(s, st.id, x.day, x.start, dur, { now: ctx.now });
    if (!free && !x.force) fail(409, inHours ? 'taken' : 'outside', inHours ? 'Ce créneau n’est pas libre.' : 'C’est en dehors des horaires de ' + st.name + '.', { canForce: ctx.can('agenda.edit') || ctx.staff?.id === st.id });
    if (x.force && !free && !(ctx.can('agenda.edit') || ctx.staff?.id === st.id)) fail(403, 'forbidden', 'Seul le gérant peut forcer un créneau.');
    // fileSms: the client's own « SMS de service » switch, what the booking's switch defaults to when it is not sent
    let clientId = null, phone = '', fileSms = true;
    if (x.clientId) { const c = getClient(s, x.clientId); clientId = c.id; phone = c.phone; fileSms = c.sms !== false; }
    else if (x.client) {
      const r = upsertClient(s, ctx, { first: x.client.first, last: x.client.last || '', phone: x.client.phone || '' }, x.source === 'phone' ? 'phone' : 'salon');
      clientId = r.id; phone = r.created ? normPhone(x.client.phone || '') : getClient(s, r.id).phone;
      if (!r.created) fileSms = getClient(s, r.id).sms !== false;
    }
    if (!clientId && !x.name) fail(400, 'invalid', 'Choisis un client ou indique un prénom.');
    const aid = ctx.id('ap');
    const a = {
      id: aid, code: uniqueCode(s, ctx), clientId, staffId: st.id, anyStaff: false, day: x.day, start: x.start, dur, services,
      price: totalPrice(services), source: x.source || 'salon', status: x.seat ? 'in_chair' : 'booked', sms: (x.sms ?? fileSms) !== false && !!phone, deposit: null, cid: clientId || undefined,
      ...(x.demo ? { demo: true } : {})
    };
    const pii = {};
    if (x.note) pii.note = x.note;
    if (!clientId && x.name) pii.name = x.name;
    ctx.emit('appt.booked', a, Object.keys(pii).length ? pii : undefined);
    // 'Confirmer par SMS' off stops the text only (a.sms): the e-mail with the calendar file still goes
    if (x.day >= ctx.local.day && !x.seat) confirmText(s, ctx, { ...a, moves: 0 }, phone, x.client ? capFirst(x.client.first) : undefined);
    return { id: aid, code: a.code };
  }
};

/* ---------------- moving ---------------- */

const moveSchema = obj({ id: id(), day: day(), start: minute(), staffId: opt(id()), force: opt(bool()), notify: opt(bool()) });
export const moveAppointment = {
  run(s, input, ctx) {
    const x = parse(moveSchema, input);
    const a = getAppt(s, x.id);
    if (!ACTIVE.has(a.status)) fail(409, 'closed', 'Ce rendez-vous ne peut plus être déplacé.');
    needChair(ctx, a.staffId);
    const to = x.staffId || a.staffId;
    if (to !== a.staffId) needChair(ctx, to);
    const st = getStaff(s, to);
    if (!st.active || !st.chair) fail(409, 'no_chair', st.name + ' ne prend pas de rendez-vous.');
    if (x.day === a.day && x.start === a.start && to === a.staffId) return { ok: true };
    notSealed(s, x.day);
    const free = isFree(s, to, x.day, x.start, a.dur, { now: ctx.now, ignoreAppt: a.id });
    if (!free && !x.force) fail(409, 'taken', 'Ce créneau n’est pas libre.', { canForce: ctx.can('agenda.edit') });
    if (!free && !ctx.can('agenda.edit')) fail(403, 'forbidden', 'Seul le gérant peut forcer un créneau.');
    ctx.emit('appt.moved', { id: a.id, day: x.day, start: x.start, staffId: to, from: { day: a.day, start: a.start, staffId: a.staffId }, cid: a.clientId || undefined });
    if (x.notify && a.clientId) confirmText(s, ctx, { ...a, day: x.day, start: x.start, staffId: to, moves: a.moves + 1 }, getClient(s, a.clientId).phone);
    return { ok: true };
  }
};

const clientMoveSchema = obj({ id: id(), day: day(), start: minute(), holdId: opt(id()) });
export const moveByClient = {
  run(s, input, ctx) {
    const x = parse(clientMoveSchema, input);
    const a = getAppt(s, x.id);
    if (!['booked', 'pending'].includes(a.status)) fail(409, 'closed', 'Ce rendez-vous ne peut plus être déplacé en ligne.');
    if (!clientMayChange(s, a, ctx.now)) fail(409, 'too_late', 'Il est trop tard pour déplacer en ligne. Appelle le salon.', { phone: s.settings.shop.phone });
    // moves carried over from the old site (WordPress re-import) are not the client's: only those made since count
    if (a.moves - ((a.ext && a.ext.moves) || 0) >= 3) fail(409, 'too_many', 'Ce rendez-vous a déjà été déplacé plusieurs fois. Appelle le salon.');
    const hold = x.holdId ? s.holds.get(x.holdId) : null;
    const staff = a.anyStaff ? 'any' : a.staffId;
    const slot = onlineSlot(s, ctx, { day: x.day, start: x.start, dur: a.dur, serviceIds: a.services.map((v) => v.id), staffId: staff, ignoreAppt: a.id, ignoreHold: hold ? hold.id : null });
    if (!slot) fail(409, 'taken', 'Ce créneau vient d’être pris.');
    ctx.emit('appt.moved', { id: a.id, day: x.day, start: x.start, staffId: slot.staffId, from: { day: a.day, start: a.start, staffId: a.staffId }, holdId: hold ? hold.id : undefined, by: 'client', cid: a.clientId || undefined });
    if (a.clientId) confirmText(s, ctx, { ...a, day: x.day, start: x.start, staffId: slot.staffId, moves: a.moves + 1 }, getClient(s, a.clientId).phone);
    return { ok: true, staffId: slot.staffId };
  }
};

/* ---------------- details, status, cancel ---------------- */

const updSchema = obj({ id: id(), serviceIds: opt(serviceIds()), note: opt(str({ max: 300 })), name: opt(str({ max: 40 })), dur: opt(int({ min: 5, max: 480 })), force: opt(bool()), clientId: opt(id()) });
export const updateAppointment = {
  run(s, input, ctx) {
    const x = parse(updSchema, input);
    const a = getAppt(s, x.id);
    needChair(ctx, a.staffId);
    if (!ACTIVE.has(a.status)) fail(409, 'closed', 'Ce rendez-vous est clos.');
    const patch = {};
    if (x.serviceIds) {
      const services = snapshotServices(s, x.serviceIds);
      patch.services = services; patch.price = totalPrice(services); patch.dur = totalDur(services);
    }
    if (x.dur) patch.dur = x.dur;
    if (x.clientId) { patch.clientId = getClient(s, x.clientId).id; patch.cid = patch.clientId; }
    if (patch.dur && patch.dur > a.dur && !isFree(s, a.staffId, a.day, a.start, patch.dur, { now: ctx.now, ignoreAppt: a.id }) && !x.force) {
      fail(409, 'taken', 'La nouvelle durée déborde sur le rendez-vous suivant.', { canForce: true });
    }
    const pii = {};
    if (x.note !== undefined) pii.note = x.note;
    if (x.name !== undefined) pii.name = x.name;
    if (!Object.keys(patch).length && !Object.keys(pii).length) return { ok: true };
    ctx.emit('appt.updated', { id: a.id, patch, cid: patch.cid || a.clientId || undefined }, Object.keys(pii).length ? pii : undefined);
    return { ok: true };
  }
};

const FLOW = {
  pending: ['booked', 'arrived', 'in_chair', 'no_show'],
  booked: ['arrived', 'in_chair', 'no_show'],
  arrived: ['in_chair', 'booked', 'no_show'],
  in_chair: ['arrived', 'booked'],
  no_show: ['booked']
};
export const setStatus = {
  run(s, input, ctx) {
    const a = getAppt(s, input.id);
    needChair(ctx, a.staffId);
    const to = parse(oneOf(/** @type {const} */ (['booked', 'arrived', 'in_chair', 'no_show'])), input.status);
    if (!(FLOW[a.status] || []).includes(to)) fail(409, 'flow', 'Ce changement n’est pas possible depuis « ' + a.status + ' ».');
    if (to === 'no_show' && a.day === ctx.local.day && a.start > ctx.local.min + 5) fail(409, 'early', 'Le rendez-vous n’a pas encore commencé.');
    ctx.emit('appt.status', { id: a.id, status: to, prev: a.status, cid: a.clientId || undefined });
    return { ok: true };
  }
};

const cancelSchema = obj({ id: id(), reason: opt(str({ max: 120 })), notify: opt(bool()) });
export const cancelAppointment = {
  run(s, input, ctx) {
    const x = parse(cancelSchema, input);
    const a = getAppt(s, x.id);
    needChair(ctx, a.staffId);
    if (!ACTIVE.has(a.status) && a.status !== 'no_show') fail(409, 'closed', 'Ce rendez-vous est déjà clos.');
    ctx.emit('appt.cancelled', { id: a.id, by: 'salon', reason: x.reason || '', cid: a.clientId || undefined });
    if (x.notify && a.clientId && a.day >= ctx.local.day) {
      const c = getClient(s, a.clientId);
      if (c.phone && c.sms) queueMessage(s, ctx, { key: 'cx_' + a.id, template: 'cancelled', to: c.phone, cid: c.id, apptId: a.id, vars: { ...apptVars(s, a), lien: ctx.meta.siteUrl || '' } });
      // a booking still waiting for its deposit was never sent its calendar file
      if (a.status !== 'pending') mailCancellation(s, ctx, a, { to: c.email, first: c.first, by: 'salon' });
    }
    return { ok: true, deposit: a.deposit && a.deposit.paid ? a.deposit : null };
  }
};
export const cancelByClient = {
  run(s, input, ctx) {
    const a = getAppt(s, input.id);
    if (!['booked', 'pending'].includes(a.status)) fail(409, 'closed', 'Ce rendez-vous est déjà clos.');
    if (a.status === 'booked' && !clientMayChange(s, a, ctx.now)) fail(409, 'too_late', 'Il est trop tard pour annuler en ligne. Appelle le salon.', { phone: s.settings.shop.phone });
    // the client's own words are personal data: next to the event, erased with the client
    const reason = input.reason ? String(input.reason).slice(0, 120) : '';
    ctx.emit('appt.cancelled', { id: a.id, by: 'client', cid: a.clientId || undefined }, reason ? { reason } : undefined);
    const c = a.clientId ? s.clients.get(a.clientId) : null;
    // the client's copy takes it out of their agenda; the owner hears of it. An unpaid booking was never confirmed
    // by mail nor told to the owner: nothing to take back
    if (a.status === 'booked') {
      if (c && !c.erased) mailCancellation(s, ctx, a, { to: c.email, first: c.first, by: 'client' });
      mailOwner(s, ctx, a, 'cancelled', { reason });
    }
    return { ok: true, deposit: a.deposit && a.deposit.paid ? a.deposit : null };
  }
};
/** A booking whose deposit was never paid frees its slot. */
export const expirePending = {
  run(s, input, ctx) {
    const a = getAppt(s, input.id);
    if (a.status !== 'pending') return { ok: true };
    ctx.emit('appt.cancelled', { id: a.id, by: 'system', reason: 'Acompte non réglé', cid: a.clientId || undefined });
    return { ok: true };
  }
};

/* ---------------- blocks: breaks, errands, "plus personne après 17 h" ---------------- */

const blockSchema = obj({ staffId: id(), day: day(), start: minute(), dur: opt(int({ min: 5, max: 900 })), end: opt(int({ min: 1, max: 1440 })), label: opt(str({ max: 40 })) });
export const addBlock = {
  run(s, input, ctx) {
    const x = parse(blockSchema, input);
    needChair(ctx, x.staffId);
    getStaff(s, x.staffId);
    const label = x.label || 'Pause';
    if (x.end != null) {
      // block every free span between start and end, around what is already there
      if (x.end <= x.start) fail(400, 'invalid', 'La fin doit suivre le début.');
      const work = intersect(staffIntervals(s, x.staffId, x.day), [[x.start, x.end]]);
      const spans = subtract(work, busyIntervals(s, x.staffId, x.day, { now: ctx.now })).filter(([a, b]) => b - a >= 5);
      if (!spans.length) fail(409, 'nothing', 'Il n’y a rien de libre à bloquer sur cette plage.');
      const ids = spans.map(([a, b]) => {
        const bid = ctx.id('bl');
        ctx.emit('block.added', { id: bid, staffId: x.staffId, day: x.day, start: a, dur: b - a, label });
        return bid;
      });
      return { ids };
    }
    const dur = x.dur || 30;
    const clash = [...(s.apptsByDay.get(x.day) || [])].map((i) => s.appts.get(i)).some((a) => a && a.staffId === x.staffId && ACTIVE.has(a.status) && a.start < x.start + dur && x.start < a.start + a.dur);
    if (clash) fail(409, 'taken', 'Un rendez-vous occupe déjà ce moment.');
    const bid = ctx.id('bl');
    ctx.emit('block.added', { id: bid, staffId: x.staffId, day: x.day, start: x.start, dur, label });
    return { id: bid };
  }
};
export const removeBlock = {
  run(s, input, ctx) {
    const b = s.blocks.get(input.id);
    if (!b) fail(404, 'not_found', 'Blocage introuvable.');
    needChair(ctx, b.staffId);
    ctx.emit('block.removed', { id: b.id });
    return { ok: true };
  }
};

/* ---------------- walk-ins: "La file" ---------------- */

const walkSchema = obj({ name: str({ min: 1, max: 40 }), phone: opt(str({ max: 24 })), serviceId: id(), staffId: str({ min: 1, max: 64 }), clientId: opt(id()) });
export const addWalkin = {
  run(s, input, ctx) {
    if (!ctx.can('agenda.own') && !ctx.can('agenda.edit')) fail(403, 'forbidden', 'Action réservée à l’équipe.');
    const x = parse(walkSchema, input);
    snapshotServices(s, [x.serviceId]);
    if (x.staffId !== 'any') getStaff(s, x.staffId);
    // after the Z nobody could be seated: say so at the desk, not when the barber calls them
    notSealed(s, ctx.local.day);
    const phone = x.phone ? normPhone(x.phone) : '';
    if (x.phone && !phone) fail(400, 'invalid', 'Numéro de téléphone invalide.');
    const qid = ctx.id('wq');
    ctx.emit('queue.added', { id: qid, serviceId: x.serviceId, staffId: x.staffId, clientId: x.clientId || null, cid: x.clientId || undefined }, { name: x.name, phone });
    return { id: qid };
  }
};
const queueAct = obj({ id: id(), action: oneOf(/** @type {const} */ (['call', 'seat', 'leave', 'back'])), staffId: opt(id()) });
export const updateWalkin = {
  run(s, input, ctx) {
    if (!ctx.can('agenda.own') && !ctx.can('agenda.edit')) fail(403, 'forbidden', 'Action réservée à l’équipe.');
    const x = parse(queueAct, input);
    const q = s.queue.get(x.id);
    if (!q || ['seated', 'left'].includes(q.status)) fail(404, 'not_found', 'Ce passage n’est plus dans la file.');
    if (x.action === 'leave') { ctx.emit('queue.updated', { id: q.id, patch: { status: 'left' } }); return { ok: true }; }
    if (x.action === 'back') { ctx.emit('queue.updated', { id: q.id, patch: { status: 'waiting' } }); return { ok: true }; }
    if (x.action === 'call') {
      ctx.emit('queue.updated', { id: q.id, patch: { status: 'called', calledAt: ctx.now } });
      if (q.phone) queueMessage(s, ctx, { key: 'queue_' + q.id, template: 'queue', to: q.phone, cid: q.clientId, vars: { prenom: q.name.split(' ')[0] } });
      return { ok: true };
    }
    const staffId = x.staffId || (q.staffId !== 'any' ? q.staffId : ctx.staff?.id);
    if (!staffId) fail(400, 'invalid', 'Choisis le barbier.');
    notSealed(s, ctx.local.day);
    const st = getStaff(s, staffId);
    const services = snapshotServices(s, [q.serviceId]);
    const start = Math.floor(ctx.local.min / 5) * 5;
    const aid = ctx.id('ap');
    ctx.emit('appt.booked', {
      id: aid, code: uniqueCode(s, ctx), clientId: q.clientId || null, staffId: st.id, anyStaff: false, day: ctx.local.day, start, dur: totalDur(services),
      services, price: totalPrice(services), source: 'walkin', status: 'in_chair', sms: false, deposit: null, cid: q.clientId || undefined
    }, q.clientId ? undefined : { name: q.name });
    ctx.emit('queue.updated', { id: q.id, patch: { status: 'seated', apptId: aid, seatedAt: ctx.now } });
    return { id: aid };
  }
};

/* ---------------- waiting list ---------------- */

const waitSchema = obj({ day: day(), staffId: str({ min: 1, max: 64 }), serviceId: id(), from: opt(minute()), to: opt(int({ min: 1, max: 1440 })), first: str({ min: 2, max: 40 }), phone: str({ min: 6, max: 24 }), clientId: opt(id()) });
export const addWait = {
  run(s, input, ctx) {
    if (!s.settings.booking.waitlist) fail(409, 'off', 'La liste d’attente est désactivée.');
    const x = parse(waitSchema, input);
    snapshotServices(s, [x.serviceId]);
    const phone = normPhone(x.phone);
    if (!phone) fail(400, 'invalid', 'Numéro de téléphone invalide.');
    if (x.day < ctx.local.day) fail(400, 'invalid', 'Cette journée est passée.');
    const mine = [...s.waitlist.values()].filter((w) => w.phone === phone && w.status === 'waiting');
    if (mine.some((w) => w.day === x.day)) return { ok: true, already: true };
    if (mine.length >= 3) fail(409, 'too_many', 'Tu es déjà en liste d’attente sur 3 journées.');
    const wid = ctx.id('wl');
    const cid = x.clientId || s.clientByPhone.get(phone) || null;
    ctx.emit('waitlist.added', { id: wid, day: x.day, staffId: x.staffId, serviceId: x.serviceId, from: x.from ?? 0, to: x.to ?? 1440, clientId: cid, cid: cid || undefined }, { first: x.first, phone });
    return { id: wid };
  }
};
export const removeWait = {
  run(s, input, ctx) {
    const w = s.waitlist.get(input.id);
    if (!w || w.status === 'removed') fail(404, 'not_found', 'Demande introuvable.');
    ctx.emit('waitlist.updated', { id: w.id, patch: { status: 'removed' } });
    return { ok: true };
  }
};
