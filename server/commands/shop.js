// @ts-check
// Shop-wide settings: identity, opening hours, closures, online booking rules, payments, messages.
import { fail } from '../core/engine.js';
import { str, obj, day, parse } from '../lib/validate.js';
import { checkIntervals } from './common.js';
import { normPhone } from '../lib/util.js';
import { settingsSchema } from '../settings/index.js';
import { cgvPatch } from '../settings/shop.js';

// Composed from server/settings, one file per section; still exported from here as before.
export { settingsSchema };

/**
 * The owner's alert address and mobile (settings.notify) name a person: they leave the chained patch for the event's
 * pii, like a client's details, and the projection merges them back (core/state.js). Mutates the patch.
 */
function contactPii(patch) {
  const n = patch.notify;
  if (!n || (n.to === undefined && n.phone === undefined)) return null;
  const { to, phone, ...rest } = n;
  if (phone && !normPhone(phone)) fail(400, 'invalid', 'Ce numéro ne peut pas recevoir de SMS. Exemple : 06 12 34 56 78.');
  if (Object.keys(rest).length) patch.notify = rest; else delete patch.notify;
  return { notify: { ...(to !== undefined ? { to } : {}), ...(phone !== undefined ? { phone } : {}) } };
}

export const updateSettings = {
  run(s, input, ctx) {
    ctx.need('settings');
    let patch = parse(settingsSchema, input);
    if (patch.hours) for (const k of Object.keys(patch.hours)) checkIntervals(patch.hours[k], 'horaires');
    const pii = contactPii(patch);
    if (!Object.keys(patch).length && !pii) return { settings: s.settings };
    // the CGV version follows the deposit and cancellation rules, dated here rather than by the screen that saved them
    patch = cgvPatch(s.settings, patch, ctx.local.day);
    if (!Object.keys(patch).length && !pii) return { settings: s.settings };
    ctx.emit('settings.updated', { patch }, pii || undefined);
    return { ok: true };
  }
};

const closureSchema = obj({ from: day(), to: day(), label: str({ min: 1, max: 60 }) });
export const addClosure = {
  run(s, input, ctx) {
    ctx.need('settings');
    const c = parse(closureSchema, input);
    if (c.to < c.from) fail(400, 'invalid', 'La date de fin doit suivre la date de début.');
    const closures = [...s.settings.closures, { id: ctx.id('cl'), ...c }].sort((a, b) => (a.from < b.from ? -1 : 1));
    ctx.emit('settings.updated', { patch: { closures } });
    return { ok: true };
  }
};
export const removeClosure = {
  run(s, input, ctx) {
    ctx.need('settings');
    const closures = s.settings.closures.filter((c) => c.id !== input.id);
    if (closures.length === s.settings.closures.length) fail(404, 'not_found', 'Fermeture introuvable.');
    ctx.emit('settings.updated', { patch: { closures } });
    return { ok: true };
  }
};
