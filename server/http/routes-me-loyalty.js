// @ts-check
// FID-03 · The client's own loyalty card, under /api/me/loyalty (INDEX › Shared contracts: each area adds its own file of
// /api/me/<area> routes). The card, what it says, the rewards that wait, the referral link, and the right not to take
// part. The cid is always the session's; the rules are in domain/loyalty.js, the words in shared/loyalty.js.
import { HttpError } from './kit.js';
import { requireMe, runAs, isPersona } from './me-kit.js';
import { cardOf, cfgOf, referralOf } from '../domain/loyalty.js';
import { setLoyaltyOff } from '../commands/loyalty.js';
import { refLink } from './routes-loyalty.js';
import { rewardWords, ruleWords, termsText, headlineWords } from '../../shared/loyalty.js';

/** @param {any} s */
const nameOf = (s) => (id) => { const sv = s.services.get(id); return sv ? sv.name : ''; };

/**
 * GET /api/me/loyalty. { enabled: false } while the programme is off. Otherwise:
 *   off      he asked not to take part (the card stays readable, the rewards already earned stay usable)
 *   card     { units, goal, model } (never below 0: a refund after a reward can leave a debt, shown as a fresh card)
 *   rule     « 9 passages = la 10e prestation offerte »; headline: « Encore 3 passages avant ta prestation offerte »
 *   terms    the règlement, one paragraph per entry
 *   rewards  [{ id, label, expires }] to use, the soonest to end first
 *   referral { link, offer, gift, count } while the programme takes referrals and he takes part, else null
 * An unnamed account (a number that may have changed hands, commands/accounts.js) sees no card at all: the stamps on the
 * file may be the previous holder's. A fenced one sees what came from the fence's day on (stamps, rewards), like the rest
 * of /moi (domain/me.js), and keeps the switch; the earlier referrals are not counted.
 * @param {any} r @param {any} me requireMe's answer
 */
function loyaltyOf(r, me) {
  const s = r.s, cfg = cfgOf(s);
  const a = me.account;
  if (!cfg.enabled || (a && a.named === false)) return { enabled: false };
  const fenced = !!(a && a.fenced);
  const card = cardOf(s, me.cid, r.local.day, fenced ? a.historyFrom || r.local.day : null);
  const words = nameOf(s);
  const ref = cfg.referral && cfg.referral.enabled && !card.off;
  return {
    enabled: true, off: card.off,
    card: { units: Math.max(0, card.units), goal: card.goal, model: card.model },
    rule: ruleWords(cfg, words),
    headline: card.off ? 'Tu ne participes pas à la carte fidélité. Tes récompenses déjà gagnées restent valables.' : headlineWords({ ...card, units: Math.max(0, card.units) }, cfg), terms: termsText(cfg, words),
    rewards: card.rewards.map((x) => ({ id: x.id, label: x.label, expires: x.expires })),
    referral: ref ? { link: refLink(r, me.cid), offer: rewardWords(cfg.referral.referee, words) + ' sur ta première visite', gift: rewardWords(cfg.referral.referee, words), count: fenced ? 0 : referralOf(s, card.root).count } : null,
    // the birthday reward is a later idea (settings/loyalty.js): nothing to ask for in the profile yet
    birthdayMissing: false
  };
}

/** @param {any} app */
export function meLoyaltyRoutes(app) {
  app.get('/api/me/loyalty', (r) => loyaltyOf(r, requireMe(r)));

  // « Participer à la carte fidélité » (Profil): off or on again, on his own file. The demo's persona changes nothing.
  app.post('/api/me/loyalty/off', async (r) => {
    const me = requireMe(r);
    // the same silence as GET: a number that may have changed hands does not switch the previous holder's file
    if (me.account && me.account.named === false) throw new HttpError(403, 'forbidden', 'Ton espace n’est pas encore confirmé : le salon peut te le confirmer.');
    const off = r.body && r.body.off;
    if (typeof off !== 'boolean') throw new HttpError(400, 'invalid', 'Choisis : participer ou non.');
    if (isPersona(me)) return { ok: true, demo: true, off };
    await runAs(r, me)(setLoyaltyOff, { off });
    return { ok: true, off };
  });
}
