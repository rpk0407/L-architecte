// @ts-check
// The money side of the Caisse home, phone first: who is still to pay (every chair, oldest first), what came in today
// by method and by barber (tips apart), the deposits, the memberships of the day, the gift cards, the cash barbers
// hold; and the month (by method, by barber, commissions, tips owed). Read only from what the till, the reports and the
// balances already compute (cash.js, insights.js through statement.js, balances.js): no figure is computed twice.
import { localParts, monthEnd, addDays } from '../../shared/dates.js';
import { dayTotals, heldCash, METHODS } from './cash.js';
import { refundsOf } from './ledger.js';
import { giftcardRoll } from './balances.js';
import { report } from './insights.js';
import { monthWords, PROVISIONAL } from './statement.js';

const dayOf = (ms) => localParts(ms).day;
/** methods as the owner reads them on the home: the online ones (QR, deposits) together, the prepaid apart */
export const HOME_METHODS = ['cash', 'card', 'online', 'deposit', 'giftcard', 'ancien'];

/** « Karim B. », or the name typed on the booking */
function who(s, a) {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  return c && !c.erased ? (c.first + (c.last ? ' ' + c.last.charAt(0) + '.' : '')).trim() : a.name || 'Client';
}

/** Appointments of `day` finished or in the chair and not paid: every chair, the one waiting longest first. */
export function toPayOf(s, day, min) {
  return [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id))
    .filter((a) => a && !a.saleId && !a.legacy && (a.status === 'in_chair' || a.status === 'done' || ((a.status === 'booked' || a.status === 'arrived') && a.start + a.dur <= min)))
    .sort((a, b) => a.start + a.dur - (b.start + b.dur))
    .map((a) => {
      const st = s.staff.get(a.staffId);
      return { id: a.id, name: who(s, a), start: a.start, end: a.start + a.dur, status: a.status, staffId: a.staffId, staff: st ? st.name : '', price: (a.services || []).reduce((t, v) => t + (v.price || 0), 0), waited: Math.max(0, min - (a.start + a.dur)) };
    });
}

/** The day at the till for the owner: everything the Caisse home lists under « Encaissé aujourd'hui » and after. */
export function tillDay(s, day, min) {
  const t = dayTotals(s, day);
  const sales = (s.salesByDay.get(day) || []).map((id) => s.sales.get(id)).filter(Boolean);
  /** @type {Map<string, { id: string, name: string, color: string, performed: number, tickets: number, tips: number, cash: number }>} */
  const staff = new Map();
  const row = (id) => {
    let r = staff.get(id);
    if (!r) { const st = s.staff.get(id) || {}; r = { id, name: st.name || '', color: st.color || '', performed: 0, tickets: 0, tips: 0, cash: 0 }; staff.set(id, r); }
    return r;
  };
  // cuts settled by a carnet or a membership: no money today, said apart (the money came when it was sold)
  const credits = { carnet: 0, member: 0 };
  for (const x of sales) {
    for (const l of x.lines) if (l.kind === 'service') { if (l.packId) credits.carnet += l.qty || 1; else if (l.memberId) credits.member += l.qty || 1; }
    const seen = new Set();
    for (const l of x.lines) {
      if (!l.staffId || l.kind === 'giftcard' || l.kind === 'membership') continue;
      const r = row(l.staffId);
      r.performed += l.net ?? l.unit * l.qty - (l.discount || 0);
      if (!seen.has(l.staffId)) { r.tickets += 1; seen.add(l.staffId); }
    }
    if (x.tip && x.tip.amount) row(x.tip.staffId).tips += x.tip.amount;
    for (const p of x.payments) if (p.method === 'cash' && p.heldBy) row(p.heldBy).cash += p.amount;
  }
  // deposits: still waiting for their visit, used on a ticket today, given back today
  const deposits = { waiting: { n: 0, amount: 0 }, used: { n: 0, amount: 0 }, refunded: { n: 0, amount: 0 } };
  for (const py of s.payments.values()) {
    if (py.kind !== 'deposit' || !py.paidAt) continue;
    const sale = py.usedBy ? s.sales.get(py.usedBy) : null;
    if (sale && sale.day === day) { deposits.used.n++; deposits.used.amount += py.amount; }
    const back = refundsOf(py).filter((rf) => dayOf(rf.at) === day).reduce((v, rf) => v + rf.amount, 0);
    if (back) { deposits.refunded.n++; deposits.refunded.amount += back; }
    if (!sale && py.status === 'paid' && !(py.refunded > 0)) { deposits.waiting.n++; deposits.waiting.amount += py.amount; }
  }
  // memberships: the months paid today, and the refusals still being retried (to follow up)
  const renewed = [], failed = [];
  for (const m of s.members ? s.members.values() : []) {
    const c = m.cid ? s.clients.get(m.cid) : null;
    const name = c && !c.erased ? (c.first + (c.last ? ' ' + c.last.charAt(0) + '.' : '')).trim() : m.first || 'Client';
    for (const p of m.periods) if (p.at && dayOf(p.at) === day) renewed.push({ id: m.id, name, plan: m.name, amount: p.amount });
    if (m.pastDue && !m.ended) failed.push({ id: m.id, name, plan: m.name, amount: m.price, attempt: m.pastDue.attempt, since: dayOf(m.pastDue.at), clientId: m.cid });
  }
  const held = [...heldCash(s)].map(([id, amount]) => ({ id, name: (s.staff.get(id) || {}).name || '', amount })).sort((a, b) => b.amount - a.amount);
  const methods = HOME_METHODS.filter((m) => t.paymentsNet[m]).map((m) => ({ method: m, amount: t.paymentsNet[m] }));
  return {
    day, toPay: toPayOf(s, day, min), closed: s.closures.has(day),
    // takings: the money that came in today (cash, card, online); prepaid: settled by money taken before
    takings: t.takings, prepaid: t.prepaid, net: t.netTtc, tickets: t.tickets, tips: t.tips, refunds: t.refundsTotal, methods,
    staff: [...staff.values()].sort((a, b) => b.performed - a.performed),
    credits, deposits, members: { renewed, failed },
    giftcards: { sold: t.giftcardsSold, used: t.paymentsNet.giftcard || 0 },
    held, drawer: s.drawer ? { open: true } : { open: false }
  };
}

/** The month for the owner: by method, by barber with his commission and the tips owed to him, the gift cards. */
export function tillMonth(s, month, today, now) {
  const from = month + '-01', end = monthEnd(from);
  const to = today < end ? today : end;
  /** @type {Record<string, number>} */
  const paid = {};
  let takings = 0, net = 0, tips = 0, tickets = 0;
  if (to >= from) for (let d = from; d <= to; d = addDays(d, 1)) {
    const t = dayTotals(s, d);
    for (const [m, v] of Object.entries(t.paymentsNet)) paid[m] = (paid[m] || 0) + v;
    takings += t.takings; net += t.netTtc; tips += t.tips; tickets += t.tickets;
  }
  const rep = to >= from ? report(s, { from, to, today, now }) : null;
  const staff = rep ? rep.staff.filter((x) => x.chair || x.revenue).map((x) => ({ id: x.id, name: x.name, color: x.color, performed: x.revenue, commission: x.commission, tips: x.tips, tipsCard: x.tipsCard, tipsCash: x.tipsCash, tickets: x.tickets })) : [];
  const g = to >= from ? giftcardRoll(s, from, to) : null;
  return {
    month, label: monthWords(month), from, to, provisional: today <= end, note: today <= end ? PROVISIONAL : '',
    takings, net, tips, tickets,
    methods: METHODS.filter((m) => paid[m]).map((m) => ({ method: m, amount: paid[m] })),
    staff, commissions: staff.reduce((v, x) => v + x.commission, 0),
    // tips paid by card come in with the salon's money: owed to the barber; cash tips he kept at the chair
    tipsOwed: staff.filter((x) => x.tipsCard).map((x) => ({ id: x.id, name: x.name, amount: x.tipsCard })),
    giftcards: g ? { sold: g.issued, used: g.redeemed, outstanding: g.closing } : { sold: 0, used: 0, outstanding: 0 }
  };
}

