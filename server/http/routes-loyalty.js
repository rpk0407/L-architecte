// @ts-check
// Fidélité over HTTP (FID-02): a client's card, the stamps and rewards given by hand, a referral at the till, the
// launch, the owner's simulator, the programme's figures, and the referrer's public link. The screens are FID-03's
// (Comptoir, /moi) and FID-05's (figures); the rules are in domain/loyalty.js and commands/loyalty.js.
import { HttpError, guard } from './kit.js';
import { signLink, checkLink } from '../auth/session.js';
import { addDays, isDay, diffDays } from '../../shared/dates.js';
import { rewardWords } from '../../shared/loyalty.js';
import { fmtEur } from '../../shared/money.js';
import { cardOf, cfgOf, rootOf, referralOf, simulate, programStats, liability, launchView } from '../domain/loyalty.js';
import { HEAD_STARTS } from '../settings/loyalty.js';
import { adjustLoyalty, giftReward, voidReward, restoreReward, claimReferral, launchLoyalty, setLoyaltyOff } from '../commands/loyalty.js';

/** A file as the routes name it: the one kept after a merge. */
function fileOf(r, id) {
  const root = rootOf(r.s, id);
  const c = root ? r.s.clients.get(root) : null;
  if (!c) throw new HttpError(404, 'not_found', 'Client introuvable.');
  return c;
}
const shortName = (c) => (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim();

/** The referrer's link to hand out: the site with ?parrain=, signed for his file (FID-03 shows it on /moi). @param {any} r @param {string} cid */
export function refLink(r, cid) {
  return (r.rt.cfg.publicUrl || r.origin) + '/?parrain=' + encodeURIComponent(signLink(r.rt.secret, 'ref', cid));
}

/** The referrer a link names, when the programme takes referrals and his file still exists, or null. @param {any} r @param {string} token */
function referrerOf(r, token) {
  const cfg = cfgOf(r.s);
  if (!cfg.enabled || !cfg.referral || !cfg.referral.enabled) return null;
  const id = checkLink(r.rt.secret, 'ref', token);
  const root = id ? rootOf(r.s, id) : null;
  const c = root ? r.s.clients.get(root) : null;
  return c && !c.erased ? c : null;
}

/**
 * After a booking on the site that came through a referrer's link (?parrain=): the referral, recorded by the system.
 * A refusal or an error never touches the booking: it is already made, the client just gets no welcome reward. The answer
 * ({ ok, why }) goes back in the booking's, so the site can say whether the offer was applied; awaited, but only for a
 * booking that carries a link.
 * @param {any} r @param {string} apptId @param {any} token
 */
export async function claimFromLink(r, apptId, token) {
  try {
    const by = typeof token === 'string' ? referrerOf(r, token) : null;
    const a = r.s.appts.get(apptId);
    if (!by || !a || !a.clientId) return { ok: false, why: 'link' };
    return await r.rt.engine.run(claimReferral, { refereeId: a.clientId, referrerId: by.id, via: 'link' }, { actor: { t: 'system', id: 'referral' }, caps: new Set(), meta: r.meta });
  } catch (e) {
    console.error('[lx] referral not recorded', e && /** @type {any} */ (e).message);
    return { ok: false, why: 'error' };
  }
}

/** A programme from the simulator's query, over the salon's own: only the keys given. @param {URLSearchParams} q */
function overOf(q) {
  /** @type {any} */
  const o = {};
  const num = (k, min, max) => {
    const v = q.get(k);
    if (v == null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, 'invalid', k + ' : entre ' + min + ' et ' + max + '.');
    return n;
  };
  const model = q.get('model');
  // v1 counts stamps; points are a later idea
  if (model && model !== 'stamps') throw new HttpError(400, 'invalid', 'Seule la carte à tampons est disponible.');
  const goal = num('goal', 2, 5000), minNet = num('minNet', 0, 10000), cap = num('cap', 0, 20000), amount = num('amount', 100, 20000);
  if (goal !== undefined) o.goal = goal;
  if (minNet !== undefined) o.minNet = minNet;
  const kind = q.get('kind');
  if (kind && kind !== 'service' && kind !== 'amount') throw new HttpError(400, 'invalid', 'kind : service ou amount.');
  if (kind === 'amount') o.reward = { kind: 'amount', amount: amount ?? 500 };
  else if (kind === 'service' || cap !== undefined || q.has('refs')) {
    // refs: the services the reward may pay, comma-separated (empty: any), as Réglages › Fidélité has them before it saves
    const refs = (q.get('refs') || '').split(',').filter(Boolean);
    if (refs.length > 10 || refs.some((x) => !/^[A-Za-z0-9_:-]{1,64}$/.test(x))) throw new HttpError(400, 'invalid', 'refs : dix prestations au plus.');
    o.reward = { kind: 'service', ...(cap !== undefined ? { cap } : {}), ...(q.has('refs') ? { refs } : {}) };
  }
  return o;
}

/** @param {any} app */
export function loyaltyRoutes(app) {
  // the card on a client file: balance, rewards to use, the last movements, who referred him and how many he referred
  app.get('/api/v1/loyalty/client/:id', (r) => {
    const s = r.s;
    const c = fileOf(r, r.params.id);
    const card = cardOf(s, c.id, r.local.day);
    const ref = referralOf(s, card.root);
    const by = ref.by ? s.clients.get(ref.by) : null;
    const cfg = cfgOf(s);
    // minNet and referralOn: what the till and the done screen say about the rule, for a barber too (the settings are not his to read)
    return { ...card, referral: { by: by && !by.erased ? { id: by.id, name: shortName(by) } : null, count: ref.count }, minNet: cfg.minNet, referralOn: !!(cfg.referral && cfg.referral.enabled) };
  }, { cap: 'client.view' });

  app.post('/api/v1/loyalty/adjust', (r) => r.run(adjustLoyalty, r.body), { cap: 'sale.create' });
  app.post('/api/v1/loyalty/gift', (r) => r.run(giftReward, r.body), { cap: 'loyalty.manage' });
  app.post('/api/v1/loyalty/void', (r) => r.run(voidReward, r.body), { cap: 'loyalty.manage' });
  // a reward used on a ticket that took no money (nothing to refund), given back while that day is open
  app.post('/api/v1/loyalty/restore', (r) => r.run(restoreReward, r.body), { cap: 'loyalty.manage' });
  // the right not to take part, set at the counter (the client's own switch is FID-03's)
  app.post('/api/v1/loyalty/off', (r) => r.run(setLoyaltyOff, r.body), { cap: 'client.edit' });

  // « Qui t'a recommandé ? » at the till: a refusal is a 409 with its reason, for the Comptoir to say
  app.post('/api/v1/loyalty/referral', async (r) => {
    const b = r.body || {};
    const res = await r.run(claimReferral, { refereeId: b.clientId, referrerId: b.referrerId, via: 'till' });
    if (res && res.ok === false) throw new HttpError(409, 'referral_' + res.why, res.message);
    return res;
  }, { cap: 'sale.create' });

  app.post('/api/v1/loyalty/launch', (r) => r.run(launchLoyalty, r.body || {}), { cap: 'settings' });
  // the launch line of Réglages › Fidélité: the day and cards it opened, or what launching now would give with this head start
  app.get('/api/v1/loyalty/launch', (r) => {
    const h = r.query.get('headStart') || cfgOf(r.s).headStart;
    if (!HEAD_STARTS.includes(/** @type {any} */ (h))) throw new HttpError(400, 'invalid', 'headStart : none, half ou full.');
    return launchView(r.s, /** @type {'none'|'half'|'full'} */ (h), r.local.day);
  }, { cap: 'settings' });

  // the owner's simulator: the last 365 days of tickets under another programme
  app.get('/api/v1/loyalty/simulate', (r) => {
    const to = r.local.day, from = addDays(to, -364);
    return { from, to, ...simulate(r.s, overOf(r.query), { from, to }) };
  }, { cap: 'settings' });

  // the programme's figures, and what it owes today (for the accountant)
  app.get('/api/v1/loyalty/stats', (r) => {
    const today = r.local.day;
    const from = isDay(r.query.get('from') || '') ? /** @type {string} */ (r.query.get('from')) : addDays(today, -29);
    const to = isDay(r.query.get('to') || '') ? /** @type {string} */ (r.query.get('to')) : today;
    if (from > to || diffDays(from, to) > 3 * 366) throw new HttpError(400, 'invalid', 'Période invalide (3 ans au plus).');
    return { ...programStats(r.s, { from, to }), liability: liability(r.s, today) };
  }, { cap: 'report.shop' });

  // the site, opened from a referrer's link: his first name and the welcome offer, nothing else
  app.get('/api/public/parrain/:token', (r) => {
    guard('parrain|' + r.ip, 30, 60000);
    const c = referrerOf(r, r.params.token);
    if (!c) throw new HttpError(404, 'not_found', 'Ce lien de parrainage n’est pas (ou plus) valable.');
    const ref = cfgOf(r.s).referral.referee;
    const words = rewardWords(ref, (id) => (r.s.services.get(id) || {}).name || '');
    // give / line are ready for a sentence (« Karim t’offre 5 € sur ta première visite »): offer already says « offerts »
    const give = ref.kind === 'amount' ? fmtEur(ref.amount || 0) : words.replace(' offerte', '').replace(/^./, (x) => x.toLowerCase());
    return { first: c.first, offer: words + ' sur ta première visite', give, line: c.first + ' t’offre ' + give + ' sur ta première visite' };
  });
}
