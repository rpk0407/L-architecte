// @ts-check
// The very first events of a journal: the shop exists, and so does its owner.
import { fail } from '../core/engine.js';
import { str, obj, parse } from '../lib/validate.js';
import { isEmail } from '../lib/util.js';

const ownerSchema = obj({ name: str({ min: 2, max: 40 }), email: str({ min: 5, max: 120, lower: true }) });

export const initialize = {
  run(s, input, ctx) {
    if (s.version > 0) fail(409, 'initialized', 'Le salon est déjà configuré.');
    const o = parse(ownerSchema, input.owner);
    if (!isEmail(o.email)) fail(400, 'invalid', 'E-mail invalide.');
    ctx.emit('shop.initialized', { mode: input.mode === 'demo' ? 'demo' : 'production', settings: input.settings || undefined });
    const oid = input.ownerId || ctx.id('st');
    ctx.emit('staff.added', {
      id: oid,
      staff: { name: o.name, role: 'owner', color: '#ECE8E0', initials: o.name.slice(0, 2).toUpperCase(), bookable: false, chair: false, services: 'all', schedule: {}, commission: { service: 0, product: 0 }, order: 0 }
    }, { email: o.email });
    const pii = {};
    if (input.pwdHash) pii.pwd = input.pwdHash;
    if (input.pinHash) pii.pin = input.pinHash;
    if (Object.keys(pii).length) ctx.emit('staff.credentials', { id: oid }, pii);
    return { ownerId: oid };
  }
};
