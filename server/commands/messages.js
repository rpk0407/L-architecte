// @ts-check
// Delivery bookkeeping for queued messages, the "on recoupe ?" campaign, and the STOP replies.
import { fail } from '../core/engine.js';
import { str, arr, id, opt, obj, parse } from '../lib/validate.js';
import { normPhone } from '../lib/util.js';
import { queueMessage, consentGone, fileOf } from '../domain/messages.js';
import { clientStats } from '../domain/insights.js';
import { SECRET_TEMPLATES, SECRET_ERROR } from '../core/templates.js';

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
    ctx.emit('message.updated', { id: m.id, patch: { status, ...(status === 'queued' ? {} : { sentAt: ctx.now }), providerRef: input.providerRef || null, error, tries: (m.tries || 0) + 1, ...via, ...fallback, ...retry } });
    // the text that tells a file imported from WordPress about the new site has left: relation texts may follow (FID-01)
    const left = status === 'sent' || (status === 'simulated' && s.mode === 'demo');
    const c = left && m.informs ? fileOf(s, m.cid) : null;
    if (c && !c.erased && !(s.informed && s.informed.has(c.id))) ctx.emit('client.informed', { cid: c.id, msgId: m.id });
    return { ok: true };
  }
};

const campaignSchema = obj({ clientIds: arr(id(), { min: 1, max: 200 }), text: opt(str({ min: 10, max: 320 })) });
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
      if (!st || st.sinceLast == null || st.sinceLast < MIN_DAYS) { skipped++; continue; }
      const id = queueMessage(s, ctx, {
        key: 'rebook_' + cid + '_' + ctx.local.day, template: 'rebook', text: x.text, to: c.phone, cid,
        vars: { prenom: c.first, jours: st.sinceLast, lien: ctx.meta.siteUrl || '' }
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
