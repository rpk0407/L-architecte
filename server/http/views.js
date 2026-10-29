// @ts-check
// What leaves the server, per audience. Nothing is sent "just in case": a barber without the
// right sees masked phone numbers, the public site never sees a client, a booking link shows one booking.
import { maskPhone, fmtPhone, maskEmail } from '../lib/util.js';
import { staffIntervals } from '../domain/availability.js';
import { clientStats } from '../domain/insights.js';
import { ROLES } from '../domain/permissions.js';
import { ticketNo, refundNo } from '../domain/cash.js';
import { membersOf, statusOf, periodAt, graceOf, abandoned, weekUse } from '../domain/membership.js';
import { rhythmOf, perWeekOf, missedOf } from '../../shared/membership-words.js';
import { localParts, addDays } from '../../shared/dates.js';
import { cardLine, saleLoyalty } from '../domain/loyalty.js';

/** photo: the version of the person's photo (TEAM-02, /api/v1/staff/:id/photo?v=), null without one */
export function staffView(st, full = false) {
  const v = { id: st.id, name: st.name, initials: st.initials, color: st.color, role: st.role, roleLabel: ROLES[st.role], chair: !!st.chair, bookable: !!st.bookable, active: st.active, order: st.order ?? 99, bio: st.bio || '', instagram: st.instagram || '', photo: st.photoV || null };
  if (!full) return v;
  return { ...v, email: st.email || '', services: st.services, schedule: st.schedule || {}, commission: st.commission || { service: 0, product: 0 }, hasPwd: !!st.hasPwd, hasPin: !!st.hasPin };
}

export function serviceView(sv) {
  return { id: sv.id, slug: sv.slug || null, name: sv.name, short: sv.short || sv.name, category: sv.category, price: sv.price, from: !!sv.from, dur: sv.dur, buffer: sv.buffer || 0, online: sv.online !== false, deposit: sv.deposit ?? null, vat: sv.vat, order: sv.order ?? 0, description: sv.description || '', includes: sv.includes || [], tag: sv.tag || '', pack: sv.pack || null, active: sv.active };
}
export function productView(p) {
  return { id: p.id, name: p.name, price: p.price, cost: p.cost || 0, stock: p.stock || 0, low: p.low || 0, vat: p.vat, sku: p.sku || '', category: p.category || '', active: p.active };
}

/**
 * The file's memberships still running or waiting for their checkout (PAY-02): status, this month's cuts (used of of,
 * 0 = illimité), the last day this period covers, the last day a cancellation leaves, the card's label.
 * full: who manages the contracts (member.manage). A barber sees the badge and the cuts, not the card nor a payment
 * in trouble ('grace' and 'unpaid' read 'active': the till still refuses a cut nothing pays for).
 */
export function memberCards(s, cid, now, full = true) {
  const day = localParts(now).day, grace = graceOf(s);
  const out = [];
  for (const m of membersOf(s, cid)) {
    const status = abandoned(m, now) ? 'ended' : statusOf(m, day, grace);
    if (status === 'ended') continue;
    const p = periodAt(m, day, grace);
    out.push({
      id: m.id, plan: m.name, planId: m.planId, status: full || (status !== 'grace' && status !== 'unpaid') ? status : 'active', used: p ? m.uses.filter((u) => u.periodStart === p.start).length : 0, of: m.cuts,
      until: p ? addDays(p.grace && p.until ? p.until : p.end, -1) : null, cancelAt: m.cancel ? addDays(m.cancel.effective, -1) : null, card: full ? m.card || '' : '',
      // PAY-07: a weekly plan's rule and this calendar week's covered cuts (a monthly card keeps its shape)
      ...(rhythmOf(m) === 'week' ? { rhythm: 'week', perWeek: perWeekOf(m), missed: missedOf(m), week: p ? weekUse(m, day) : null } : {})
    });
  }
  return out;
}

/** A client as one line in a list or on an appointment card. now: the engine's clock (r.now), for the memberships. */
export function clientCard(s, c, caps, stats, now = Date.now()) {
  if (!c) return null;
  const st = stats ? stats.get(c.id) : null;
  const badges = [];
  if (c.erased) badges.push('effacé');
  else if (st) {
    if (st.isNew) badges.push('nouveau');
    if (st.loyal) badges.push('fidèle');
    if (st.risk) badges.push('absences');
  } else badges.push('nouveau');
  const packs = [...s.packs.values()].filter((k) => k.clientId === c.id && k.used < k.total);
  const memberships = c.erased ? [] : memberCards(s, c.id, now, caps.has('member.manage'));
  // « abonné » is the monthly membership only; the prepaid pack is a « carnet ». Before « VIP »: lists show two badges
  if (memberships.some((x) => x.status !== 'pending')) badges.push('abonné');
  if (packs.length) badges.push('carnet');
  if (c.tags && c.tags.includes('VIP')) badges.push('VIP');
  // FID-02: the stamp card when the programme runs, « récompense » first while one waits (the lists show two badges)
  const loyalty = cardLine(s, c, localParts(now).day);
  if (loyalty && loyalty.rewards) badges.unshift('récompense');
  return {
    id: c.id, first: c.first, last: c.last, name: (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim(),
    phone: caps.has('client.contact') ? fmtPhone(c.phone) : maskPhone(c.phone), hasPhone: !!c.phone, hasEmail: !!c.email,
    badges, visits: st ? st.visits : 0, lastDay: st ? st.lastDay : null, sinceLast: st ? st.sinceLast : null, cadence: st ? st.cadence : null,
    spend: st ? st.spend : 0, noShows: st ? st.noShows : 0, next: st ? st.next : null, overdue: st ? st.overdue : false, dueIn: st ? st.dueIn : null,
    tech: c.tech || '', sms: c.sms, marketing: !!c.marketing, packs: packs.map((k) => ({ id: k.id, name: k.name, used: k.used, total: k.total, expires: k.expires, serviceIds: k.serviceIds || [] })), memberships, ...(loyalty ? { loyalty } : {})
  };
}

export function clientFull(s, c, caps, stats, now = Date.now()) {
  const card = clientCard(s, c, caps, stats, now);
  return {
    ...card, email: caps.has('client.contact') ? c.email : maskEmail(c.email), notes: c.notes || '', birthday: c.birthday || '', tags: c.tags || [],
    marketing: !!c.marketing, source: c.source, createdAt: c.createdAt, erased: !!c.erased
  };
}

/** « Mourad C. », or « Ilyes (fiche de Mourad C.) » for a booking made on the old site under another first name than the file's (a father booking for his son). */
function nameOn(a, c) {
  const card = (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim();
  const typed = typedFor(a, c);
  return typed ? typed + ' (fiche de ' + card + ')' : card;
}
/** The first name typed on the old site for a booking when it is not the file's (Ilyes on Mourad's file), else ''. */
export function typedFor(a, c) {
  if (a.source !== 'import' || !a.name || !c || c.erased) return '';
  const typed = a.name.trim().split(/\s+/)[0];
  const f = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = f(typed), y = f(c.first);
  return x && y && !x.startsWith(y) && !y.startsWith(x) ? typed : '';
}

export function apptView(s, a, caps, stats, now = Date.now()) {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  return {
    id: a.id, code: a.code, staffId: a.staffId, anyStaff: a.anyStaff, day: a.day, start: a.start, dur: a.dur, services: a.services, price: a.price,
    status: a.status, source: a.source, note: a.note || '', name: c ? nameOn(a, c) : a.name || 'Client',
    client: c ? clientCard(s, c, caps, stats, now) : null, deposit: a.deposit, guarantee: a.guarantee || null, saleId: a.saleId, createdAt: a.createdAt,
    statusAt: a.statusAt || {}, cancel: a.cancel, moves: a.moves || 0, demo: !!a.demo, legacy: !!a.legacy
  };
}

export function saleView(s, x, caps) {
  const c = x.clientId ? s.clients.get(x.clientId) : null;
  const cashier = x.cashierId ? s.staff.get(x.cashierId) : null;
  return {
    id: x.id, number: x.number, ref: ticketNo(x.number), day: x.day, at: x.at, apptId: x.apptId, clientId: x.clientId,
    client: c ? (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim() : null, cashier: cashier ? cashier.name : 'Système',
    lines: x.lines.map((l) => ({ kind: l.kind, ref: l.ref, name: l.name, qty: l.qty, unit: l.unit, discount: l.discount || 0, net: l.net, staffId: l.staffId, vat: l.vat, packId: l.packId || null, memberId: l.memberId || null, reward: l.reward || null })),
    discount: x.discount && x.discountNote ? { ...x.discount, reason: x.discountNote } : x.discount, tip: x.tip, totals: x.totals, payments: x.payments.map((p) => ({ method: p.method, amount: p.amount, given: p.given, change: p.change, last4: p.last4 })),
    refunded: x.refunded, refunds: x.refundIds.map((id) => { const r = s.refunds.get(id); return r ? { id: r.id, ref: refundNo(r.number), amount: r.amount, method: r.method, reason: r.reason, at: r.at } : null; }).filter(Boolean),
    // FID-03: what this ticket did for the card (the till's done screen)
    note: x.note || '', demo: !!x.demo, loyalty: saleLoyalty(s, x)
  };
}

/** One day of the agenda as the Comptoir draws it. */
export function agendaView(s, day, caps, viewer, now) {
  const stats = clientStats(s, day, now);
  const all = caps.has('agenda.all');
  const lanes = [...s.staff.values()].filter((x) => x.active && x.chair && (all || x.id === viewer.id)).sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((x) => ({ ...staffView(x), work: staffIntervals(s, x.id, day) }));
  const ids = new Set(lanes.map((l) => l.id));
  const appts = [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && ids.has(a.staffId)).map((a) => apptView(s, a, caps, stats, now));
  const blocks = [...(s.blocksByDay.get(day) || [])].map((id) => s.blocks.get(id)).filter((b) => b && ids.has(b.staffId));
  const holds = [...s.holds.values()].filter((h) => h.day === day && h.exp > now && ids.has(h.staffId)).map((h) => ({ id: h.id, staffId: h.staffId, start: h.start, dur: h.dur, exp: h.exp, by: h.by }));
  const waitlist = [...s.waitlist.values()].filter((w) => w.day === day && (w.status === 'waiting' || w.status === 'offered')).map((w) => ({ id: w.id, first: w.first, staffId: w.staffId, serviceId: w.serviceId, from: w.from, to: w.to, status: w.status, offer: w.offer, at: w.at }));
  const queue = [...s.queue.values()].filter((q) => (q.status === 'waiting' || q.status === 'called') && now - q.at < 12 * 3600000).sort((a, b) => a.at - b.at)
    .map((q) => ({ id: q.id, name: q.name, hasPhone: !!q.phone, serviceId: q.serviceId, staffId: q.staffId, status: q.status, at: q.at, calledAt: q.calledAt || null }));
  return { day, lanes, appts, blocks, holds, waitlist, queue, closed: s.closures.has(day), closure: s.closures.get(day) || null };
}
