// @ts-check
// What leaves the server, per audience. Nothing is sent "just in case": a barber without the
// right sees masked phone numbers, the public site never sees a client, a booking link shows one booking.
import { maskPhone, fmtPhone, maskEmail } from '../lib/util.js';
import { staffIntervals } from '../domain/availability.js';
import { clientStats } from '../domain/insights.js';
import { ROLES } from '../domain/permissions.js';
import { ticketNo, refundNo } from '../domain/cash.js';

export function staffView(st, full = false) {
  const v = { id: st.id, name: st.name, initials: st.initials, color: st.color, role: st.role, roleLabel: ROLES[st.role], chair: !!st.chair, bookable: !!st.bookable, active: st.active, order: st.order ?? 99, bio: st.bio || '', instagram: st.instagram || '', photo: st.photo || '', video: st.video || '', videoTitle: st.videoTitle || '' };
  if (!full) return v;
  return { ...v, email: st.email || '', services: st.services, schedule: st.schedule || {}, commission: st.commission || { service: 0, product: 0 }, hasPwd: !!st.hasPwd, hasPin: !!st.hasPin };
}

export function serviceView(sv) {
  return { id: sv.id, slug: sv.slug || null, name: sv.name, short: sv.short || sv.name, category: sv.category, price: sv.price, from: !!sv.from, dur: sv.dur, buffer: sv.buffer || 0, online: sv.online !== false, deposit: sv.deposit ?? null, vat: sv.vat, order: sv.order ?? 0, description: sv.description || '', includes: sv.includes || [], tag: sv.tag || '', pack: sv.pack || null, active: sv.active };
}
export function productView(p) {
  return { id: p.id, name: p.name, price: p.price, cost: p.cost || 0, stock: p.stock || 0, low: p.low || 0, vat: p.vat, sku: p.sku || '', category: p.category || '', active: p.active };
}

/** A client as one line in a list or on an appointment card. */
export function clientCard(s, c, caps, stats) {
  if (!c) return null;
  const st = stats ? stats.get(c.id) : null;
  const badges = [];
  if (c.erased) badges.push('effacé');
  else if (st) {
    if (st.isNew) badges.push('nouveau');
    if (st.loyal) badges.push('fidèle');
    if (st.risk) badges.push('absences');
  } else badges.push('nouveau');
  if (c.tags && c.tags.includes('VIP')) badges.push('VIP');
  const packs = [...s.packs.values()].filter((k) => k.clientId === c.id && k.used < k.total);
  if (packs.length) badges.push('abonné');
  return {
    id: c.id, first: c.first, last: c.last, name: (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim(),
    phone: caps.has('client.contact') ? fmtPhone(c.phone) : maskPhone(c.phone), hasPhone: !!c.phone,
    badges, visits: st ? st.visits : 0, lastDay: st ? st.lastDay : null, sinceLast: st ? st.sinceLast : null, cadence: st ? st.cadence : null,
    spend: st ? st.spend : 0, noShows: st ? st.noShows : 0, next: st ? st.next : null, overdue: st ? st.overdue : false, dueIn: st ? st.dueIn : null,
    tech: c.tech || '', sms: c.sms, packs: packs.map((k) => ({ id: k.id, name: k.name, used: k.used, total: k.total, expires: k.expires, serviceIds: k.serviceIds || [] }))
  };
}

export function clientFull(s, c, caps, stats) {
  const card = clientCard(s, c, caps, stats);
  return {
    ...card, email: caps.has('client.contact') ? c.email : maskEmail(c.email), notes: c.notes || '', birthday: c.birthday || '', tags: c.tags || [],
    marketing: !!c.marketing, source: c.source, createdAt: c.createdAt, erased: !!c.erased
  };
}

export function apptView(s, a, caps, stats) {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  return {
    id: a.id, code: a.code, staffId: a.staffId, anyStaff: a.anyStaff, day: a.day, start: a.start, dur: a.dur, services: a.services, price: a.price,
    status: a.status, source: a.source, note: a.note || '', name: c ? (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim() : a.name || 'Client',
    client: c ? clientCard(s, c, caps, stats) : null, deposit: a.deposit, guarantee: a.guarantee || null, saleId: a.saleId, createdAt: a.createdAt,
    statusAt: a.statusAt || {}, cancel: a.cancel, moves: a.moves || 0, demo: !!a.demo, legacy: !!a.legacy
  };
}

export function saleView(s, x, caps) {
  const c = x.clientId ? s.clients.get(x.clientId) : null;
  const cashier = x.cashierId ? s.staff.get(x.cashierId) : null;
  return {
    id: x.id, number: x.number, ref: ticketNo(x.number), day: x.day, at: x.at, apptId: x.apptId, clientId: x.clientId,
    client: c ? (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim() : null, cashier: cashier ? cashier.name : 'Système',
    lines: x.lines.map((l) => ({ kind: l.kind, ref: l.ref, name: l.name, qty: l.qty, unit: l.unit, discount: l.discount || 0, net: l.net, staffId: l.staffId, vat: l.vat, packId: l.packId || null })),
    discount: x.discount && x.discountNote ? { ...x.discount, reason: x.discountNote } : x.discount, tip: x.tip, totals: x.totals, payments: x.payments.map((p) => ({ method: p.method, amount: p.amount, given: p.given, change: p.change, last4: p.last4 })),
    refunded: x.refunded, refunds: x.refundIds.map((id) => { const r = s.refunds.get(id); return r ? { id: r.id, ref: refundNo(r.number), amount: r.amount, method: r.method, reason: r.reason, at: r.at } : null; }).filter(Boolean),
    note: x.note || '', demo: !!x.demo
  };
}

/** One day of the agenda as the Comptoir draws it. */
export function agendaView(s, day, caps, viewer, now) {
  const stats = clientStats(s, day, now);
  const all = caps.has('agenda.all');
  const lanes = [...s.staff.values()].filter((x) => x.active && x.chair && (all || x.id === viewer.id)).sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((x) => ({ ...staffView(x), work: staffIntervals(s, x.id, day) }));
  const ids = new Set(lanes.map((l) => l.id));
  const appts = [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && ids.has(a.staffId)).map((a) => apptView(s, a, caps, stats));
  const blocks = [...(s.blocksByDay.get(day) || [])].map((id) => s.blocks.get(id)).filter((b) => b && ids.has(b.staffId));
  const holds = [...s.holds.values()].filter((h) => h.day === day && h.exp > now && ids.has(h.staffId)).map((h) => ({ id: h.id, staffId: h.staffId, start: h.start, dur: h.dur, exp: h.exp, by: h.by }));
  const waitlist = [...s.waitlist.values()].filter((w) => w.day === day && (w.status === 'waiting' || w.status === 'offered')).map((w) => ({ id: w.id, first: w.first, staffId: w.staffId, serviceId: w.serviceId, from: w.from, to: w.to, status: w.status, offer: w.offer, at: w.at }));
  const queue = [...s.queue.values()].filter((q) => (q.status === 'waiting' || q.status === 'called') && now - q.at < 12 * 3600000).sort((a, b) => a.at - b.at)
    .map((q) => ({ id: q.id, name: q.name, hasPhone: !!q.phone, serviceId: q.serviceId, staffId: q.staffId, status: q.status, at: q.at, calledAt: q.calledAt || null }));
  return { day, lanes, appts, blocks, holds, waitlist, queue, closed: s.closures.has(day), closure: s.closures.get(day) || null };
}
