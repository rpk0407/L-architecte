// @ts-check
// Delivery bookkeeping for queued messages, the "on recoupe ?" campaign, and the STOP replies.
import { fail } from '../core/engine.js';
import { str, arr, id, opt, obj, bool, parse } from '../lib/validate.js';
import { normPhone } from '../lib/util.js';
import { queueMessage, consentGone, fileOf } from '../domain/messages.js';
import { clientStats } from '../domain/insights.js';
import { membersOf, liveIn, weekUse } from '../domain/membership.js';
import { rhythmOf } from '../../shared/membership-words.js';
import { SECRET_TEMPLATES, SECRET_ERROR } from '../core/templates.js';
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
    const via = ['whatsapp', 'sms', 'fallback'].includes(input.via) ? { via: input.via } : {};
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
