// @ts-check
// Notices by e-mail that are not about one appointment (mails.js is): a contract's acknowledgement to the client — the
// durable medium the law asks for a cancellation or a withdrawal: when it was received, when it takes effect, what stays
// included — and the owner's alerts. Queued like any message (domain/messages.js), with a deterministic key.
import { isEmail } from '../lib/util.js';
import { queueMessage } from './messages.js';
import { ownerEmail } from './mails.js';

/** The salon's address from a command's meta (the routes hand siteUrl, origin + '/'; the demo seed its '/site'), or ''. */
export function originOf(ctx) {
  const m = (ctx && ctx.meta) || {};
  return String(m.origin || m.siteUrl || '').replace(/\/site\/?$/, '').replace(/\/+$/, '');
}

/**
 * One e-mail to a client. legal: an acknowledgement the law asks for, so it leaves even when the salon's confirmations
 * by e-mail are off (settings.messages.email), and the dispatch never expires nor holds it (TEMPLATE_FLAGS.legal, FID-01).
 * @param {any} s @param {import('../core/engine.js').Ctx} ctx
 * @param {{ key: string, to: string, cid: string|null, subject: string, lines: string[], button?: { label: string, url: string } | null, template?: string, legal?: boolean }} o
 * @returns {string|null} the message id, or null when nothing will leave (no valid address, already queued)
 */
export function noticeMail(s, ctx, o) {
  if (!o.to || !isEmail(o.to)) return null;
  if (!o.legal && !s.settings.messages.email) return null;
  const button = o.button && o.button.url ? o.button : null;
  const m = {
    key: o.key, channel: /** @type {const} */ ('email'), template: o.template || 'notice', to: o.to, cid: o.cid || null, vars: {},
    subject: o.subject, text: o.lines.join('\n'), cta: button || undefined, links: button ? [button.url] : [], ...(o.legal ? { legal: true } : {})
  };
  return queueMessage(s, ctx, m);
}

/**
 * One e-mail to the owner (settings.notify.to, else the owner's account). It may name a client: cid, so erasing them
 * blanks it with the rest.
 * @param {any} s @param {import('../core/engine.js').Ctx} ctx
 * @param {{ key: string, subject: string, lines: string[], cid?: string|null, template?: string }} o
 */
export function ownerAlert(s, ctx, o) {
  const to = ownerEmail(s);
  if (!isEmail(to)) return null;
  const origin = originOf(ctx);
  const comptoir = origin ? origin + '/comptoir' : '';
  return queueMessage(s, ctx, {
    key: o.key, channel: 'email', template: o.template || 'owner_member', to, cid: o.cid || null, vars: {}, subject: o.subject,
    text: [...o.lines, ...(comptoir ? ['', 'Le Comptoir : ' + comptoir] : [])].join('\n'), links: [comptoir]
  });
}
