// @ts-check
// Fidélité (FID-02): the commands of the stamp card, and what the till calls around a ticket. The events are described
// in projections/loyalty.js, the reading of a card in domain/loyalty.js, the settings in settings/loyalty.js.
// A reward is a discount on a normal taxed line (CJEU C-436/24 Lyko: a price reduction on the later supply, not a
// voucher): stamps have no cash value, so issuing them books nothing and VAT follows what the client pays (shared/money.js).
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, id, oneOf, parse } from '../lib/validate.js';
import { getClient } from './common.js';
import { addDays, dayParts, pad2, diffDays } from '../../shared/dates.js';
import { cfgOf, rootOf, filesOf, unlocks, qualifyingNet, unitsFor, takeReward, stampStands, mergedUnits, launchPlan } from '../domain/loyalty.js';
import { rewardSchema, HEAD_STARTS } from '../settings/loyalty.js';

const DAY_MS = 86400000;
/** @param {any} s */
const L = (s) => s.loyalty;
const ddmm = (day) => { const p = dayParts(day); return pad2(p.d) + '/' + pad2(p.m) + '/' + p.y; };

/** A reward as it is written in an event: only the fields of its kind (a settings merge may leave the other kind's). */
export function rewardOf(r) {
  if (r && r.kind === 'amount') return { kind: 'amount', amount: r.amount || 0 };
  return { kind: 'service', refs: (r && r.refs) || [], ...(r && r.cap ? { cap: r.cap } : {}) };
}

/** Full cards become rewards of the programme's, valid rewardDays. @param {any} s @param {any} ctx */
function grantCards(s, ctx, root, n, day, saleId = null) {
  const cfg = cfgOf(s);
  for (let i = 0; i < n; i++) {
    ctx.emit('loyalty.rewarded', { id: ctx.id('lrw'), cid: root, clientId: root, source: 'card', reward: rewardOf(cfg.reward), units: cfg.goal, expires: addDays(day, cfg.rewardDays), day, ...(saleId ? { saleId } : {}) });
  }
  return n;
}
/** Where a stamp given now sits among the tickets: after the last one (as the projection files it). @param {any} s */
const nowKey = (s) => [s.saleSeq + 0.5, 0, Infinity];

/* ---------------- around a ticket (commands/sales.js) ---------------- */

/**
 * A line of the ticket being rung up with a reward on it: the reward's value off its price (on top of a discount typed
 * on the line), « · fidélité » in its name, and `reward: { id, amount }` kept on it for the books (« remises fidélité »)
 * and the commissions (TEAM-03 team.rewardCredit). Any cashier may apply one: the system checked it (domain/loyalty.js).
 * @param {any} s @param {any} client @param {string|undefined} rewardId @param {any} line as sales.js built it
 * @param {string} day @param {Set<string>} taken the rewards already on this ticket
 */
export function withReward(s, client, rewardId, line, day, taken) {
  if (!rewardId) return line;
  const r = takeReward(s, client, rewardId, line, day, taken);
  taken.add(rewardId);
  return { ...line, name: (line.name + ' · fidélité').slice(0, 80), discount: (line.discount || 0) + r.amount, reward: { id: rewardId, amount: r.amount } };
}

/** The file's referral, by the file kept. @param {any} s @param {string} root */
function referralOf(s, root) {
  for (const f of filesOf(s, root)) { const ref = L(s).referrals.get(f); if (ref) return ref; }
  return null;
}

/**
 * After a ticket: its rewards used (loyalty.redeemed), the full cards its stamp completes (at most 3), and, on the
 * referee's first earning ticket, his referrer's reward. sale: the sale.completed data just emitted.
 * @param {any} s @param {any} ctx @param {any} sale
 */
export function loyaltyAfterSale(s, ctx, sale) {
  for (const l of sale.lines) {
    const r = l.reward ? L(s).rewards.get(l.reward.id) : null;
    if (r) ctx.emit('loyalty.redeemed', { id: r.id, cid: r.clientId, saleId: sale.id, amount: l.reward.amount });
  }
  const units = sale.loyalty ? sale.loyalty.units : 0;
  if (!units || !sale.clientId) return;
  const root = rootOf(s, sale.clientId);
  grantCards(s, ctx, root, unlocks(s, root, units, sale.day, [sale.number, 0, 0]), sale.day, sale.id);
  const ref = referralOf(s, root);
  if (!ref || !ref.by) return;
  // once, unless the referee's first ticket was refunded before the referrer used his reward (voided): the next one counts
  const prev = ref.rewardId ? L(s).rewards.get(ref.rewardId) : null;
  if (ref.rewardId && !(prev && prev.voided && prev.voided.why === 'refund')) return;
  // first earning ticket: none of his tickets earned before this one (a stamp refunded away does not count)
  for (const x of s.sales.values()) if (stampStands(s, x) && x.clientId && rootOf(s, x.clientId) === root) return;
  const by = rootOf(s, ref.by);
  const c = by ? s.clients.get(by) : null;
  // a referrer who opted out earns nothing, his referral's reward included
  if (!c || c.erased || c.loyaltyOff) return;
  const cfg = cfgOf(s);
  ctx.emit('loyalty.rewarded', {
    id: ctx.id('lrw'), cid: by, clientId: by, source: 'referrer', reward: rewardOf(cfg.referral.referrer), units: 0, expires: addDays(sale.day, cfg.rewardDays),
    day: sale.day, saleId: sale.id, year: ref.year || Number(sale.day.slice(0, 4)), peer: ref.refereeId
  }, { for: ref.refereeId });
}

/**
 * After a credit note: the ticket's stamps recomputed on what is left after all its refunds, the difference taken back
 * (loyalty.reversed); refunded in full, its rewards used come back (loyalty.restored, valid 30 more days at least) and,
 * if it was a referee's first ticket, the referrer's reward is voided if unused (else the loss is accepted: the feed
 * says so). Idempotent per refund: run again with the refund in the state, it finds nothing left to do.
 * @param {any} s @param {any} ctx @param {any} sale as the state has it @param {any} refund the sale.refunded data
 */
export function loyaltyAfterRefund(s, ctx, sale, refund) {
  if (!sale || !sale.clientId || !refund) return;
  const known = s.refunds.has(refund.id);
  /** @type {Record<number, { qty: number, amount: number }>} */
  const done = { ...(sale.lineRefunds || {}) };
  let refunded = sale.refunded || 0;
  if (!known) {
    for (const l of refund.lines || []) { const r = done[l.i] || { qty: 0, amount: 0 }; done[l.i] = { qty: r.qty + l.qty, amount: r.amount + l.amount }; }
    refunded += refund.amount - (refund.liability || 0);
  }
  const revenue = sale.totals.revenue;
  const left = revenue - refunded;
  // each line less what went back on it; then a refund without lines spreads over what is left of the revenue
  const lines = sale.lines.map((l, i) => ({ ...l, net: l.net - ((done[i] || { amount: 0 }).amount || 0) }));
  const byLines = lines.reduce((t, l, i) => t + (l.kind !== 'giftcard' ? (done[i] || { amount: 0 }).amount : 0), 0);
  const rest = revenue - byLines;
  const qual = left <= 0 || rest <= 0 ? 0 : Math.round((qualifyingNet(lines) * left) / rest);
  const earned = sale.loyalty ? sale.loyalty.units : 0;
  const b = L(s).bySale.get(sale.id);
  const keep = left > 0 && unitsFor(cfgOf(s), qual) ? earned : 0;
  const diff = keep - (earned + (b ? b.reversed : 0));
  const root = rootOf(s, sale.clientId);
  const day = ctx.local.day;
  let referral = null;
  if (left <= 0) {
    const ref = [...L(s).referrals.values()].find((x) => x.rewardedBy === sale.id);
    const rw = ref && ref.rewardId ? L(s).rewards.get(ref.rewardId) : null;
    if (rw && !rw.voided) {
      if (!rw.usedBy) ctx.emit('loyalty.voided', { id: rw.id, cid: rw.clientId, why: 'refund' });
      else referral = 'kept';
    }
  }
  // units 0: a partial refund already took the stamp back, the marker still tells the feed the referral was lost
  if (diff < 0 || referral) ctx.emit('loyalty.reversed', { id: ctx.id('lrv'), cid: root, clientId: root, units: Math.min(0, diff), saleId: sale.id, refundId: refund.id, day, ...(referral ? { referral } : {}) });
  if (left > 0 || !b) return;
  for (const rid of b.redeemed) {
    const rw = L(s).rewards.get(rid);
    if (!rw || rw.usedBy !== sale.id) continue;
    const back = addDays(day, 30);
    ctx.emit('loyalty.restored', { id: rw.id, cid: rw.clientId, saleId: sale.id, refundId: refund.id, expires: rw.expires > back ? rw.expires : back });
  }
}

/* ---------------- the programme ---------------- */

const launchSchema = obj({ headStart: opt(oneOf(HEAD_STARTS)) });
/**
 * Start the programme once: every client with paid visits in the last 365 days (visits brought over from WordPress
 * included) gets a head start, capped by headStart. Visits that already earned a stamp are not counted twice. About
 * one event per active client, in one write.
 */
export const launchLoyalty = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(launchSchema, input || {});
    if (L(s).launched) fail(409, 'launched', 'Le programme de fidélité est déjà lancé (depuis le ' + ddmm(L(s).launched.day) + ').');
    const cfg = cfgOf(s);
    // once only: launched while off, the head start would be spent before the final WordPress sync
    if (!cfg.enabled) fail(409, 'off', 'Active d’abord le programme de fidélité, puis lance la reprise des cartes.');
    const head = x.headStart || cfg.headStart;
    const day = ctx.local.day;
    ctx.emit('loyalty.launched', { day, headStart: head });
    const plan = launchPlan(s, head, day);
    for (const row of plan.rows) ctx.emit('loyalty.earned', { id: ctx.id('lea'), cid: row.root, clientId: row.root, units: row.units, reason: 'start', day });
    const clients = plan.rows.length, stamps = plan.rows.reduce((t, x) => t + x.units, 0);
    return { launched: day, headStart: head, clients, stamps };
  }
};

// what anyone at the till may give, one stamp a day: the reasons are the salon's words, never a person's
export const ADJUST_REASONS = ['Tampon oublié', 'Passage sans ticket'];
const adjustSchema = obj({ clientId: id(), units: int({ min: -50, max: 50 }), reason: str({ min: 2, max: 80 }) });
/**
 * A stamp by hand. Whoever rings up (sale.create): +1, once a day per client, for a forgotten stamp or a visit without a
 * ticket. The owner and managers (loyalty.manage): −50 to +50 for any reason. The reason stays out of the chain (pii).
 */
export const adjustLoyalty = {
  run(s, input, ctx) {
    const boss = ctx.can('loyalty.manage');
    if (!boss) ctx.need('sale.create');
    const x = parse(adjustSchema, input);
    const c = getClient(s, x.clientId);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    if (!cfgOf(s).enabled) fail(409, 'off', 'Le programme de fidélité n’est pas lancé.');
    if (!x.units) fail(400, 'invalid', 'Indique un nombre de tampons.');
    if (x.units > 0 && c.loyaltyOff) fail(409, 'loyalty_off', 'Ce client ne participe pas au programme de fidélité.');
    const day = ctx.local.day;
    const root = c.id;
    if (!boss) {
      if (x.units !== 1) fail(403, 'forbidden', 'Tu peux ajouter un tampon à la fois : le gérant fait les autres ajustements.');
      if (!ADJUST_REASONS.includes(x.reason)) fail(400, 'invalid', 'Raison : « ' + ADJUST_REASONS.join(' » ou « ') + ' ».');
      const files = new Set(filesOf(s, root));
      const today = [...files].some((f) => (L(s).entries.get(f) || []).some((e) => e.reason === 'adjust' && e.units > 0 && e.day === day));
      const ticket = (s.salesByDay.get(day) || []).some((sid) => { const t = s.sales.get(sid); return stampStands(s, t) && t.clientId && files.has(t.clientId); });
      if (today || ticket) fail(409, 'adjusted', 'Ce client a déjà son tampon aujourd’hui.');
    }
    const eid = ctx.id('lea');
    ctx.emit('loyalty.earned', { id: eid, cid: root, clientId: root, units: x.units, reason: 'adjust', day, by: ctx.staff ? ctx.staff.id : ctx.actor.id }, { note: x.reason });
    const rewards = x.units > 0 ? grantCards(s, ctx, root, unlocks(s, root, x.units, day, nowKey(s)), day) : 0;
    return { id: eid, rewards };
  }
};

const giftSchema = obj({ clientId: id(), reward: rewardSchema(), days: opt(int({ min: 7, max: 730 })) });
/** A reward the salon offers (a gesture, an apology): valid `days` (the programme's rewardDays by default). */
export const giftReward = {
  run(s, input, ctx) {
    ctx.need('loyalty.manage');
    const x = parse(giftSchema, input);
    const c = getClient(s, x.clientId);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    const day = ctx.local.day;
    const rid = ctx.id('lrw');
    ctx.emit('loyalty.rewarded', { id: rid, cid: c.id, clientId: c.id, source: 'gift', reward: rewardOf(x.reward), units: 0, expires: addDays(day, x.days || cfgOf(s).rewardDays), day });
    return { id: rid };
  }
};

/** A reward taken back before use (given by mistake). A used one stays used: its ticket is refunded instead. */
export const voidReward = {
  run(s, input, ctx) {
    ctx.need('loyalty.manage');
    const r = L(s).rewards.get(parse(id(), input && input.id));
    if (!r) fail(404, 'not_found', 'Récompense introuvable.');
    if (r.voided) return { ok: true };
    if (r.usedBy) fail(409, 'reward_used', 'Cette récompense a déjà servi : rembourse son ticket, ou rends-la si le ticket est à 0 €.');
    ctx.emit('loyalty.voided', { id: r.id, cid: r.clientId, why: 'staff' });
    return { ok: true };
  }
};

/**
 * A used reward given back when its ticket took no money (a free cut rung on the wrong client or service): a 0 € ticket
 * has nothing to refund, so loyaltyAfterRefund never sees it. Only while the ticket's day is open (its Z then counts the
 * reward once) and nothing is left of its revenue; valid 30 more days at least, as after a refund.
 */
export const restoreReward = {
  run(s, input, ctx) {
    ctx.need('loyalty.manage');
    const r = L(s).rewards.get(parse(id(), input && input.id));
    if (!r) fail(404, 'not_found', 'Récompense introuvable.');
    if (!r.usedBy) return { ok: true, expires: r.expires };
    const sale = s.sales.get(r.usedBy);
    if (!sale) fail(404, 'not_found', 'Ticket introuvable.');
    if (s.closures.has(sale.day)) fail(409, 'day_closed', 'La journée de ce ticket est clôturée : offre plutôt une nouvelle récompense.');
    if (sale.totals.revenue - (sale.refunded || 0) > 0) fail(409, 'reward_paid', 'Ce ticket a encaissé de l’argent : rembourse-le, la récompense revient avec.');
    const back = addDays(ctx.local.day, 30);
    const expires = r.expires > back ? r.expires : back;
    ctx.emit('loyalty.restored', { id: r.id, cid: r.clientId, saleId: sale.id, refundId: null, expires });
    return { ok: true, expires };
  }
};

/* ---------------- referral ---------------- */

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-8);
/** A paid visit of this file or of one merged into it: a ticket that took money, or a visit brought over from the old site. */
function paidVisit(s, files) {
  for (const t of s.sales.values()) if (t.clientId && files.has(t.clientId) && t.totals.revenue - t.refunded > 0) return true;
  for (const a of s.appts.values()) if (a.legacy && a.status === 'done' && a.clientId && files.has(a.clientId)) return true;
  return false;
}
const referralSchema = obj({ refereeId: id(), referrerId: id(), via: oneOf(/** @type {const} */ (['link', 'till'])) });
/**
 * A new client says who sent him: from the referrer's link on the site (the system, right after his booking), or at the
 * till (sale.create). The referee gets his welcome reward now (60 days); the referrer his own on the referee's first
 * earning ticket (loyaltyAfterSale). Two different persons (numbers and e-mails differ), a referee never seen before and
 * never referred, a referrer who came, perYear referrals a calendar year at most, and by link only a file that booking
 * just created. A refusal is an answer ({ ok: false, why, message }), never an error: it must not block a booking.
 */
export const claimReferral = {
  run(s, input, ctx) {
    const x = parse(referralSchema, input);
    if (x.via === 'link') { if (ctx.actor.t !== 'system') fail(403, 'forbidden', 'Le lien de parrainage est enregistré par le site.'); }
    else ctx.need('sale.create');
    const no = (why, message) => ({ ok: false, why, message });
    const cfg = cfgOf(s);
    const R = cfg.referral || {};
    if (!cfg.enabled || !R.enabled) return no('off', 'Le parrainage n’est pas ouvert.');
    const ee = s.clients.get(rootOf(s, x.refereeId) || ''), er = s.clients.get(rootOf(s, x.referrerId) || '');
    if (!ee || !er) return no('not_found', 'Fiche introuvable.');
    if (ee.erased || er.erased) return no('erased', 'Cette fiche a été effacée.');
    if (ee.id === er.id) return no('self', 'Un client ne se parraine pas lui-même.');
    if (ee.loyaltyOff || er.loyaltyOff) return no('off', 'Ce client ne participe pas au programme de fidélité.');
    const eeFiles = new Set(filesOf(s, ee.id)), erFiles = new Set(filesOf(s, er.id));
    if ([...eeFiles].some((f) => L(s).referrals.has(f))) return no('twice', 'Ce client a déjà un parrain.');
    if (paidVisit(s, eeFiles)) return no('known', 'Ce client est déjà venu : le parrainage est pour un nouveau client.');
    const eeAll = [...eeFiles].map((f) => s.clients.get(f)).filter(Boolean), erAll = [...erFiles].map((f) => s.clients.get(f)).filter(Boolean);
    const phones = new Set(erAll.map((c) => digits(c.phone)).filter((d) => d.length === 8));
    const mails = new Set(erAll.map((c) => String(c.email || '').trim().toLowerCase()).filter(Boolean));
    if (eeAll.some((c) => phones.has(digits(c.phone)) || mails.has(String(c.email || '').trim().toLowerCase()))) return no('same', 'Le parrain et le filleul ont le même numéro ou la même adresse.');
    if (!paidVisit(s, erFiles)) return no('referrer', 'Le parrain doit être déjà venu au salon.');
    const day = ctx.local.day, year = Number(day.slice(0, 4));
    // the referrals of the year that were rewarded, or still may be (the referee's 60 days): junk claims cannot burn the
    // quota for good, and an erased referee still counts
    const counts = (x) => x.year === year && (x.rewarded || (x.pending && diffDays(x.day, day) <= 60));
    const mine = [...L(s).referrals.values()].filter((ref) => ref.by && erFiles.has(ref.by)).map((ref) => {
      const w = ref.rewardId ? L(s).rewards.get(ref.rewardId) : null;
      return { year: ref.year, day: ref.day, rewarded: !!(w && !w.voided), pending: !ref.rewardId };
    });
    const made = [...mine, ...[...erFiles].flatMap((f) => L(s).gone.get(f) || [])].filter(counts).length;
    if (R.perYear && made >= R.perYear) return no('limit', 'Ce parrain a déjà fait ses ' + R.perYear + ' parrainages de l’année.');
    if (x.via === 'link' && !(ee.source === 'site' && ctx.now - (ee.createdAt || 0) <= DAY_MS)) return no('late', 'Le lien de parrainage vaut pour une première réservation.');
    const rid = ctx.id('lrf');
    ctx.emit('loyalty.referred', { id: rid, cid: ee.id, peer: er.id, via: x.via, day, year }, { by: er.id });
    const wid = ctx.id('lrw');
    ctx.emit('loyalty.rewarded', { id: wid, cid: ee.id, clientId: ee.id, source: 'referee', reward: rewardOf(R.referee), units: 0, expires: addDays(day, 60), day });
    return { ok: true, id: rid, rewardId: wid };
  }
};

/**
 * Two files merged (commands/clients.js mergeClients): the cards their stamps now complete become rewards at once,
 * rather than a card reading 10/9 until the next visit. Before client.merged is applied: both files are still apart.
 * @param {any} s @param {any} ctx @param {any} from @param {any} into
 */
export function loyaltyAfterMerge(s, ctx, from, into) {
  const cfg = cfgOf(s);
  if (!cfg.enabled || !cfg.goal || from.loyaltyOff || into.loyaltyOff) return 0;
  const units = mergedUnits(s, rootOf(s, from.id), rootOf(s, into.id), ctx.local.day);
  return units >= cfg.goal ? grantCards(s, ctx, into.id, Math.min(3, Math.floor(units / cfg.goal)), ctx.local.day) : 0;
}

/* ---------------- the old site, the right not to take part ---------------- */

const importSchema = obj({ rows: arr(obj({ clientId: id(), units: int({ min: 1, max: 5000 }) }), { max: 2000 }) });
/**
 * Points or stamps of the old site's loyalty plugin (WordPress), as stamps on each file: once per file (its id says
 * so), full cards becoming rewards. The system only (the import, the demo), never a person's typing.
 */
export const importLoyalty = {
  run(s, input, ctx) {
    if (ctx.actor.t !== 'system') fail(403, 'forbidden', 'Réservé à l’import de l’ancien site.');
    const x = parse(importSchema, input);
    const day = ctx.local.day;
    const seen = new Set();
    let imported = 0, skipped = 0, rewards = 0;
    for (const row of x.rows) {
      const root = rootOf(s, row.clientId);
      const c = root ? s.clients.get(root) : null;
      const eid = 'lea_imp_' + root;
      if (!c || c.erased || c.loyaltyOff || seen.has(root) || filesOf(s, root).some((f) => (L(s).entries.get(f) || []).some((e) => e.id === eid))) { skipped++; continue; }
      seen.add(root);
      ctx.emit('loyalty.earned', { id: eid, cid: root, clientId: root, units: row.units, reason: 'import', day });
      rewards += grantCards(s, ctx, root, unlocks(s, root, row.units, day, nowKey(s)), day);
      imported++;
    }
    return { imported, skipped, rewards };
  }
};

const offSchema = obj({ clientId: id(), off: bool() });
/**
 * The right not to take part: off, nothing is earned and the card reads « Ne participe pas »; the rewards already
 * earned stay usable until they expire. The salon sets it at the counter (client.edit); the client himself, signed in to
 * /moi, sets it on his own file only, which the route vouches for in ctx.meta.me (http/me-kit.js runAs), never the body's.
 */
export const setLoyaltyOff = {
  run(s, input, ctx) {
    const own = ctx.actor.t === 'client';
    if (!own) ctx.need('client.edit');
    const mine = own ? ctx.meta && ctx.meta.me && ctx.meta.me.cid : null;
    if (own && !mine) fail(401, 'signed_out', 'Ton espace s’est fermé. Reconnecte-toi.');
    const x = parse(offSchema, own ? { clientId: mine, off: input && input.off } : input);
    const c = getClient(s, x.clientId);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    if (!!c.loyaltyOff === x.off) return { ok: true, off: x.off };
    ctx.emit('client.updated', { id: c.id, cid: c.id, patch: { loyaltyOff: x.off }, fields: [] });
    return { ok: true, off: x.off };
  }
};
