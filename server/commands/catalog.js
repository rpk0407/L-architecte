// @ts-check
// Services and products. A price change applies to new bookings and tickets; past ones keep their price.
import { fail } from '../core/engine.js';
import { str, int, opt, obj, parse } from '../lib/validate.js';
import { getService, getProduct, serviceShape, productShape } from './common.js';

const partial = (shape) => obj(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, /** @type {any} */ (v.optional ? v : opt(v))])));
const svcAdd = obj(serviceShape), svcPatch = partial(serviceShape);
const prdAdd = obj(productShape), prdPatch = partial(productShape);

/** At most n characters, cut at a dash rather than mid-word when one is not too far back (clients see it in links). */
const wordCut = (x, n) => {
  if (x.length <= n) return x;
  const cut = x.slice(0, n), at = cut.lastIndexOf('-');
  return (x[n] === '-' || at < n / 2 ? cut : cut.slice(0, at)).replace(/-+$/, '');
};

/** The site's key for a service (?prestation=…): from the name unless given, unique among every service, archived ones too. */
export function slugFor(s, name, given = '', selfId = '') {
  const base = given || wordCut(String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), 24) || 'prestation';
  const taken = new Set([...s.services.values()].filter((x) => x.id !== selfId && x.slug).map((x) => x.slug));
  if (!taken.has(base)) return base;
  if (given) fail(409, 'slug_taken', `Le lien « ${given} » est déjà pris par une autre prestation.`);
  for (let n = 2; ; n++) {
    const tail = '-' + n, out = base.slice(0, 24 - tail.length).replace(/-+$/, '') + tail;
    if (!taken.has(out)) return out;
  }
}

export const addService = {
  run(s, input, ctx) {
    ctx.need('catalog');
    const sv = parse(svcAdd, input);
    const sid = ctx.id('sv');
    ctx.emit('service.added', { id: sid, service: { online: true, buffer: 0, vat: s.settings.payments.vat, order: s.services.size, from: false, includes: [], ...sv, slug: slugFor(s, sv.name, sv.slug) } });
    return { id: sid };
  }
};
export const updateService = {
  run(s, input, ctx) {
    ctx.need('catalog');
    const sv = getService(s, input.id);
    const patch = parse(svcPatch, input.patch || {});
    // the slug is the service's address on the site: a rename keeps it, so links already shared still work
    if (patch.slug !== undefined) { if (patch.slug === sv.slug) delete patch.slug; else patch.slug = slugFor(s, sv.name, patch.slug, sv.id); }
    if (!Object.keys(patch).length) return { ok: true };
    ctx.emit('service.updated', { id: sv.id, patch });
    return { ok: true };
  }
};
export const archiveService = {
  run(s, input, ctx) {
    ctx.need('catalog');
    const sv = getService(s, input.id);
    if (input.restore) ctx.emit('service.updated', { id: sv.id, patch: { active: true } });
    else ctx.emit('service.archived', { id: sv.id });
    return { ok: true };
  }
};

export const addProduct = {
  run(s, input, ctx) {
    ctx.need('catalog');
    const p = parse(prdAdd, input);
    const pid = ctx.id('pr');
    ctx.emit('product.added', { id: pid, product: { stock: 0, low: 3, cost: 0, vat: s.settings.payments.vat, category: 'Produits', ...p } });
    return { id: pid };
  }
};
export const updateProduct = {
  run(s, input, ctx) {
    ctx.need('catalog');
    const p = getProduct(s, input.id);
    const patch = parse(prdPatch, input.patch || {});
    delete patch.stock; // stock only moves through adjustments, so every unit is accounted for
    if (!Object.keys(patch).length) return { ok: true };
    ctx.emit('product.updated', { id: p.id, patch });
    return { ok: true };
  }
};
export const archiveProduct = {
  run(s, input, ctx) {
    ctx.need('catalog');
    const p = getProduct(s, input.id);
    if (input.restore) ctx.emit('product.updated', { id: p.id, patch: { active: true } });
    else ctx.emit('product.archived', { id: p.id });
    return { ok: true };
  }
};
const adjSchema = obj({ id: str({ min: 1, max: 64 }), delta: int({ min: -9999, max: 9999 }), reason: str({ min: 1, max: 60 }) });
export const adjustStock = {
  run(s, input, ctx) {
    ctx.need('catalog');
    const a = parse(adjSchema, input);
    const p = getProduct(s, a.id);
    if (!a.delta) fail(400, 'invalid', 'Indique une quantité.');
    ctx.emit('stock.adjusted', { productId: p.id, delta: a.delta, reason: a.reason, name: p.name });
    return { stock: (p.stock || 0) + a.delta };
  }
};
