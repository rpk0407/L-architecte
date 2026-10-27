// @ts-check
// The membership's messages around Stripe Billing (PAY-03): what PAY-02's commands do not send. Each is idempotent per
// key (queueMessage writes a key once) and none moves money: the provider's calls stay in the routes and in
// payments/billing.js.
//   sendMemberLink      a member asks for his page (/resilier, by number or e-mail): SMS and e-mail to the contact on file
//   offerMember         the salon texts a client the page that starts his membership (memberOffer)
//   sendCardLink        the salon texts a member the page that changes his card (memberCard)
//   requestCancelUnverified  /resilier without the phone nor the mailbox: recorded unverified, the salon confirms it
//   confirmCancel       the salon's confirmation of it (member.cancelConfirmed)
//   memberScheduled     a start in 14 days: the contract's confirmation by e-mail when the checkout is done
//   ackScheduledCancel  that start called off before it began: its acknowledgement
//   billingAlert        the owner's e-mails: a dispute, a refund made at Stripe without a credit note, money sent back
import { fail } from '../core/engine.js';
import { str, opt, obj, oneOf, id, int, parse } from '../lib/validate.js';
import { normPhone, isEmail } from '../lib/util.js';
import { fmtEur } from '../../shared/money.js';
import { localParts, fmtTime, pad2, dayParts, addDays } from '../../shared/dates.js';
import { queueMessage } from '../domain/messages.js';
import { noticeMail, ownerAlert, originOf } from '../domain/notices.js';
import { TEMPLATES } from '../core/templates.js';
import { LINK_PER_DAY, linkAllowed } from '../domain/linkcap.js';
import { rootOf, membersOf, statusIn, dateWords } from '../domain/membership.js';
import { requestCancel } from './memberships.js';

const machine = (ctx) => ctx.actor.t === 'system' || ctx.actor.t === 'provider';
/** 27/10 */
const ddmm = (d) => { const p = dayParts(d); return pad2(p.d) + '/' + pad2(p.m); };
/** the default words of a text when the owner has not written his own (an older salon's settings may lack them) */
const textOf = (s, template) => ((s.settings.messages.templates || {})[template] ? undefined : /** @type {any} */ (TEMPLATES)[template]);

/** Who to write to about this member: the file as it is now (through a merge), else what was typed at the checkout. */
export function contactOf(s, m) {
  const cid = rootOf(s, m.cid);
  const c = cid ? s.clients.get(cid) : null;
  const live = c && !c.erased ? c : null;
  return { cid, first: (live && live.first) || m.first || '', phone: (live && live.phone) || m.phone || '', email: (live && live.email) || m.email || '' };
}
/** A contract that may still be managed: running, or waiting for its first payment (a start in 14 days). */
const manageable = (s, m, day) => !m.ended && !m.withdrawn && statusIn(s, m, day) !== 'ended';
/** The file's membership a person may manage, newest first. */
const manageableOf = (s, cid, day) => membersOf(s, cid).find((m) => manageable(s, m, day)) || null;

/** « éloïse » and « Eloise » are the same first name; « Jean-Luc » and « jean luc » too. */
export const sameFirst = (a, b) => {
  const n = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return !!n(a) && n(a) === n(b);
};
const sameEmail = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** The member a number or an address reaches: the number on file (never a merged file's old one), or an address on the
 *  file or typed at the checkout. null when none, so the route answers the same either way. */
function memberFor(s, x, day) {
  if (x.phone) {
    const phone = normPhone(x.phone);
    const cid = phone ? rootOf(s, s.clientByPhone.get(phone)) : null;
    const c = cid ? s.clients.get(cid) : null;
    if (!c || c.erased || c.phone !== phone) return null;
    return manageableOf(s, c.id, day);
  }
  if (!x.email) return null;
  for (const m of [...s.members.values()].sort((a, b) => b.createdAt - a.createdAt)) if (manageable(s, m, day) && (sameEmail(contactOf(s, m).email, x.email) || sameEmail(m.email, x.email))) return m;
  return null;
}

const linkSchema = obj({ phone: opt(str({ max: 32 })), email: opt(str({ max: 120, lower: true })), memberId: opt(id()) });
/**
 * The member's page by SMS to the number on file and by e-mail to the address on file, whichever was typed: the asker
 * learns nothing (the route answers the same), and only the member's own phone and mailbox get the link. One ask
 * counts once in the file's LINK_PER_DAY (domain/linkcap.js: the SMS carries the counted template; the e-mail is sent
 * only with it). memberId: the route already knows the member (POST /api/public/memberships with a live one).
 */
export const sendMemberLink = {
  run(s, input, ctx) {
    if (ctx.actor.t === 'staff') fail(403, 'forbidden', 'Réservé au client.');
    const x = parse(linkSchema, input || {});
    const day = ctx.local.day;
    const m = x.memberId ? s.members.get(x.memberId) || null : memberFor(s, x, day);
    if (!m || !manageable(s, m, day) || !ctx.meta || typeof ctx.meta.memberLink !== 'function') return { sent: false };
    const k = contactOf(s, m);
    if (!k.cid || !k.phone || !linkAllowed(s, k.cid, day)) return { sent: false };
    let n = 0;
    const key = (i) => 'mlink_' + k.cid + '_' + day + '_' + i;
    while (n < LINK_PER_DAY && s.messages.has('msg_' + key(n))) n++;
    if (n >= LINK_PER_DAY) return { sent: false };
    const link = String(ctx.meta.memberLink(m));
    const sms = queueMessage(s, ctx, { key: key(n), template: 'memberLink', text: textOf(s, 'memberLink'), to: k.phone, cid: k.cid, vars: { prenom: k.first, formule: m.name, lien: link } });
    const mail = k.email && isEmail(k.email) ? queueMessage(s, ctx, {
      key: 'mlinkm_' + k.cid + '_' + day + '_' + n, channel: 'email', template: 'memberLinkMail', to: k.email, cid: k.cid, vars: {},
      subject: 'Ton abonnement ' + m.name + ' · ' + s.settings.shop.name,
      text: ['Bonjour' + (k.first ? ' ' + k.first : '') + ',', '', 'Voici le lien pour gérer ou résilier ton abonnement ' + m.name + '. Il est valable une heure.', '', link, '', 'Tu n’as rien demandé ? Ignore ce message : rien ne change sans toi.', '', s.settings.shop.name].join('\n'),
      cta: { label: 'Mon abonnement', url: link }, links: [link]
    }) : null;
    return { sent: !!(sms || mail), ids: [sms, mail].filter(Boolean) };
  }
};

/** The salon texts a client the page where he starts the membership it offered him (the checkout, behind our own short link). */
export const offerMember = {
  run(s, input, ctx) {
    ctx.need('client.edit');
    const x = parse(obj({ memberId: id(), link: str({ max: 300, pattern: /^https?:\/\/[^\s]+$/ }) }), input);
    const m = s.members.get(x.memberId);
    if (!m || m.activatedAt || m.ended) fail(404, 'not_found', 'Abonnement introuvable.');
    const k = contactOf(s, m);
    if (!k.phone) fail(409, 'no_phone', 'Pas de numéro sur cette fiche.');
    const msg = queueMessage(s, ctx, { key: 'moffer_' + m.id, template: 'memberOffer', text: textOf(s, 'memberOffer'), to: k.phone, cid: k.cid, vars: { prenom: k.first, formule: m.name, prix: fmtEur(m.price), lien: x.link } });
    if (!msg && !s.messages.has('msg_moffer_' + m.id)) fail(409, 'not_sent', 'Ce numéro ne peut pas recevoir de SMS du salon.');
    return { id: msg || 'msg_moffer_' + m.id };
  }
};

/** The salon texts a member the page that changes his card (three a day at most). */
export const sendCardLink = {
  run(s, input, ctx) {
    ctx.need('member.manage');
    const x = parse(obj({ id: id() }), input);
    const m = s.members.get(x.id);
    if (!m || !m.activatedAt || m.ended || m.withdrawn) fail(409, 'ended', 'Cet abonnement n’est pas en cours.');
    if (!ctx.meta || typeof ctx.meta.memberLink !== 'function') fail(409, 'no_link', 'Lien indisponible.');
    const k = contactOf(s, m);
    if (!k.phone) fail(409, 'no_phone', 'Pas de numéro sur cette fiche.');
    let n = 0;
    while (n < 3 && s.messages.has('msg_mcard_' + m.id + '_' + ctx.local.day + '_' + n)) n++;
    if (n >= 3) fail(429, 'slow_down', 'Déjà envoyé trois fois aujourd’hui.');
    const msg = queueMessage(s, ctx, { key: 'mcard_' + m.id + '_' + ctx.local.day + '_' + n, template: 'memberCard', text: textOf(s, 'memberCard'), to: k.phone, cid: k.cid, vars: { prenom: k.first, formule: m.name, lien: String(ctx.meta.memberLink(m)) + '?carte' } });
    if (!msg) fail(409, 'not_sent', 'Ce numéro ne peut pas recevoir de SMS du salon.');
    return { id: msg };
  }
};

const unverifiedSchema = obj({ first: str({ min: 1, max: 40 }), email: str({ min: 3, max: 120, lower: true }), replyTo: opt(str({ max: 120, lower: true })) });
/**
 * /resilier when the person has lost the phone and the mailbox (L.215-1-1: termination online without an account). The
 * first name and the subscription's e-mail must match a running membership: then the cancellation is recorded now
 * (received now, effective at the end of the paid period) but unverified (verified: false), the acknowledgement leaves
 * by e-mail to the address on file and to replyTo, and the owner gets « Résiliation à confirmer » (one tap Confirmer,
 * which cancels at Stripe). No match: the owner gets what was typed. The route answers the same either way.
 */
export const requestCancelUnverified = {
  run(s, input, ctx) {
    if (ctx.actor.t !== 'client') fail(403, 'forbidden', 'Réservé au client.');
    const x = parse(unverifiedSchema, input);
    const day = ctx.local.day;
    const replyTo = x.replyTo && isEmail(x.replyTo) ? x.replyTo : '';
    let m = null;
    for (const y of [...s.members.values()].sort((a, b) => b.createdAt - a.createdAt)) {
      const k = contactOf(s, y);
      if (manageable(s, y, day) && (sameEmail(y.email, x.email) || sameEmail(k.email, x.email)) && (sameFirst(y.first, x.first) || sameFirst(k.first, x.first))) { m = y; break; }
    }
    const when = dateWords(day) + ' à ' + fmtTime(ctx.local.min);
    if (!m) {
      // nothing chained says who typed it: the words travel in the mail's pii, to the owner only
      ownerAlert(s, ctx, { key: ctx.id('omcxu'), subject: 'Demande de résiliation sans abonnement trouvé', lines: ['Reçue sur le site le ' + when + ', sans le lien ni l’espace du client.', 'Prénom saisi : ' + x.first, 'E-mail saisi : ' + x.email, ...(replyTo ? ['Répondre à : ' + replyTo] : []), '', 'Aucun abonnement en cours ne correspond : réponds-lui si tu le connais.'] });
      return { found: false };
    }
    if (m.cancel) return { found: true, already: true, id: m.id };
    const k = contactOf(s, m);
    const cid = k.cid || undefined;
    // this alert takes the key of requestCancel's own (« Résiliation d'abonnement »): one mail to the owner, this one
    const confirm = originOf(ctx) ? originOf(ctx) + '/comptoir/clients/' + encodeURIComponent(cid || '') : '';
    ownerAlert(s, ctx, { key: 'omcx_' + m.id, cid, subject: 'Résiliation à confirmer · ' + (k.first || 'un client'), lines: [
      'Demande reçue sur le site le ' + when + ' sans le lien du client ni son espace (prénom et e-mail de l’abonnement concordent).',
      'Abonnement ' + m.name + ' (' + fmtEur(m.price) + '/mois) : enregistré comme résilié à la fin du mois payé ; l’accusé de réception est parti par e-mail.',
      'Confirme-la depuis sa fiche (« Résilier ») pour l’arrêter chez Stripe.', ...(confirm ? ['Sa fiche : ' + confirm] : [])
    ] });
    const res = requestCancel.run(s, { id: m.id, by: 'client', channel: 'site', verified: false }, { ...ctx, meta: { ...ctx.meta, memberId: m.id } });
    if (replyTo && !sameEmail(replyTo, k.email)) {
      noticeMail(s, ctx, {
        key: 'mcxr_' + m.id, template: 'memberCancelled', legal: true, to: replyTo, cid: cid || null,
        subject: 'Résiliation de ton abonnement ' + m.name + ' · ' + s.settings.shop.name,
        lines: ['Bonjour' + (k.first ? ' ' + k.first : '') + ',', '', 'Nous avons bien reçu ta demande de résiliation le ' + when + '.',
          res.ended ? 'Ton abonnement ' + m.name + ' prend fin aujourd’hui : plus rien ne sera prélevé.' : 'Ton abonnement ' + m.name + ' prend fin le ' + dateWords(res.last) + ' au soir : plus rien ne sera prélevé.',
          '', 'Ce message vaut accusé de réception de ta résiliation.', '', s.settings.shop.name + (s.settings.shop.phone ? ' · ' + s.settings.shop.phone : '')]
      });
    }
    return { found: true, id: m.id, effective: res.effective };
  }
};

/** The salon confirms a cancellation asked from /resilier without the link (the route then stops it at Stripe). */
export const confirmCancel = {
  run(s, input, ctx) {
    ctx.need('member.manage');
    const m = s.members.get(parse(obj({ id: id() }), input).id);
    if (!m || !m.cancel) fail(404, 'not_found', 'Aucune résiliation à confirmer.');
    if (m.cancel.verified !== false) return { already: true, id: m.id, effective: m.cancel.effective };
    ctx.emit('member.cancelConfirmed', { id: m.id, cid: rootOf(s, m.cid) || undefined });
    return { id: m.id, effective: m.cancel.effective };
  }
};

/** The day a start not asked for now begins: Stripe's trial_end, else 14 days after the checkout. */
const startDayOf = (m, startAt) => startAt ? localParts(startAt).day : addDays(localParts(m.createdAt).day, 14);
/**
 * A start in 14 days (the client did not ask to start now): the checkout is done but nothing is paid, so PAY-02's
 * welcome waits for the first payment. The contract's confirmation on a durable medium leaves now, by e-mail.
 */
export const memberScheduled = {
  run(s, input, ctx) {
    if (!machine(ctx)) fail(403, 'forbidden', 'Réservé au paiement en ligne.');
    const x = parse(obj({ id: id(), startAt: opt(int({ min: 0, max: 8.64e15 })) }), input);
    const m = s.members.get(x.id);
    if (!m || m.activatedAt || m.ended || m.startNow) return { sent: false };
    const k = contactOf(s, m);
    const start = startDayOf(m, x.startAt);
    const link = ctx.meta && typeof ctx.meta.memberLink === 'function' ? String(ctx.meta.memberLink(m)) : '';
    const id_ = noticeMail(s, ctx, {
      key: 'msched_' + m.id, template: 'memberWelcome', legal: true, to: k.email, cid: k.cid || null,
      subject: 'Ton abonnement ' + m.name + ' commence le ' + dateWords(start) + ' · ' + s.settings.shop.name,
      lines: ['Bonjour' + (k.first ? ' ' + k.first : '') + ',', '',
        'Ton abonnement ' + m.name + ' (' + fmtEur(m.price) + ' par mois) est enregistré. Il commence le ' + dateWords(start) + ' : rien n’est prélevé avant, et d’ici là tes coupes sont au prix habituel.',
        'Premier prélèvement : ' + fmtEur(m.price) + ' le ' + dateWords(start) + ', puis chaque mois à la même date.',
        'Sans engagement : tu peux l’annuler d’ici là sans frais, puis le résilier quand tu veux.',
        ...(link ? ['', 'Gérer ou annuler mon abonnement : ' + link] : []), '', 'Ce message confirme ton abonnement.', '', s.settings.shop.name],
      button: link ? { label: 'Mon abonnement', url: link } : null
    });
    return { sent: !!id_, id: id_ };
  }
};
/** A start in 14 days called off before it began: the acknowledgement (PAY-02's cancel() writes none for a contract never paid). */
export const ackScheduledCancel = {
  run(s, input, ctx) {
    const m = s.members.get(parse(obj({ id: id() }), input).id);
    // only one the client had confirmed (memberScheduled): a checkout never finished has nothing to acknowledge
    if (!m || m.activatedAt || !m.ended || !s.messages.has('msg_msched_' + m.id)) return { sent: false };
    if (ctx.actor.t === 'client' && !(ctx.meta && ctx.meta.memberId === m.id)) fail(403, 'forbidden', 'Cet abonnement n’est pas le tien.');
    if (ctx.actor.t === 'staff') ctx.need('member.manage');
    const k = contactOf(s, m);
    const id_ = noticeMail(s, ctx, {
      key: 'mschx_' + m.id, template: 'memberStopped', legal: true, to: k.email, cid: k.cid || null,
      subject: 'Annulation de ton abonnement ' + m.name + ' · ' + s.settings.shop.name,
      lines: ['Bonjour' + (k.first ? ' ' + k.first : '') + ',', '', 'Nous avons bien reçu l’annulation de ton abonnement ' + m.name + ' le ' + dateWords(ctx.local.day) + ' à ' + fmtTime(ctx.local.min) + '.',
        'Il ne commencera pas : rien ne sera prélevé.', '', 'Ce message vaut accusé de réception.', '', s.settings.shop.name]
    });
    return { sent: !!id_ };
  }
};

/** The ticket on the Comptoir, for the owner's e-mail. */
const ticketLink = (s, ctx, saleId) => {
  const o = originOf(ctx), x = saleId ? s.sales.get(saleId) : null;
  return o && x ? o + '/comptoir/caisse/ventes?jour=' + x.day + '&ticket=' + x.id : '';
};
const alertSchema = obj({
  kind: oneOf(/** @type {const} */ (['dispute', 'memberDispute', 'memberDisputeLost', 'outside', 'orphan'])),
  paymentId: opt(id()), disputeId: opt(str({ max: 80 })), memberId: opt(id()), amount: opt(int({ min: 0, max: 10000000 })), total: opt(int({ min: 0, max: 10000000 })), invoice: opt(str({ max: 80 }))
});
/**
 * The owner's e-mail about money that needs him, once per object (its key): a dispute opened (with its answer date), a
 * membership's dispute (« résilier ? ») and its loss (« fais l'avoir »), a refund made at Stripe that no credit note
 * records, a membership payment sent back because no contract covered it. Written by the provider's notices only.
 */
export const billingAlert = {
  run(s, input, ctx) {
    if (!machine(ctx)) fail(403, 'forbidden', 'Réservé au paiement en ligne.');
    const x = parse(alertSchema, input);
    const py = x.paymentId ? s.payments.get(x.paymentId) : null;
    const m = x.memberId ? s.members.get(x.memberId) : py && py.memberId ? s.members.get(py.memberId) : null;
    const k = m ? contactOf(s, m) : null;
    const cid = (k && k.cid) || (py && py.cid) || null;
    const d = x.disputeId ? s.disputes.get(x.disputeId) : null;
    const who = (k && k.first) || 'un client';
    const eu = (c) => fmtEur(c, { decimals: c % 100 !== 0 });
    const due = d && d.dueBy ? ddmm(localParts(d.dueBy).day) : '';
    const sale = py && py.usedBy ? ticketLink(s, ctx, py.usedBy) : '';
    switch (x.kind) {
      case 'dispute':
        if (!py || !d) return { sent: false };
        return { id: ownerAlert(s, ctx, { key: 'odisp_' + d.id, cid, subject: 'Litige ouvert sur un paiement de ' + eu(d.amount) + (due ? ' : réponds avant le ' + due : ''), lines: [py.label + ' · ' + eu(py.amount) + '.', 'Caisse › En ligne › « Copier le dossier », puis réponds dans Stripe › Litiges' + (due ? ' avant le ' + due : '') + '.', ...(sale ? ['Le ticket : ' + sale] : [])] }) };
      case 'memberDispute':
        if (!m || !d) return { sent: false };
        return { id: ownerAlert(s, ctx, { key: 'omdisp_' + d.id, cid, subject: 'Litige sur l’abonnement de ' + who + ' : résilier ?', lines: ['La banque de ' + who + ' conteste un mois de son abonnement ' + m.name + ' (' + eu(d.amount) + ')' + (due ? ', réponse attendue avant le ' + due : '') + '.', 'Les prélèvements sont suspendus et ses coupes ne sont plus incluses tant que le litige dure.', 'Résilie-le depuis sa fiche si tu ne veux pas le garder ; réponds au litige dans Stripe › Litiges.', ...(sale ? ['Le ticket du mois contesté : ' + sale] : [])] }) };
      case 'memberDisputeLost':
        if (!m || !d) return { sent: false };
        return { id: ownerAlert(s, ctx, { key: 'omdlost_' + d.id, cid, subject: 'Litige perdu sur l’abonnement de ' + who + ' : fais l’avoir du mois contesté', lines: ['La banque a rendu ' + eu(d.amount) + ' à ' + who + ' : fais l’avoir du mois contesté en « remboursé hors caisse », sur son ticket.', ...(sale ? ['Le ticket : ' + sale] : []), 'L’abonnement reste suspendu : résilie-le depuis sa fiche.'] }) };
      case 'outside':
        if (!py) return { sent: false };
        return { id: ownerAlert(s, ctx, { key: 'oout_' + py.id + '_' + (x.total || 0), cid, subject: 'Remboursé chez Stripe sans avoir : fais l’avoir', lines: [eu(x.amount || 0) + ' rendus depuis le tableau de bord de Stripe sur « ' + py.label + ' ».', sale ? 'Fais l’avoir en « remboursé hors caisse » sur le ticket : ' + sale : 'Caisse › En ligne le montre.'] }) };
      case 'orphan':
        if (!m) return { sent: false };
        return { id: ownerAlert(s, ctx, { key: 'oorph_' + (x.invoice || m.id), cid, subject: 'Paiement d’abonnement rendu · ' + who, lines: ['Stripe a prélevé ' + eu(x.amount || 0) + ' pour l’abonnement ' + m.name + ' de ' + who + ', qui ne couvrait plus rien (résilié, terminé ou en double).', 'Le paiement a été remboursé et l’abonnement arrêté chez Stripe.'] }) };
      default: return { sent: false };
    }
  }
};
