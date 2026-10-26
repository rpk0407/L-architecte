// @ts-check
// Services and products. A price change applies to new bookings and tickets; past ones keep their price.
import { fail } from '../core/engine.js';
import { str, int, opt, obj, parse } from '../lib/validate.js';
import { getService, getProduct, serviceShape, productShape } from './common.js';

const partial = (shape) => obj(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, /** @type {any} */ (v.optional ? v : opt(v))])));
const svcAdd = obj(serviceShape), svcPatch = partial(serviceShape);
const prdAdd = obj(productShape), prdPatch = partial(productShape);

export const addService = {
  run(s, input, ctx) {
    ctx.need('catalog');
    const sv = parse(svcAdd, input);
    const sid = ctx.id('sv');
    ctx.emit('service.added', { id: sid, service: { online: true, buffer: 0, vat: s.settings.payments.vat, order: s.services.size, from: false, includes: [], ...sv } });
    return { id: sid };
  }
};
export const updateService = {
  run(s, input, ctx) {
    ctx.need('catalog');
    const sv = getService(s, input.id);
    const patch = parse(svcPatch, input.patch || {});
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
