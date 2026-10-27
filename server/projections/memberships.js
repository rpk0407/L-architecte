// @ts-check
// Les abonnements (PAY-02), as the projection folds them. Registered in core/extensions.js; the commands are in
// commands/memberships.js, the reading of a member (what today covers, his status) in domain/membership.js.
// No import of the engine or the state here (see core/extensions.js).
//
// s.members: id → {
//   id, cid (the client file, as when it was written: rootOf follows a merge), planId, name, price, cuts (0: illimité),
//   minDays, serviceIds, vat — what he signed for, kept when the owner changes the plan —, provider, providerRef, url, exp
//   (the checkout and when it lapses), channel ('online'|'salon'|'import'), startNow, cgv, demoFail, createdAt,
//   first, phone, email (pii of member.created), customer, subscription, card (pii of member.activated: 'Visa •• 4242'),
//   activatedAt (0: pending), periods [{ start, end, invoice, amount, paymentId, saleId, at }] (paid, by start),
//   invoices (every invoice seen paid or failed, so a webhook seen twice changes nothing), pastDue { invoice, attempt,
//   nextAt, action, at } | null (the failure being retried), failed (every invoice ever refused), uses [{ saleId, periodStart, day, forced, at }],
//   cancel { at, effective, by, channel, reason, verified?: false (asked from /resilier without link nor session, until the
//   salon confirms it) } | null, withdrawn { at, refund, used } | null, ended { at, reason } | null,
//   acks [{ kind: 'welcome'|'cancel'|'withdraw', at, msgIds }] (the acknowledgements sent: PAY-04 says « Confirmation
//   envoyée le … » or « Envoi en cours » from those messages' status), disputes? [{ id, paymentId, status, at }] (PAY-03:
//   chargebacks on its months, folded from payment.disputed and payment.disputeClosed; absent until the first) }
// s.memberByRef: the provider's references (checkout, subscription) → member id. The subscription comes from pii, so an
// erasure (refused while the contract runs, commands/clients.js) takes it out with the rest; the checkout's stays.
// member.paused, member.resumed, member.planChanged and member.adopted are reserved names: no command writes them in v1.
import { fmtEur } from '../../shared/money.js';

/** @param {any} s @param {string} id */
const get = (s, id) => (s.members ? s.members.get(id) : null);

/** the member a payment paid a month of */
function memberOfPayment(s, pid) {
  const py = s.payments.get(pid);
  return py && py.kind === 'membership' && py.memberId ? get(s, py.memberId) : null;
}

/** the first name on the file (or the one typed at the checkout), for the feed */
function firstOf(s, m) {
  let c = m.cid ? s.clients.get(m.cid) : null;
  for (let i = 0; c && c.mergedInto && i < 20; i++) c = s.clients.get(c.mergedInto) || null;
  return (c && !c.erased && c.first) || m.first || 'Client';
}
const REASON_FR = { cancelled: 'résilié', unpaid: 'faute de paiement', withdrawn: 'rétractation', abandoned: 'paiement jamais fait' };
const dm = (day) => (typeof day === 'string' ? day.slice(8, 10) + '/' + day.slice(5, 7) : '');

/** @type {import('../core/extensions.js').Extension} */
export const membershipsExtension = {
  init(s) { s.members = new Map(); s.memberByRef = new Map(); },
  on: {
    'member.created': (s, e, d, p) => {
      s.members.set(d.id, {
        id: d.id, cid: d.cid || d.clientId || null, planId: d.planId, name: d.name, price: d.price, cuts: d.cuts, minDays: d.minDays || 0,
        serviceIds: d.serviceIds || [], vat: d.vat ?? 0, provider: d.provider || '', providerRef: d.providerRef || null, url: d.url || null, exp: d.exp || 0,
        channel: d.channel || 'online', startNow: d.startNow !== false, cgv: d.cgv || '', demoFail: !!d.demoFail, createdAt: e.at,
        first: p.first || '', phone: p.phone || '', email: p.email || '', customer: '', subscription: '', card: '',
        activatedAt: 0, periods: [], invoices: [], failed: [], pastDue: null, uses: [], cancel: null, withdrawn: null, ended: null, acks: []
      });
      if (d.providerRef) s.memberByRef.set(d.providerRef, d.id);
    },
    'member.activated': (s, e, d, p) => {
      const m = get(s, d.id);
      if (!m) return;
      Object.assign(m, { activatedAt: m.activatedAt || e.at, cid: d.clientId || m.cid, customer: p.customer || m.customer, subscription: p.subscription || m.subscription, card: p.card || m.card });
      if (m.subscription) s.memberByRef.set(m.subscription, m.id);
      if (d.msgIds && d.msgIds.length) m.acks.push({ kind: 'welcome', at: e.at, msgIds: d.msgIds });
    },
    'member.renewed': (s, e, d) => {
      const m = get(s, d.id);
      if (!m || m.periods.some((x) => x.invoice === d.invoice)) return;
      m.periods.push({ start: d.periodStart, end: d.periodEnd, invoice: d.invoice, amount: d.amount, paymentId: d.paymentId || null, saleId: d.saleId || null, at: e.at });
      m.periods.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
      if (!m.invoices.includes(d.invoice)) m.invoices.push(d.invoice);
      // paid: whatever failed before is behind
      m.pastDue = null;
    },
    'member.pastDue': (s, e, d) => {
      const m = get(s, d.id);
      if (!m) return;
      m.pastDue = { invoice: d.invoice, attempt: d.attempt || 1, nextAt: d.nextAt || 0, action: !!d.action, at: m.pastDue && m.pastDue.invoice === d.invoice ? m.pastDue.at : e.at };
      if (!m.invoices.includes(d.invoice)) m.invoices.push(d.invoice);
      if (!m.failed.includes(d.invoice)) m.failed.push(d.invoice);
    },
    'member.used': (s, e, d) => {
      const m = get(s, d.id);
      if (m) m.uses.push({ saleId: d.saleId, periodStart: d.periodStart, day: d.day, forced: !!d.forced, at: e.at });
    },
    'member.cancelRequested': (s, e, d, p) => {
      const m = get(s, d.id);
      if (!m) return;
      m.cancel = { at: e.at, effective: d.effective, by: d.by, channel: d.channel, reason: p.reason || '', ...(d.verified === false ? { verified: false } : {}) };
      if (d.msgIds && d.msgIds.length) m.acks.push({ kind: 'cancel', at: e.at, msgIds: d.msgIds });
    },
    // PAY-03: the salon confirmed a cancellation asked without the member's link
    'member.cancelConfirmed': (s, e, d) => { const m = get(s, d.id); if (m && m.cancel) delete m.cancel.verified; },
    'member.withdrawn': (s, e, d) => {
      const m = get(s, d.id);
      if (!m) return;
      m.withdrawn = { at: e.at, refund: d.refund, used: d.used };
      if (d.msgIds && d.msgIds.length) m.acks.push({ kind: 'withdraw', at: e.at, msgIds: d.msgIds });
    },
    // a chargeback on one of its months (PAY-03): while it is open or lost the member reads unpaid (domain/membership.js)
    'payment.disputed': (s, e, d) => {
      const m = memberOfPayment(s, d.id);
      if (!m || !d.dispute) return;
      // kept only once there is one, so a member's record without any keeps its shape
      if (!m.disputes) m.disputes = [];
      if (!m.disputes.some((x) => x.id === d.dispute.id)) m.disputes.push({ id: d.dispute.id, paymentId: d.id, status: 'open', at: e.at });
    },
    'payment.disputeClosed': (s, e, d) => {
      const m = memberOfPayment(s, d.id);
      const x = m && m.disputes ? m.disputes.find((y) => y.id === d.disputeId) : null;
      if (x) x.status = d.status;
    },
    'member.ended': (s, e, d) => { const m = get(s, d.id); if (m && !m.ended) m.ended = { at: e.at, reason: d.reason || 'cancelled' }; },
    // the file's members lose what names or reaches the person; the contract's figures (the books') stay
    'client.erased': (s, e, d) => {
      const ids = new Set(d.ids || [d.id]);
      for (const m of s.members.values()) {
        if (!ids.has(m.cid)) continue;
        Object.assign(m, { first: '', phone: '', email: '', customer: '', subscription: '', card: '' });
        if (m.cancel) m.cancel.reason = '';
        // the processor's ids from pii go; the checkout's reference is the chain's (member.created), kept so a payment
        // arriving after the erasure still finds its member (and is recorded without them, commands/memberships.js)
        for (const [k, v] of s.memberByRef) if (v === m.id && k !== m.providerRef) s.memberByRef.delete(k);
      }
    }
  },
  feed: ['member.activated', 'member.pastDue', 'member.cancelRequested', 'member.ended'],
  // the salon's contracts: who manages them (owner, manager), never a barber, even one shown the revenue
  // (team.barberSeeRevenue gives report.shop)
  item(r, f) {
    if (!r.caps.has('member.manage')) return null;
    const m = get(r.s, f.data.id);
    if (!m) return null;
    const base = { v: f.v, at: f.at, by: f.actor.t, kind: 'member', memberId: m.id, clientId: m.cid, staffId: null };
    const who = firstOf(r.s, m);
    switch (f.type) {
      case 'member.activated': return { ...base, title: 'Nouvel abonné · ' + who + ' · ' + m.name, sub: fmtEur(m.price) + '/mois', money: true };
      case 'member.pastDue': return { ...base, title: 'Paiement d’abonnement refusé · ' + who, sub: m.name + (f.data.action ? ' · validation demandée par la banque' : ' · nouvel essai prévu') };
      case 'member.cancelRequested': return { ...base, title: 'Résiliation · ' + who + ' · ' + m.name, sub: 'Fin le ' + dm(f.data.effective) };
      case 'member.ended': return { ...base, title: 'Abonnement terminé · ' + who, sub: m.name + ' · ' + (REASON_FR[f.data.reason] || 'résilié') };
      default: return null;
    }
  }
};
