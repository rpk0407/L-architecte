// @ts-check
// Google reviews: the request sent after a finished and paid visit (the tick's step 4, commands/system.js), the opening of
// its tracked link (GET /avis/:token, http/routes-reviews.js), the owner's test, and the demo's history.
//
// No review gating, on purpose: every eligible client gets the same request, whatever the visit was like. Google's policy
// forbids asking only the happy ones (« tu as aimé ? », then Google for a yes and a private form for a no), and French
// consumer law forbids filtering reviews or rewarding them (Code de la consommation L111-7-2 and L121-1, décret 2017-1436).
// So there is no satisfaction question and no reward here: never add one.
//
// Its consent class is relation (core/templates.js, FID-01): a text to a client about a visit he made, never a promotion,
// sent on the salon's legitimate interest. A STOP stops it, like an offer; a client who switched texts off gets nothing
// (he said no: the salon does not switch channels behind his back); an e-mail only goes to a file without a phone; a
// file imported from WordPress gets none before it was told about the new site.
import { fail } from '../core/engine.js';
import { queueMessage, apptVars, whenWords, afterQuiet, messageId, reviewLink, fileOf } from '../domain/messages.js';
import { hashStr, isEmail } from '../lib/util.js';
import { clickedAt } from '../projections/reviews.js';

/** A request that could not leave within 24 h of its time (no traffic over a long weekend, an outage) is dropped: a
 *  « merci » three days after the visit reads like spam. */
export const REVIEW_LATE_MS = 24 * 3600000;
/** the quiet hours push a request at most this far (Saturday evening → Monday 8 h, a holiday Monday → Tuesday) */
const QUIET_MAX_MS = 4 * 86400000;

/** "2026-4": a day's quarter, the key of the once-per-client cap: the quarter of the visit, not of the day it is asked
 *  (a visit of 31 March asked on 1 April belongs to the first quarter, with the one of 15 March). */
export const quarterOf = (day) => day.slice(0, 5) + Math.ceil(+day.slice(5, 7) / 3);

/**
 * When the visit was over and paid: the later of the appointment's 'done' and its ticket. 0 when it does not qualify:
 * not done (a no-show, a cancellation), no ticket, a past visit imported from the old site, a ticket refunded even in part.
 */
export function visitClosedAt(s, a) {
  if (a.status !== 'done' || !a.saleId || a.legacy) return 0;
  const x = s.sales.get(a.saleId);
  if (!x || x.refunded > 0 || (x.refundIds && x.refundIds.length)) return 0;
  return Math.max((a.statusAt && a.statusAt.done) || 0, x.at || 0);
}

/** When the request may leave: the delay after the visit, then out of the quiet hours (19:30 + 2 h → 8 h the next morning). */
export function reviewDueAt(s, a) {
  const closed = visitClosedAt(s, a);
  if (!closed) return 0;
  const M = s.settings.messages;
  return afterQuiet(M.quiet, closed + (M.reviewDelayMin ?? 120) * 60000);
}

/** The way to say no, at the end of every request by e-mail: replies reach EMAIL_REPLY_TO, the salon's inbox. */
export const REVIEW_MAIL_STOP = 'Tu ne veux plus de demande d’avis ? Réponds « stop » à ce mail ou dis-le au salon.';

/** The request by e-mail, for a file without a phone: the same words, the tracked link as a button. */
function mailReview(s, ctx, m) {
  const shop = s.settings.shop;
  const text = [
    'Bonjour' + (m.first ? ' ' + m.first : '') + ',', '',
    'Merci pour ta visite chez ' + shop.name + (m.barber ? ' avec ' + m.barber : '') + '.',
    'Tu as 30 secondes ? Ton avis sur Google nous aide énormément.', '',
    'Laisser un avis : ' + m.link, '', 'À bientôt !', shop.name, '', REVIEW_MAIL_STOP
  ].join('\n');
  return queueMessage(s, ctx, {
    key: m.key, channel: 'email', template: 'review', to: m.to, cid: m.cid, apptId: m.apptId, vars: {}, ...(m.owner ? { owner: true } : {}),
    subject: 'Merci pour ta visite · ' + shop.name, text, cta: { label: 'Laisser un avis', url: m.link }, links: [m.link]
  });
}

/**
 * Queue the review requests due now. Once per client per quarter of the visit, whatever the channel: a text to a client
 * who takes them (by SMS: never WhatsApp), else an e-mail to a file without a phone when e-mails are on; nothing to a
 * client who switched texts off or said STOP, nor to an erased file (queueMessage refuses those: relation class).
 * Deterministic ids: two servers ticking at once send one request.
 * @param {any} s
 * @param {import('../core/engine.js').Ctx} ctx
 * @param {{ demo?: boolean, cap?: number }} [o] demo: the demo's own seeded visits too (its history); cap: bounded work
 * @returns {string[]} the messages queued
 */
export function queueReviews(s, ctx, o = {}) {
  const M = s.settings.messages;
  if (!M.review || !s.settings.shop.reviewUrl) return [];
  const delay = (M.reviewDelayMin ?? 120) * 60000;
  // production without an e-mail provider: no mail that would only wait in the outbox and expire
  const P = ctx.meta && ctx.meta.providers;
  const mails = M.email !== false && (s.mode === 'demo' || !P || !!P.email);
  const cap = o.cap ?? 60;
  /** @type {string[]} */
  const out = [];
  for (const a of s.appts.values()) {
    if (out.length >= cap) break;
    if (a.status !== 'done' || !a.saleId || (a.demo && !o.demo)) continue;
    const closed = visitClosedAt(s, a);
    // cheap bounds first: the quiet hours only push a request later, never earlier
    if (!closed || closed + delay > ctx.now || ctx.now - closed - delay > QUIET_MAX_MS + REVIEW_LATE_MS) continue;
    const due = afterQuiet(M.quiet, closed + delay);
    if (due > ctx.now || ctx.now - due > REVIEW_LATE_MS) continue;
    const c = fileOf(s, a.clientId);
    if (!c || c.erased) continue;
    const key = 'rev_' + c.id + '_' + quarterOf(a.day);
    const id = messageId(key);
    if (s.messages.has(id) || ctx.drafts.some((d) => d.type === 'message.queued' && d.data.id === id)) continue;
    const vars = { ...apptVars(s, a), avis: reviewLink(s, ctx, id) };
    const st = s.staff.get(a.staffId);
    const r = c.phone ? queueMessage(s, ctx, { key, template: 'review', to: c.phone, cid: c.id, apptId: a.id, vars })
      : mails && isEmail(c.email) ? mailReview(s, ctx, { key, to: c.email, first: c.first, cid: c.id, apptId: a.id, link: vars.avis, barber: st ? st.name : '' })
        : null;
    if (r) out.push(r);
  }
  return out;
}

/** GET /avis/:token: the first opening of a request's link. Only its id is chained: no address, no device, no person. */
export const reviewClicked = {
  run(s, input, ctx) {
    const id = String((input && input.id) || '');
    const m = s.messages.get(id);
    if (!m || m.template !== 'review' || clickedAt(s, id)) return { recorded: false };
    ctx.emit('review.clicked', { id });
    return { recorded: true };
  }
};

/**
 * The owner's test (Réglages › Messages › Avis Google): the real text with a tracked link of its own, to the owner's phone
 * or e-mail, through the same outbox as the clients' requests. No appointment, so it never counts in the figures.
 * @type {{ run: (s: any, input: { to: string, channel: 'sms'|'email' }, ctx: import('../core/engine.js').Ctx) => any }}
 */
export const queueReviewTest = {
  run(s, input, ctx) {
    ctx.need('settings');
    if (!s.settings.shop.reviewUrl) fail(409, 'no_link', 'Ajoute d’abord le lien Google.');
    const key = 'revtest_' + ctx.now.toString(36);
    const id = messageId(key);
    const link = reviewLink(s, ctx, id);
    // « Le gérant » is not a first name: no « Merci Le ! »
    const word = String((ctx.staff && ctx.staff.name) || '').split(' ')[0];
    const first = /^(le|la|les|l['’])$/i.test(word) ? '' : word;
    const barber = [...s.staff.values()].find((x) => x.active && x.chair);
    if (input.channel === 'email') {
      const r = mailReview(s, ctx, { key, to: input.to, first, cid: null, apptId: null, link, barber: barber ? barber.name : '', owner: true });
      if (!r) fail(400, 'invalid', 'Cette adresse ne peut pas recevoir d’e-mail.');
      return { id: r, channel: 'email' };
    }
    const vars = { prenom: first, ...whenWords(ctx.local.day, ctx.local.min), barbier: barber ? barber.name : 'ton barbier', prestation: 'Coupe', prix: '', salon: s.settings.shop.name, avis: link, lien: '' };
    const r = queueMessage(s, ctx, { key, template: 'review', to: input.to, vars, owner: true });
    if (!r) fail(400, 'country', 'Les SMS ne partent pas vers ce pays (Réglages › Messages).');
    return { id: r, channel: 'sms' };
  }
};

/**
 * The demo's history (domain/seed.js): the requests the tick would have sent for the seeded visits, left (simulated, as the
 * demo's dispatcher marks them) and about a third of them opened, so Rapports › Avis Google has something to show.
 */
export const seedReviews = {
  run(s, input, ctx) {
    if (s.mode !== 'demo') return { queued: 0 };
    const ids = queueReviews(s, ctx, { demo: true, cap: 400 });
    for (const id of ids) {
      ctx.emit('message.updated', { id, patch: { status: 'simulated', sentAt: ctx.now, tries: 1 } });
      if (hashStr(id) % 100 < 38) ctx.emit('review.clicked', { id });
    }
    return { queued: ids.length };
  }
};
