// @ts-check
// Fidélité (FID-02), as the projection folds it. Registered in core/extensions.js; the commands are commands/loyalty.js,
// the reading of a card (balance, rewards, stats) domain/loyalty.js. No import of the engine or the state here.
//
// A paid visit's stamp travels on its ticket (sale.completed data.loyalty.units), not as an event of its own: one more
// event per ticket would take the demo past its journal budget (≤ 8 000 events, tests/unit/journal-budget.test.js).
// Every other movement of a card is a loyalty.* event, each naming its file (data.cid) so erasure blanks its pii:
//   loyalty.launched { day, headStart }                                  once (commands/loyalty.js launchLoyalty)
//   loyalty.earned   { id, cid, clientId, units, reason: 'start'|'adjust'|'import', day, by? }   pii { note? }
//   loyalty.rewarded { id, cid, clientId, source: 'card'|'gift'|'referrer'|'referee', reward, units, expires, day,
//                      saleId?, year?, peer? }                           pii { for? }  ('birthday' is a reserved source)
//   loyalty.redeemed { id: rewardId, cid, saleId, amount }
//   loyalty.reversed { id, cid, clientId, units (≤ 0: 0 only to carry referral 'kept'), saleId, refundId, day, referral?: 'kept' }
//   loyalty.restored { id: rewardId, cid, saleId, refundId (null: given back by hand from a 0 € ticket, restoreReward), expires }
//   loyalty.voided   { id: rewardId, cid, why: 'refund'|'staff' }
//   loyalty.referred { id, cid: refereeId, peer: referrerId, via: 'link'|'till', day, year }   pii { by: referrerId }
// A referral names two persons: its events carry the other file in data.peer, so erasing either one finds them
// (commands/clients.js adds their ids to client.erased.drop) and this projection forgets the link on both sides.
//
// s.loyalty = {
//   launched: { day, headStart, at } | null,
//   entries: clientId → [{ id, kind: 'earned'|'reversed', clientId, units, reason, saleId, refundId, day, at, by, note,
//            referral, n (the last ticket number when it was written: orders it among the tickets), v }],
//   rewards: id → { id, cid, clientId, source, reward, units, expires, day, saleId, year, peer, for, at, by, n, v,
//            usedBy (saleId) | null, amount, usedAt, voided { why, at } | null, restored [{ saleId, refundId, at }] },
//   bySale: saleId → { reversed (units taken back, ≤ 0), redeemed [rewardId] },
//   referrals: refereeId → { id, refereeId, by (referrer) | null, via, day, year, at, rewardedBy (saleId) | null,
//            rewardId (the referrer's) | null, refereeRewardId | null },
//   gone: referrerId → [{ year, day, rewarded, pending }] the referrals whose referee was erased (counted, nobody named) }
// An erased file's rewards not used yet are voided ({ why: 'erased' }): nobody can use them any more, nothing is owed.
// client.merged is not handed on: the reads resolve each file to the one kept (domain/loyalty.js rootOf).
import { fmtEur } from '../../shared/money.js';
import { localParts } from '../../shared/dates.js';

const L = (s) => s.loyalty;
const bySale = (s, id) => { let b = L(s).bySale.get(id); if (!b) { b = { reversed: 0, redeemed: [] }; L(s).bySale.set(id, b); } return b; };
const push = (s, cid, x) => { const l = L(s).entries.get(cid); if (l) l.push(x); else L(s).entries.set(cid, [x]); };
const dayOf = (at) => localParts(at).day;

/** The first name on the file kept, for the feed. */
function firstOf(s, cid) {
  let c = cid ? s.clients.get(cid) : null;
  for (let i = 0; c && c.mergedInto && i < 20; i++) c = s.clients.get(c.mergedInto) || null;
  return (c && !c.erased && c.first) || 'Client';
}
/** « Coupe classique », « Une prestation », « 5 € »: the reward in the feed's title. */
function shortOf(s, reward) {
  if (!reward) return '';
  if (reward.kind === 'amount') return fmtEur(reward.amount || 0);
  const refs = reward.refs || [];
  const sv = refs.length === 1 ? s.services.get(refs[0]) : null;
  return sv ? sv.name : 'Une prestation';
}
const SOURCE_FR = { card: 'Carte complète', gift: 'Offerte par le salon', referrer: 'Parrainage', referee: 'Bienvenue (parrainé)', birthday: 'Anniversaire' };

/** @type {import('../core/extensions.js').Extension} */
export const loyaltyExtension = {
  init(s) { s.loyalty = { launched: null, entries: new Map(), rewards: new Map(), bySale: new Map(), referrals: new Map(), gone: new Map() }; },
  on: {
    'loyalty.launched': (s, e, d) => { if (!L(s).launched) L(s).launched = { day: d.day, headStart: d.headStart, at: e.at }; },
    'loyalty.earned': (s, e, d, p) => {
      push(s, d.clientId, { id: d.id, kind: 'earned', clientId: d.clientId, units: d.units, reason: d.reason, saleId: d.saleId || null, refundId: null, day: d.day || dayOf(e.at), at: e.at, by: d.by || e.actor.id, note: p.note || '', referral: null, n: s.saleSeq, v: e.v });
    },
    'loyalty.rewarded': (s, e, d, p) => {
      L(s).rewards.set(d.id, {
        id: d.id, cid: d.cid, clientId: d.clientId, source: d.source, reward: d.reward, units: d.units || 0, expires: d.expires, day: d.day || dayOf(e.at),
        saleId: d.saleId || null, year: d.year || null, peer: d.peer || null, for: p.for || '', at: e.at, by: e.actor.id, n: s.saleSeq, v: e.v,
        usedBy: null, amount: 0, usedAt: 0, voided: null, restored: []
      });
      const ref = d.source === 'referrer' ? L(s).referrals.get(d.peer) : d.source === 'referee' ? L(s).referrals.get(d.clientId) : null;
      if (ref && d.source === 'referrer') Object.assign(ref, { rewardedBy: d.saleId || null, rewardId: d.id });
      if (ref && d.source === 'referee') ref.refereeRewardId = d.id;
    },
    'loyalty.redeemed': (s, e, d) => {
      const r = L(s).rewards.get(d.id);
      if (!r) return;
      Object.assign(r, { usedBy: d.saleId, amount: d.amount, usedAt: e.at });
      bySale(s, d.saleId).redeemed.push(d.id);
    },
    'loyalty.reversed': (s, e, d) => {
      if (!d.units) return;
      push(s, d.clientId, { id: d.id, kind: 'reversed', clientId: d.clientId, units: d.units, reason: 'refund', saleId: d.saleId, refundId: d.refundId, day: d.day || dayOf(e.at), at: e.at, by: e.actor.id, note: '', referral: d.referral || null, n: s.saleSeq, v: e.v });
      bySale(s, d.saleId).reversed += d.units;
    },
    'loyalty.restored': (s, e, d) => {
      const r = L(s).rewards.get(d.id);
      if (!r) return;
      r.restored.push({ saleId: r.usedBy, refundId: d.refundId, at: e.at });
      const b = L(s).bySale.get(d.saleId);
      if (b) b.redeemed = b.redeemed.filter((x) => x !== d.id);
      Object.assign(r, { usedBy: null, amount: 0, usedAt: 0, expires: d.expires });
    },
    'loyalty.voided': (s, e, d) => { const r = L(s).rewards.get(d.id); if (r && !r.voided) r.voided = { why: d.why, at: e.at }; },
    'loyalty.referred': (s, e, d, p) => {
      L(s).referrals.set(d.cid, { id: d.id, refereeId: d.cid, by: d.peer || p.by || null, via: d.via, day: d.day || dayOf(e.at), year: d.year || null, at: e.at, rewardedBy: null, rewardId: null, refereeRewardId: null });
    },
    // the erased files' notes, and every link between them and the person they referred (or who referred them)
    'client.erased': (s, e, d) => {
      const ids = new Set(d.ids || [d.id]);
      for (const cid of ids) for (const x of L(s).entries.get(cid) || []) x.note = '';
      for (const r of L(s).rewards.values()) {
        if (ids.has(r.clientId) || ids.has(r.peer)) { r.for = ''; r.peer = null; }
        if (ids.has(r.clientId) && !r.usedBy && !r.voided) r.voided = { why: 'erased', at: e.at };
      }
      for (const [referee, ref] of L(s).referrals) {
        if (ids.has(referee)) {
          // the referrer keeps his count, not whom it was
          if (ref.by && !ids.has(ref.by)) {
            const w = ref.rewardId ? L(s).rewards.get(ref.rewardId) : null;
            const list = L(s).gone.get(ref.by) || [];
            list.push({ year: ref.year, day: ref.day, rewarded: !!(w && !w.voided), pending: !ref.rewardId });
            L(s).gone.set(ref.by, list);
          }
          L(s).referrals.delete(referee);
        } else if (ref.by && ids.has(ref.by)) ref.by = null;
      }
    }
  },
  feed: ['loyalty.rewarded', 'loyalty.earned', 'loyalty.reversed'],
  // the programme's movements are the owner's and the managers' (loyalty.manage): a reward at the till already shows
  // on its ticket, and nobody else needs the adjustments
  item(r, f) {
    if (!r.caps.has('loyalty.manage')) return null;
    const s = r.s, d = f.data || {};
    const base = { v: f.v, at: f.at, by: f.actor.t, kind: 'loyalty', clientId: d.clientId || d.cid || null, staffId: null };
    switch (f.type) {
      case 'loyalty.rewarded': {
        const w = L(s).rewards.get(d.id);
        if (!w) return null;
        return { ...base, title: 'Récompense offerte · ' + firstOf(s, w.clientId) + ' · ' + shortOf(s, w.reward), sub: SOURCE_FR[w.source] || '' };
      }
      case 'loyalty.earned':
        if (d.reason !== 'adjust') return null;
        return { ...base, title: 'Ajustement fidélité · ' + (d.units > 0 ? '+' : '') + d.units + ' · ' + firstOf(s, d.clientId), sub: '' };
      case 'loyalty.reversed': {
        if (d.referral !== 'kept') return null;
        const ref = L(s).referrals.get(d.clientId);
        return { ...base, title: 'Parrainage remboursé après usage · ' + firstOf(s, ref && ref.by), sub: 'La récompense du parrain avait déjà servi' };
      }
      default: return null;
    }
  }
};
