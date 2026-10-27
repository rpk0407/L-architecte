// @ts-check
// PAY-04 · The membership seen by its member: the client session's twins of PAY-03's token routes, and the
// acknowledgement a member downloads (the durable medium he can keep).
//   GET  /api/me/membership                  the file's membership (memberOf(s, me.cid)), as the member page reads it
//   POST /api/me/membership/cancel           { reason? }: at the end of the paid period, acknowledged by SMS and e-mail
//   POST /api/me/membership/withdraw         within 14 days: the month less the cuts taken, refunded on its ticket
//   POST /api/me/membership/card             the card page (Stripe's portal, or the demo's)
//   GET  /api/me/membership/ack/:kind        the acknowledgement, as an HTML file (kind: welcome | cancel | withdraw)
//   GET  /api/public/memberships/:token/ack/:kind   the same under the member page's signed link
// The member is always the session's file's (never a typed phone, never an id from the body): requireMe + runAs, and
// the route vouches for that member in meta (memberId), as PAY-03's link does.
import { HttpError, guard } from './kit.js';
import { requireMe, runAs, isPersona } from './me-kit.js';
import { memberView, refundMonth } from './routes-membership.js';
import { memberMeta, billingOf, cancelAtProvider } from '../payments/billing.js';
import { providerFor } from '../payments/provider.js';
import { readMemberToken, memberToken, MEMBER_ASK_TTL } from '../auth/member-token.js';
import { requestCancel, withdrawMember } from '../commands/memberships.js';
import { ackScheduledCancel, billingAlert, contactOf } from '../commands/member-billing.js';
import { memberOf, membersOf, statusIn, abandoned } from '../domain/membership.js';
import { addDays, dayParts, localParts, fmtTime, MONTHS_FR } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';

/** the reasons the cancel recap offers (optional, never a step before the final button) */
export const CANCEL_REASONS = ['Je viens moins souvent', 'Trop cher pour moi', 'Je déménage', 'Autre raison'];
const ACK_KINDS = new Set(['welcome', 'cancel', 'withdraw']);

/** « 27 octobre 2026 » */
const dayWords = (day) => { const p = dayParts(day); return (p.d === 1 ? '1er' : String(p.d)) + ' ' + MONTHS_FR[p.m - 1] + ' ' + p.y; };
/** « 27 octobre 2026 à 14 h 05 », Paris time */
const atWords = (ms) => { const L = localParts(ms); return dayWords(L.day) + ' à ' + fmtTime(L.min); };
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
/** « 2 coupes par mois · Coupe classique », as on the member page */
function coverage(s, m) {
  const n = m.cuts ? m.cuts + (m.cuts > 1 ? ' coupes' : ' coupe') + ' par mois' : m.minDays ? '1 coupe tous les ' + m.minDays + ' jours' : 'coupes illimitées';
  const names = (m.serviceIds || []).map((x) => (s.services.get(x) || {}).name).filter(Boolean);
  return n + (names.length ? ' (' + names.join(', ') + ')' : '');
}

/**
 * The acknowledgement as a page to keep (text/html, downloaded): when it was received, when it takes effect, what stays
 * included. Only for what this member was acknowledged: a kind he never had is 404.
 * @param {any} r @param {any} m @param {string} kind
 */
export function ackFile(r, m, kind) {
  const s = r.s;
  if (!ACK_KINDS.has(kind)) throw new HttpError(404, 'not_found', 'Confirmation introuvable.');
  const shop = s.settings.shop;
  const k = contactOf(s, m);
  const L = [];
  let title = '';
  if (kind === 'cancel' && m.cancel) {
    const now = m.cancel.effective <= localParts(m.cancel.at).day;
    title = 'Accusé de réception de ta résiliation';
    L.push('Résiliation reçue le ' + atWords(m.cancel.at) + '.');
    L.push(now ? 'Ton abonnement ' + m.name + ' a pris fin le jour même : plus rien n’est prélevé.'
      : 'Ton abonnement ' + m.name + ' prend fin le ' + dayWords(addDays(m.cancel.effective, -1)) + ' au soir : plus rien n’est prélevé ensuite.');
    if (!now) L.push('Jusque-là, tes coupes restent incluses : ' + coverage(s, m) + '.');
    if (m.cancel.verified === false) L.push('Demandée sans ton lien : le salon la confirme, sans rien changer à ces dates.');
  } else if (kind === 'withdraw' && m.withdrawn) {
    title = 'Accusé de réception de ta rétractation';
    L.push('Rétractation reçue le ' + atWords(m.withdrawn.at) + '. Ton abonnement ' + m.name + ' est arrêté depuis ce jour.');
    L.push(m.withdrawn.refund ? 'Remboursement : ' + fmtEur(m.withdrawn.refund, { decimals: m.withdrawn.refund % 100 !== 0 }) + ' sous 14 jours, sur la carte du paiement' + (m.withdrawn.used ? ' (le mois payé, moins ' + m.withdrawn.used + (m.withdrawn.used > 1 ? ' coupes déjà faites).' : ' coupe déjà faite).') : '.')
      : 'Les coupes déjà faites valent le mois payé : il n’y a rien à rembourser.');
  } else if (kind === 'welcome' && m.activatedAt) {
    const first = m.periods[0];
    title = 'Confirmation de ton abonnement';
    L.push('Abonnement ' + m.name + ' actif depuis le ' + atWords(m.activatedAt) + '.');
    L.push(fmtEur(m.price) + ' par mois, prélevés chaque mois à la date anniversaire. Inclus : ' + coverage(s, m) + '.');
    L.push('Sans engagement : tu résilies quand tu veux, l’abonnement s’arrête à la fin du mois payé.');
    L.push('Droit de rétractation de 14 jours, jusqu’au ' + dayWords(addDays(localParts(m.activatedAt).day, 14)) + ' : on te rembourse ce mois, moins les coupes déjà faites' + (first ? ' (' + fmtEur(first.amount) + ' payés)' : '') + '.');
    if (m.cgv) L.push('Conditions générales de vente acceptées : version du ' + m.cgv + '.');
  } else throw new HttpError(404, 'not_found', 'Confirmation introuvable.');
  const ack = m.acks.find((a) => a.kind === kind);
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">'
    + '<title>' + esc(title + ' · ' + shop.name) + '</title>'
    + '<style>body{margin:0;background:#ECE8E0;color:#0F0E0D;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:560px;margin:0 auto;padding:32px 20px}'
    + 'h1{font:400 32px/1.1 "Instrument Serif","Times New Roman",serif;margin:0 0 18px}p{margin:0 0 12px}.k{font-weight:600;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#58534C}.f{margin-top:24px;color:#58534C;font-size:14px}</style></head><body><main>'
    + '<p class="k">' + esc(shop.name) + '</p><h1>' + esc(title) + '</h1>'
    + '<p>' + esc('Bonjour' + (k.first ? ' ' + k.first : '') + ',') + '</p>'
    + L.map((x) => '<p>' + esc(x) + '</p>').join('')
    + '<p>Ce document vaut accusé de réception.' + (ack ? ' Il t’a aussi été envoyé le ' + esc(atWords(ack.at)) + '.' : '') + '</p>'
    + '<p class="f">' + esc([shop.name, [shop.address, [shop.zip, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), shop.phone, shop.email].filter(Boolean).join(' · ')) + '</p>'
    + '</main></body></html>';
  const name = { welcome: 'confirmation-abonnement', cancel: 'confirmation-resiliation', withdraw: 'confirmation-retractation' }[kind];
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-disposition': 'attachment; filename="' + name + '.html"', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

/** an ended contract still shows for this long (« arrêté », its acknowledgement to download) */
const ENDED_SHOWN_DAYS = 60;
/**
 * The signed-in client's membership: the one that runs, else the one waiting for its start, else the last one that ran
 * if it ended less than ENDED_SHOWN_DAYS ago; null otherwise (a checkout never paid is nothing to show).
 */
function mine(r, me) {
  const m = memberOf(r.s, me.cid);
  if (m && (m.activatedAt || !abandoned(m, r.now))) return m;
  const last = membersOf(r.s, me.cid).find((x) => x.activatedAt);
  if (!last) return null;
  const endAt = last.withdrawn ? last.withdrawn.at : last.ended ? last.ended.at : 0;
  const endDay = endAt ? localParts(endAt).day : last.cancel ? last.cancel.effective : '';
  return endDay && endDay >= addDays(r.local.day, -ENDED_SHOWN_DAYS) ? last : null;
}
function needMine(r, me) {
  const m = mine(r, me);
  if (!m) throw new HttpError(404, 'not_found', 'Pas d’abonnement sur ton espace.');
  return m;
}
/** Commands as this client, on his own member: the session's file (runAs) and the member the route vouches for. */
function asMember(r, me, m) {
  Object.assign(r.meta, memberMeta(r), { memberId: m.id });
  return runAs(r, me);
}
/** the system's own command after a client's (the owner's mail about a withdrawal), as PAY-03's routes run it */
const SYSTEM = (r) => ({ actor: /** @type {const} */ ({ t: 'system', id: 'memberships' }), caps: new Set(), meta: memberMeta(r) });

/** What the page reads: PAY-03's member view, and a signed link for « Réserver ma coupe » (the site's verified path). */
function pageOf(r, m) {
  const view = memberView(r, m);
  const live = view.status !== 'ended' && view.status !== 'pending';
  return { member: view, mbr: live ? memberToken(r.rt.secret, m.id, r.now + MEMBER_ASK_TTL) : null, reasons: CANCEL_REASONS };
}

export function meMembershipRoutes(app) {
  app.get('/api/me/membership', (r) => {
    const me = requireMe(r);
    const m = mine(r, me);
    return m ? { ...pageOf(r, m), demo: isPersona(me) } : { member: null, mbr: null, reasons: CANCEL_REASONS, demo: isPersona(me) };
  });

  /** Résilier: recorded first (its moment is the law's), then at Stripe (a retry tries Stripe again: its calls are keyed). */
  app.post('/api/me/membership/cancel', async (r) => {
    guard('mbx|' + r.ip, 10, 60000);
    const me = requireMe(r);
    const m = needMine(r, me);
    if (isPersona(me)) return { demo: true, ...pageOf(r, m) };
    const reason = r.body && r.body.reason ? String(r.body.reason).slice(0, 200) : undefined;
    const run = asMember(r, me, m);
    const res = await run(requestCancel, { id: m.id, by: 'client', channel: 'moi', ...(reason ? { reason } : {}) });
    const cur = r.s.members.get(m.id);
    await cancelAtProvider(r, cur, { now: !!(cur.ended || (cur.cancel && cur.cancel.effective <= r.local.day)) });
    if (!cur.activatedAt) await run(ackScheduledCancel, { id: cur.id });
    return { cancelled: { at: cur.cancel ? cur.cancel.at : r.now, effective: res.effective, last: addDays(res.effective, -1), ended: !!cur.ended }, ...pageOf(r, cur) };
  });

  /** Renoncer (14 days): recorded, the subscription deleted, then the law's amount given back on the month's ticket. */
  app.post('/api/me/membership/withdraw', async (r) => {
    guard('mbx|' + r.ip, 10, 60000);
    const me = requireMe(r);
    const m = needMine(r, me);
    if (isPersona(me)) return { demo: true, ...pageOf(r, m) };
    const run = asMember(r, me, m);
    // the owner hears how the refund below went (PAY-03's billingAlert), never « à rembourser » as well
    r.meta.refundsAfter = true;
    await run(withdrawMember, { id: m.id, by: 'client' });
    const cur = r.s.members.get(m.id);
    await cancelAtProvider(r, cur, { now: true });
    const first = cur.periods[0];
    const refund = cur.withdrawn ? cur.withdrawn.refund : 0;
    const money = refund > 0 && first ? await refundMonth(r, { paymentId: first.paymentId, saleId: first.saleId, amount: refund, key: 'mbwd-' + cur.id, reason: 'Rétractation de l’abonnement' }) : { ok: true };
    if (cur.withdrawn) {
      try { await r.rt.engine.run(billingAlert, { kind: 'withdrawn', memberId: cur.id, ok: money.ok, ...(money.refundId ? { refundId: money.refundId } : {}), ...(money.error ? { error: money.error } : {}) }, SYSTEM(r)); }
      catch (e) { console.error('[lx] withdrawal alert', cur.id, e && /** @type {any} */ (e).message); }
    }
    return { withdrawn: { at: cur.withdrawn ? cur.withdrawn.at : r.now, refund, refunded: money.ok }, ...pageOf(r, cur) };
  });

  /** Changer de carte: Stripe's hosted page, back to /moi; the demo's page says the card is up to date. */
  app.post('/api/me/membership/card', async (r) => {
    guard('mbx|' + r.ip, 10, 60000);
    const me = requireMe(r);
    const m = needMine(r, me);
    if (!m.activatedAt || m.ended || m.withdrawn || statusIn(r.s, m, r.local.day) === 'ended') throw new HttpError(409, 'ended', 'Cet abonnement n’est pas en cours.');
    const back = r.origin + '/moi';
    const p = m.provider === 'simulated' ? providerFor(r.rt, 'simulated') : billingOf(r, m);
    if (p && p.name === 'simulated' && p.portalUrl) return p.portalUrl('', back, { ref: m.id });
    if (!p || !p.portalUrl || !m.customer) throw new HttpError(409, 'no_portal', 'Le changement de carte se fait au salon pour l’instant.');
    return p.portalUrl(m.customer, back);
  });

  app.get('/api/me/membership/ack/:kind', (r) => {
    const me = requireMe(r);
    return ackFile(r, needMine(r, me), r.params.kind);
  });

  /** Under the member page's signed link: an altered link is 404, a genuine one past its time 410 (as its page). */
  app.get('/api/public/memberships/:token/ack/:kind', (r) => {
    guard('mbv|' + r.ip, 60, 60000);
    const t = readMemberToken(r.rt.secret, r.params.token, r.now);
    if ('error' in t) throw t.error === 'expired' ? new HttpError(410, 'expired', 'Ce lien a expiré : demande-en un nouveau.') : new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
    const m = r.s.members.get(t.id);
    if (!m) throw new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
    return ackFile(r, m, r.params.kind);
  });
}
