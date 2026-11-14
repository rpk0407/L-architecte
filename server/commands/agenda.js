// @ts-check
// The agenda: holds, bookings (online and at the counter), moves, statuses, cancellations, blocks,
// the walk-in queue and the waiting list.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, day, id, oneOf, parse } from '../lib/validate.js';
import { freeSlots, isFree, staffIntervals, canDo, busyIntervals, intersect, subtract } from '../domain/availability.js';
import { normPhone, capFirst } from '../lib/util.js';
import { depositFor, memberCovers, clientMayChange, payWindowMin } from '../domain/policy.js';
import { bookedWords } from '../../shared/membership-words.js';
import { rootOf } from '../domain/membership.js';
import { riskDeposit } from '../domain/risk.js';
import { queueMessage, apptVars } from '../domain/messages.js';
import { mailConfirmation, mailCancellation, mailOwner } from '../domain/mails.js';
import { getStaff, getAppt, getClient, snapshotServices, totalDur, totalPrice, needChair } from './common.js';
import { upsertClient } from './clients.js';
import { fold } from '../domain/client-search.js';
import { diffDays, fmtTime } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
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
 * @param {Record<string, string>|null} [extra] words of the text that say more (a child's name, everyone of a booking)
 */
function confirmText(s, ctx, a, clientPhone, first, typed, extra) {
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
  if (extra) Object.assign(vars, extra);
  queueMessage(s, ctx, { key: 'conf_' + a.id + '_' + (a.moves || 0), template: 'confirmation', to: clientPhone, cid: a.clientId, apptId: a.id, vars });
}

/* ---------------- holds: a slot kept for a few minutes while the client types ---------------- */

/** Slots one visitor of the site may keep at once: the one he is on, and two left behind by a tab or a change of mind. */
export const HOLDS_PER_VISITOR = 3;
// party: how many people the visitor is booking together (« Ajouter une personne »): each one's slot stays kept
const holdSchema = obj({ serviceIds: serviceIds(), staffId: str({ min: 1, max: 64 }), day: day(), start: minute(), replace: opt(id()), ignoreAppt: opt(id()), party: opt(int({ min: 1, max: 4 })) });
export const holdSlot = {
  run(s, input, ctx) {
    const q = parse(holdSchema, input);
    const services = snapshotServices(s, q.serviceIds);
    if (services.some((x) => !s.services.get(x.id)?.online) && ctx.actor.t === 'client') fail(409, 'not_online', 'Cette prestation se réserve au salon.');
    const dur = totalDur(services);
    const slot = onlineSlot(s, ctx, { day: q.day, start: q.start, dur, serviceIds: q.serviceIds, staffId: q.staffId, ignoreHold: q.replace || null, ignoreAppt: q.ignoreAppt || null });
    if (!slot) fail(409, 'taken', 'Ce créneau vient d’être pris.');
    if (q.replace && s.holds.has(q.replace)) ctx.emit('hold.released', { id: q.replace });
    // one visitor keeps a few slots at most (ctx.meta.visitor: the site's keyed mark of who asks, never an address):
    // one more gives back his oldest, so a client who changes his mind is never refused and nobody empties a day
    const vk = ctx.actor.t === 'client' && ctx.meta.visitor ? String(ctx.meta.visitor).slice(0, 24) : '';
    if (vk) {
      const mine = [...s.holds.values()].filter((h) => h.vk === vk && h.exp > ctx.now && h.id !== q.replace).sort((a, b) => a.at - b.at || a.exp - b.exp);
      const cap = HOLDS_PER_VISITOR + (q.party || 1) - 1;
      for (const h of mine.slice(0, Math.max(0, mine.length - (cap - 1)))) ctx.emit('hold.released', { id: h.id });
    }
    const hid = ctx.id('ho');
    const exp = ctx.now + s.settings.booking.holdMin * 60000;
    ctx.emit('appt.held', { id: hid, staffId: slot.staffId, day: q.day, start: q.start, dur, serviceIds: q.serviceIds, exp, by: ctx.actor.t, ...(vk ? { vk } : {}) });
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

// no ':' or '/' in a name: it is written into mails, where a web address would read as the salon's own link
const nameStr = (min) => str({ min, max: 40, pattern: /^[^:/]*$/ });
/**
 * Who a place is for when it is not the booker: another adult (his first name, his phone if given: then he gets the
 * texts) or a child (first name, age if given: the parent stays the contact for everything, the child has no phone).
 */
const guestSchema = obj({ kind: oneOf(/** @type {const} */ (['other', 'child'])), first: nameStr(2), phone: opt(str({ max: 24 })), age: opt(int({ min: 0, max: 17 })) });
/** One more person in the same booking (« Ajouter une personne »): his own service, barber and slot. */
const personSchema = obj({ holdId: opt(id()), serviceIds: serviceIds(), staffId: str({ min: 1, max: 64 }), day: day(), start: minute(), guest: guestSchema });
/** People in one booking at most: a father and his sons, a mother and her children. */
export const PARTY_MAX = 4;
/** Bookings still to come one file may hold when most are for its children or guests (its own stay at 3). */
const FILE_UPCOMING_MAX = 8;
const bookSchema = obj({
  holdId: opt(id()), serviceIds: serviceIds(), staffId: str({ min: 1, max: 64 }), day: day(), start: minute(),
  first: nameStr(2), last: opt(str({ max: 40, pattern: /^[^:/]*$/ })), phone: str({ min: 6, max: 24 }), email: opt(str({ max: 120, lower: true })),
  note: opt(str({ max: 200 })), sms: opt(bool()), marketing: opt(bool()), demo: opt(bool()),
  guest: opt(guestSchema), others: opt(arr(personSchema, { max: PARTY_MAX - 1 }))
});
const overlaps = (x, y) => x.staffId === y.staffId && x.day === y.day && x.start < y.start + y.dur && y.start < x.start + x.dur;

/**
 * The chair a person of the booking gets: his hold when it still stands, else the slot as offered online now. Never one
 * an earlier person of the same booking just took (`taken`: this command's own bookings, not yet in the state).
 */
function chairFor(s, ctx, p, dur, taken) {
  const hold = p.holdId ? s.holds.get(p.holdId) : null;
  const clash = (staffId) => taken.some((t) => overlaps(t, { staffId, day: p.day, start: p.start, dur }));
  if (hold && hold.day === p.day && hold.start === p.start && hold.dur === dur && hold.exp > ctx.now - 60000 && !clash(hold.staffId)
    && isFree(s, hold.staffId, p.day, p.start, dur, { now: ctx.now, ignoreHold: hold.id })) return { staffId: hold.staffId, hold };
  const q = { day: p.day, start: p.start, dur, serviceIds: p.serviceIds, ignoreHold: hold ? hold.id : null };
  const first = onlineSlot(s, ctx, { ...q, staffId: p.staffId });
  if (first && !clash(first.staffId)) return { staffId: first.staffId, hold };
  // « peu importe »: the best chair is the one a person of this booking took, another free one will do
  if (first && p.staffId === 'any') for (const st of s.staff.values()) {
    if (clash(st.id)) continue;
    const alt = onlineSlot(s, ctx, { ...q, staffId: st.id });
    if (alt) return { staffId: alt.staffId, hold };
  }
  return null;
}

/** The child's file under this parent with that first name (a child booked again keeps his file), or null. */
function childFile(s, parentId, first) {
  const root = rootOf(s, parentId), f = fold(first).trim();
  for (const c of s.clients.values()) if (!c.erased && !c.mergedInto && c.ext && c.ext.parent && rootOf(s, c.ext.parent) === root && fold(c.first).trim() === f) return c;
  return null;
}

export const bookOnline = {
  run(s, input, ctx) {
    const b = parse(bookSchema, input);
    if (!s.settings.booking.enabled) fail(409, 'closed', 'La réservation en ligne est momentanément fermée. Appelle le salon.');
    const people = [{ holdId: b.holdId, serviceIds: b.serviceIds, staffId: b.staffId, day: b.day, start: b.start, guest: b.guest }, ...(b.others || [])];
    if (people.filter((p) => !p.guest).length > 1) fail(400, 'invalid', 'Une seule des personnes peut être toi : pour les autres, indique leur prénom.');
    const group = people.length > 1;
    const who = (p) => (group && p.guest ? ' pour ' + capFirst(p.guest.first) : '');
    // every place is checked before anything is written: all the people are booked, or none
    const taken = [];
    const plan = people.map((p, i) => {
      const services = snapshotServices(s, p.serviceIds);
      if (services.some((x) => !s.services.get(x.id)?.online)) fail(409, 'not_online', 'Cette prestation se réserve au salon.');
      // a hold taken before an early Z must not slip through
      if (s.closures.has(p.day)) fail(409, 'taken', 'Le salon a fermé ses réservations pour ce jour-là. Choisis un autre jour, tes choix sont gardés.');
      const dur = totalDur(services);
      const got = chairFor(s, ctx, p, dur, taken);
      // person: which one of the booking (in the order sent), so the site sends him back to his choice of time
      if (!got) fail(409, 'taken', 'Ce créneau' + who(p) + ' vient d’être pris. Choisis-en un autre, tes choix sont gardés.', group ? { person: i } : undefined);
      taken.push({ staffId: got.staffId, day: p.day, start: p.start, dur });
      return { p, services, dur, staffId: got.staffId, hold: got.hold };
    });
    const consent = b.marketing === true;
    const client = upsertClient(s, ctx, { first: b.first, last: b.last || '', phone: b.phone, email: b.email || '', sms: b.sms !== false, marketing: consent }, 'site');
    const existing = client.created ? null : getClient(s, client.id);
    // the proof of consent: when and where the client said yes (an unticked box takes nothing back)
    if (consent && (client.created || !existing.marketing)) ctx.emit('client.updated', { id: client.id, cid: client.id, patch: { marketing: true, marketingAt: ctx.now, marketingSrc: 'site' }, fields: [] });
    const upcoming = existing ? [...s.appts.values()].filter((a) => a.clientId === existing.id && ACTIVE.has(a.status) && diffDays(ctx.local.day, a.day) >= 0) : [];
    const own = upcoming.filter((a) => !(a.ext && a.ext.guest));
    if (existing) {
      if (plan.some((x) => !x.p.guest) && own.length >= 3) fail(409, 'too_many', 'Tu as déjà 3 rendez-vous à venir. Appelle le salon pour en ajouter.');
      if (upcoming.length + plan.length > FILE_UPCOMING_MAX) fail(409, 'too_many', 'Tu as déjà beaucoup de rendez-vous à venir. Appelle le salon pour en ajouter.');
      // an address typed on the site never lands on an existing file: the phone alone does not prove who typed it, and
      // the file's address receives every later mail with its links to move or cancel (only the salon sets it there)
    }
    const bookerPhone = existing ? existing.phone : normPhone(b.phone);
    const bookerFirst = existing ? existing.first : capFirst(b.first);
    // ctx.meta.payLive: the API says whether a deposit can really be paid online (false: production without Stripe);
    // the file found by the phone above brings its history: a client who already missed may owe one below the threshold
    const payLive = ctx.meta.payLive !== false;
    const risk = payLive && !!existing && riskDeposit(s, existing.id, ctx.local.day);
    // PAY-04: a membership only from a path that proved it (ctx.meta.memberId: the member page's signed link), and only
    // on the file the phone found, and only for the member's own place: a guest or a child pays as usual
    const mb = existing && ctx.meta.memberId ? s.members.get(String(ctx.meta.memberId)) : null;
    const member = mb && rootOf(s, mb.cid) === rootOf(s, existing.id) ? mb : null;
    const cgv = cgvVersionOf(s.settings.shop);
    const groupId = group ? ctx.id('gr') : '';
    // files made in this same command are not in the state yet: a phone or a child named twice gets one file
    const madeByPhone = new Map(), madeChild = new Map();
    const booked = plan.map((x, i) => {
      const g = x.p.guest;
      let clientId = client.id, phone = bookerPhone, first = bookerFirst, sms = b.sms !== false && !(existing && existing.sms === false), name = '', placeRisk = risk;
      /** @type {any} */
      let guest = null;
      if (g) {
        name = capFirst(g.first);
        const gp = g.kind === 'other' && g.phone ? normPhone(g.phone) : '';
        if (g.kind === 'other' && g.phone && !gp) fail(400, 'invalid', 'Le numéro de ' + name + ' n’est pas valide.');
        if (gp && gp !== bookerPhone) {
          // his own number: he gets his own texts, on his own file (found by the number, nothing of it shown back)
          let gid = madeByPhone.get(gp) || s.clientByPhone.get(gp) || null;
          const gc = gid ? s.clients.get(rootOf(s, gid)) : null;
          if (gc) gid = gc.id;
          if (!gid) { gid = upsertClient(s, ctx, { first: name, phone: gp, sms: true, marketing: false }, 'site').id; madeByPhone.set(gp, gid); }
          clientId = gid; phone = gp; first = name; sms = !(gc && gc.sms === false);
          // his own file brings its own history: a client who missed does not get past the deposit by being booked by a friend
          placeRisk = risk || (payLive && !!gc && riskDeposit(s, gc.id, ctx.local.day));
          guest = { kind: 'other', by: client.id };
        } else if (g.kind === 'child') {
          // the child's own file, linked to the parent, without a phone: the same child booked again keeps it
          const key = fold(name).trim();
          let cid = madeChild.get(key) || (existing ? childFile(s, client.id, name)?.id : null) || null;
          if (!cid) {
            cid = ctx.id('cl');
            const last = existing ? existing.last : capFirst(b.last || '');
            const notes = g.age != null ? g.age + ' ans (dit à la réservation du ' + ctx.local.day.split('-').reverse().join('/') + ')' : '';
            ctx.emit('client.added', { id: cid, cid, source: 'site', sms: false, marketing: false, tags: [], ext: { parent: client.id } }, { first: name, last, ...(notes ? { notes } : {}) });
            madeChild.set(key, cid);
          }
          guest = { kind: 'child', cid };
        } else guest = { kind: 'other' };
      }
      const price = totalPrice(x.services);
      const covered = member && !g ? memberCovers(s, member, x.services, x.p.day, upcoming) : null;
      const deposit = depositFor(s, x.services, { payLive, risk: placeRisk, ...(covered && covered.ok ? { member, day: x.p.day, upcoming } : {}) });
      const aid = ctx.id('ap');
      const code = uniqueCode(s, ctx);
      const a = {
        id: aid, code, clientId, staffId: x.staffId, anyStaff: x.p.staffId === 'any', day: x.p.day, start: x.p.start, dur: x.dur,
        services: x.services, price, source: 'site', status: deposit > 0 ? 'pending' : 'booked', sms,
        deposit: deposit > 0 ? { amount: deposit, paid: 0, paymentId: null, until: ctx.now + payWindowMin(s, { stripe: ctx.meta.payProvider === 'stripe' }) * 60000 } : null, holdId: x.hold ? x.hold.id : null, cid: clientId,
        // the CGV version in force when the client booked: the later of the owner's last rule change and the text's own date
        cgv,
        // who the place is for when not the booker, and the booking it came with (ids only: the names travel in pii)
        ...(guest || groupId ? { ext: { ...(guest ? { guest } : {}), ...(groupId ? { group: groupId } : {}) } } : {}),
        ...(b.demo && ctx.meta.demoSim === true ? { demo: true } : {})
      };
      const note = i === 0 && b.note ? b.note : '';
      ctx.emit('appt.booked', a, note || name ? { ...(note ? { note } : {}), ...(name ? { name } : {}) } : undefined);
      // a place offered from the waiting list, taken: the person leaves the list
      if (x.hold) for (const w of s.waitlist.values()) if (w.status === 'offered' && w.offer && w.offer.holdId === x.hold.id) ctx.emit('waitlist.updated', { id: w.id, patch: { status: 'booked', apptId: aid } });
      return { a, phone, first, name, guest, deposit, covered, toBooker: clientId === client.id };
    });
    const typed = b.email ? { to: b.email, first: capFirst(b.first) } : undefined;
    const forWord = (x) => (x.guest ? ' pour ' + x.name : '');
    // the texts: one confirmation to the booker listing every place he is the contact for; a guest who gave his own
    // number gets his own. A place waiting for its deposit is confirmed once paid (commands/payments.js), never before
    const mine = booked.filter((x) => x.toBooker && x.a.status === 'booked');
    if (mine.length) {
      const head = mine[0];
      // the text names who each place is for, in the words every template has ({barbier}, {prestation}):
      // « jeu. 5 nov. à 9 h avec JKut pour toi, avec Aland pour Adam, à 9 h 30 avec JKut pour Yanis »
      const barberOf = (x) => s.staff.get(x.a.staffId)?.name || 'ton barbier';
      const tail = (x) => (x.a.day !== head.a.day ? ' le ' + x.a.day.split('-').reverse().slice(0, 2).join('/') : '') + (x.a.day !== head.a.day || x.a.start !== head.a.start ? ' à ' + fmtTime(x.a.start) : '') + ' avec ' + barberOf(x) + (x.guest ? ' pour ' + x.name : ' pour toi');
      const what = (x) => x.a.services.map((y) => y.name).join(' + ') + forWord(x);
      const extra = mine.length > 1
        ? { barbier: barberOf(head) + (head.guest ? ' pour ' + head.name : ' pour toi') + mine.slice(1).map((x) => ',' + tail(x)).join(''), prestation: mine.map(what).join(', '), prix: fmtEur(mine.reduce((t, x) => t + x.a.price, 0)) }
        : head.guest ? { barbier: barberOf(head) + ' pour ' + head.name, prestation: what(head) } : null;
      confirmText(s, ctx, { ...head.a, moves: 0 }, head.phone, capFirst(b.first), typed, extra);
      const to = typed || { to: (existing && !existing.erased && existing.email) || '', first: bookerFirst };
      for (const x of mine.slice(1)) mailConfirmation(s, ctx, x.a, { ...to, link: ctx.meta.linkFor ? ctx.meta.linkFor(x.a) : '' });
    }
    for (const x of booked) if (!x.toBooker && x.a.status === 'booked') confirmText(s, ctx, { ...x.a, moves: 0 }, x.phone, x.first, typed);
    // a booking waiting for its deposit is told to the owner once paid (commands/payments.js)
    for (const x of booked) if (x.a.status === 'booked') mailOwner(s, ctx, x.a, 'booked', { first: x.name || bookerFirst });
    const view = (x) => {
      // the till applies the membership when he comes (the booking consumes nothing): the site says it is included
      const memberLine = x.covered && x.covered.ok ? { covered: true, label: 'Inclus dans ton abonnement · ' + bookedWords(member, x.covered) } : null;
      return { id: x.a.id, code: x.a.code, status: x.a.status, staffId: x.a.staffId, deposit: x.deposit, price: x.a.price, ...(memberLine ? { member: memberLine } : {}) };
    };
    const head = view(booked[0]);
    if (!group) return head;
    return { ...head, people: booked.map((x) => ({ ...view(x), first: x.guest ? x.name : capFirst(b.first), day: x.a.day, start: x.a.start, guest: x.guest ? x.guest.kind : null })) };
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
    // not before it starts, today or any day to come: an absence counts against the client (domain/risk.js) and frees the slot
    if (to === 'no_show' && (a.day > ctx.local.day || (a.day === ctx.local.day && a.start > ctx.local.min + 5))) fail(409, 'early', 'Le rendez-vous n’a pas encore commencé.');
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
/** A booking whose deposit was never paid frees its slot. reason: why, when it is not the deadline (no page to pay on). */
export const expirePending = {
  run(s, input, ctx) {
    const a = getAppt(s, input.id);
    // group: a booking of several people whose deposit page could not open (http/routes-public.js) is taken back whole,
    // the places confirmed without a deposit too: all the people are booked, or none (only by the system, only from the site)
    const undo = input.group === true && ctx.actor.t === 'system' && a.status === 'booked' && a.source === 'site' && !!(a.ext && a.ext.group);
    if (a.status !== 'pending' && !undo) return { ok: true };
    ctx.emit('appt.cancelled', { id: a.id, by: 'system', reason: input.reason ? String(input.reason).slice(0, 120) : 'Acompte non réglé', cid: a.clientId || undefined });
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
