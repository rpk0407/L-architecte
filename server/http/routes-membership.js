// @ts-check
// The monthly membership's API (PAY-03), every self-service and owner action behind one file:
//   public   the plans; subscribe (a Stripe Billing checkout, or the demo's test page); the member's own page under a
//            signed link that expires (memberToken: 7 days in a text, 1 hour when asked from /resilier): read, cancel,
//            withdraw within 14 days, change the card; « send me my link » by number or e-mail; and the cancellation for
//            whoever has lost both (recorded unverified, the salon confirms it)
//   Comptoir the members' list, the owner's figures, an offer texted from the counter, cancel (now, with a goodwill
//            refund), the card link, and « re-read Stripe now »
// The client session's twins (/api/me/membership*) are PAY-04's. Money moves at the provider here, then PAY-02's
// commands record it; every command run from here carries ctx.meta.memberLink, so its texts link the member's page.
import { HttpError, guard, limited, json } from './kit.js';
import { waitUntil } from '@vercel/functions';
import { dispatchNow } from './scheduler.js';
import { newId, normPhone, isEmail, sha256 } from '../lib/util.js';
import { addDays, diffDays, instantOf, localParts, fmtTime, dayParts, pad2 } from '../../shared/dates.js';
import { moneyMode, providerFor, providerLabel } from '../payments/provider.js';
import { memberMeta, billingOf, cancelAtProvider, syncMember } from '../payments/billing.js';
import { readMemberToken, memberToken, MEMBER_TEXT_TTL, MEMBER_ASK_TTL } from '../auth/member-token.js';
import { planOf } from '../settings/membership.js';
import { cgvVersionOf } from '../settings/shop.js';
import { startMembership, requestCancel, withdrawMember, endMember } from '../commands/memberships.js';
import { sendMemberLink, offerMember, sendCardLink, requestCancelUnverified, confirmCancel, ackScheduledCancel, ackStoppedNow, billingAlert, contactOf } from '../commands/member-billing.js';
import { paymentRefundedOutside } from '../commands/payments.js';
import { refund as refundSale } from '../commands/sales.js';
import { providerKnown, outsideOpen } from '../projections/payments.js';
import { statusIn, periodIn, membersOf, liveIn, canWithdraw, withdrawRefund, abandoned, mrr, graceOf, disputeHeld, dateWords, cover, coverWords, label as coverLabel, rootOf } from '../domain/membership.js';
import { LINK_IP_PER_HOUR, LINK_PER_DAY, linkIpKey, linkPhoneKey } from '../domain/linkcap.js';

const HOUR = 3600000, DAY = 86400000;
/** a start the client did not ask to be now: the day after the 14 days of withdrawal, early, before the salon opens */
export const START_DAYS = 14;
const START_MIN = 6 * 60;
export const SOON = 'Les abonnements arrivent bientôt : parles-en au salon.';
export const EXPIRED = 'Ce lien a expiré : demande-en un nouveau.';
export const LOOKUP_PHONE = 'Si un abonnement existe à ce numéro, tu reçois un SMS dans un instant.';
export const LOOKUP_EMAIL = 'Si un abonnement existe à cette adresse, tu reçois ton lien dans un instant, par e-mail et par SMS.';
export const ALREADY = 'Tu as déjà un abonnement : on t’envoie le lien pour le gérer.';
// the answers that must not say whether a number, an address or a name is known: same words, about the same time
const MIN_MS = 450, JITTER_MS = 200;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// the actor is chained and can never be erased: no name and no number in it (the person travels as pii)
const SYSTEM = (r) => ({ actor: /** @type {const} */ ({ t: 'system', id: 'memberships' }), caps: new Set(), meta: memberMeta(r) });
/** a client the route vouches for: the member a verified link names (needOwnerOrSelf in commands/memberships.js) */
const SELF = (r, m, ttl = MEMBER_TEXT_TTL) => ({ actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { ...memberMeta(r, ttl), ...(m ? { memberId: m.id } : {}) } });
/** the system's credit note on a membership ticket (the withdrawal), keyed so a retry writes it once */
const REFUNDER = (r, key) => ({ actor: /** @type {const} */ ({ t: 'system', id: 'memberships' }), caps: new Set(['sale.refund']), meta: memberMeta(r), requestId: key });
/**
 * r.run with the member's link in meta, so the texts and mails of a member command run from the Comptoir link his page:
 * the same actor (device included) and the same keys per request as app.js's r.run (a retried request replays its
 * answers: one SMS). A route uses this one only, never both.
 */
function staffRun(r) {
  let n = 0;
  const rq = (r.req && r.req.headers.get('x-request-id')) || undefined;
  const meta = memberMeta(r);
  return (cmd, input) => {
    const i = n++;
    return r.rt.engine.run(cmd, input, { actor: { t: 'staff', id: r.me.id, n: r.me.name, ...(r.device ? { dev: r.device.id } : {}) }, staff: r.me, caps: r.caps, meta, requestId: rq && i ? rq + ':' + i : rq });
  };
}

/** New membership money runs only where it is real or plainly the demo's (PAY-01: never a test key in production). */
const open = (r) => { const m = moneyMode(r); return (m === 'demo' || m === 'live') && !!r.rt.pay.caps.billing && !!r.rt.pay.createSubscription; };
const ddmm = (d) => { const p = dayParts(d); return pad2(p.d) + '/' + pad2(p.m); };
/** « 2 coupes par mois · Coupe classique », « 1 coupe tous les 7 jours · Coupe classique, Coupe + contour » */
function coverWordsOf(s, plan) {
  const n = plan.cuts ? plan.cuts + (plan.cuts > 1 ? ' coupes' : ' coupe') + ' par mois' : plan.minDays ? '1 coupe tous les ' + plan.minDays + ' jours' : 'coupes illimitées';
  const names = (plan.serviceIds || []).map((x) => (s.services.get(x) || {}).name).filter(Boolean);
  return n + (names.length ? ' · ' + names.join(', ') : '');
}
/** the member's page, signed for ttl (up to the next 10-minute mark: a retry gives Stripe the same success address) */
const pageOf = (r, id, ttl = MEMBER_TEXT_TTL) => r.origin + '/abo/' + memberToken(r.rt.secret, id, Math.ceil((r.now + ttl) / 600000) * 600000);
/** the line above Stripe's button for a start in 14 days: its page would otherwise speak of a « trial » */
const startNote = (day) => 'Ton abonnement commence le ' + dateWords(addDays(day, START_DAYS)) + ' : rien n’est prélevé avant.';
/** the instant a start not asked for now takes effect */
const startAtOf = (day) => instantOf(addDays(day, START_DAYS), START_MIN);

/** When a checkout page lapses, on the salon's clock: the provider counts its lifetime on its own. */
const lapse = (r, co) => r.now + Math.max(0, co.exp - Date.now());

/** The member a link names; an altered one is 404, a genuine one past its time 410. */
function memberFromToken(r) {
  const t = readMemberToken(r.rt.secret, r.params.token, r.now);
  if ('error' in t) throw t.error === 'expired' ? new HttpError(410, 'expired', EXPIRED) : new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
  const m = r.s.members.get(t.id);
  if (!m) throw new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
  return m;
}

/** What a message became, for « Confirmation envoyée le … » or « Envoi en cours » (PAY-04). */
const SENT = new Set(['sent', 'simulated', 'delivered']);
function acksOf(s, m) {
  return m.acks.map((a) => {
    const list = a.msgIds.map((id) => s.messages.get(id)).filter(Boolean);
    const left = list.filter((x) => SENT.has(x.status));
    return { kind: a.kind, at: a.at, sent: list.length > 0 && left.length === list.length, sentAt: left.reduce((t, x) => Math.max(t, x.updatedAt || x.at || 0), 0) || null };
  });
}

/**
 * The member page's data (/abo/:token, PAY-04): the plan in words, where he stands, this month's cuts, the next charge,
 * the card's label, the withdrawal while it is open and what it would give back, what he may do. No number, no e-mail.
 */
export function memberView(r, m) {
  const s = r.s, day = r.local.day;
  const status = abandoned(m, r.now) ? 'ended' : statusIn(s, m, day);
  const p = periodIn(s, m, day);
  const used = p ? m.uses.filter((u) => u.periodStart === p.start).length : 0;
  const k = contactOf(s, m);
  const live = status !== 'ended';
  const startDay = !m.activatedAt && !m.startNow ? addDays(localParts(m.createdAt).day, START_DAYS) : null;
  const next = !live || m.cancel ? null : p && p.paid ? { amount: m.price, day: p.end } : p ? { amount: m.price, day: p.start } : startDay ? { amount: m.price, day: startDay } : null;
  const wd = canWithdraw(m, day);
  const caps = r.rt.pay.caps || {};
  return {
    id: m.id, first: k.first, status, startDay,
    plan: { id: m.planId, name: m.name, price: m.price, cuts: m.cuts, minDays: m.minDays, words: coverWordsOf(s, m), services: m.serviceIds.map((x) => { const sv = s.services.get(x); return sv ? { id: sv.id, name: sv.name, slug: sv.slug || null } : null; }).filter(Boolean) },
    used, of: m.cuts, period: p ? { start: p.start, end: p.end, last: addDays(p.grace && p.until ? p.until : p.end, -1), paid: !!p.paid } : null,
    next, card: m.card || '', pastDue: m.pastDue && live ? { since: m.pastDue.at, action: !!m.pastDue.action } : null,
    cancel: m.cancel ? { at: m.cancel.at, effective: m.cancel.effective, last: addDays(m.cancel.effective, -1), by: m.cancel.by, verified: m.cancel.verified !== false } : null,
    withdraw: wd ? { until: addDays(localParts(m.activatedAt).day, 14), refund: withdrawRefund(m, day), used: m.uses.length } : null,
    withdrawn: m.withdrawn ? { at: m.withdrawn.at, refund: m.withdrawn.refund } : null,
    ended: status === 'ended' ? { reason: m.withdrawn ? 'withdrawn' : m.ended ? m.ended.reason : 'cancelled' } : null,
    actions: { cancel: live && !m.cancel, withdraw: wd, card: live && !!m.activatedAt && !!caps.portal && (m.provider === 'simulated' || !!m.customer) },
    acks: acksOf(s, m), shop: { name: s.settings.shop.name, phone: s.settings.shop.phone }
  };
}

/** One line of Clients › Abonnés. full: who manages the contracts sees a payment in trouble and the card (views.js memberCards). */
function rowOf(s, m, now, full) {
  const day = localParts(now).day;
  const status = abandoned(m, now) ? 'ended' : statusIn(s, m, day);
  const p = periodIn(s, m, day);
  const k = contactOf(s, m);
  const hide = !full && (status === 'grace' || status === 'unpaid');
  // stopped before the end it had been given (« Résilier tout de suite » after a cancellation at the month's end): its last day is that day
  const endDay = m.ended ? localParts(m.ended.at).day : '';
  const live = status !== 'ended';
  const period = paidPeriodOf(m, p);
  return {
    id: m.id, clientId: k.cid, first: k.first, plan: m.name, planId: m.planId, price: m.price, status: hide ? 'active' : status, channel: m.channel,
    used: p ? m.uses.filter((u) => u.periodStart === p.start).length : 0, of: m.cuts, until: p ? addDays(p.grace && p.until ? p.until : p.end, -1) : null,
    cancelAt: m.cancel ? (endDay && endDay < m.cancel.effective ? endDay : addDays(m.cancel.effective, -1)) : null, cancelVerified: m.cancel ? m.cancel.verified !== false : null,
    pastDueSince: full && m.pastDue && status !== 'ended' ? m.pastDue.at : null, card: full ? m.card || '' : '',
    disputed: full ? (m.disputes || []).some((x) => x.status === 'open' || x.status === 'lost') : false,
    // a barber never reads a payment in trouble: an end for want of payment is an end to him
    since: m.activatedAt || null, endedAt: m.ended ? m.ended.at : null, endReason: m.withdrawn ? 'withdrawn' : m.ended ? (!full && m.ended.reason === 'unpaid' ? 'ended' : m.ended.reason) : '',
    // PAY-05: the next charge (as memberView says it) and what « Résilier tout de suite » would give back (0: nothing to)
    next: !live || m.cancel || hide ? null : p && p.paid ? p.end : p ? p.start : null, refund: full && live ? unusedRefund(period, day) : 0
  };
}

/** The paid month a period is, as the member holds it (its amount and ticket), or null. @param {any} m @param {any} p */
const paidPeriodOf = (m, p) => (p && p.paid ? m.periods.find((x) => x.start === p.start) || null : null);
/** « Résilier tout de suite » with the switch on: the month's unused days, pro rata, of what it cost (the owner's goodwill). */
function unusedRefund(period, day) {
  if (!period) return 0;
  const total = Math.max(1, diffDays(period.start, period.end));
  const unused = Math.max(0, diffDays(day, period.end) - 1);
  return Math.min(period.amount, Math.round((period.amount * unused) / total));
}

/* ---------------- the owner's figures, memoised per journal version and day ---------------- */

const sums = new WeakMap();
/**
 * Abonnés at a glance (PAY-05's strip, TEAM's cockpit): who runs, MRR, who joined and who left over 30 days, churn,
 * payments in trouble, and this month's covered cuts worth at list price against what the months brought in.
 * @param {any} s @param {number} now
 */
export function membershipSummary(s, now) {
  const day = localParts(now).day;
  const memo = sums.get(s);
  if (memo && memo.v === s.version && memo.day === day) return memo.out;
  const from = addDays(day, -30), month = day.slice(0, 7);
  // disputed: held by a chargeback (open or lost), apart from the payments in trouble: billing waits for the owner's call
  const count = { pending: 0, active: 0, grace: 0, unpaid: 0, ending: 0, paused: 0, disputed: 0 };
  let joined = 0, left = 0, base = 0, cuts = 0, value = 0, collected = 0;
  for (const m of s.members.values()) {
    const st0 = abandoned(m, now) ? 'ended' : statusIn(s, m, day);
    const st = st0 === 'unpaid' && disputeHeld(m) ? 'disputed' : st0;
    if (st !== 'ended') count[st] = (count[st] || 0) + 1;
    if (m.activatedAt && localParts(m.activatedAt).day >= from) joined++;
    // a contract that ran and was cancelled, withdrawn or ended in the window (a checkout never paid is no departure)
    const stopAt = !m.activatedAt ? 0 : m.cancel ? m.cancel.at : m.withdrawn ? m.withdrawn.at : m.ended ? m.ended.at : 0;
    if (stopAt && localParts(stopAt).day >= from) left++;
    if (m.activatedAt && liveIn(s, m, from)) base++;
    for (const u of m.uses) {
      if (!u.day.startsWith(month)) continue;
      cuts++;
      const sale = s.sales.get(u.saleId);
      for (const l of (sale && sale.lines) || []) if (l.memberId === m.id && l.kind === 'service') value += l.listPrice || 0;
    }
    for (const pr of m.periods) if (localParts(pr.at).day.startsWith(month)) collected += pr.amount;
  }
  const out = {
    day, ...count, live: count.active + count.grace + count.unpaid + count.ending + count.disputed, mrr: mrr(s, day), graceDays: graceOf(s),
    days30: { joined, left, churn: base ? Math.round((left * 1000) / base) / 10 : 0 },
    troubled: count.grace + count.unpaid, month: { month, cuts, value, collected }
  };
  sums.set(s, { v: s.version, day, out });
  return out;
}

/* ---------------- money back on a membership ticket ---------------- */

/**
 * Give back `amount` of a month on its own ticket: at the provider first (keyed, so a retry refunds nothing more), then
 * the credit note (keyed too). A credit note refused after the money moved (the day's Z already done) is recorded as
 * a refund made at the provider, so Caisse shows « fais l'avoir » and nothing is invisible. As at the till (PAY-01
 * tillRefund): what the provider gave back that no credit note records yet (that very refund, on a first try whose
 * credit note was refused) is not refunded again, nor recorded again, on a second try.
 * @param {any} r @param {{ paymentId: string, saleId: string, amount: number, key: string, reason: string, as?: (cmd: any, input: any) => Promise<any> }} o
 * @returns {Promise<{ ok: boolean, error?: string, refundId?: string }>} refundId: the credit note, when it is written
 */
async function refundMonth(r, o) {
  const py = r.s.payments.get(o.paymentId);
  const sale = r.s.sales.get(o.saleId);
  if (!py || !sale || !(o.amount > 0)) return { ok: false, error: 'rien à rembourser' };
  // already given back on this ticket for this reason (a retry): the provider's key and the credit note's say the same
  const noteOf = () => (r.s.sales.get(o.saleId).refundIds || []).find((id) => { const x = r.s.refunds.get(id); return !!x && x.reason === o.reason; });
  if (noteOf()) return { ok: true, refundId: noteOf() };
  const part = o.amount - Math.min(o.amount, outsideOpen(r.s, py));
  let ref = 'outside';
  if (part > 0) {
    try {
      const prov = providerFor(r.rt, py.provider);
      const charge = py.chargeRef || (prov.name === 'simulated' ? py.providerRef : (await prov.retrieveCharge(py.providerRef)).chargeRef) || '';
      // an invoice paid without a PaymentIntent nor a charge names only itself: Stripe cannot refund that reference
      if (!charge || (prov.name !== 'simulated' && !/^(pi|ch)_/.test(charge))) throw new Error('paiement sans référence remboursable ici : rembourse-le depuis le tableau de bord de ' + providerLabel(prov.name));
      ref = (await prov.refund(charge, part, o.key)).ref;
    } catch (e) {
      const why = (e && (/** @type {any} */ (e).detail || /** @type {any} */ (e).message)) || 'erreur';
      console.error('[lx] membership refund failed', py.id, why);
      return { ok: false, error: String(why).slice(0, 200) };
    }
  }
  const known = providerKnown(r.s, py);
  const input = { saleId: sale.id, amount: o.amount, method: 'online', reason: o.reason, providerRef: ref };
  try { await (o.as ? o.as(refundSale, input) : r.rt.engine.run(refundSale, input, REFUNDER(r, o.key))); }
  catch (e) {
    console.error('[lx] membership credit note not written', sale.id, e && /** @type {any} */ (e).message);
    if (part > 0) {
      try { await r.rt.engine.run(paymentRefundedOutside, { id: py.id, total: known + part, providerRefund: ref }, { actor: { t: 'provider', id: py.provider }, caps: new Set(), meta: r.meta }); }
      catch (e2) { console.error('[lx] membership refund not recorded', py.id, e2 && /** @type {any} */ (e2).message); }
    }
    return { ok: true };
  }
  return { ok: true, refundId: noteOf() };
}

/** The live member a file already has, through its merges. */
const liveOf = (s, cid, day) => (cid ? membersOf(s, cid).find((m) => liveIn(s, m, day)) || null : null);

/**
 * @param {any} app
 * @param {{ minMs?: number, jitterMs?: number, later?: (p: Promise<any>) => void }} [o] tests shorten the wait and await the work
 */
export function membershipRoutes(app, o = {}) {
  const minMs = o.minMs ?? MIN_MS, jitterMs = o.jitterMs ?? JITTER_MS, later = o.later || waitUntil;
  /** the same answer, after the same time, whatever the work found: the work finishes after it */
  const constant = async (fn) => {
    const answer = wait(minMs + Math.random() * jitterMs);
    later((async () => { try { await fn(); } catch (e) { console.error('[lx] membership ask', e && /** @type {any} */ (e).message); } })());
    await answer;
  };

  /* ---------------- public: the plans, subscribing ---------------- */

  app.get('/api/public/memberships', (r) => {
    const s = r.s, M = s.settings.membership || {};
    const plans = (M.plans || []).filter((p) => p.active !== false && p.online !== false).map((p) => ({
      id: p.id, name: p.name, price: p.price, cuts: p.cuts, minDays: p.minDays || 0, blurb: p.blurb || '', words: coverWordsOf(s, p),
      services: p.serviceIds.map((x) => { const sv = s.services.get(x); return sv ? { id: sv.id, name: sv.name, slug: sv.slug || null } : null; }).filter(Boolean)
    }));
    // live: the site shows the block and its button; sepa: no SEPA in v1; startDay: the day a start not asked for now begins
    return json({ live: !!M.enabled && open(r) && plans.length > 0, sepa: false, plans, startDay: addDays(r.local.day, START_DAYS), cgv: cgvVersionOf(s.settings.shop) }, 200, { 'cache-control': 'public, max-age=0, s-maxage=20, stale-while-revalidate=60' });
  });

  /**
   * Subscribe from the site: { planId, first, phone, email (the durable medium of the contract), startNow (the unticked
   * box: start now, so a withdrawal pays what was used), cgv (the version shown) } → the provider's checkout page.
   * A number with a live membership gets its link by SMS and a 409 already instead.
   */
  app.post('/api/public/memberships', async (r) => {
    guard('mbr|' + r.ip, 5, 60000, 'Trop de demandes d’un coup. Patiente une minute.');
    guard('mbrh|' + r.ip, 20, HOUR, 'Trop de demandes depuis cet appareil. Appelle le salon.');
    const s = r.s, b = r.body || {};
    if (!open(r) || !(s.settings.membership && s.settings.membership.enabled)) throw new HttpError(409, 'soon', SOON);
    const plan = planOf(s.settings, String(b.planId || ''));
    if (!plan || plan.active === false || plan.online === false) throw new HttpError(404, 'not_found', 'Formule introuvable.');
    const first = String(b.first || '').trim().slice(0, 40);
    const phone = normPhone(String(b.phone || '').slice(0, 32));
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    if (!first) throw new HttpError(400, 'invalid', 'Indique ton prénom.');
    if (!phone) throw new HttpError(400, 'invalid', 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
    if (!isEmail(email)) throw new HttpError(400, 'invalid', 'Indique ton e-mail : il reçoit la confirmation de ton abonnement.');
    const startNow = b.startNow === true;
    const day = r.local.day;
    const known = liveOf(s, s.clientByPhone.get(phone), day);
    if (known) {
      if (!limited(linkPhoneKey(phone), LINK_PER_DAY, DAY)) {
        const res = await r.rt.engine.run(sendMemberLink, { memberId: known.id }, SELF(r, null, MEMBER_ASK_TTL));
        if (res.ids) await dispatchNow(r.rt, res.ids);
      }
      throw new HttpError(409, 'already', ALREADY);
    }
    const prov = r.rt.pay;
    const id = newId('mb');
    const startAt = startNow ? 0 : startAtOf(day);
    const page = pageOf(r, id);
    const price = await prov.ensurePrice(plan, plan.price);
    const co = await prov.createSubscription({ id, price, planId: plan.id, name: plan.name, email, startNow, startAt, sepa: false, ...(startNow ? {} : { note: startNote(day) }), successUrl: page + '?paiement=ok', cancelUrl: r.origin + '/?abonnement=annule' });
    await r.rt.engine.run(startMembership, {
      id, planId: plan.id, first, phone, email, provider: prov.name, providerRef: co.ref, ...(/^https:\/\//.test(co.url) ? { url: co.url } : {}),
      // a start in 14 days waits that long for its first payment: it is not abandoned when the checkout page closes
      exp: startNow ? lapse(r, co) : startAt + 2 * DAY, channel: 'online', startNow, cgv: String(b.cgv || '').slice(0, 20) || undefined
    }, SYSTEM(r));
    return json({ url: co.url, page }, 201);
  });

  /* ---------------- public: « send me my link », and the cancellation without it ---------------- */

  /** { phone } or { email }: the link by SMS and e-mail to what the file holds; the answer never says whether it exists. */
  app.post('/api/public/memberships/lookup', async (r) => {
    guard(linkIpKey(r.ip), LINK_IP_PER_HOUR, HOUR, 'Trop de demandes depuis cet appareil. Réessaie dans une heure ou appelle le salon.');
    const b = r.body || {};
    const phone = b.phone ? normPhone(String(b.phone).slice(0, 32)) : '';
    const email = !phone && b.email ? String(b.email).trim().toLowerCase().slice(0, 120) : '';
    if (!phone && !isEmail(email)) throw new HttpError(400, 'invalid', b.email ? 'Vérifie ton e-mail.' : 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
    // past 3 asks a day the number (or address) gets nothing more, and the asker is not told
    const key = phone ? linkPhoneKey(phone) : 'linke|' + email;
    if (!limited(key, LINK_PER_DAY, DAY)) {
      await constant(async () => {
        const res = await r.rt.engine.run(sendMemberLink, phone ? { phone } : { email }, SELF(r, null, MEMBER_ASK_TTL));
        // asked for now: it leaves now, not at the next tick
        if (res.ids) await dispatchNow(r.rt, res.ids);
      });
    } else await constant(async () => {});
    return { ok: true, message: phone ? LOOKUP_PHONE : LOOKUP_EMAIL };
  });

  /**
   * Neither the phone nor the mailbox any more: { first, email (the subscription's), replyTo? }. A match is recorded as a
   * cancellation received now, to be confirmed by the salon; the answer is the same, with the time it was received.
   */
  app.post('/api/public/memberships/cancel-request', async (r) => {
    guard('mbcx|' + r.ip, 5, HOUR, 'Trop de demandes depuis cet appareil. Réessaie dans une heure ou appelle le salon.');
    const b = r.body || {};
    const first = String(b.first || '').trim().slice(0, 40);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    const replyTo = String(b.replyTo || '').trim().toLowerCase().slice(0, 120);
    if (!first) throw new HttpError(400, 'invalid', 'Indique ton prénom.');
    if (!isEmail(email)) throw new HttpError(400, 'invalid', 'Indique l’e-mail de ton abonnement.');
    if (replyTo && !isEmail(replyTo)) throw new HttpError(400, 'invalid', 'Vérifie l’e-mail où te répondre.');
    const at = r.now, L = localParts(at);
    const key = 'mbcxe|' + email;
    if (!limited(key, 3, DAY)) {
      await constant(async () => {
        await r.rt.engine.run(requestCancelUnverified, { first, email, ...(replyTo ? { replyTo } : {}) }, SELF(r, null));
      });
    } else await constant(async () => {});
    return { ok: true, at, message: 'Demande de résiliation reçue le ' + ddmm(L.day) + ' à ' + fmtTime(L.min) + '. Si elle correspond à un abonnement en cours, tu reçois l’accusé de réception par e-mail ; le salon la confirme.' };
  });

  /* ---------------- public: the member's own page ---------------- */

  app.get('/api/public/memberships/:token', (r) => {
    guard('mbv|' + r.ip, 60, 60000);
    return memberView(r, memberFromToken(r));
  });

  /**
   * The offer's short link (texted from the counter): on to the checkout while it waits, else the member's page.
   * Only ever to the address recorded for this member, so it redirects nowhere else.
   */
  app.get('/api/public/memberships/:token/pay', (r) => {
    const m = memberFromToken(r);
    const url = !m.activatedAt && !m.ended && !abandoned(m, r.now) ? m.url || (m.provider === 'simulated' ? r.origin + '/paiement/' + encodeURIComponent(m.id) : '') : '';
    return new Response(null, { status: 302, headers: { location: url || r.origin + '/abo/' + r.params.token, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  });

  /** Cancel: at the end of the paid period (or today when nothing is paid for today), recorded first, then at Stripe. */
  app.post('/api/public/memberships/:token/cancel', async (r) => {
    guard('mbx|' + r.ip, 10, 60000);
    const m = memberFromToken(r);
    const reason = r.body && r.body.reason ? String(r.body.reason).slice(0, 200) : undefined;
    const res = await r.rt.engine.run(requestCancel, { id: m.id, by: 'client', channel: 'site', ...(reason ? { reason } : {}) }, SELF(r, m));
    const cur = r.s.members.get(m.id);
    // a retry after a failed provider call tries it again: Stripe's calls are idempotent
    await cancelAtProvider(r, cur, { now: !!(cur.ended || (cur.cancel && cur.cancel.effective <= r.local.day)) });
    if (!cur.activatedAt) await r.rt.engine.run(ackScheduledCancel, { id: cur.id }, SELF(r, cur));
    return { cancelled: { at: cur.cancel ? cur.cancel.at : r.now, effective: res.effective, last: addDays(res.effective, -1), ended: !!cur.ended }, member: memberView(r, cur) };
  });

  /**
   * Withdraw within 14 days of the first payment (rétractation): recorded first (the moment the law counts, and the
   * acknowledgement), then the subscription deleted, then the first month less the cuts taken given back on its ticket.
   */
  app.post('/api/public/memberships/:token/withdraw', async (r) => {
    guard('mbx|' + r.ip, 10, 60000);
    const m = memberFromToken(r);
    // refundsAfter: PAY-02's « à rembourser » to the owner is replaced by the outcome of the refund made below
    const self = SELF(r, m);
    await r.rt.engine.run(withdrawMember, { id: m.id, by: 'client' }, { ...self, meta: { ...self.meta, refundsAfter: true } });
    const cur = r.s.members.get(m.id);
    await cancelAtProvider(r, cur, { now: true });
    const first = cur.periods[0];
    const refund = cur.withdrawn ? cur.withdrawn.refund : 0;
    const money = refund > 0 && first ? await refundMonth(r, { paymentId: first.paymentId, saleId: first.saleId, amount: refund, key: 'mbwd-' + cur.id, reason: 'Rétractation de l’abonnement' }) : { ok: true };
    if (cur.withdrawn) {
      try { await r.rt.engine.run(billingAlert, { kind: 'withdrawn', memberId: cur.id, ok: money.ok, ...(money.refundId ? { refundId: money.refundId } : {}), ...(money.error ? { error: money.error } : {}) }, SYSTEM(r)); }
      catch (e) { console.error('[lx] withdrawal alert', cur.id, e && /** @type {any} */ (e).message); }
    }
    return { withdrawn: { at: cur.withdrawn ? cur.withdrawn.at : r.now, refund, refunded: money.ok }, member: memberView(r, cur) };
  });

  /** Change the card: Stripe's hosted page (its portal, on the payment-method flow), or the demo's. */
  app.post('/api/public/memberships/:token/card', async (r) => {
    guard('mbx|' + r.ip, 10, 60000);
    const m = memberFromToken(r);
    if (!m.activatedAt || m.ended || m.withdrawn) throw new HttpError(409, 'ended', 'Cet abonnement n’est pas en cours.');
    const back = r.origin + '/abo/' + r.params.token;
    const p = m.provider === 'simulated' ? providerFor(r.rt, 'simulated') : billingOf(r, m);
    if (p && p.name === 'simulated' && p.portalUrl) return p.portalUrl('', back, { ref: m.id });
    if (!p || !p.portalUrl || !m.customer) throw new HttpError(409, 'no_portal', 'Le changement de carte se fait au salon pour l’instant.');
    return p.portalUrl(m.customer, back);
  });

  /* ---------------- the Comptoir ---------------- */

  /**
   * Clients › Abonnés. Opening it also catches up, at most 5 a request and once an hour each, the members whose month
   * ended more than a day ago without a renewal recorded (a notice Stripe never delivered); within CATCH_UP_MS, so a
   * slow Stripe never holds the list: the rest waits for the next visit.
   */
  app.get('/api/v1/memberships', async (r) => {
    const s = r.s, day = r.local.day, full = r.caps.has('member.manage');
    // PAY-05: one file's memberships (the client file's block); the catch-up is the board's, not every file's
    const only = r.query.get('clientId');
    if (full && !only) {
      const late = [...s.members.values()].filter((m) => m.activatedAt && !m.ended && !m.withdrawn && billingOf(r, m) && m.periods.length && m.periods[m.periods.length - 1].end < addDays(day, -1) && !(m.cancel && m.cancel.effective <= day) && !recently(m.id, r.now)).slice(0, 5);
      const until = Date.now() + CATCH_UP_MS;
      for (const m of late) {
        if (Date.now() > until) break;
        mark(m.id, r.now);
        try { await syncMember(r, m); } catch (e) { console.error('[lx] membership catch-up', m.id, e && /** @type {any} */ (e).message); }
      }
    }
    const rows = [...r.s.members.values()].filter((m) => (m.activatedAt || !abandoned(m, r.now)) && (!only || rootOf(s, m.cid) === rootOf(s, only))).sort((a, b) => b.createdAt - a.createdAt).map((m) => rowOf(r.s, m, r.now, full));
    return { members: rows, mrr: full ? mrr(r.s, day) : null };
  }, { cap: 'client.view' });

  app.get('/api/v1/memberships/summary', (r) => membershipSummary(r.s, r.now), { cap: 'report.shop' });

  /**
   * The till's dry check (PAY-05): would this member's plan pay for that service today? The same rule as the checkout's
   * (domain/membership.js cover), asked before ringing up so the line can say « Abonnement · coupe 1/2 » at 0 € or why it
   * stays priced. pending: the member's covered cuts already on the ticket. force: the owner or a manager may give a refused
   * cut anyway (never an ended contract), which the checkout asks of member.manage again.
   */
  app.get('/api/v1/memberships/:id/cover', (r) => {
    const s = r.s, m = s.members.get(r.params.id);
    if (!m) throw new HttpError(404, 'not_found', 'Abonnement introuvable.');
    const sv = s.services.get(String(r.query.get('serviceId') || ''));
    if (!sv) throw new HttpError(404, 'not_found', 'Prestation introuvable.');
    const pending = Math.max(0, Math.min(9, Number(r.query.get('pending')) || 0));
    const c = cover(s, m, sv.id, { day: r.local.day, pending });
    const words = c.ok ? '' : coverWords(c, sv.name);
    return {
      ok: c.ok, why: c.ok ? null : c.why, used: c.used, of: c.of, until: c.until, next: c.next || null,
      label: c.ok ? coverLabel(m, c.used + 1, c) : '', words, force: !c.ok && c.why !== 'ended' && r.caps.has('member.manage'),
      plan: m.name
    };
  }, { cap: 'sale.create' });

  /**
   * The counter offers a membership to a client's file: the same checkout (channel 'salon'), then { send: 'sms' } texts
   * him the short link (member.manage: a barber's text to a client is off by default, decision 10), or { send: 'qr' }
   * gives it to show as a QR code (client.edit). startNow only when the client asks for it. The file needs its number
   * and its e-mail: the contract's confirmation and every acknowledgement go there.
   */
  app.post('/api/v1/memberships/offer', async (r) => {
    guard('mbo|' + r.me.id, 10, 60000);
    const s = r.s, b = r.body || {};
    const run = staffRun(r);
    if (!open(r) || !(s.settings.membership && s.settings.membership.enabled)) throw new HttpError(409, 'soon', SOON);
    const c = s.clients.get(String(b.clientId || ''));
    if (!c || c.erased || c.mergedInto) throw new HttpError(404, 'not_found', 'Fiche introuvable.');
    const plan = planOf(s.settings, String(b.planId || ''));
    if (!plan || plan.active === false) throw new HttpError(404, 'not_found', 'Formule introuvable.');
    const send = b.send === 'qr' ? 'qr' : 'sms';
    if (send === 'sms' && !r.caps.has('member.manage')) throw new HttpError(403, 'forbidden', 'L’envoi par SMS est réservé au gérant : montre le QR code au client.');
    // a retried request makes the same checkout: the member's id comes from the request's, and one already recorded is given back as it is
    const rq = r.req && r.req.headers.get('x-request-id');
    const id = rq ? 'mb_o' + sha256('offer:' + r.me.id + ':' + rq).slice(0, 20) : newId('mb');
    const done = s.members.get(id);
    if (done) {
      const url = done.url || (done.provider === 'simulated' ? r.origin + '/paiement/' + encodeURIComponent(done.id) : '');
      return { id, link: r.origin + '/api/public/memberships/' + memberToken(r.rt.secret, id, Math.max(done.exp || 0, r.now + DAY)) + '/pay', url, sent: s.messages.has('msg_moffer_' + id) };
    }
    if (send === 'sms' && !c.phone) throw new HttpError(409, 'no_phone', 'Pas de numéro sur cette fiche : montre le QR code.');
    if (!c.phone) throw new HttpError(409, 'no_phone', 'Ajoute le numéro du client d’abord : l’abonnement le demande.');
    if (!c.email || !isEmail(c.email)) throw new HttpError(409, 'no_email', 'Ajoute l’e-mail du client d’abord : il reçoit la confirmation de son abonnement.');
    if (liveOf(s, c.id, r.local.day)) throw new HttpError(409, 'already', 'Ce client a déjà un abonnement en cours.');
    // one offer at a time: a second checkout of the same file would only be refunded if both were paid
    if (membersOf(s, c.id).some((m) => !m.activatedAt && !m.ended && !abandoned(m, r.now))) throw new HttpError(409, 'pending', 'Une offre d’abonnement attend déjà ce client (son lien vaut 24 heures).');
    const startNow = b.startNow === true;
    const startAt = startNow ? 0 : startAtOf(r.local.day);
    const prov = r.rt.pay;
    const price = await prov.ensurePrice(plan, plan.price);
    const co = await prov.createSubscription({ id, price, planId: plan.id, name: plan.name, email: c.email, startNow, startAt, sepa: false, expiresMin: 24 * 60 - 1, ...(startNow ? {} : { note: startNote(r.local.day) }), successUrl: pageOf(r, id) + '?paiement=ok', cancelUrl: r.origin + '/' });
    await run(startMembership, {
      id, planId: plan.id, first: c.first || 'Client', phone: c.phone, email: c.email, clientId: c.id, provider: prov.name, providerRef: co.ref,
      ...(/^https:\/\//.test(co.url) ? { url: co.url } : {}), exp: startNow ? lapse(r, co) : startAt + 2 * DAY, channel: 'salon', startNow
    });
    const link = r.origin + '/api/public/memberships/' + memberToken(r.rt.secret, id, Math.max(lapse(r, co), r.now + DAY)) + '/pay';
    let sent = null;
    if (send === 'sms') { sent = (await run(offerMember, { memberId: id, link })).id; await dispatchNow(r.rt, [sent]); }
    return { id, link, url: co.url, sent: !!sent };
  }, { cap: 'client.edit' });

  /**
   * The salon cancels. { now }: today (« Résilier tout de suite »), with { refund }: the unused days of the month paid
   * back on its ticket, the owner's goodwill. On a request made from /resilier without the link, this is the
   * confirmation: Stripe stops at the end of the paid period (at once for a start not begun, already called off).
   */
  app.post('/api/v1/memberships/:id/cancel', async (r) => {
    const m = r.s.members.get(r.params.id);
    if (!m) throw new HttpError(404, 'not_found', 'Abonnement introuvable.');
    const b = r.body || {}, day = r.local.day;
    const run = staffRun(r);
    const now = b.now === true;
    if (now && b.refund === true && !r.caps.has('sale.refund')) throw new HttpError(403, 'forbidden', 'Le remboursement demande le droit de rembourser.');
    // unverified even once ended: a start not begun is called off at once, and only this confirmation tells Stripe
    const unverified = !!(m.cancel && m.cancel.verified === false);
    // the paid month as it stands before the end, for the goodwill refund
    const period = paidPeriodOf(m, periodIn(r.s, m, day));
    // cancelled at the month's end, now stopped today: the client is told the new end
    const sooner = !!(m.cancel && !m.ended && now && m.activatedAt);
    let res;
    if (unverified) res = await run(confirmCancel, { id: m.id });
    if (m.cancel && !m.ended && now) res = await run(endMember, { id: m.id, reason: 'cancelled' });
    else if (!unverified) res = await run(requestCancel, { id: m.id, by: 'salon', channel: 'comptoir', now });
    const cur = r.s.members.get(m.id);
    const provider = await cancelAtProvider(r, cur, { now: !!(cur.ended || (cur.cancel && cur.cancel.effective <= day)) });
    if (!cur.activatedAt) await run(ackScheduledCancel, { id: cur.id });
    if (sooner && cur.ended) await run(ackStoppedNow, { id: cur.id });
    let refunded = null;
    if (now && b.refund === true && period && cur.ended) {
      const amount = unusedRefund(period, day);
      if (amount > 0) {
        const done = await refundMonth(r, { paymentId: period.paymentId, saleId: period.saleId, amount, key: 'mbcx-' + m.id + '-' + period.invoice, reason: 'Résiliation : jours non utilisés', as: run });
        refunded = { amount, ok: done.ok, ...(done.error ? { error: done.error } : {}) };
      }
    }
    return {
      // stopped before the end it had been given: today
      id: m.id, effective: cur.cancel ? (cur.ended && cur.cancel.effective > day ? day : cur.cancel.effective) : day, ended: !!cur.ended, confirmed: unverified,
      provider: provider.ok ? { ok: true } : { ok: false, error: 'Stripe n’a pas pris la résiliation (' + provider.error + ') : « Relire Stripe » réessaie.' }, refunded, already: !!(res && res.already)
    };
  }, { cap: 'member.manage' });

  /** The member's card page by SMS (his own page, which opens Stripe's): a failed card is fixed without coming in. */
  app.post('/api/v1/memberships/:id/card-link', async (r) => {
    guard('mbc|' + r.me.id, 10, 60000);
    const res = await staffRun(r)(sendCardLink, { id: r.params.id });
    if (res.id) await dispatchNow(r.rt, [res.id]);
    return { sent: true };
  }, { cap: 'member.manage' });

  /** Re-read Stripe now: the subscription, then its latest invoice (a missed notice, a doubt at the counter). */
  app.post('/api/v1/memberships/:id/sync', async (r) => {
    guard('mbs|' + r.me.id, 20, 60000);
    const m = r.s.members.get(r.params.id);
    if (!m) throw new HttpError(404, 'not_found', 'Abonnement introuvable.');
    mark(m.id, r.now);
    const out = await syncMember(r, m);
    return { ...(out && out.ignored ? { ignored: out.ignored } : { ok: true }), member: rowOf(r.s, r.s.members.get(m.id), r.now, true) };
  }, { cap: 'member.manage' });
}

/** the list's catch-up asks Stripe about a member at most once an hour per instance, and stops after this long */
const seen = new Map();
const CATCH_UP_MS = 3000;
const recently = (id, now) => { const t = seen.get(id); return !!t && now - t < HOUR; };
/** only the members actually asked about are marked: the ones left for the next visit are not skipped for an hour */
function mark(id, now) {
  if (seen.size > 2000) seen.clear();
  seen.set(id, now);
}

