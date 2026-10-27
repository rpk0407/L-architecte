// @ts-check
// The answer to a request replayed on an instance that never saw the first one (another instance, or this one
// before a restart): its events are in the journal, its answer is not. Nothing durable keeps answers (a gift card's
// full code must live nowhere), so the answer is rebuilt from the events the request wrote, in the shape the
// command returns. Same instance: engine.js replays the answer it kept in memory instead. A command whose answer
// cannot be read this way gives its own `replay(events)` (core/engine.js, Handler).
import { refundNo } from '../domain/cash.js';

/** @typedef {import('./journal.js').JEvent} JEvent */

/** The commands whose answer says more than the id of what they made, by the event that carries it. */
const BY_TYPE = {
  /** @param {any} d @param {JEvent[]} list */
  'sale.completed': (d, list) => ({
    id: d.id, number: d.number, totals: d.totals, change: (d.payments || []).reduce((t, p) => t + (p.change || 0), 0),
    // printed or texted the first time: a replay cannot show the code again (Réémettre gives a new one)
    giftcards: [], giftcardsIssued: list.filter((e) => e.type === 'giftcard.issued' && e.data.saleId === d.id).length
  }),
  /** @param {any} d */
  'appt.booked': (d) => ({ id: d.id, code: d.code, status: d.status, staffId: d.staffId, deposit: d.deposit ? d.deposit.amount : 0, price: d.price }),
  /** @param {any} d */
  'appt.held': (d) => ({ holdId: d.id, staffId: d.staffId, exp: d.exp }),
  /** @param {any} d */
  'sale.refunded': (d) => ({ id: d.id, number: d.number, ref: refundNo(d.number), amount: d.amount, liability: d.liability || 0 }),
  /** @param {any} d */
  'day.closed': (d) => { const { id, ...z } = d; return { ...z, early: !!d.early, late: !!d.late }; },
  /** @param {any} d */
  'client.merged': (d) => ({ id: d.into })
};
const ORDER = Object.keys(BY_TYPE);

/**
 * @param {JEvent[]} list the events the first request wrote, in order
 * @returns {any}
 */
export function replayAnswer(list) {
  const events = list.map((e) => ({ type: e.type, data: e.data }));
  for (const type of ORDER) {
    const of = list.filter((x) => x.type === type);
    // one of them: the command made that one thing (a batch of bookings, an import, answers otherwise)
    if (of.length === 1) return { ...BY_TYPE[type](of[0].data, list), duplicate: true, events };
  }
  // what the other commands answer: the id of what they made or changed; a walk-in or a waiting-list entry that
  // opens a client file on the way answers with the entry, not the file
  const hasId = (e) => !!e.data && typeof e.data.id === 'string';
  const main = list.find((e) => hasId(e) && !e.type.startsWith('client.')) || list.find(hasId);
  return { ok: true, ...(main ? { id: main.data.id } : {}), ...(main && main.type === 'client.added' ? { created: true } : {}), duplicate: true, events };
}
