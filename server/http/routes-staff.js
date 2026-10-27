// @ts-check
// The Comptoir API, for signed-in staff. Every route states the capability it needs; the handlers
// re-check finer rules (own chair, discount caps) inside the commands.
import { HttpError } from './kit.js';
import { agendaView, apptView, clientCard, clientFull, saleView, staffView, serviceView, productView } from './views.js';
import { freeSlots, staffIntervals, walkinEstimate } from '../domain/availability.js';
import { clientStats, report, previousPeriod } from '../domain/insights.js';
import { drawerExpected, dayTotals, zFigures, METHOD_LABEL, ticketNo, closureNo } from '../domain/cash.js';
import { missedZ, closingWarnings, dayWords, dayAndDate } from '../commands/tick-steps.js';
import { addDays, isDay, weekStart, monthStart, monthEnd, diffDays, dayShort, fmtTime, localParts } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { maskPhone, normGiftCode, sha256 } from '../lib/util.js';
import { EXTENSIONS } from '../core/extensions.js';
import { startPayment, refundOnline } from './routes-public.js';
import { meView } from './routes-auth.js';
import * as A from '../commands/agenda.js';
import * as C from '../commands/clients.js';
import * as S from '../commands/sales.js';
import { sendRebook } from '../commands/messages.js';
import { maybeTick } from './scheduler.js';
import { waitUntil } from '@vercel/functions';

const dayParam = (r, name = 'day') => { const d = r.query.get(name); return d && isDay(d) ? d : r.local.day; };

/* ---------------- the live feed ---------------- */

function nameOfAppt(s, a) {
  if (!a) return 'Client';
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  return c ? c.first + (c.last ? ' ' + c.last.charAt(0) + '.' : '') : a.name || 'Client';
}
function feedItem(r, f) {
  const s = r.s;
  const d = f.data || {};
  const own = (staffId) => r.caps.has('agenda.all') || staffId === r.me.id;
  const staffName = (id) => (s.staff.get(id) || {}).name || '';
  const a = d.id ? s.appts.get(d.id) : null;
  const base = { v: f.v, at: f.at, by: f.actor.t };
  switch (f.type) {
    case 'appt.booked': {
      if (!a || !own(a.staffId)) return null;
      const who = nameOfAppt(s, a);
      const sub = dayShort(a.day) + ' · ' + fmtTime(a.start) + ' · ' + staffName(a.staffId) + ' · ' + a.services.map((x) => x.name).join(' + ');
      if (a.source === 'site') return { ...base, kind: 'booking', title: who + ' a réservé en ligne', sub, apptId: a.id, day: a.day };
      if (a.source === 'walkin') return { ...base, kind: 'walkin', title: who + ' installé sans rendez-vous', sub, apptId: a.id, day: a.day };
      return { ...base, kind: 'booking', title: 'RDV ajouté · ' + who, sub, apptId: a.id, day: a.day };
    }
    case 'appt.cancelled': {
      if (!a || !own(a.staffId)) return null;
      const who = nameOfAppt(s, a);
      const sub = dayShort(a.day) + ' · ' + fmtTime(a.start) + ' · ' + staffName(a.staffId);
      const title = d.by === 'client' ? who + ' a annulé' : d.by === 'system' ? 'Acompte non réglé · ' + who : 'RDV annulé · ' + who;
      return { ...base, kind: 'cancel', title, sub: sub + ' · créneau libéré', apptId: a.id, day: a.day };
    }
    case 'appt.moved':
      if (!a || !own(a.staffId)) return null;
      return { ...base, kind: 'move', title: (d.by === 'client' ? nameOfAppt(s, a) + ' a déplacé son RDV' : 'RDV déplacé · ' + nameOfAppt(s, a)), sub: dayShort(a.day) + ' · ' + fmtTime(a.start) + ' · ' + staffName(a.staffId), apptId: a.id, day: a.day };
    case 'appt.status':
      if (!a || !own(a.staffId) || !['arrived', 'no_show'].includes(d.status)) return null;
      return { ...base, kind: d.status === 'arrived' ? 'arrived' : 'noshow', title: nameOfAppt(s, a) + (d.status === 'arrived' ? ' est arrivé' : ' ne s’est pas présenté'), sub: fmtTime(a.start) + ' · ' + staffName(a.staffId), apptId: a.id, day: a.day };
    case 'sale.completed': {
      const x = s.sales.get(d.id);
      if (!x || (!r.caps.has('sale.all') && x.cashierId !== r.me.id && !x.lines.some((l) => l.staffId === r.me.id))) return null;
      const methods = [...new Set(x.payments.map((p) => METHOD_LABEL[p.method] || p.method))].join(' + ');
      return { ...base, kind: 'sale', title: 'Encaissé ' + fmtEur(x.totals.due), sub: ticketNo(x.number) + (methods ? ' · ' + methods : '') + (x.tip ? ' · pourboire ' + fmtEur(x.tip.amount) : ''), saleId: x.id, money: true };
    }
    case 'sale.refunded':
      if (!r.caps.has('sale.all')) return null;
      return { ...base, kind: 'refund', title: 'Remboursé ' + fmtEur(d.amount), sub: d.reason, money: true };
    case 'payment.succeeded': {
      const p = s.payments.get(d.id);
      if (!p) return null;
      return { ...base, kind: 'payment', title: (p.kind === 'deposit' ? 'Acompte reçu ' : 'Paiement reçu ') + fmtEur(p.amount), sub: p.label, apptId: p.apptId, paymentId: p.id, money: true };
    }
    case 'waitlist.added':
      return { ...base, kind: 'wait', title: 'Liste d’attente · ' + (s.waitlist.get(d.id)?.first || ''), sub: dayShort(d.day) + (d.staffId !== 'any' ? ' · ' + staffName(d.staffId) : ' · sans préférence'), day: d.day };
    case 'queue.added':
      return { ...base, kind: 'walkin', title: (s.queue.get(d.id)?.name || 'Un client') + ' attend sans rendez-vous', sub: (s.services.get(d.serviceId)?.name || '') + (d.staffId !== 'any' ? ' · ' + staffName(d.staffId) : '') };
    case 'day.closed':
      if (!r.caps.has('closure') && !r.caps.has('report.shop')) return null;
      return { ...base, kind: 'closure', title: d.auto ? 'Z du ' + dayAndDate(d.day) + ' fait automatiquement' : 'Journée clôturée · ' + closureNo(d.number), sub: (d.auto ? closureNo(d.number) + ' · ' : '') + fmtEur(d.net) + ' · ' + d.tickets + ' tickets', money: true };
    case 'drawer.closed':
      return r.caps.has('drawer') ? { ...base, kind: 'drawer', title: 'Caisse comptée', sub: d.diff ? 'Écart ' + fmtEur(d.diff) : 'Aucun écart', money: true } : null;
    case 'stock.adjusted': {
      const p = s.products.get(d.productId);
      if (!p || d.reason !== 'Vente' || p.stock > p.low || !r.caps.has('catalog')) return null;
      return { ...base, kind: 'stock', title: 'Stock bas · ' + p.name, sub: 'Il en reste ' + p.stock };
    }
    default: for (const x of EXTENSIONS) if (x.item && x.feed?.includes(f.type)) return x.item(r, f); return null;
  }
}

/**
 * The live feed keeps no system events; the Z the scheduler made on its own is one the owner must hear about.
 * Read from the journal after version `from`, looking back a bounded number of events.
 */
function autoZ(r, from) {
  const j = r.rt.engine.journal;
  const out = [];
  for (let i = Math.max(from, j.length - 5000); i < j.length; i++) {
    const e = j[i];
    if (e.type === 'day.closed' && e.actor.t === 'system' && e.data && e.data.auto) out.push({ v: e.v, type: e.type, at: e.at, actor: e.actor, data: e.data });
  }
  return out;
}
const byV = (a, b) => a.v - b.v;

function badges(r) {
  const s = r.s, L = r.local;
  const mineOnly = !r.caps.has('agenda.all');
  let toPay = 0;
  for (const id of s.apptsByDay.get(L.day) || []) {
    const a = s.appts.get(id);
    if (!a || a.saleId || (mineOnly && a.staffId !== r.me.id)) continue;
    if (a.status === 'in_chair' || a.status === 'done' || ((a.status === 'booked' || a.status === 'arrived') && a.start + a.dur <= L.min)) toPay++;
  }
  const queue = [...s.queue.values()].filter((q) => q.status === 'waiting' || q.status === 'called').length;
  let relances = 0;
  if (r.caps.has('marketing')) for (const st of clientStats(s, L.day, r.now).values()) if (st.overdue) relances++;
  const waitlist = [...s.waitlist.values()].filter((w) => w.status === 'waiting' && w.day >= L.day).length;
  return { toPay, queue, relances, waitlist };
}

/* ---------------- day figures ---------------- */

function dayKpis(r, day) {
  const s = r.s;
  const mine = !r.caps.has('report.shop');
  const appts = [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && a.status !== 'cancelled' && (!mine || a.staffId === r.me.id));
  const done = appts.filter((a) => a.status === 'done').length;
  const noShows = appts.filter((a) => a.status === 'no_show').length;
  const upcoming = appts.filter((a) => ['booked', 'pending', 'arrived'].includes(a.status) && (day > r.local.day || a.start >= r.local.min)).length;
  let revenue = 0, tips = 0;
  for (const id of s.salesByDay.get(day) || []) {
    const x = s.sales.get(id);
    if (!x) continue;
    if (mine) { revenue += x.lines.filter((l) => l.staffId === r.me.id && l.kind !== 'giftcard').reduce((t, l) => t + l.net, 0); if (x.tip && x.tip.staffId === r.me.id) tips += x.tip.amount; }
    else { revenue += x.totals.revenue - x.refunded; tips += x.totals.tip; }
  }
  const planned = appts.filter((a) => a.status !== 'no_show').reduce((t, a) => t + a.price, 0);
  const staffIds = mine ? [r.me.id] : [...s.staff.values()].filter((x) => x.active && x.chair).map((x) => x.id);
  let cap = 0, booked = 0;
  for (const id of staffIds) for (const [a, b] of staffIntervals(s, id, day)) cap += b - a;
  for (const a of appts) if (a.status !== 'no_show') booked += a.dur;
  const showMoney = r.caps.has('report.shop') || r.caps.has('report.own');
  return { total: appts.length, done, noShows, upcoming, revenue: showMoney ? revenue : null, tips: showMoney ? tips : null, planned: showMoney ? planned : null, fill: cap ? Math.min(1, booked / cap) : 0, scope: mine ? 'own' : 'shop' };
}

export function staffRoutes(app) {
  app.get('/api/v1/bootstrap', (r) => {
    const s = r.s;
    const full = r.caps.has('team');
    const settings = r.caps.has('settings') ? s.settings : {
      shop: s.settings.shop, hours: s.settings.hours, closures: s.settings.closures, booking: s.settings.booking, deposits: s.settings.deposits,
      payments: s.settings.payments, team: s.settings.team, goals: s.settings.goals,
      messages: { ...s.settings.messages, templates: r.caps.has('marketing') ? s.settings.messages.templates : {} }
    };
    return {
      me: meView(s, r.me, r.device, r.session.kind), mode: s.mode, today: r.local.day, now: r.now, version: s.version, cfg: s.cfgVersion, settings,
      staff: [...s.staff.values()].filter((x) => x.active || full).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((x) => staffView(x, full || x.id === r.me.id)),
      services: [...s.services.values()].filter((x) => x.active || r.caps.has('catalog')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(serviceView),
      products: [...s.products.values()].filter((x) => x.active || r.caps.has('catalog')).map(productView),
      providers: { payments: r.rt.pay.name, paymentsLive: !!r.rt.pay.live, sms: r.rt.sms ? r.rt.sms.name : null, store: r.rt.store.kind },
      warnings: r.me.role === 'owner' ? [...r.rt.warnings, ...closingWarnings(s, r.local.day)] : []
    };
  });

  /** Polled every few seconds: cheap, and the carrier of the background work. */
  app.get('/api/v1/pulse', (r) => {
    const since = Number(r.query.get('since')) || 0;
    const items = since ? [...r.s.feed.filter((f) => f.v > since), ...autoZ(r, since)].sort(byV).slice(-40).map((f) => feedItem(r, f)).filter(Boolean) : [];
    const t = maybeTick(r.rt, r.meta);
    if (t) waitUntil(t);
    return { version: r.s.version, cfg: r.s.cfgVersion, now: r.now, today: r.local.day, min: r.local.min, feed: items, badges: badges(r) };
  });

  app.get('/api/v1/feed', (r) => {
    const recent = r.s.feed.slice(-120);
    const items = [...recent, ...autoZ(r, recent.length ? recent[0].v : 0)].sort(byV).map((f) => feedItem(r, f)).filter(Boolean).reverse().slice(0, 50);
    return { items };
  });

  /* ---------------- agenda ---------------- */

  app.get('/api/v1/agenda', (r) => {
    const day = dayParam(r);
    const v = agendaView(r.s, day, r.caps, r.me, r.now);
    const L = r.local;
    const est = day === L.day ? walkinEstimate(r.s, r.now, L) : null;
    return { ...v, kpis: dayKpis(r, day), walkin: est, drawer: r.s.drawer ? { open: true, since: r.s.drawer.openedAt } : { open: false } };
  }, { cap: 'agenda.own' });

  app.get('/api/v1/week', (r) => {
    const from = weekStart(dayParam(r));
    const s = r.s;
    const staff = [...s.staff.values()].filter((x) => x.active && x.chair && (r.caps.has('agenda.all') || x.id === r.me.id));
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(from, i);
      const appts = [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && a.status !== 'cancelled' && a.status !== 'no_show');
      days.push({
        day, kpis: dayKpis(r, day),
        staff: staff.map((st) => {
          const mine = appts.filter((a) => a.staffId === st.id);
          const cap = staffIntervals(s, st.id, day).reduce((t, [a, b]) => t + b - a, 0);
          const hours = Array.from({ length: 24 }, () => 0);
          for (const a of mine) for (let m = a.start; m < a.start + a.dur; m += 30) hours[Math.floor(m / 60)] += 30;
          return { id: st.id, count: mine.length, minutes: mine.reduce((t, a) => t + a.dur, 0), cap, hours };
        })
      });
    }
    return { from, days, staff: staff.map((x) => staffView(x)) };
  }, { cap: 'agenda.own' });

  app.get('/api/v1/slots', (r) => {
    const day = dayParam(r);
    const ids = String(r.query.get('services') || '').split(',').filter(Boolean).slice(0, 4);
    const staffId = r.query.get('staff') || 'any';
    const services = ids.map((id) => r.s.services.get(id)).filter(Boolean);
    if (!services.length) throw new HttpError(400, 'invalid', 'Choisis une prestation.');
    const dur = services.reduce((t, x) => t + x.dur, 0) + Math.max(0, ...services.map((x) => x.buffer || 0));
    const days = Math.min(14, Number(r.query.get('days')) || 1);
    const ignoreAppt = r.query.get('ignore') || null;
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(day, i);
      const slots = freeSlots(r.s, { day: d, dur, serviceIds: ids, staffId, now: r.now, local: r.local, online: false, step: 15, ignoreAppt });
      out.push({ day: d, slots: slots.map((x) => ({ m: x.m, s: x.staffId })) });
      if (r.query.get('first') && out.reduce((t, x) => t + x.slots.length, 0) >= Number(r.query.get('first'))) break;
    }
    return { dur, days: out };
  }, { cap: 'agenda.own' });

  app.get('/api/v1/appointments/:id', (r) => {
    const s = r.s;
    const a = s.appts.get(r.params.id);
    if (!a || (!r.caps.has('agenda.all') && a.staffId !== r.me.id)) throw new HttpError(404, 'not_found', 'Rendez-vous introuvable.');
    const stats = clientStats(s, r.local.day, r.now);
    const c = a.clientId ? s.clients.get(a.clientId) : null;
    const history = c ? [...s.appts.values()].filter((x) => x.clientId === c.id && x.id !== a.id && (x.status === 'done' || x.status === 'no_show')).sort((x, y) => (x.day < y.day ? 1 : -1)).slice(0, 8)
      .map((x) => ({ id: x.id, day: x.day, start: x.start, services: x.services.map((v) => v.name), staff: (s.staff.get(x.staffId) || {}).name, status: x.status, price: x.saleId ? (s.sales.get(x.saleId)?.totals.revenue ?? x.price) : x.price })) : [];
    const messages = [...s.messages.values()].filter((m) => m.apptId === a.id).map((m) => ({ id: m.id, template: m.template, status: m.status, at: m.at, sentAt: m.sentAt || null, to: m.toMasked }));
    const payments = [...s.payments.values()].filter((p) => p.apptId === a.id).map((p) => ({ id: p.id, kind: p.kind, amount: p.amount, status: p.status, at: p.createdAt }));
    return { appt: apptView(s, a, r.caps, stats), client: c && r.caps.has('client.view') ? clientFull(s, c, r.caps, stats) : null, history, messages, payments, sale: a.saleId && s.sales.get(a.saleId) ? saleView(s, s.sales.get(a.saleId), r.caps) : null };
  }, { cap: 'agenda.own' });

  app.post('/api/v1/appointments', (r) => r.run(A.createAppointment, r.body), { cap: 'agenda.own' });
  app.patch('/api/v1/appointments/:id', (r) => r.run(A.updateAppointment, { ...r.body, id: r.params.id }), { cap: 'agenda.own' });
  app.post('/api/v1/appointments/:id/move', (r) => r.run(A.moveAppointment, { ...r.body, id: r.params.id }), { cap: 'agenda.own' });
  app.post('/api/v1/appointments/:id/status', (r) => r.run(A.setStatus, { id: r.params.id, status: r.body.status }), { cap: 'agenda.own' });
  app.post('/api/v1/appointments/:id/cancel', async (r) => {
    const res = await r.run(A.cancelAppointment, { id: r.params.id, reason: r.body.reason, notify: r.body.notify });
    if (r.body.refundDeposit && res.deposit && res.deposit.paymentId) {
      if (!r.caps.has('sale.refund')) throw new HttpError(403, 'forbidden', 'Seul le gérant rembourse un acompte.');
      res.refunded = await refundOnline(r, r.s.payments.get(res.deposit.paymentId), 'Annulé par le salon');
    }
    return res;
  }, { cap: 'agenda.own' });

  app.post('/api/v1/blocks', (r) => r.run(A.addBlock, r.body), { cap: 'agenda.own' });
  app.del('/api/v1/blocks/:id', (r) => r.run(A.removeBlock, { id: r.params.id }), { cap: 'agenda.own' });
  app.post('/api/v1/queue', (r) => r.run(A.addWalkin, r.body), { cap: 'agenda.own' });
  app.post('/api/v1/queue/:id', (r) => r.run(A.updateWalkin, { ...r.body, id: r.params.id }), { cap: 'agenda.own' });
  app.get('/api/v1/waitlist', (r) => {
    const s = r.s;
    const items = [...s.waitlist.values()].filter((w) => w.day >= r.local.day && (w.status === 'waiting' || w.status === 'offered'))
      .sort((a, b) => a.day.localeCompare(b.day) || a.from - b.from)
      .map((w) => ({ id: w.id, first: w.first, phone: r.caps.has('client.contact') ? w.phone : maskPhone(w.phone), day: w.day, staffId: w.staffId, serviceId: w.serviceId, from: w.from, to: w.to, status: w.status, offer: w.offer, at: w.at }));
    const recent = [...s.waitlist.values()].filter((w) => r.now - w.at < 30 * 86400000);
    return { items, stats: { added: recent.length, booked: recent.filter((w) => w.status === 'booked').length } };
  }, { cap: 'agenda.own' });
  app.post('/api/v1/waitlist', (r) => r.run(A.addWait, r.body), { cap: 'agenda.own' });
  app.del('/api/v1/waitlist/:id', (r) => r.run(A.removeWait, { id: r.params.id }), { cap: 'agenda.own' });

  /* ---------------- clients ---------------- */

  app.get('/api/v1/clients', (r) => {
    const s = r.s, L = r.local;
    const stats = clientStats(s, L.day, r.now);
    const q = String(r.query.get('q') || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const digits = q.replace(/\D/g, '');
    const seg = r.query.get('segment') || 'all';
    const sort = r.query.get('sort') || 'recent';
    const limit = Math.min(200, Number(r.query.get('limit')) || 60);
    const offset = Math.max(0, Number(r.query.get('offset')) || 0);
    const month = L.day.slice(5, 7);
    let list = [...s.clients.values()].filter((c) => !c.mergedInto && !c.erased);
    if (q) list = list.filter((c) => {
      const name = (c.first + ' ' + c.last).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return name.includes(q) || (digits.length >= 2 && c.phone.replace(/\D/g, '').replace(/^33/, '0').includes(digits));
    });
    const st = (c) => stats.get(c.id) || {};
    const segs = {
      all: () => true, nouveaux: (c) => st(c).firstDay && diffDays(st(c).firstDay, L.day) <= 30 || !st(c).visits, fideles: (c) => st(c).loyal,
      relancer: (c) => st(c).overdue && c.sms, absents: (c) => st(c).noShows > 0, abonnes: (c) => [...s.packs.values()].some((k) => k.clientId === c.id && k.used < k.total),
      vip: (c) => (c.tags || []).includes('VIP'), anniversaires: (c) => c.birthday && c.birthday.slice(3, 5) === month
    };
    const counts = Object.fromEntries(Object.entries(segs).map(([k, f]) => [k, list.filter(f).length]));
    list = list.filter(segs[seg] || segs.all);
    const sorters = {
      recent: (a, b) => (st(b).lastDay || '').localeCompare(st(a).lastDay || '') || b.createdAt - a.createdAt,
      name: (a, b) => (a.first + a.last).localeCompare(b.first + b.last, 'fr'),
      spend: (a, b) => (st(b).spend || 0) - (st(a).spend || 0),
      visits: (a, b) => (st(b).visits || 0) - (st(a).visits || 0),
      overdue: (a, b) => (st(a).dueIn ?? 999) - (st(b).dueIn ?? 999)
    };
    list.sort(sorters[sort] || sorters.recent);
    return { total: list.length, counts, items: list.slice(offset, offset + limit).map((c) => clientCard(s, c, r.caps, stats)) };
  }, { cap: 'client.view' });

  app.get('/api/v1/clients/:id', (r) => {
    const s = r.s;
    let c = s.clients.get(r.params.id);
    if (c && c.mergedInto) c = s.clients.get(c.mergedInto);
    if (!c) throw new HttpError(404, 'not_found', 'Client introuvable.');
    const stats = clientStats(s, r.local.day, r.now);
    const appts = [...s.appts.values()].filter((a) => a.clientId === c.id).sort((a, b) => (b.day + String(b.start).padStart(4, '0')).localeCompare(a.day + String(a.start).padStart(4, '0')))
      .map((a) => ({ id: a.id, day: a.day, start: a.start, dur: a.dur, status: a.status, services: a.services.map((x) => x.name), staffId: a.staffId, price: a.price, source: a.source, saleId: a.saleId, note: a.note || '' }));
    const sales = [...s.sales.values()].filter((x) => x.clientId === c.id).sort((a, b) => b.at - a.at).slice(0, 40).map((x) => ({ id: x.id, ref: ticketNo(x.number), day: x.day, due: x.totals.due, revenue: x.totals.revenue, refunded: x.refunded, lines: x.lines.map((l) => l.name) }));
    const packs = [...s.packs.values()].filter((k) => k.clientId === c.id).map((k) => ({ id: k.id, name: k.name, used: k.used, total: k.total, expires: k.expires, soldAt: k.soldAt }));
    const messages = [...s.messages.values()].filter((m) => m.cid === c.id).sort((a, b) => b.at - a.at).slice(0, 20).map((m) => ({ id: m.id, template: m.template, status: m.status, at: m.at }));
    return { client: clientFull(s, c, r.caps, stats), appts, sales: r.caps.has('sale.all') || r.caps.has('report.shop') ? sales : [], packs, messages };
  }, { cap: 'client.view' });

  app.post('/api/v1/clients', (r) => r.run(C.addClient, r.body), { cap: 'client.edit' });
  app.patch('/api/v1/clients/:id', (r) => r.run(C.updateClient, { id: r.params.id, patch: r.body }), { cap: 'client.edit' });
  app.post('/api/v1/clients/merge', (r) => r.run(C.mergeClients, r.body), { cap: 'client.edit' });
  app.post('/api/v1/clients/:id/erase', (r) => r.run(C.eraseClient, { id: r.params.id }), { cap: 'client.erase' });

  /* ---------------- the till ---------------- */

  app.post('/api/v1/sales', (r) => r.run(S.checkout, { ...r.body, day: undefined, at: undefined }), { cap: 'sale.create' });
  app.get('/api/v1/sales', (r) => {
    const day = dayParam(r);
    const s = r.s;
    const all = r.caps.has('sale.all');
    const list = (s.salesByDay.get(day) || []).map((id) => s.sales.get(id)).filter((x) => x && (all || x.cashierId === r.me.id || x.lines.some((l) => l.staffId === r.me.id)));
    return { day, items: list.sort((a, b) => b.at - a.at).map((x) => saleView(s, x, r.caps)), totals: all ? dayTotals(s, day) : null, closed: s.closures.has(day) };
  }, { cap: 'sale.create' });
  app.get('/api/v1/sales/:id', (r) => {
    const x = r.s.sales.get(r.params.id);
    if (!x || (!r.caps.has('sale.all') && x.cashierId !== r.me.id && !x.lines.some((l) => l.staffId === r.me.id))) throw new HttpError(404, 'not_found', 'Ticket introuvable.');
    return saleView(r.s, x, r.caps);
  }, { cap: 'sale.create' });
  app.post('/api/v1/sales/:id/refund', async (r) => {
    const x = r.s.sales.get(r.params.id);
    if (!x) throw new HttpError(404, 'not_found', 'Ticket introuvable.');
    let providerRef;
    if (r.body.method === 'online') {
      // check everything the credit note will check before any money moves at the provider
      const left = x.totals.revenue - x.refunded;
      const amount = Number(r.body.amount);
      if (!Number.isInteger(amount) || amount <= 0 || amount > left) throw new HttpError(400, 'invalid', 'Montant remboursable au maximum : ' + fmtEur(left) + '.');
      if (String(r.body.reason || '').trim().length < 3) throw new HttpError(400, 'invalid', 'Indique la raison du remboursement.');
      if (r.s.closures.has(r.local.day)) throw new HttpError(409, 'day_closed', 'La journée est clôturée.');
      const pay = x.payments.map((p) => p.paymentId && r.s.payments.get(p.paymentId)).find((p) => p && p.status === 'paid');
      if (!pay) throw new HttpError(400, 'invalid', 'Aucun paiement en ligne à rembourser sur ce ticket.');
      if (r.body.amount > pay.amount) throw new HttpError(400, 'invalid', 'Le remboursement en ligne ne peut dépasser ' + fmtEur(pay.amount) + '.');
      const res = await r.rt.pay.refund(pay.chargeRef || pay.providerRef, r.body.amount, x.id + '-' + x.refundIds.length);
      providerRef = res.ref;
    }
    return r.run(S.refund, { ...r.body, saleId: x.id, providerRef });
  }, { cap: 'sale.refund' });
  app.post('/api/v1/sales/:id/receipt', (r) => r.run(S.sendReceipt, { saleId: r.params.id, phone: r.body.phone, n: r.body.n }), { cap: 'sale.create' });

  app.get('/api/v1/giftcards/check', (r) => {
    const g = r.s.giftcards.get(r.s.giftByHash.get(sha256(normGiftCode(r.query.get('code')))) || '');
    if (!g) throw new HttpError(404, 'not_found', 'Carte cadeau inconnue.');
    return { id: g.id, last4: g.last4, balance: g.balance, amount: g.amount, expires: g.expires, status: g.status, expired: g.expires < r.local.day };
  }, { cap: 'sale.create' });
  app.get('/api/v1/giftcards', (r) => {
    const items = [...r.s.giftcards.values()].sort((a, b) => b.issuedAt - a.issuedAt).map((g) => ({ id: g.id, last4: g.last4, amount: g.amount, balance: g.balance, expires: g.expires, status: g.status, recipient: g.recipient, buyer: g.buyer, issuedAt: g.issuedAt, uses: g.uses.length }));
    const outstanding = items.filter((g) => g.status === 'active' && g.expires >= r.local.day).reduce((t, g) => t + g.balance, 0);
    return { items, outstanding };
  }, { cap: 'sale.all' });

  app.post('/api/v1/payments/qr', async (r) => {
    const amount = Number(r.body.amount);
    if (!Number.isInteger(amount) || amount < 50 || amount > 500000) throw new HttpError(400, 'invalid', 'Montant invalide.');
    if (!r.s.settings.payments.qr) throw new HttpError(409, 'off', 'Le paiement par QR est désactivé.');
    const p = await startPayment(r, { kind: 'qr', amount, label: String(r.body.label || r.s.settings.shop.name).slice(0, 80), apptId: r.body.apptId || null, returnPath: '/paiement/merci' });
    return p;
  }, { cap: 'sale.create' });
  app.get('/api/v1/payments/:id', (r) => {
    const p = r.s.payments.get(r.params.id);
    if (!p) throw new HttpError(404, 'not_found', 'Paiement introuvable.');
    return { id: p.id, status: p.status, amount: p.amount, kind: p.kind, url: p.url, usedBy: p.usedBy || null, provider: p.provider };
  }, { cap: 'sale.create' });

  /* ---------------- drawer and Z ---------------- */

  app.get('/api/v1/drawer', (r) => {
    const s = r.s;
    const d = s.drawer;
    const last = [...s.drawers.values()].filter((x) => x.closedAt).sort((a, b) => b.closedAt - a.closedAt)[0] || null;
    const today = dayTotals(s, r.local.day);
    const unpaid = [...(s.apptsByDay.get(r.local.day) || [])].map((id) => s.appts.get(id)).filter((a) => a && !a.saleId && (a.status === 'in_chair' || a.status === 'done' || ((a.status === 'booked' || a.status === 'arrived') && a.start + a.dur <= r.local.min))).length;
    const z = s.closures.get(r.local.day);
    const missed = missedZ(s, r.local.day);
    // the float to leave in the drawer tonight is the one the day started with
    const lastFloat = [...s.drawers.values()].sort((a, b) => b.openedAt - a.openedAt)[0];
    return {
      open: d ? { id: d.id, day: d.day, openedAt: d.openedAt, float: d.float, moves: d.moves, expected: drawerExpected(s, d), openedBy: (s.staff.get(d.openedBy) || {}).name || '' } : null,
      // day: the drawer's own day, so a forgotten drawer counted this morning does not read as "counted tonight"
      last: last ? { day: last.day, counted: last.counted, expected: last.expected, diff: last.diff, closedAt: last.closedAt, note: last.note } : null,
      today, closure: z ? { ...z, ...zFigures(z) } : null, unpaid, grandTotal: s.grandTotal,
      remaining: S.remainingAppts(s, r.local.day, r.local.min), closesAt: S.closingMin(s, r.local.day),
      floatHint: lastFloat ? lastFloat.float : 15000,
      missed: missed.close.map((day) => ({ day, words: dayWords(day, r.local.day), tickets: (s.salesByDay.get(day) || []).length })),
      warnings: closingWarnings(s, r.local.day)
    };
  }, { cap: 'drawer' });
  app.post('/api/v1/drawer/open', (r) => r.run(S.openDrawer, r.body), { cap: 'drawer' });
  app.post('/api/v1/drawer/move', (r) => r.run(S.moveDrawer, r.body), { cap: 'drawer' });
  app.post('/api/v1/drawer/close', (r) => r.run(S.closeDrawer, r.body), { cap: 'drawer' });
  // early: the owner closes before the end of the day on purpose; day: catching up a past day nobody closed
  app.post('/api/v1/closures', (r) => r.run(S.closeDay, { early: r.body.early === true, day: isDay(r.body.day) ? r.body.day : undefined }), { cap: 'closure' });
  app.get('/api/v1/closures', (r) => {
    const items = [...r.s.closures.values()].sort((a, b) => b.number - a.number).slice(0, Math.min(400, Number(r.query.get('limit')) || 60))
      .map((z) => ({ ...z, ...zFigures(z), ref: closureNo(z.number), by: (r.s.staff.get(z.by) || {}).name || (z.auto ? 'Automatique' : 'Système') }));
    return { items, grandTotal: r.s.grandTotal };
  }, { cap: 'closure' });

  /* ---------------- reports ---------------- */

  app.get('/api/v1/reports', (r) => {
    const L = r.local;
    let from = r.query.get('from'), to = r.query.get('to');
    if (!from || !isDay(from)) from = monthStart(L.day);
    if (!to || !isDay(to)) to = L.day;
    if (to < from) [from, to] = [to, from];
    if (diffDays(from, to) > 400) throw new HttpError(400, 'invalid', 'Période trop longue (400 jours maximum).');
    const own = !r.caps.has('report.shop');
    if (own && !r.caps.has('report.own')) throw new HttpError(403, 'forbidden', 'Tu n’as pas accès aux chiffres.');
    const staffId = own ? r.me.id : r.query.get('staff') || null;
    const cur = report(r.s, { from, to, staffId, today: L.day, now: r.now });
    const pp = previousPeriod(from, to);
    const prev = report(r.s, { ...pp, staffId, today: L.day, now: r.now });
    const pick = (x) => ({ revenue: x.revenue, tickets: x.tickets, avgTicket: x.avgTicket, clients: x.clients, newClients: x.newClients, occupancy: x.occupancy, noShowRate: x.noShowRate, tips: x.tips, series: x.series.map((d) => d.revenue) });
    const ms = monthStart(L.day), me = monthEnd(L.day);
    const month = own ? null : report(r.s, { from: ms, to: L.day, staffId: null, today: L.day, now: r.now });
    const goal = own ? null : { target: r.s.settings.goals.monthCents, done: month ? month.revenue : 0, days: diffDays(ms, me) + 1, elapsed: diffDays(ms, L.day) + 1 };
    return { ...cur, scope: own ? 'own' : staffId ? 'staff' : 'shop', prev: pick(prev), prevRange: pp, goal };
  }, { cap: 'report.own' });

  /* ---------------- relances ---------------- */

  app.get('/api/v1/relances', (r) => {
    const s = r.s;
    const stats = clientStats(s, r.local.day, r.now);
    const items = [...s.clients.values()].filter((c) => !c.erased && !c.mergedInto && c.sms && c.phone && stats.get(c.id)?.overdue)
      .map((c) => clientCard(s, c, r.caps, stats)).sort((a, b) => (a.dueIn ?? 0) - (b.dueIn ?? 0)).slice(0, 200);
    const sent = [...s.messages.values()].filter((m) => m.template === 'rebook' && r.now - m.at < 60 * 86400000);
    const sentIds = new Set(sent.map((m) => m.cid));
    const came = [...s.appts.values()].filter((a) => a.clientId && sentIds.has(a.clientId) && a.createdAt > Math.min(...sent.filter((m) => m.cid === a.clientId).map((m) => m.at))).length;
    const recent = new Map(sent.map((m) => [m.cid, m.at]));
    return { items: items.map((c) => ({ ...c, lastText: recent.get(c.id) || null })), stats: { sent: sent.length, booked: came }, template: s.settings.messages.templates.rebook };
  }, { cap: 'marketing' });
  app.post('/api/v1/relances/send', (r) => r.run(sendRebook, r.body), { cap: 'marketing' });

  app.get('/api/v1/messages', (r) => {
    const items = [...r.s.messages.values()].sort((a, b) => b.at - a.at).slice(0, Math.min(300, Number(r.query.get('limit')) || 100))
      .map((m) => ({ id: m.id, template: m.template, status: m.status, at: m.at, sentAt: m.sentAt || null, to: m.toMasked || maskPhone(m.to), body: r.caps.has('settings') ? m.body : '', error: m.error || '' }));
    return { items, provider: r.rt.sms ? r.rt.sms.name : null, mode: r.s.mode };
  }, { cap: 'marketing' });
}
