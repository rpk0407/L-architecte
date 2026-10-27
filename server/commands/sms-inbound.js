// @ts-check
// MSG-02 · What the salon's own phone (SMS Gateway for Android) reports on the SMS webhook, besides the STOP replies
// (smsOptOut in commands/messages.js): a client's answer, kept in Relances › Demandes so the owner reads it and can
// answer by SMS, and the phone's delivery reports, written on the outbox row.
// The number and the words travel in pii only, as for a request from the site (projections/inquiries.js): erasing the
// client's file erases the answer with it.
// FID-01: each answer says which text it answers (`re`: the last one the salon sent that number in the 7 days before,
// its template and id only), and a plain « ok » or « merci » to a review request, a reminder or a receipt is filed at
// once under « Traitées »: it needs no answer, and it would bury the questions.
import { normPhone } from '../lib/util.js';
import { LIMITS } from '../settings/trainings.js';
import { SECRET_TEMPLATES, SECRET_ERROR } from '../core/templates.js';
import { toldBy } from '../projections/informed.js';

const WEEK_MS = 7 * 86400000;
// « ok », « merci beaucoup », « d'accord », « ça marche »… up to three of them (« ok merci », « super, merci à bientôt »),
// and nothing more than a few marks after it
const WORD = "(?:ok|oki|okay|merci|merci beaucoup|super|top|parfait|d'?accord|oui|ça marche|ca marche|à bientôt|a bientot)";
const ACK = new RegExp('^' + WORD + '(?:[\\s,!.]+' + WORD + '){0,2}[\\s!.]*$', 'i');
// emoji and their joiners, read as marks: « Merci 🙏 » is « Merci »
const PICTO = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200D\uFE0F]/gu;

/** An answer that only acknowledges: one of the words above, only emoji or punctuation, or two characters at most. */
export function isAck(text) {
  const t = String(text || '').replace(/[’‘]/g, "'").trim();
  if ([...t].length <= 2) return true;
  const words = t.replace(PICTO, ' ').replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(words)) return true;
  return ACK.test(words);
}

/** The last text the salon sent this number in the week before `now`: the one a reply most likely answers. */
export function answeredText(s, phone, now) {
  let best = null;
  for (const m of s.messages.values()) {
    if (m.channel === 'email' || m.to !== phone || !m.sentAt || m.sentAt > now || now - m.sentAt > WEEK_MS) continue;
    if (!(m.status === 'sent' || (s.mode === 'demo' && m.status === 'simulated'))) continue;
    if (!best || m.sentAt > best.sentAt) best = m;
  }
  return best;
}

/** @typedef {{ id: string, text: string, phone: string, cid: string|null, re: { template: string, msgId: string } | null }} Reply */
/** Auto-file a mere acknowledgement: `inquiry.handled` with auto, so no badge, and it stays readable under « Traitées ». */
const ackOnly = (/** @type {any} */ s, /** @type {any} */ ctx, /** @type {Reply} */ reply) => {
  if (!isAck(reply.text)) return false;
  ctx.emit('inquiry.handled', { id: reply.id, auto: true });
  return true;
};
/**
 * REPLY_HANDLERS: what happens to an answer, keyed by the template of the text it answers; true when the handler dealt
 * with it. A REGISTRY: the package that owns a template adds its line (TEAM-05b: replies to `confirm`). An answer to a
 * text without a handler stays open in Demandes.
 * @type {Record<string, (s: any, ctx: import('../core/engine.js').Ctx, reply: Reply) => boolean>}
 */
export const REPLY_HANDLERS = {
  review: ackOnly,
  reminder: ackOnly,
  receipt: ackOnly
};

/** A client answered a text: a request of kind 'sms' in Demandes. The same delivery posted twice is recorded once. */
export const smsReply = {
  run(/** @type {any} */ s, /** @type {any} */ input, /** @type {import('../core/engine.js').Ctx} */ ctx) {
    const phone = normPhone(String(input.phone || ''));
    const text = String(input.text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, LIMITS.message);
    if (!phone || !text) return { ok: false };
    const ref = String(input.ref || '').replace(/[^\w-]/g, '').slice(0, 40);
    const id = ref ? 'inq_sms_' + ref : ctx.id('inq');
    if (s.inquiries && s.inquiries.has(id)) return { ok: true, id, dup: true };
    const cid0 = s.clientByPhone.get(phone);
    let c = cid0 ? s.clients.get(cid0) : null;
    if (c && c.mergedInto) c = s.clients.get(c.mergedInto) || c;
    const known = c && !c.erased ? c : null;
    const last = answeredText(s, phone, ctx.now);
    const re = last ? { template: last.template, msgId: last.id } : null;
    // no name to show for a number the salon does not know: the inbox says so
    ctx.emit('inquiry.received', { id, kind: 'sms', module: '', ...(known ? { cid: known.id } : {}), ...(re ? { re } : {}) }, { first: known ? known.first || 'Client' : 'Numéro inconnu', phone, email: '', message: text });
    const h = re && Object.hasOwn(REPLY_HANDLERS, re.template) ? REPLY_HANDLERS[re.template] : null;
    const handled = !!h && h(s, ctx, { id, text, phone, cid: known ? known.id : null, re });
    return { ok: true, id, ...(handled ? { handled: true } : {}) };
  }
};

/** The phone's delivery report for a text it sent: delivered (noted), or failed after all (the outbox says why). */
export const smsReport = {
  run(/** @type {any} */ s, /** @type {any} */ input, /** @type {import('../core/engine.js').Ctx} */ ctx) {
    const ref = String(input.ref || '');
    if (!ref) return { ok: false };
    let m = null;
    for (const x of s.messages.values()) if (x.providerRef === ref && x.channel !== 'email' && x.via !== 'whatsapp') { m = x; break; }
    if (!m || m.status !== 'sent') return { ok: true, found: !!m };
    if (input.status === 'delivered') {
      if (!m.deliveredAt) ctx.emit('message.updated', { id: m.id, patch: { deliveredAt: ctx.now } });
    } else if (input.status === 'failed') {
      // "never twice": a text the phone could not send stays failed, the owner sees it and its reason (a code's reason is
      // masked: the phone may echo the text, and this patch is chained). A text that told an imported file about the new
      // site and fails here no longer counts as telling it (projections/informed.js)
      const why = SECRET_TEMPLATES.has(m.template) ? SECRET_ERROR : String(input.error || '');
      ctx.emit('message.updated', { id: m.id, patch: { status: 'failed', error: ('Le téléphone du salon n’a pas pu l’envoyer' + (why ? ' : ' + why : '')).slice(0, 160) } });
      if (m.informs) for (const cid of toldBy(s, m.id)) ctx.emit('client.uninformed', { cid, msgId: m.id });
    }
    return { ok: true, found: true };
  }
};
