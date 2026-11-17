// @ts-check
// Delivery bookkeeping for queued messages, the "on recoupe ?" campaign, and the STOP replies.
import { fail } from '../core/engine.js';
import { str, arr, id, opt, obj, bool, parse } from '../lib/validate.js';
import { normPhone, isEmail, maskEmail } from '../lib/util.js';
import { queueMessage, consentGone, fileOf, FILLERS } from '../domain/messages.js';
import { mailConfirmation } from '../domain/mails.js';
import { contactCidOf } from '../domain/notify.js';
import { startsAt } from '../domain/policy.js';
import { mailOfText } from '../messaging/bymail.js';
import { localParts } from '../../shared/dates.js';
import { getAppt, needChair } from './common.js';
import { clientStats } from '../domain/insights.js';
import { membersOf, liveIn, weekUse } from '../domain/membership.js';
import { rhythmOf } from '../../shared/membership-words.js';
import { SECRET_TEMPLATES, SECRET_ERROR, classOf } from '../core/templates.js';
import { handEligible, handRefusal, maySend } from '../messaging/hand.js';
import { cutoverHeld } from '../projections/bascule.js';

// a client seen less than a week ago is not drifting away ("déjà 0 jours depuis ta dernière coupe")
const MIN_DAYS = 7;

/** One sender at a time: a message is claimed before it is handed to the provider. */
export const claimMessage = {
  run(s, input, ctx) {
    const m = s.messages.get(input.id);
    if (!m || m.status !== 'queued') return { ok: false };
    // consent is checked again as it leaves: a STOP in the night beats a text queued the evening before
    const gone = consentGone(s, m);
    if (gone) { ctx.emit('message.updated', { id: m.id, patch: { status: 'skipped', error: gone } }); return { ok: false }; }
    ctx.emit('message.updated', { id: m.id, patch: { status: 'claimed', claimedAt: ctx.now } });
    return { ok: true };
  }
};
export const messageResult = {
  run(s, input, ctx) {
    const m = s.messages.get(input.id);
    if (!m) return { ok: false };
    const status = ['sent', 'failed', 'simulated', 'skipped', 'queued', 'expired'].includes(input.status) ? input.status : 'failed';
    // via (MSG-02): the way it really left, 'whatsapp' or 'sms' ('fallback': by Brevo SMS after the salon's phone
    // refused it, FID-01), and fallback: why the first way handed it on
    // 'email': a text no SMS could carry, sent to the client's address instead (messaging/hand.js byMail), toMasked: where
    const via = ['whatsapp', 'sms', 'fallback', 'email'].includes(input.via) ? { via: input.via, ...(input.via === 'email' && input.toMasked ? { toMasked: String(input.toMasked).slice(0, 120) } : {}) } : {};
    // a text with a code: the provider's words may echo it, and this patch is chained for good (whatever the status)
    const secret = SECRET_TEMPLATES.has(m.template);
    const fallback = input.fallback ? { fallback: secret ? SECRET_ERROR : String(input.fallback).slice(0, 160) } : {};
    const error = input.error ? (secret ? SECRET_ERROR : String(input.error).slice(0, 160)) : '';
    // a contract's acknowledgement that failed waits for the next try (legal: retried until sent, core/templates.js)
    const retry = status === 'queued' && Number.isFinite(input.retryAt) ? { dueAt: Math.max(ctx.now, input.retryAt) } : {};
    // manual: the automatic way gave it back (WhatsApp refused it and no SMS route stands behind): it waits for a person
    // on the Messages screen, and no dispatch takes it again (messaging/hand.js byHand)
    const manual = status === 'queued' && input.manual === true ? { manual: true } : {};
    ctx.emit('message.updated', { id: m.id, patch: { status, ...(status === 'queued' ? {} : { sentAt: ctx.now }), providerRef: input.providerRef || null, error, tries: (m.tries || 0) + 1, ...via, ...fallback, ...retry, ...manual } });
    // the text that tells a file imported from WordPress about the new site has left: relation texts may follow (FID-01)
    const left = status === 'sent' || (status === 'simulated' && s.mode === 'demo');
    const c = left && m.informs ? fileOf(s, m.cid) : null;
    if (c && !c.erased && !(s.informed && s.informed.has(c.id))) ctx.emit('client.informed', { cid: c.id, msgId: m.id });
    return { ok: true };
  }
};

/**
 * « Mode téléphone »: a person sent this text from the salon's phone (WhatsApp opened by the Messages screen with the
 * text ready) and says so, or sets it aside (`skip`: told at the counter, not worth sending). Recorded once: a second
 * tap, or the same request played again, changes nothing. Who may: the desk, a manager, the owner for every client; a
 * barber for the clients of his own appointments (messaging/hand.js maySend). Never before the switch from WordPress
 * (the hold), never to a client who switched the salon's messages off since the text was written.
 */
export const handSent = {
  run(s, input, ctx) {
    const m = s.messages.get(String((input && input.id) || ''));
    if (!m || !handEligible(m)) fail(404, 'not_found', 'Message introuvable.');
    if (!maySend(s, m, { caps: ctx.caps, staffId: ctx.staff ? ctx.staff.id : undefined })) fail(403, 'forbidden', 'Ce message n’est pas pour un de tes clients.');
    if (m.via === 'hand' && (m.status === 'sent' || m.status === 'skipped')) return { ok: true, already: true, status: m.status };
    if (m.status !== 'queued') fail(409, 'gone', m.status === 'sent' ? 'Ce message est déjà parti.' : 'Ce message n’est plus à envoyer.');
    if (cutoverHeld(s, m)) fail(409, 'held', 'Les messages aux clients attendent la bascule depuis l’ancien site : rien ne part avant.');
    const no = handRefusal(s, m);
    if (no) {
      ctx.emit('message.updated', { id: m.id, patch: { status: 'skipped', error: no, via: 'hand' } });
      return { ok: false, skipped: no };
    }
    const skip = !!(input && input.skip);
    ctx.emit('message.updated', { id: m.id, patch: { status: skip ? 'skipped' : 'sent', sentAt: ctx.now, via: 'hand', by: ctx.actor.id, tries: (m.tries || 0) + 1, ...(skip ? { error: 'Écarté à la main' } : {}) } });
    // as for an automatic send: the text that tells a file imported from WordPress about the new site has left
    const c = !skip && m.informs ? fileOf(s, m.cid) : null;
    if (c && !c.erased && !(s.informed && s.informed.has(c.id))) ctx.emit('client.informed', { cid: c.id, msgId: m.id });
    return { ok: true, status: skip ? 'skipped' : 'sent' };
  }
};

/* ---------------- « Renvoyer »: a fresh copy of a client's message, by e-mail ---------------- */

/** A message, or an appointment's confirmation, is sent again at most this many times a day. */
export const RESENDS_PER_DAY = 3;
const resendsToday = (s, ctx, root) => { let n = 0; for (const x of s.messages.values()) if (x.resendOf === root && localParts(x.at).day === ctx.local.day) n++; return n; };
const TOO_MANY = 'Déjà renvoyé ' + RESENDS_PER_DAY + ' fois aujourd’hui. Réessaie demain.';

/**
 * Why this message cannot be sent again by e-mail, or '' (the lists of the Comptoir show « Renvoyer » on '' only).
 * What can: a message to a client that failed or came too late, whatever its channel, and an e-mail that left (the
 * client lost it, or asks for it again). Never an offer (the client's yes is for SMS), a sign-in code, a text filled as
 * it leaves, nor one still waiting or sent by SMS or WhatsApp (it reached him).
 * @returns {string}
 */
export function resendRefusal(s, m) {
  if (!m || !m.cid || m.owner || SECRET_TEMPLATES.has(m.template) || Object.hasOwn(FILLERS, m.template)) return 'Ce message ne se renvoie pas.';
  if (m.marketing || classOf(m.template) === 'marketing') return 'Une offre ne part pas par e-mail : le client a dit oui aux SMS seulement.';
  const mail = m.channel === 'email' || m.via === 'email';
  const left = m.status === 'sent' || (m.status === 'simulated' && s.mode === 'demo');
  if (!(m.status === 'failed' || m.status === 'expired' || (left && mail))) return m.status === 'queued' || m.status === 'claimed' ? 'Ce message est encore en attente.' : 'Ce message ne se renvoie pas : il est déjà parti, ou il a été écarté.';
  if (s.settings.messages.email === false) return 'Les e-mails aux clients sont coupés (Réglages › Messages).';
  const c = fileOf(s, m.cid);
  if (!c || c.erased) return 'Cette fiche est effacée.';
  const gone = consentGone(s, m);
  if (gone) return 'Ce client ne veut plus de ce message (' + gone + ').';
  return isEmail(m.channel === 'email' && isEmail(m.to) ? m.to : c.email) ? '' : 'Ce client n’a pas d’adresse e-mail.';
}

/**
 * « Renvoyer » on a message of the Comptoir's lists: a fresh copy by e-mail, under a new id, to the address the mail
 * went to (else the file's). The copy is a message like any other: it waits in the outbox and leaves by the normal
 * dispatch. A confirmation of an appointment still to come is written again from the appointment (its hour today, a
 * fresh calendar file); anything else leaves with the words it had. Who may: whoever may send this client's messages
 * (messaging/hand.js maySend: the desk, a manager, the owner; a barber for his own appointments). At most three a day
 * per message, counted on the first one (a copy of a copy counts with it). The journal names who asked (the actor).
 */
export const resendMessage = {
  run(s, input, ctx) {
    const m = s.messages.get(String((input && input.id) || ''));
    if (!m || !m.cid || m.owner) fail(404, 'not_found', 'Message introuvable.');
    if (!maySend(s, m, { caps: ctx.caps, staffId: ctx.staff ? ctx.staff.id : undefined })) fail(403, 'forbidden', 'Ce message n’est pas pour un de tes clients.');
    const no = resendRefusal(s, m);
    if (no) fail(409, 'not_resendable', no);
    const c = fileOf(s, m.cid);
    const to = m.channel === 'email' && isEmail(m.to) ? m.to : c.email;
    const root = m.resendOf || m.id;
    const n = resendsToday(s, ctx, root);
    if (n >= RESENDS_PER_DAY) fail(429, 'slow_down', TOO_MANY);
    const key = 'rs_' + root.replace(/^msg_/, '') + '_' + ctx.local.day + '_' + (n + 1);
    const a = m.apptId ? s.appts.get(m.apptId) : null;
    let id;
    if (m.template === 'confirmation' && a && a.status === 'booked' && startsAt(a) > ctx.now) {
      id = mailConfirmation(s, ctx, a, { to, first: c.first, link: ctx.meta.linkFor ? ctx.meta.linkFor(a) : '', key, resendOf: root });
    } else {
      // a mail keeps its subject and button (its calendar file left with the first one); a text is laid out as a mail
      const x = m.channel === 'email' ? { subject: (m.mail || {}).subject || '', text: m.body, html: (m.mail || {}).html, cta: (m.mail || {}).cta, links: (m.mail || {}).links } : mailOfText(s, m);
      id = queueMessage(s, ctx, { key, channel: 'email', template: m.template, to, cid: m.cid, apptId: m.apptId || null, vars: {}, ...x, resendOf: root });
    }
    if (!id) fail(409, 'not_resendable', 'Ce message ne peut pas partir par e-mail.');
    return { ok: true, id, to: maskEmail(to, { domain: true }) };
  }
};

/** The address an appointment's confirmation goes to: the client's, else the parent's who booked for a child. */
export function confirmAddress(s, a) {
  for (const cid of [a.clientId, contactCidOf(a, s)]) { const c = cid ? fileOf(s, cid) : null; if (c && !c.erased && isEmail(c.email)) return { to: c.email, first: c.first || '' }; }
  return null;
}

/**
 * « Renvoyer la confirmation par e-mail » on an appointment's sheet: the confirmation written again from the
 * appointment (with the calendar file and the « Gérer mon rendez-vous » link), whether or not one ever left. Who may:
 * whoever may change this appointment (needChair). At most three a day per appointment.
 */
export const resendConfirmation = {
  run(s, input, ctx) {
    const a = getAppt(s, String((input && input.id) || ''));
    needChair(ctx, a.staffId);
    if (a.status === 'pending') fail(409, 'unpaid', 'Ce rendez-vous attend son acompte : la confirmation part une fois payé.');
    if (a.status !== 'booked' || startsAt(a) <= ctx.now) fail(409, 'closed', 'Ce rendez-vous n’est plus à venir : pas de confirmation à renvoyer.');
    if (s.settings.messages.email === false) fail(409, 'email_off', 'Les e-mails aux clients sont coupés (Réglages › Messages).');
    const who = confirmAddress(s, a);
    if (!who) fail(409, 'no_email', 'Ce client n’a pas d’adresse e-mail.');
    const root = 'conf:' + a.id;
    const n = resendsToday(s, ctx, root);
    if (n >= RESENDS_PER_DAY) fail(429, 'slow_down', TOO_MANY);
    const id = mailConfirmation(s, ctx, a, { ...who, link: ctx.meta.linkFor ? ctx.meta.linkFor(a) : '', key: 'rs_mconf_' + a.id + '_' + ctx.local.day + '_' + (n + 1), resendOf: root });
    if (!id) fail(409, 'not_resendable', 'La confirmation ne peut pas partir par e-mail.');
    return { ok: true, id, to: maskEmail(who.to, { domain: true }) };
  }
};

const campaignSchema = obj({ clientIds: arr(id(), { min: 1, max: 200 }), text: opt(str({ min: 10, max: 320 })), member: opt(bool()) });
/** PAY-07: the nudge's words when the screen sends none (a relance: the rebook text says « déjà N jours », wrong here) */
const NUDGE = "{prenom}, on te garde ta place cette semaine ? Réserve ta coupe : {lien}";
/** PAY-07: a member on a weekly plan with no covered cut yet this calendar week (Clients › Abonnés, « Écrire »). */
const weekIdle = (s, cid, day) => membersOf(s, cid).some((m) => rhythmOf(m) === 'week' && liveIn(s, m, day) && !weekUse(m, day).used);
export const sendRebook = {
  run(s, input, ctx) {
    ctx.need('marketing');
    const x = parse(campaignSchema, input);
    const stats = clientStats(s, ctx.local.day, ctx.now);
    let sent = 0, skipped = 0;
    const ids = [];
    for (const cid of x.clientIds) {
      const c = s.clients.get(cid);
      const st = stats.get(cid);
      // a promotional text: only to clients who said yes to the salon's offers
      if (!c || c.erased || c.mergedInto || !c.sms || !c.phone || !c.marketing) { skipped++; continue; }
      // a weekly member not come this week often came last week: the week-since-last-visit rule gives way for him
      // (consent, STOP, quiet hours and one offer a day stay: the same template and key as the relance)
      const nudge = !!x.member && weekIdle(s, cid, ctx.local.day);
      if (!nudge && (!st || st.sinceLast == null || st.sinceLast < MIN_DAYS)) { skipped++; continue; }
      const id = queueMessage(s, ctx, {
        key: 'rebook_' + cid + '_' + ctx.local.day, template: 'rebook', text: x.text || (nudge ? NUDGE : undefined), to: c.phone, cid,
        vars: { prenom: c.first, jours: st && st.sinceLast != null ? st.sinceLast : '', lien: ctx.meta.siteUrl || '' }
      });
      if (id) { sent++; ids.push(cid); } else skipped++;
    }
    if (!sent && !skipped) fail(400, 'invalid', 'Aucun client sélectionné.');
    return { sent, skipped, ids };
  }
};

/**
 * A client answered STOP (or unsubscribed through the provider): no more promotional texts.
 * Service texts (confirmations, reminders) go on: they are part of the booking.
 */
export const smsOptOut = {
  run(s, input, ctx) {
    const phone = normPhone(String(input.phone || ''));
    const cid = phone ? s.clientByPhone.get(phone) : null;
    const c = cid ? s.clients.get(cid) : null;
    if (!c || c.erased) return { ok: true, found: false };
    if (!c.marketing && c.marketingSrc === 'stop') return { ok: true, found: true };
    ctx.emit('client.updated', { id: c.id, cid: c.id, patch: { marketing: false, marketingSrc: 'stop', marketingAt: ctx.now }, fields: [] });
    // the offers already waiting for the morning are closed now, so the outbox says so at once
    for (const m of s.messages.values()) if (m.marketing && m.cid === c.id && m.status === 'queued') ctx.emit('message.updated', { id: m.id, patch: { status: 'skipped', error: 'Désinscrit des bons plans' } });
    return { ok: true, found: true };
  }
};
