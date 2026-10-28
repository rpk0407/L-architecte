// @ts-check
// The monthly membership's commands (PAY-02). The provider's calls (a checkout, a refund, the subscription itself) stay in
// the routes (PAY-03): these only record what the provider said, and each is idempotent, so a webhook seen twice, or
// arriving out of order, changes nothing more. What a member's month covers is read in domain/membership.js.
//   startMembership   a checkout was made: the file (found by number, else created) and a pending member
//   memberPaid        an invoice paid: the first one activates; each one is a numbered ticket and one more paid period
//   memberFailed      an invoice refused: grace while the provider retries, one text per invoice
//   memberSync        the provider's view of the subscription (a cancellation made in its portal, the end)
//   requestCancel     the client or the salon cancels: effect at the end of the paid period
//   withdrawMember    the 14-day withdrawal: the first payment less the cuts taken
//   endMember         the end, as the provider or the owner says it
// No pause, no SEPA, no plan change, no adoption of a subscription in v1: member.paused, member.resumed,
// member.planChanged and member.adopted are reserved, and nothing here writes them.
// Every member event carries data.cid (the file), so an erasure of the file reaches its personal data.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, oneOf, id, day, either, parse } from '../lib/validate.js';
import { addDays, fmtTime, dayParts, pad2 } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { TEMPLATES } from '../core/templates.js';
import { queueMessage } from '../domain/messages.js';
import { noticeMail, ownerAlert, originOf } from '../domain/notices.js';
import { planOf } from '../settings/membership.js';
import { cgvVersionOf } from '../settings/shop.js';
import { statusIn, periodIn, rootOf, membersOf, liveIn, withdrawRefund, canWithdraw, dateWords, dayOf } from '../domain/membership.js';
import { clientParts } from './clients.js';
import { checkout } from './sales.js';
import { getClient } from './common.js';

/** The provider's webhooks and the scheduler (the demo's simulated billing): never a person. */
const machine = (ctx) => ctx.actor.t === 'system' || ctx.actor.t === 'provider';
function needMachine(ctx) { if (!machine(ctx)) fail(403, 'forbidden', 'Réservé au paiement en ligne.'); }
/**
 * The salon acts through member.manage; a client only on his own file, as the route vouches for it in the ctx: the
 * session's file (meta.me.cid, AC-01's runAs) or the member a verified link names (meta.memberId, PAY-03's token
 * routes). Never a cid from the input: a route that forwards the body would let anyone name any file.
 */
function needOwnerOrSelf(s, ctx, m) {
  if (machine(ctx)) return;
  if (ctx.actor.t === 'staff') { ctx.need('member.manage'); return; }
  const meta = ctx.meta || {};
  if (meta.memberId && meta.memberId === m.id) return;
  const cid = meta.me && typeof meta.me.cid === 'string' ? meta.me.cid : '';
  if (!cid || rootOf(s, cid) !== rootOf(s, m.cid)) fail(403, 'forbidden', 'Cet abonnement n’est pas le tien.');
}

const ref = () => str({ min: 3, max: 120, pattern: /^[A-Za-z0-9_.:-]+$/ });
/** a day of the salon, or a provider's instant (ms) */
const when = () => either([day(), int({ min: 0, max: 8.64e15 })]);
const httpsUrl = () => str({ max: 500, pattern: /^https:\/\/[^\s]+$/ });

/** @param {any} s @param {{ id?: string, ref?: string }} x */
function memberRef(s, x) {
  const m = x.id ? s.members.get(x.id) : x.ref ? s.members.get(s.memberByRef.get(x.ref) || '') : null;
  if (!m) fail(404, 'not_found', 'Abonnement introuvable.');
  return m;
}

/**
 * {lien}: the member's own page (PAY-03 signs it, ctx.meta.memberLink), else nothing: the site's cancellation page
 * (/resilier) comes with PAY-04, and a dead link in an acknowledgement is worse than none.
 */
function linkOf(ctx, m, o) {
  if (ctx.meta && typeof ctx.meta.memberLink === 'function') return String(ctx.meta.memberLink(m, o) || '');
  return '';
}
/** The welcome's « Réserve tes coupes » link: the member's page, else the site where he books (not the cancellation page). */
function bookLinkOf(ctx, m) {
  if (ctx.meta && typeof ctx.meta.memberLink === 'function') return String(ctx.meta.memberLink(m) || '');
  const o = originOf(ctx);
  return o ? o + '/' : '';
}
/** Who to write to: the file as it is now (through a merge), else what was typed at the checkout. */
function contactOf(s, m) {
  const cid = rootOf(s, m.cid);
  const c = cid ? s.clients.get(cid) : null;
  const live = c && !c.erased ? c : null;
  return { cid, first: (live && live.first) || m.first || '', phone: (live && live.phone) || m.phone || '', email: (live && live.email) || m.email || '', sms: !live || live.sms !== false };
}
/**
 * One of the member texts. legal (an acknowledgement): sent even to a file that took service texts off, the law asks for
 * it; the others follow the file's choice.
 */
function memberText(s, ctx, m, template, key, vars = {}, legal = false) {
  const k = contactOf(s, m);
  if (!k.phone || (!legal && !k.sms)) return null;
  const own = (s.settings.messages.templates || {})[template];
  return queueMessage(s, ctx, {
    key, template, ...(own ? {} : { text: /** @type {any} */ (TEMPLATES)[template] }), to: k.phone, cid: k.cid,
    vars: { prenom: k.first, formule: m.name, prix: fmtEur(m.price), lien: linkOf(ctx, m), salon: s.settings.shop.name, ...vars }
  });
}
const hello = (first) => 'Bonjour' + (first ? ' ' + first : '') + ',';
const shopLine = (s) => s.settings.shop.name + (s.settings.shop.phone ? ' · ' + s.settings.shop.phone : '');
/** "2 coupes par mois", "coupes illimitées, une tous les 7 jours au plus" */
function coverage(m) {
  const n = m.cuts ? m.cuts + (m.cuts > 1 ? ' coupes' : ' coupe') + ' par mois' : 'coupes illimitées';
  return n + (m.minDays ? ', une tous les ' + m.minDays + ' jours au plus' : '');
}
const servicesOf = (s, m) => m.serviceIds.map((x) => (s.services.get(x) || {}).name).filter(Boolean).join(', ');
/** 27/10: the dates of a text (the mails say them in words) */
const ddmm = (d) => { const p = dayParts(d); return pad2(p.d) + '/' + pad2(p.m); };
/** the message ids that left, for the member's acks */
const ids = (...list) => /** @type {string[]} */ (list.filter(Boolean));

/* ---------------- a checkout was made ---------------- */

const startSchema = obj({
  id: opt(str({ min: 4, max: 64, pattern: /^mb_[A-Za-z0-9_-]+$/ })), planId: str({ min: 2, max: 24 }),
  first: str({ min: 1, max: 40 }), phone: str({ min: 6, max: 32 }), email: opt(str({ max: 120, lower: true })), clientId: opt(id()),
  provider: str({ min: 2, max: 20, pattern: /^[a-z0-9-]+$/ }), providerRef: ref(), url: opt(httpsUrl()), exp: opt(int({ min: 0, max: 8.64e15 })),
  channel: oneOf(/** @type {const} */ (['online', 'salon', 'import'])), startNow: opt(bool()), cgv: opt(str({ max: 20 })), demoFail: opt(bool())
});

/**
 * Record a membership whose checkout the provider just made (PAY-03), as the system: the client's file first, found by his
 * number (or the one the salon offered it from), else created, so every member event names its file; then the member,
 * pending until paid. The same checkout twice gives the first answer. One live membership per file: 409 already.
 */
export const startMembership = {
  run(s, input, ctx) {
    if (ctx.actor.t === 'staff') ctx.need('client.edit');
    else needMachine(ctx);
    const x = parse(startSchema, input);
    if (ctx.actor.t === 'staff' && x.channel !== 'salon') fail(403, 'forbidden', 'Au comptoir, l’abonnement se propose depuis la fiche du client.');
    const known = s.memberByRef.get(x.providerRef);
    // a person at the counter learns nothing of another file from a reference
    if (known) { const m = s.members.get(known); return ctx.actor.t === 'staff' ? { already: true } : { already: true, id: known, cid: m ? rootOf(s, m.cid) : null }; }
    const M = s.settings.membership;
    if (!M || !M.enabled) fail(409, 'off', 'Les abonnements ne sont pas ouverts.');
    const plan = planOf(s.settings, x.planId);
    if (!plan || !plan.active) fail(404, 'not_found', 'Formule introuvable.');
    if (x.channel === 'online' && plan.online === false) fail(409, 'offline', 'Cette formule se prend au salon.');
    if (x.id && s.members.has(x.id)) fail(409, 'exists', 'Cet abonnement existe déjà.');
    const { pii } = clientParts({ first: x.first, phone: x.phone, ...(x.email ? { email: x.email } : {}) });
    if (!pii.phone) fail(400, 'invalid', 'Numéro de téléphone invalide.');
    let cid = null;
    if (x.clientId) {
      const c = getClient(s, x.clientId);
      if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
      cid = c.id;
    } else if (s.clientByPhone.has(pii.phone)) cid = rootOf(s, s.clientByPhone.get(pii.phone));
    if (cid && membersOf(s, cid).some((m) => liveIn(s, m, ctx.local.day))) fail(409, 'already', 'Tu as déjà un abonnement.');
    let created = false;
    if (!cid) {
      cid = ctx.id('cl');
      ctx.emit('client.added', { id: cid, cid, source: x.channel === 'online' ? 'site' : 'salon', sms: true, marketing: false, tags: [] }, pii);
      created = true;
    }
    const mid = x.id || ctx.id('mb');
    ctx.emit('member.created', {
      id: mid, cid, clientId: cid, planId: plan.id, name: plan.name, price: plan.price, cuts: plan.cuts, minDays: plan.minDays ?? (plan.cuts ? 0 : 7),
      serviceIds: [...plan.serviceIds], vat: plan.vat ?? s.settings.payments.vat, provider: x.provider, providerRef: x.providerRef, url: x.url || null,
      exp: x.exp || ctx.now + 24 * 3600000, channel: x.channel, startNow: x.startNow !== false, cgv: x.cgv || cgvVersionOf(s.settings.shop),
      // the demo's simulated billing refuses this member's next renewal once (steps/sim-billing.js)
      ...(x.demoFail && s.mode === 'demo' ? { demoFail: true } : {})
    }, { first: pii.first || '', phone: pii.phone, ...(pii.email ? { email: pii.email } : {}) });
    return { id: mid, cid, clientCreated: created };
  }
};

/* ---------------- an invoice paid ---------------- */

// chargeRef: what the provider refunds (Stripe's charge or payment intent), never the invoice: the Comptoir's online
// refund and the withdrawal send it as it is
const paidSchema = obj({
  id: opt(id()), ref: opt(ref()), invoice: ref(), amount: int({ min: 50, max: 100000 }), periodStart: when(), periodEnd: when(),
  chargeRef: ref(), customer: opt(ref()), subscription: opt(ref()), card: opt(str({ max: 40 }))
});

/**
 * An invoice the provider says is paid. Seen twice: { already }. The first one activates the member (welcome text and
 * mail, the contract's acknowledgement). Each one is a payment of kind 'membership' and a numbered ticket of one
 * 'membership' line at the plan's VAT, paid online, with no barber; after today's Z it opens tomorrow's till.
 */
export const memberPaid = {
  run(s, input, ctx) {
    needMachine(ctx);
    const x = parse(paidSchema, input);
    const m = memberRef(s, x);
    const seen = m.periods.find((p) => p.invoice === x.invoice);
    if (seen) return { already: true, id: m.id, saleId: seen.saleId, paymentId: seen.paymentId };
    if (m.ended || m.withdrawn) fail(409, 'ended', 'Cet abonnement est terminé : ce paiement est à rembourser.');
    const start = dayOf(x.periodStart), end = dayOf(x.periodEnd);
    if (!(start < end) || end > addDays(start, 62)) fail(400, 'invalid', 'Période invalide.');
    if (m.periods.some((p) => p.start < end && start < p.end)) fail(409, 'overlap', 'Cette période est déjà payée.');
    // cancelled before this period: it covers nothing (the provider's end may come later than the effective day)
    if (m.cancel && m.cancel.effective <= start) fail(409, 'ended', 'Cet abonnement est résilié : ce paiement est à rembourser.');
    const first = !m.activatedAt;
    const cid = rootOf(s, m.cid);
    const c = cid ? s.clients.get(cid) : null;
    const file = c && !c.erased ? c.id : null;
    // two checkouts of one file both paid (a double click, two tabs): the second one is refunded, never a second contract
    if (first && cid && membersOf(s, cid).some((o) => o.id !== m.id && liveIn(s, o, ctx.local.day))) fail(409, 'already', 'Ce client a déjà un abonnement en cours : ce paiement est à rembourser.');

    if (first) {
      const k = contactOf(s, m);
      // PAY-04: the mail's links live through the withdrawal period (its last day + 1), not the texts' usual week
      const link = linkOf(ctx, m, { until: addDays(start, 15) });
      const sms = memberText(s, ctx, m, 'memberWelcome', 'mwel_' + m.id, { lien: bookLinkOf(ctx, m) }, true);
      const mail = noticeMail(s, ctx, {
        key: 'mwelm_' + m.id, template: 'memberWelcome', legal: true, to: k.email, cid,
        subject: 'Ton abonnement ' + m.name + ' est actif · ' + s.settings.shop.name,
        lines: [
          hello(k.first), '',
          'Ton abonnement ' + m.name + ' est actif depuis le ' + dateWords(start) + '.',
          m.name + ' : ' + fmtEur(m.price) + ' par mois, ' + coverage(m) + '.',
          'Prestations incluses : ' + servicesOf(s, m) + '.',
          'Prochain prélèvement : le ' + dateWords(end) + '.', '',
          'Sans engagement : tu résilies quand tu veux, l’abonnement s’arrête à la fin du mois payé.',
          'Tu peux aussi te rétracter pendant 14 jours : on te rembourse ce mois, moins les coupes déjà faites.',
          ...(link ? ['', 'Gérer ou résilier mon abonnement : ' + link] : []),
          // PAY-04: the withdrawal function, shown while it is open (until the 14th day after this one)
          ...(link && link.includes('/abo/') ? ['Renoncer au contrat ici (jusqu’au ' + dateWords(addDays(start, 14)) + ') : ' + link + '?renoncer'] : []),
          '', shopLine(s)
        ],
        button: link ? { label: 'Mon abonnement', url: link } : null
      });
      // a file erased since the checkout: its erasure already ran, so the processor's references are not kept under it
      ctx.emit('member.activated', { id: m.id, clientId: cid, cid, msgIds: ids(sms, mail) }, file ? { customer: x.customer || '', subscription: x.subscription || '', card: x.card || '' } : undefined);
    }

    const pid = ctx.id('py');
    ctx.emit('payment.created', {
      id: pid, kind: 'membership', amount: x.amount, provider: m.provider, providerRef: x.chargeRef, url: null, apptId: null,
      exp: ctx.now, label: ('Abonnement ' + m.name).slice(0, 80), memberId: m.id, cid: cid || undefined
    });
    // as every payment since PAY-01: no processor customer or card id in the chain (a member's live in pii, above)
    ctx.emit('payment.succeeded', { id: pid, chargeRef: x.chargeRef, ...(cid ? { cid } : {}) });
    // the till's rule for a sale made by the system: allowed here because only a provider or the scheduler gets this far
    const till = { ...ctx, can: (cap) => cap === 'sale.create' || ctx.can(cap), need: (cap) => { if (cap !== 'sale.create') ctx.need(cap); } };
    const res = checkout.run(s, {
      clientId: file || undefined, online: true,
      lines: [{ kind: 'membership', memberId: m.id, unit: x.amount, period: { start, end } }],
      payments: [{ method: 'online', amount: x.amount, ref: pid }]
    }, till);
    ctx.emit('member.renewed', { id: m.id, invoice: x.invoice, periodStart: start, periodEnd: end, amount: x.amount, paymentId: pid, saleId: res.id, cid: cid || undefined });
    return { id: m.id, first, saleId: res.id, number: res.number, day: res.day, paymentId: pid };
  }
};

/* ---------------- an invoice refused ---------------- */

const failedSchema = obj({ id: opt(id()), ref: opt(ref()), invoice: ref(), attempt: opt(int({ min: 1, max: 30 })), nextAt: opt(int({ min: 0, max: 8.64e15 })), url: opt(httpsUrl()), action: opt(bool()) });

/**
 * A renewal the bank refused (or asks to confirm: action, 3-D Secure). The member keeps his cuts for graceDays while
 * the provider retries; one text per invoice, memberAction when the bank asks him to confirm, memberFailed otherwise,
 * with the provider's page to fix it (url) or his own page. A later attempt only moves the next try.
 */
export const memberFailed = {
  run(s, input, ctx) {
    needMachine(ctx);
    const x = parse(failedSchema, input);
    const m = memberRef(s, x);
    if (m.periods.some((p) => p.invoice === x.invoice)) return { already: true, paid: true };
    if (m.ended || m.withdrawn || !m.activatedAt) return { already: true, ended: !!(m.ended || m.withdrawn) };
    const attempt = x.attempt || 1;
    if (m.pastDue && m.pastDue.invoice === x.invoice && attempt <= m.pastDue.attempt) return { already: true };
    const msg = memberText(s, ctx, m, x.action ? 'memberAction' : 'memberFailed', 'mfail_' + m.id + '_' + x.invoice, x.url ? { lien: x.url } : {});
    ctx.emit('member.pastDue', { id: m.id, invoice: x.invoice, attempt, nextAt: x.nextAt || 0, action: !!x.action, cid: rootOf(s, m.cid) || undefined });
    return { ok: true, messageId: msg };
  }
};

/* ---------------- the end, a cancellation ---------------- */

/** member.ended, with the text and the owner's alert when it stops for want of payment. */
function end(s, ctx, m, reason) {
  const cid = rootOf(s, m.cid) || undefined;
  ctx.emit('member.ended', { id: m.id, reason, cid });
  // never paid: there was no contract to stop, nobody to tell
  if (reason === 'unpaid' && m.activatedAt) {
    memberText(s, ctx, m, 'memberEnded', 'mend_' + m.id);
    ownerAlert(s, ctx, { key: 'omend_' + m.id, cid, subject: 'Abonnement arrêté faute de paiement : ' + (contactOf(s, m).first || 'un client') + ' · ' + m.name, lines: ['Les nouveaux essais de paiement n’ont rien donné : l’abonnement ' + m.name + ' (' + fmtEur(m.price) + '/mois) est arrêté.'] });
  }
}

const CHANNEL_FR = { site: 'sur le site', moi: 'depuis son espace', comptoir: 'au salon', stripe: 'chez Stripe' };
/**
 * The cancellation and its acknowledgement (SMS and e-mail: the day received, the day it takes effect, what stays
 * included until then). effective: the first day it covers nothing; today: it ends now.
 */
function cancel(s, ctx, m, o) {
  const today = ctx.local.day;
  const cid = rootOf(s, m.cid) || undefined;
  const now = o.effective <= today;
  const last = now ? today : addDays(o.effective, -1);
  const k = contactOf(s, m);
  const link = linkOf(ctx, m);
  // an end today covers nothing more: the text says so instead of « incluses jusqu'au » today
  const sms = m.activatedAt ? (now ? memberText(s, ctx, m, 'memberStopped', 'mcx_' + m.id, { date: ddmm(today) }, true)
    : memberText(s, ctx, m, 'memberCancelled', 'mcx_' + m.id, { date: ddmm(today), fin: ddmm(last) }, true)) : null;
  const mail = m.activatedAt ? noticeMail(s, ctx, {
    key: 'mcxm_' + m.id, template: now ? 'memberStopped' : 'memberCancelled', legal: true, to: k.email, cid: cid || null,
    subject: 'Résiliation de ton abonnement ' + m.name + ' · ' + s.settings.shop.name,
    lines: [
      hello(k.first), '',
      'Nous avons bien reçu ta résiliation le ' + dateWords(today) + ' à ' + fmtTime(ctx.local.min) + '.',
      now ? 'Ton abonnement ' + m.name + ' prend fin aujourd’hui : plus rien ne sera prélevé.'
        : 'Ton abonnement ' + m.name + ' prend fin le ' + dateWords(last) + ' au soir : plus rien ne sera prélevé.',
      ...(now ? [] : ['D’ici là, tes coupes restent incluses (' + coverage(m) + ').']),
      '', 'Ce message vaut accusé de réception de ta résiliation.',
      ...(link ? ['', 'Mon abonnement : ' + link] : []),
      '', shopLine(s)
    ],
    button: link ? { label: 'Mon abonnement', url: link } : null
  }) : null;
  // verified false: asked without the member's link nor his session (PAY-03's /resilier fallback), the salon confirms it
  ctx.emit('member.cancelRequested', { id: m.id, at: ctx.now, effective: o.effective, by: o.by, channel: o.channel, msgIds: ids(sms, mail), ...(o.verified === false ? { verified: false } : {}), cid }, o.reason ? { reason: o.reason } : undefined);
  // the client's own cancellation, here or in the provider's portal (by 'provider', channel 'stripe'): the owner hears of it
  if ((o.by === 'client' || o.channel === 'stripe') && ctx.actor.t !== 'staff' && m.activatedAt) ownerAlert(s, ctx, { key: 'omcx_' + m.id, cid, subject: 'Résiliation d’abonnement : ' + (k.first || 'un client') + ' · ' + m.name, lines: ['Résilié ' + (CHANNEL_FR[o.channel] || '') + ' le ' + dateWords(today) + '. ' + (now ? 'Fin immédiate.' : 'Coupes incluses jusqu’au ' + dateWords(last) + ', plus rien n’est prélevé ensuite.')] });
  if (now) ctx.emit('member.ended', { id: m.id, reason: m.activatedAt ? 'cancelled' : 'abandoned', cid });
  return { id: m.id, effective: o.effective, last, ended: now, msgIds: ids(sms, mail) };
}

// no cid: the client's file is the one the ctx vouches for (needOwnerOrSelf); a cid in the body is dropped
const cancelSchema = obj({
  id: id(), by: oneOf(/** @type {const} */ (['client', 'salon', 'provider'])), channel: oneOf(/** @type {const} */ (['site', 'moi', 'comptoir', 'stripe'])),
  now: opt(bool()), reason: opt(str({ max: 200 })), verified: opt(bool())
});
/**
 * Cancel: it takes effect at the end of the paid period (the cuts stay included until then), or today when nothing is
 * paid for today (a renewal failed, a checkout never paid). now: the owner stops it today (« Résilier tout de suite »).
 */
export const requestCancel = {
  run(s, input, ctx) {
    const x = parse(cancelSchema, input);
    const m = memberRef(s, x);
    needOwnerOrSelf(s, ctx, m);
    if (x.now && !machine(ctx)) ctx.need('member.manage');
    if (ctx.actor.t === 'client' && x.by !== 'client') fail(403, 'forbidden', 'Réservé au salon.');
    if (m.cancel && !m.ended) return { already: true, id: m.id, effective: m.cancel.effective };
    const today = ctx.local.day;
    if (statusIn(s, m, today) === 'ended') fail(409, 'ended', 'Cet abonnement est déjà terminé.');
    const p = periodIn(s, m, today);
    const effective = x.now ? today : p && p.paid ? p.end : today;
    return cancel(s, ctx, m, { effective, by: x.by, channel: x.channel, reason: x.reason || '', verified: x.verified });
  }
};

const syncSchema = obj({
  id: opt(id()), ref: opt(ref()),
  snapshot: obj({ status: opt(str({ max: 30 })), cancelAt: opt(when()), pausedUntil: opt(when()) })
});
const ENDED_STATUS = { canceled: 'cancelled', unpaid: 'unpaid', incomplete_expired: 'abandoned' };
/**
 * The provider's view of the subscription, written only where it differs: a cancellation made in its portal gets the
 * same acknowledgement as one made here; an ended subscription ends the member. pausedUntil is read in a later version.
 */
export const memberSync = {
  run(s, input, ctx) {
    needMachine(ctx);
    const x = parse(syncSchema, input);
    const m = memberRef(s, x);
    if (m.ended || m.withdrawn) return { changed: [] };
    const st = x.snapshot.status || '';
    const reason = Object.hasOwn(ENDED_STATUS, st) ? ENDED_STATUS[st] : '';
    const changed = [];
    if (reason === 'cancelled' && m.activatedAt && !m.cancel) {
      // cancelled at once in the provider's portal: the same acknowledgement as here, and the end today (cancel does both)
      cancel(s, ctx, m, { effective: ctx.local.day, by: 'provider', channel: 'stripe', reason: '' });
      changed.push('cancel', 'ended');
    } else if (reason) {
      end(s, ctx, m, reason === 'cancelled' && !m.activatedAt ? 'abandoned' : reason);
      changed.push('ended');
    } else if (x.snapshot.cancelAt != null && !m.cancel && m.activatedAt) {
      cancel(s, ctx, m, { effective: dayOf(x.snapshot.cancelAt), by: 'provider', channel: 'stripe', reason: '' });
      changed.push('cancel');
    }
    return { changed };
  }
};

// refund: the salon's own amount (member.manage) or the provider's; a client always gets withdrawRefund. No cid, as above.
const withdrawSchema = obj({ id: id(), refund: opt(int({ min: 0, max: 100000 })), by: opt(oneOf(/** @type {const} */ (['client', 'salon']))) });
/**
 * The 14-day withdrawal (rétractation): the contract ends now and the first payment goes back, less the cuts already
 * taken at their value (withdrawRefund). The money moves at the provider and through an ordinary credit note on the
 * membership ticket (the route, PAY-03): the answer names that ticket and the amount.
 */
export const withdrawMember = {
  run(s, input, ctx) {
    const x = parse(withdrawSchema, input);
    const m = memberRef(s, x);
    needOwnerOrSelf(s, ctx, m);
    const self = ctx.actor.t === 'client';
    if (self && x.by && x.by !== 'client') fail(403, 'forbidden', 'Réservé au salon.');
    const first = m.periods[0];
    if (m.withdrawn) return { already: true, id: m.id, refund: m.withdrawn.refund, saleId: first ? first.saleId : null };
    const today = ctx.local.day;
    if (!canWithdraw(m, today)) fail(409, 'late', m.activatedAt && !m.ended ? 'Le délai de rétractation de 14 jours est passé : il reste la résiliation.' : 'Cet abonnement n’est pas en cours.');
    const due = withdrawRefund(m, today);
    // the client never sets the amount: the law's (the month less the cuts taken, L221-25)
    const refund = self ? due : x.refund ?? due;
    if (refund > (first ? first.amount : 0)) fail(400, 'invalid', 'Au plus ' + fmtEur(first ? first.amount : 0, { decimals: true }) + ' à rembourser.');
    const used = m.uses.length;
    const cid = rootOf(s, m.cid) || undefined;
    const k = contactOf(s, m);
    const link = linkOf(ctx, m);
    const amount = fmtEur(refund, { decimals: refund % 100 !== 0 });
    const sms = refund ? memberText(s, ctx, m, 'memberWithdrawn', 'mwd_' + m.id, { date: ddmm(today), montant: amount }, true)
      : memberText(s, ctx, m, 'memberWithdrawnNone', 'mwd_' + m.id, { date: ddmm(today) }, true);
    const mail = noticeMail(s, ctx, {
      key: 'mwdm_' + m.id, template: 'memberWithdrawn', legal: true, to: k.email, cid: cid || null,
      subject: 'Rétractation de ton abonnement ' + m.name + ' · ' + s.settings.shop.name,
      lines: [
        hello(k.first), '',
        'Nous avons bien reçu ta rétractation le ' + dateWords(today) + ' à ' + fmtTime(ctx.local.min) + '. Ton abonnement ' + m.name + ' est arrêté.',
        refund ? 'Nous te remboursons ' + amount + ' sous 14 jours, sur la carte du paiement' + (used ? ' (le mois payé, moins ' + used + (used > 1 ? ' coupes déjà faites' : ' coupe déjà faite') + ').' : '.')
          : 'Les coupes déjà faites valent le mois payé : il n’y a rien à rembourser.',
        '', 'Ce message vaut accusé de réception de ta rétractation.', '', shopLine(s)
      ],
      button: link ? { label: 'Mon abonnement', url: link } : null
    });
    ctx.emit('member.withdrawn', { id: m.id, at: ctx.now, refund, used, msgIds: ids(sms, mail), cid });
    ctx.emit('member.ended', { id: m.id, reason: 'withdrawn', cid });
    // meta.refundsAfter: the route refunds right after and tells the owner how it went (PAY-03), never « à rembourser » twice
    if ((self || (machine(ctx) && x.by !== 'salon')) && !(ctx.meta && ctx.meta.refundsAfter)) ownerAlert(s, ctx, { key: 'omwd_' + m.id, cid, subject: 'Rétractation d’abonnement : ' + (k.first || 'un client') + ' · ' + m.name, lines: ['À rembourser : ' + amount + (first ? ' sur le ticket de l’abonnement' : '') + '.'] });
    return { id: m.id, refund, used, saleId: first ? first.saleId : null, paymentId: first ? first.paymentId : null };
  }
};

const endSchema = obj({ id: opt(id()), ref: opt(ref()), reason: oneOf(/** @type {const} */ (['cancelled', 'unpaid', 'withdrawn', 'abandoned'])) });
/** The end, as the provider says it (subscription deleted, retries exhausted) or as the owner decides it. */
export const endMember = {
  run(s, input, ctx) {
    if (!machine(ctx)) ctx.need('member.manage');
    const x = parse(endSchema, input);
    const m = memberRef(s, x);
    if (m.ended || m.withdrawn) return { already: true, id: m.id };
    end(s, ctx, m, x.reason === 'cancelled' && !m.activatedAt ? 'abandoned' : x.reason);
    return { id: m.id, ended: true };
  }
};
