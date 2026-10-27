// @ts-check
// Google reviews over HTTP: /avis/:token, the tracked link of each review request (vercel.json rewrites it here), the
// figures of Rapports › Avis Google, the « avis demandé » line of a client file, and the owner's test from Réglages › Messages.
import { HttpError, guard } from './kit.js';
import { dispatchNow } from './scheduler.js';
import { checkLink } from '../auth/session.js';
import { reviewClicked, queueReviewTest } from '../commands/reviews.js';
import { clickedAt, reviewStats, left, FAILED } from '../projections/reviews.js';
import { ownerEmail } from '../domain/mails.js';
import { fileOf } from '../domain/messages.js';
import { normPhone, maskPhone, maskEmail, isEmail } from '../lib/util.js';
import { safeRedirect } from '../../shared/reviews.js';
import { isDay } from '../../shared/dates.js';

const HOUR = 3600000;
export const REVIEW_TESTS_PER_HOUR = 3;
// the chained actor of a click: nobody in particular (no address, no device: the click is not personal data)
const VISITOR = { actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set() };
// link previews (WhatsApp, iMessage, Slack…) and crawlers fetch the link without anyone opening it: sent on, not counted
const PREVIEW = /bot\b|bot\/|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|linkedin|embedly|pinterest|vkshare/i;

// reviewStats lives with the projection (FID-01), so domain modules read it without importing a route
export { reviewStats };

/** @param {any} app */
export function reviewRoutes(app) {
  /* the link in the text: record the first opening, then on to Google (or the site when no link is set) */
  app.get('/api/avis/:token', async (r) => {
    const s = r.s;
    const to = safeRedirect(s.settings.shop.reviewUrl) || '/';
    // a forged or mistyped token records nothing, and still lands somewhere useful
    const id = checkLink(r.rt.secret, 'review', r.params.token);
    const m = id ? s.messages.get(id) : null;
    const person = r.req.method === 'GET' && !PREVIEW.test(r.req.headers.get('user-agent') || '');
    if (m && m.template === 'review' && person && !clickedAt(s, id)) {
      // a click lost to a store hiccup is a figure a little low, never a client stuck on an error page
      try { await r.rt.engine.run(reviewClicked, { id }, { ...VISITOR, meta: r.meta }); } catch (e) { console.warn('[lx] review click', e && /** @type {any} */ (e).message); }
    }
    return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' } });
  });

  /* Rapports › Avis Google */
  app.get('/api/v1/reviews/stats', (r) => {
    const from = r.query.get('from'), to = r.query.get('to');
    if (!isDay(from) || !isDay(to) || to < from) throw new HttpError(400, 'invalid', 'Période invalide.');
    const staff = r.query.get('staff');
    return reviewStats(r.s, /** @type {string} */ (from), /** @type {string} */ (to), staff && r.s.staff.has(staff) ? staff : null);
  }, { cap: 'report.shop' });

  /* the client file: « Avis Google demandé le 12 oct. · ouvert » */
  app.get('/api/v1/reviews/client/:id', (r) => {
    const s = r.s;
    const c = fileOf(s, r.params.id);
    if (!c) throw new HttpError(404, 'not_found', 'Client introuvable.');
    if (c.erased) return { last: null, count: 0 };
    const mine = [...s.messages.values()].filter((m) => m.template === 'review' && m.apptId && fileOf(s, m.cid) === c).sort((a, b) => b.at - a.at);
    const m = mine[0];
    const last = m ? { at: m.sentAt || m.at, channel: m.channel || 'sms', status: left(s, m) ? 'sent' : FAILED.has(m.status) || m.status === 'simulated' ? 'failed' : 'queued', opened: clickedAt(s, m.id) || null } : null;
    return { last, count: mine.length };
  }, { cap: 'client.view' });

  /* Réglages › Messages › Avis Google: « Envoyer un test » to the owner, through the same outbox as the clients' requests */
  app.post('/api/v1/reviews/test', async (r) => {
    const s = r.s;
    const demo = s.mode === 'demo';
    if (!s.settings.shop.reviewUrl) throw new HttpError(409, 'no_link', 'Ajoute d’abord le lien Google.');
    // the number typed, else the owner's alert phone, else the salon's when it is a mobile; else the owner's e-mail.
    // A French mobile only: it is the owner's own phone, and the route is no way to text anyone, anywhere
    const typed = String((r.body && r.body.phone) || '').trim();
    const mobile = (p) => /^\+33[67]\d{8}$/.test(p);
    const saved = [s.settings.notify && s.settings.notify.phone, s.settings.shop.phone].map(normPhone).find(mobile) || '';
    const phone = typed ? normPhone(typed) : saved;
    const mail = phone ? '' : ownerEmail(s);
    if (typed && !mobile(phone)) throw new HttpError(400, 'not_mobile', 'Le test part vers un portable français (06 ou 07).');
    if (!phone && !isEmail(mail)) throw new HttpError(400, 'no_phone', 'Indique ton numéro de portable.');
    if (!demo && !(phone ? r.rt.sms : r.rt.email)) throw new HttpError(409, 'no_provider', phone ? 'Aucun fournisseur SMS n’est branché : rien ne peut partir pour l’instant.' : 'Aucun fournisseur d’e-mail n’est branché.');
    guard('review-test|' + r.me.id, REVIEW_TESTS_PER_HOUR, HOUR, 'Trois tests par heure au plus. Réessaie plus tard.');
    const out = await r.run(queueReviewTest, phone ? { to: phone, channel: 'sms' } : { to: mail, channel: 'email' });
    // the test leaves now, ahead of whatever waits in the outbox
    try { await dispatchNow(r.rt, [out.id]); } catch (e) { console.warn('[lx] review test', e && /** @type {any} */ (e).message); }
    const m = r.s.messages.get(out.id);
    return { ok: true, channel: out.channel, to: phone ? maskPhone(phone) : maskEmail(mail, { domain: true }), status: m ? m.status : 'queued', simulated: demo };
  }, { cap: 'settings' });
}
