// @ts-check
// Fidélité (FID-02), read from the state: a client's card, the rewards the till may apply, what the programme costs and
// owes. Pure: no clock, no I/O. The records are s.loyalty (projections/loyalty.js) and each ticket's own stamp
// (sale.completed data.loyalty.units, see there); the commands are commands/loyalty.js and the till's lines in
// commands/sales.js. Reads are memoised per journal version, like domain/insights.js.
//
// A card is the timeline of one file and of every file merged into it (rootOf): its tickets that earned, the stamps
// given at launch, imported or adjusted, the ones taken back by a refund, and its full cards (a card reward takes `goal`
// stamps off). The balance restarts at 0 after resetDays without an earning visit (between two of them, or since the
// last one); a negative balance (a refund after the reward) is kept, and paid back by the next visits.
import { fail } from '../core/engine.js';
import { rootOf } from './membership.js';
import { diffDays, dayParts, pad2, localParts } from '../../shared/dates.js';
import { rewardValue, rewardWords, cardWords } from '../../shared/loyalty.js';
import { fmtEur } from '../../shared/money.js';
import loyaltySection from '../settings/loyalty.js';

export { rootOf };

/** The salon's programme (settings.loyalty), its defaults on a journal older than it. @param {any} s */
export const cfgOf = (s) => (s.settings && s.settings.loyalty) || loyaltySection.defaults();
const EMPTY = { launched: null, entries: new Map(), rewards: new Map(), bySale: new Map(), referrals: new Map(), gone: new Map() };
/** @param {any} s */
const L = (s) => s.loyalty || EMPTY;

const cache = new WeakMap();
function memo(s, key, fn) {
  let c = cache.get(s);
  if (!c || c.version !== s.version) { c = { version: s.version, m: new Map() }; cache.set(s, c); }
  if (!c.m.has(key)) c.m.set(key, fn());
  return c.m.get(key);
}
/** What memo holds for this version, without computing it (commands run on a state that moves at every write). */
function cached(s, key) { const c = cache.get(s); return c && c.version === s.version ? c.m.get(key) : undefined; }

/** A salon day from an instant: what the projection keeps without a day of its own (a void, a restore). */
const dayOfAt = (at) => localParts(at).day;
const ddmm = (day) => { const p = dayParts(day); return pad2(p.d) + '/' + pad2(p.m); };
/** @param {any} s */
const nameOf = (s) => (id) => { const sv = s.services.get(id); return sv ? sv.name : ''; };

/** Every file merged into this one (itself included). @param {any} s @param {string} root @returns {string[]} */
export function filesOf(s, root) {
  const by = memo(s, 'files', () => {
    /** @type {Map<string, string[]>} */
    const m = new Map();
    for (const c of s.clients.values()) { const k = rootOf(s, c.id); const l = m.get(k); if (l) l.push(c.id); else m.set(k, [c.id]); }
    return m;
  });
  return by.get(root) || [root];
}

/* ---------------- what a ticket earns ---------------- */

/** What a ticket's services paid: a cut a carnet or the membership pays is 0, so it earns nothing (already the loyal price). */
export function qualifyingNet(lines) {
  return (lines || []).reduce((t, l) => t + (l.kind === 'service' && !l.packId && !l.memberId ? Math.max(0, l.net || 0) : 0), 0);
}
/** Stamps one ticket earns from what it paid on services: 1 from minNet (and more than nothing). @param {any} cfg */
export const unitsFor = (cfg, net) => (net > 0 && net >= (cfg.minNet || 0) ? 1 : 0);
/** The ticket's stamp still stands: it earned one and no refund took it back (a mistake refunded leaves the day free). @param {any} s @param {any} x */
export const stampStands = (s, x) => !!(x && x.loyalty && x.loyalty.units > 0 && x.loyalty.units + ((L(s).bySale.get(x.id) || { reversed: 0 }).reversed || 0) > 0);

/**
 * The stamp this ticket earns, before it is written: a client file that takes part, the programme on, enough paid on
 * services, and no other earning ticket of his that day.
 * @param {any} s @param {any} client @param {any[]} lines the ticket's lines with their net @param {string} day
 */
export function earnOf(s, client, lines, day) {
  const cfg = cfgOf(s);
  if (!cfg.enabled || !client) return 0;
  const root = rootOf(s, client.id);
  const c = root ? s.clients.get(root) : null;
  if (!c || c.erased || c.loyaltyOff) return 0;
  const units = unitsFor(cfg, qualifyingNet(lines));
  if (!units) return 0;
  for (const id of s.salesByDay.get(day) || []) {
    const x = s.sales.get(id);
    if (stampStands(s, x) && rootOf(s, x.clientId) === root) return 0;
  }
  return units;
}

/* ---------------- the card's timeline ---------------- */

/** @typedef {{ day: string, k: number[], units: number, kind: string, what: string, id: string, saleId: string|null }} Item */

const cmp = (/** @type {Item} */ a, /** @type {Item} */ b) => {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i];
  return 0;
};
const ENTRY_FR = { start: 'Reprise de la carte au lancement', import: 'Repris de l’ancien site', adjust: 'Ajustement', visit: 'Visite' };

/**
 * Each file's timeline and rewards, by the file kept. only: one file's, without touching the others (a command).
 * @param {any} s @param {string|null} only @returns {Map<string, { items: Item[], rewards: any[] }>}
 */
function build(s, only) {
  /** @type {Map<string, { items: Item[], rewards: any[] }>} */
  const by = new Map();
  const group = (cid) => {
    const k = rootOf(s, cid);
    if (!k || (only && k !== only)) return null;
    let g = by.get(k);
    if (!g) { g = { items: [], rewards: [] }; by.set(k, g); }
    return g;
  };
  for (const x of s.sales.values()) {
    if (!x.loyalty || !x.loyalty.units || !x.clientId) continue;
    const g = group(x.clientId);
    if (g) g.items.push({ day: x.day, k: [x.number, 0, 0], units: x.loyalty.units, kind: 'visit', what: 'Visite', id: x.id, saleId: x.id });
  }
  for (const [cid, list] of L(s).entries) {
    const g = group(cid);
    if (g) for (const e of list) g.items.push({ day: e.day, k: [e.n + 0.5, 0, e.v], units: e.units, kind: e.kind === 'reversed' ? 'reversed' : e.reason, what: e.kind === 'reversed' ? 'Remboursement du ticket' : ENTRY_FR[e.reason] || 'Ajustement', id: e.id, saleId: e.saleId });
  }
  const words = nameOf(s);
  for (const r of L(s).rewards.values()) {
    const g = group(r.clientId);
    if (!g) continue;
    g.rewards.push(r);
    if (r.source !== 'card' || !r.units) continue;
    const sale = r.saleId ? s.sales.get(r.saleId) : null;
    g.items.push({ day: sale ? sale.day : r.day, k: sale ? [sale.number, 1, r.v] : [r.n + 0.5, 1, r.v], units: -r.units, kind: 'reward', what: 'Carte complète · ' + rewardWords(r.reward, words), id: r.id, saleId: r.saleId });
  }
  for (const g of by.values()) g.items.sort(cmp);
  return by;
}
/** @param {any} s @param {string} root */
function groupOf(s, root) {
  const all = cached(s, 'index');
  const g = all ? all.get(root) : build(s, root).get(root);
  return g || { items: [], rewards: [] };
}
/** @param {any} s */
const index = (s) => memo(s, 'index', () => build(s, null));

/**
 * The balance a timeline comes to: resets after resetDays without an earning visit (a debt is kept), and since the last
 * one on `today` when given.
 * @param {Item[]} items @param {any} cfg @param {string|null} [today]
 */
export function fold(items, cfg, today = null) {
  let units = 0;
  /** @type {string|null} */
  let last = null;
  const gap = cfg.resetDays || 0;
  for (const it of items) {
    if (it.units > 0 && it.kind !== 'reward') {
      if (gap && last && diffDays(last, it.day) > gap) units = Math.min(units, 0);
      if (!last || it.day > last) last = it.day;
    }
    units += it.units;
  }
  if (gap && last && today && diffDays(last, today) > gap) units = Math.min(units, 0);
  return { units, lastEarn: last };
}

/**
 * How many full cards `units` more stamps on `day` complete (3 at most at once): each is a reward of the programme's.
 * @param {any} s @param {string} root @param {number} units @param {string} day @param {number[]} [k] where they sit among the tickets
 */
export function unlocks(s, root, units, day, k = [Infinity, 0, 0]) {
  const cfg = cfgOf(s);
  if (!units || !cfg.goal) return 0;
  const items = [...groupOf(s, root).items, { day, k, units, kind: 'visit', what: '', id: '', saleId: null }].sort(cmp);
  const after = fold(items, cfg).units;
  return after >= cfg.goal ? Math.min(3, Math.floor(after / cfg.goal)) : 0;
}

/**
 * The balance two files come to once merged (the stamps of both, in order): what a merge must turn into rewards at once.
 * @param {any} s @param {string} a @param {string} b the two files kept so far @param {string} day
 */
export function mergedUnits(s, a, b, day) {
  return fold([...groupOf(s, a).items, ...groupOf(s, b).items].sort(cmp), cfgOf(s), day).units;
}

/** A reward still to use on that day. @param {any} r @param {string} day */
const usable = (r, day) => !r.usedBy && !r.voided && r.expires >= day;

/** The file's rewards still to use on that day, the soonest to expire first. @param {any} s @param {string} cid @param {string} day */
export function rewardsOf(s, cid, day) {
  const root = rootOf(s, cid);
  return root ? groupOf(s, root).rewards.filter((r) => usable(r, day)).sort((a, b) => (a.expires < b.expires ? -1 : a.expires > b.expires ? 1 : 0)) : [];
}

/** Who referred this file (the file kept), and how many this one referred, erased referees included. @param {any} s @param {string} root */
export function referralOf(s, root) {
  const files = new Set(filesOf(s, root));
  let by = null, count = 0;
  for (const ref of L(s).referrals.values()) {
    if (files.has(ref.refereeId) && ref.by) by = rootOf(s, ref.by);
    if (ref.by && files.has(ref.by)) count++;
  }
  for (const f of files) count += (L(s).gone.get(f) || []).length;
  return { by, count };
}

/**
 * The events of the referrals these files take part in, on either side (the referral, the referrer's reward that names
 * the referee): erasing one person drops their personal data by id (client.erased.drop, commands/clients.js).
 * @param {any} s @param {string[]} ids @returns {string[]}
 */
export function referralEventIds(s, ids) {
  const set = new Set(ids);
  const out = [];
  for (const ref of L(s).referrals.values()) {
    if (!set.has(ref.refereeId) && !(ref.by && set.has(ref.by))) continue;
    out.push(ref.id);
    if (ref.rewardId) out.push(ref.rewardId);
  }
  return out;
}

/** Every movement of a card, newest first: { day, what, units }, the rewards used included. @param {any} s @param {{ items: Item[], rewards: any[] }} g */
function historyOf(s, g) {
  const words = nameOf(s);
  const used = g.rewards.filter((r) => r.usedBy).map((r) => {
    const sale = s.sales.get(r.usedBy);
    return { day: sale ? sale.day : r.day, k: sale ? [sale.number, 2, r.v] : [r.n + 0.5, 2, r.v], units: 0, what: 'Récompense utilisée · ' + rewardWords(r.reward, words) };
  });
  return [...g.items, ...used].sort((a, b) => -cmp(/** @type {any} */ (a), /** @type {any} */ (b))).map((x) => ({ day: x.day, what: x.what, units: x.units }));
}

/**
 * A client's card on a day: { root, model, enabled, off, units, goal, rewards [{ id, source, reward, label, expires }],
 * last (10 movements, newest first: { day, what, units }), lastEarn, referredBy }.
 * @param {any} s @param {string} cid @param {string} day
 */
export function cardOf(s, cid, day) {
  const root = rootOf(s, cid) || cid;
  return memo(s, 'card|' + root + '|' + day, () => {
    const cfg = cfgOf(s);
    const c = s.clients.get(root);
    // a read: every file's timeline at once, the lists ask for many cards
    const g = index(s).get(root) || { items: [], rewards: [] };
    const f = fold(g.items, cfg, day);
    const words = nameOf(s);
    const rewards = g.rewards.filter((r) => usable(r, day)).sort((a, b) => (a.expires < b.expires ? -1 : 1))
      .map((r) => ({ id: r.id, source: r.source, reward: r.reward, label: rewardWords(r.reward, words), expires: r.expires }));
    const last = historyOf(s, g).slice(0, 10);
    return {
      root, model: 'stamps', enabled: !!cfg.enabled, off: !!(c && c.loyaltyOff), units: f.units, goal: cfg.goal, rewards, last, lastEarn: f.lastEarn,
      referredBy: referralOf(s, root).by
    };
  });
}

const STATE_FR = { used: 'utilisée', voided: 'annulée', expired: 'expirée', open: 'à utiliser' };
const SRC_FR = { card: 'carte complète', gift: 'offerte par le salon', referrer: 'parrainage', referee: 'bienvenue (parrainé)', birthday: 'anniversaire' };
/**
 * The card in the client's own data export (right of access): balance, every movement, every reward, the referral (a
 * yes and a count: the other person stays out of it) and the reasons of the adjustments made by hand.
 * @param {any} s @param {string} cid @param {string} day
 */
export function loyaltyExport(s, cid, day) {
  const root = rootOf(s, cid) || cid;
  const card = cardOf(s, root, day);
  const g = index(s).get(root) || { items: [], rewards: [] };
  const words = nameOf(s);
  const ref = referralOf(s, root);
  const notes = filesOf(s, root).flatMap((f) => (L(s).entries.get(f) || []).filter((e) => e.reason === 'adjust' && e.note).map((e) => ({ jour: e.day, tampons: e.units, raison: e.note })));
  return {
    participe: !card.off, tampons: card.units, objectif: card.goal,
    historique: historyOf(s, g).map((x) => ({ jour: x.day, mouvement: x.what, tampons: x.units })),
    recompenses: g.rewards.map((r) => ({ recompense: rewardWords(r.reward, words), origine: SRC_FR[r.source] || r.source, obtenueLe: r.day, valableJusquAu: r.expires, etat: STATE_FR[r.usedBy ? 'used' : r.voided ? 'voided' : r.expires < day ? 'expired' : 'open'] })),
    parraine: !!ref.by, filleuls: ref.count, ajustements: notes
  };
}

/** The card in one line for lists and appointment cards: null when the programme is off. @param {any} s @param {any} c @param {string} day */
export function cardLine(s, c, day) {
  if (!c || c.erased || !cfgOf(s).enabled) return null;
  const card = cardOf(s, c.id, day);
  return { units: card.units, goal: card.goal, rewards: card.rewards.length, off: card.off };
}

/* ---------------- spending a reward at the till ---------------- */

/** « Elle s’applique à « Coupe classique ». » @param {any} s @param {any} reward */
function lineWords(s, reward) {
  if (reward.kind === 'amount') return 'Elle s’applique à une prestation ou un produit.';
  const names = (reward.refs || []).map(nameOf(s)).filter(Boolean);
  if (names.length) return 'Elle s’applique à ' + names.map((n) => '« ' + n + ' »').join(' ou ') + '.';
  return (reward.refs || []).length ? 'Elle s’applique à une prestation qui n’est plus à la carte : offre-en une autre au client.' : 'Elle s’applique à une prestation.';
}

/**
 * What a reward takes off a line of this ticket, or a refusal (409). taken: the rewards already on the ticket.
 * @param {any} s @param {any} client @param {string} rewardId
 * @param {{ kind: string, ref?: string|null, unit: number, qty?: number, discount?: number, packId?: any, memberId?: any }} line
 * @param {string} day @param {Set<string>} taken
 * @returns {{ amount: number, label: string }}
 */
export function takeReward(s, client, rewardId, line, day, taken) {
  const r = L(s).rewards.get(rewardId);
  if (!r) fail(404, 'not_found', 'Récompense introuvable.');
  if (!client || rootOf(s, r.clientId) !== rootOf(s, client.id)) fail(409, 'reward_owner', 'Cette récompense est sur la carte d’un autre client.');
  if (r.voided) fail(409, 'reward_used', 'Cette récompense a été annulée.');
  if (r.usedBy) fail(409, 'reward_used', 'Cette récompense a déjà servi.');
  if (r.expires < day) fail(409, 'reward_expired', 'Cette récompense a expiré le ' + ddmm(r.expires) + '.');
  if (taken.size) fail(409, 'reward_one', 'Une récompense par ticket.');
  if (line.packId || line.memberId) fail(409, 'reward_cover', 'Cette coupe est déjà couverte par un carnet ou un abonnement.');
  const amount = rewardValue(r.reward, { kind: line.kind, ref: line.ref, unit: line.unit, qty: line.qty || 1, discount: line.discount || 0 });
  if (!amount) fail(409, 'reward_line', lineWords(s, r.reward));
  return { amount, label: rewardWords(r.reward, nameOf(s)) };
}

/* ---------------- the receipt ---------------- */

/** The ticket's file, if it takes part in a programme that runs. @param {any} s @param {any} sale */
function receiptCard(s, sale, day) {
  const c = sale && sale.clientId ? s.clients.get(rootOf(s, sale.clientId)) : null;
  if (!c || c.erased || c.loyaltyOff || !cfgOf(s).enabled) return null;
  return cardOf(s, c.id, day);
}
/**
 * The receipt text's {fidelite}, short so the text stays one SMS: « Carte 6/9. », « Ta prochaine coupe est offerte ! »,
 * « Barbe offerte au prochain passage ! », « 5 € offerts au prochain passage ! » or ''.
 * @param {any} s @param {any} sale @param {string} day
 */
export function receiptWords(s, sale, day) {
  const card = receiptCard(s, sale, day);
  if (!card) return '';
  const r = card.rewards[0];
  if (!r) return ' Carte ' + Math.max(0, card.units) + '/' + card.goal + '.';
  if (r.reward.kind === 'amount') return ' ' + fmtEur(r.reward.amount) + ' offerts au prochain passage !';
  const refs = r.reward.refs || [];
  const one = refs.length === 1 ? nameOf(s)(refs[0]) : '';
  if (one && one.length <= 24) return ' ' + one + ' offerte au prochain passage !';
  return refs.length ? ' Prestation offerte au prochain passage !' : ' Ta prochaine coupe est offerte !';
}
/** The receipt page's card: { words: « 6/9 tampons », next: what the full card gives } or null. @param {any} s @param {any} sale @param {string} day */
export function receiptLoyalty(s, sale, day) {
  const card = receiptCard(s, sale, day);
  if (!card) return null;
  return { words: cardWords({ ...card, units: Math.max(0, card.units) }), next: rewardWords(cfgOf(s).reward, nameOf(s)) };
}

/* ---------------- what the programme costs and owes ---------------- */

/**
 * What one reward is worth at today's prices: an amount, or the services it may pay (all of them when refs is empty),
 * each up to the cap, on average. @param {any} s @param {any} reward @param {string|null} [serviceId] the cut it would pay
 */
export function rewardWorth(s, reward, serviceId = null) {
  if (!reward) return 0;
  if (reward.kind === 'amount') return reward.amount || 0;
  const refs = reward.refs || [];
  const one = serviceId && (!refs.length || refs.includes(serviceId)) ? s.services.get(serviceId) : null;
  const list = one ? [one] : (refs.length ? refs.map((x) => s.services.get(x)) : [...s.services.values()].filter((x) => x.active && !x.pack)).filter(Boolean);
  if (!list.length) return reward.cap || 0;
  return Math.round(list.reduce((t, x) => t + Math.min(reward.cap || x.price, x.price), 0) / list.length);
}

/**
 * What the salon owes in loyalty on a day, for the accountant: the rewards not used and not expired at their value, and
 * the stamps in progress at their share of a reward. No cash value, nothing to book at issue: a provision is his call.
 * @param {any} s @param {string} day @returns {{ available: number, value: number, progress: number }}
 */
export function liability(s, day) {
  return memo(s, 'liability|' + day, () => {
    const cfg = cfgOf(s);
    let available = 0, value = 0, stamps = 0;
    for (const r of L(s).rewards.values()) if (usable(r, day)) { available++; value += rewardWorth(s, r.reward); }
    for (const [root, g] of index(s)) {
      const c = s.clients.get(root);
      if (!c || c.erased) continue;
      stamps += Math.max(0, fold(g.items, cfg, day).units);
    }
    const progress = cfg.goal ? Math.round((stamps * rewardWorth(s, cfg.reward)) / cfg.goal) : 0;
    return { available, value, progress };
  });
}

/**
 * The period's tickets replayed under another programme (the owner's simulator), with the stamps carried over at launch
 * or from the old site: { clients (who earned), rewards, value (at today's prices), share (of the period's service
 * revenue), perClientYear (value a year per client who earned) }.
 * @param {any} s @param {any} over a programme's settings over the salon's own @param {{ from: string, to: string }} q
 */
export function simulate(s, over, q) {
  const key = 'sim|' + JSON.stringify(over) + '|' + q.from + '|' + q.to;
  return memo(s, key, () => {
    const cfg = { ...cfgOf(s), ...over, reward: { ...cfgOf(s).reward, ...(over.reward || {}) } };
    /** @type {Map<string, { units: number, last: string|null, days: Set<string>, svc: Map<string, number> }>} */
    const cards = new Map();
    const card = (root) => { let x = cards.get(root); if (!x) { x = { units: 0, last: null, days: new Set(), svc: new Map() }; cards.set(root, x); } return x; };
    /** @type {{ day: string, k: number[], root: string, units: number, svc: string|null }[]} */
    const steps = [];
    let serviceRevenue = 0;
    for (const x of s.sales.values()) {
      if (x.day < q.from || x.day > q.to) continue;
      serviceRevenue += x.lines.reduce((t, l) => t + (l.kind === 'service' ? l.net : 0), 0);
      if (!x.clientId) continue;
      const root = rootOf(s, x.clientId);
      const c = s.clients.get(root);
      if (!c || c.loyaltyOff) continue;
      const net = qualifyingNet(x.lines);
      const top = x.lines.filter((l) => l.kind === 'service' && !l.packId && !l.memberId).sort((a, b) => b.net - a.net)[0];
      steps.push({ day: x.day, k: [x.number, 0], root, units: unitsFor(cfg, net), svc: top ? top.ref : null });
    }
    // the stamps a launch or the old site's cards brought (their adjustments and refunds belong to the real programme)
    for (const [cid, list] of L(s).entries) for (const e of list) {
      if (e.kind === 'earned' && (e.reason === 'start' || e.reason === 'import') && e.day >= q.from && e.day <= q.to) steps.push({ day: e.day, k: [e.n + 0.5, e.v], root: rootOf(s, cid), units: e.units, svc: null });
    }
    steps.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : a.k[0] - b.k[0] || a.k[1] - b.k[1]));
    const earners = new Set();
    let rewards = 0, value = 0;
    /** @type {{ root: string }[]} */
    const won = [];
    for (const st of steps) {
      if (!st.units) continue;
      const x = card(st.root);
      if (st.svc) {
        // one earning ticket a day, as at the till
        if (x.days.has(st.day)) continue;
        x.days.add(st.day);
        x.svc.set(st.svc, (x.svc.get(st.svc) || 0) + 1);
      }
      if (cfg.resetDays && x.last && diffDays(x.last, st.day) > cfg.resetDays) x.units = Math.min(0, x.units);
      if (!x.last || st.day > x.last) x.last = st.day;
      x.units += st.units;
      earners.add(st.root);
      while (cfg.goal && x.units >= cfg.goal) { x.units -= cfg.goal; rewards++; won.push({ root: st.root }); }
    }
    // each reward valued on the cut its client takes most, at today's price
    for (const w of won) {
      const svc = [...(cards.get(w.root) || { svc: new Map() }).svc.entries()].sort((a, b) => b[1] - a[1])[0];
      value += rewardWorth(s, cfg.reward, svc ? svc[0] : null);
    }
    const days = Math.max(1, diffDays(q.from, q.to) + 1);
    return {
      clients: earners.size, rewards, value, share: serviceRevenue ? value / serviceRevenue : 0,
      perClientYear: earners.size ? Math.round(((value / earners.size) * 365) / days) : 0
    };
  });
}

/**
 * The programme over a period, for its report (FID-05): stamps given and taken back, rewards unlocked, used, expired,
 * restored and voided, the value given (at retail, and at cost for products), by source, by cashier, the manual
 * adjustments, the referrals. Birthdays are a reserved source (0 in v1).
 * @param {any} s @param {{ from: string, to: string }} q
 */
export function programStats(s, q) {
  return memo(s, 'stats|' + q.from + '|' + q.to, () => {
    const inR = (d) => !!d && d >= q.from && d <= q.to;
    const stamps = { given: 0, visit: 0, start: 0, import: 0, adjust: 0, takenBack: 0 };
    const adjustments = { count: 0, plus: 0, minus: 0 };
    for (const x of s.sales.values()) if (x.loyalty && x.loyalty.units > 0 && inR(x.day)) { stamps.given += x.loyalty.units; stamps.visit += x.loyalty.units; }
    for (const list of L(s).entries.values()) for (const e of list) {
      if (!inR(e.day)) continue;
      if (e.kind === 'reversed') { stamps.takenBack -= e.units; continue; }
      if (e.reason === 'adjust') { adjustments.count++; if (e.units > 0) adjustments.plus += e.units; else adjustments.minus -= e.units; }
      if (e.units > 0) { stamps.given += e.units; stamps[e.reason] = (stamps[e.reason] || 0) + e.units; }
      else stamps.takenBack -= e.units;
    }
    const rewards = { unlocked: 0, used: 0, expired: 0, restored: 0, voided: 0 };
    const value = { retail: 0, cost: 0 };
    /** @type {Record<string, { unlocked: number, used: number, value: number }>} */
    const bySource = {};
    for (const k of ['card', 'gift', 'referrer', 'referee', 'birthday']) bySource[k] = { unlocked: 0, used: 0, value: 0 };
    /** @type {Map<string, { staffId: string|null, name: string, used: number, value: number }>} */
    const cashiers = new Map();
    for (const r of L(s).rewards.values()) {
      const src = bySource[r.source] || (bySource[r.source] = { unlocked: 0, used: 0, value: 0 });
      if (inR(r.day)) { rewards.unlocked++; src.unlocked++; }
      if (r.voided && inR(dayOfAt(r.voided.at))) rewards.voided++;
      for (const x of r.restored) if (inR(dayOfAt(x.at))) rewards.restored++;
      if (!r.usedBy && !r.voided && inR(r.expires) && r.expires < q.to) rewards.expired++;
      const sale = r.usedBy ? s.sales.get(r.usedBy) : null;
      if (!sale || !inR(sale.day)) continue;
      rewards.used++; src.used++; src.value += r.amount; value.retail += r.amount;
      const line = sale.lines.find((l) => l.reward && l.reward.id === r.id);
      value.cost += line && line.kind === 'product' && line.unit ? Math.round((r.amount * (line.cost || 0)) / line.unit) : r.amount;
      const k = sale.cashierId || '';
      const ca = cashiers.get(k) || { staffId: sale.cashierId || null, name: (s.staff.get(sale.cashierId) || {}).name || 'Système', used: 0, value: 0 };
      ca.used++; ca.value += r.amount;
      cashiers.set(k, ca);
    }
    const referrals = { claimed: 0, came: 0, rewarded: 0 };
    for (const ref of L(s).referrals.values()) {
      if (inR(ref.day)) referrals.claimed++;
      const sale = ref.rewardedBy ? s.sales.get(ref.rewardedBy) : null;
      if (sale && inR(sale.day)) referrals.came++;
    }
    referrals.rewarded = bySource.referrer.unlocked;
    return {
      from: q.from, to: q.to, stamps, adjustments, rewards, value, bySource, byCashier: [...cashiers.values()].sort((a, b) => b.value - a.value),
      referrals, birthdays: { granted: bySource.birthday.unlocked, used: bySource.birthday.used }
    };
  });
}
