// @ts-check
// Delivery bookkeeping for queued messages, and the "on recoupe ?" campaign.
import { fail } from '../core/engine.js';
import { str, arr, id, opt, obj, parse } from '../lib/validate.js';
import { queueMessage } from '../domain/messages.js';
import { clientStats } from '../domain/insights.js';

/** One sender at a time: a message is claimed before it is handed to the provider. */
export const claimMessage = {
  run(s, input, ctx) {
    const m = s.messages.get(input.id);
    if (!m || m.status !== 'queued') return { ok: false };
    ctx.emit('message.updated', { id: m.id, patch: { status: 'claimed', claimedAt: ctx.now } });
    return { ok: true };
  }
};
export const messageResult = {
  run(s, input, ctx) {
    const m = s.messages.get(input.id);
    if (!m) return { ok: false };
    const status = ['sent', 'failed', 'simulated', 'skipped', 'queued', 'expired'].includes(input.status) ? input.status : 'failed';
    ctx.emit('message.updated', { id: m.id, patch: { status, sentAt: ctx.now, providerRef: input.providerRef || null, error: String(input.error || '').slice(0, 160), tries: (m.tries || 0) + 1 } });
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
    for (const cid of x.clientIds) {
      const c = s.clients.get(cid);
      const st = stats.get(cid);
      if (!c || c.erased || c.mergedInto || !c.sms || !c.phone) { skipped++; continue; }
      const id = queueMessage(s, ctx, {
        key: 'rebook_' + cid + '_' + ctx.local.day, template: 'rebook', text: x.text, to: c.phone, cid,
        vars: { prenom: c.first, jours: st && st.sinceLast != null ? st.sinceLast : '', lien: ctx.meta.siteUrl || '' }
      });
      if (id) sent++; else skipped++;
    }
    if (!sent && !skipped) fail(400, 'invalid', 'Aucun client sélectionné.');
    return { sent, skipped };
  }
};
