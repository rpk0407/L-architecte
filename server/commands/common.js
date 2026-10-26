// @ts-check
// Helpers shared by the command handlers.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, id, oneOf, money, nullable } from '../lib/validate.js';

/** @typedef {import('../core/state.js').State} State */
/** @typedef {import('../core/engine.js').Ctx} Ctx */

export function must(x, what = 'Élément') {
  if (!x) fail(404, 'not_found', what + ' introuvable.');
  return x;
}
export const getStaff = (s, id) => must(s.staff.get(id), 'Membre de l’équipe');
export const getService = (s, id) => must(s.services.get(id), 'Prestation');
export const getProduct = (s, id) => must(s.products.get(id), 'Produit');
export const getClient = (s, id) => { const c = must(s.clients.get(id), 'Client'); if (c.mergedInto) return getClient(s, c.mergedInto); return c; };
export const getAppt = (s, id) => must(s.appts.get(id), 'Rendez-vous');

/** Services of an appointment, frozen at booking time (a later price change does not move old tickets). */
export function snapshotServices(s, ids) {
  return ids.map((sid) => {
    const sv = getService(s, sid);
    if (!sv.active) fail(409, 'inactive', `« ${sv.name} » n’est plus proposée.`);
    return { id: sv.id, name: sv.name, price: sv.price, from: !!sv.from, dur: sv.dur, buffer: sv.buffer || 0 };
  });
}
export function totalDur(list) { return list.reduce((t, x) => t + x.dur, 0) + Math.max(0, ...list.map((x) => x.buffer || 0)); }
export function totalPrice(list) { return list.reduce((t, x) => t + x.price, 0); }

/** May this person act on that chair's appointments? */
export function needChair(ctx, staffId) {
  if (ctx.can('agenda.edit')) return;
  if (ctx.can('agenda.own') && ctx.staff && ctx.staff.id === staffId) return;
  fail(403, 'forbidden', 'Tu ne peux modifier que tes propres rendez-vous.');
}

export function checkIntervals(list, path = 'horaires') {
  for (const [a, b] of list) if (!(a < b)) fail(400, 'invalid', path + ' : la fin doit être après le début.');
  const sorted = [...list].sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < sorted.length; i++) if (sorted[i][0] < sorted[i - 1][1]) fail(400, 'invalid', path + ' : des plages se chevauchent.');
}

export const COLORS = ['#EB4639', '#F5B544', '#4ADE80', '#60A5FA', '#C084FC', '#F472B6', '#2DD4BF', '#FB923C', '#A3E635', '#E5E7EB'];
export const hex = () => str({ pattern: /^#[0-9A-Fa-f]{6}$/, max: 7 });

export const serviceShape = {
  name: str({ min: 2, max: 60 }), short: opt(str({ max: 30 })), category: str({ min: 1, max: 40 }), slug: opt(str({ max: 24, pattern: /^[a-z0-9-]+$/ })),
  price: money(500000), from: opt(bool()), dur: int({ min: 5, max: 480 }), buffer: opt(int({ min: 0, max: 120 })),
  online: opt(bool()), deposit: nullable(money(500000)), vat: opt(int({ min: 0, max: 3000 })), order: opt(int({ min: 0, max: 999 })),
  description: opt(str({ max: 300 })), includes: opt(arr(str({ min: 1, max: 60 }), { max: 10 })),
  pack: opt(obj({ credits: int({ min: 2, max: 50 }), days: int({ min: 7, max: 730 }), serviceIds: opt(arr(id(), { max: 20 })) }))
};
export const productShape = {
  name: str({ min: 2, max: 60 }), price: money(500000), cost: opt(money(500000)), stock: opt(int({ min: -9999, max: 99999 })),
  low: opt(int({ min: 0, max: 9999 })), vat: opt(int({ min: 0, max: 3000 })), sku: opt(str({ max: 40 })), category: opt(str({ max: 40 }))
};
export const lineKind = oneOf(/** @type {const} */ (['service', 'product', 'giftcard', 'pack', 'fee']));
export const refId = id;
