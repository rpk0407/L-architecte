// @ts-check
// Shop-wide settings: identity, opening hours, closures, online booking rules, payments, messages.
import { fail } from '../core/engine.js';
import { str, obj, day, parse } from '../lib/validate.js';
import { checkIntervals } from './common.js';
import { settingsSchema } from '../settings/index.js';
import { cgvPatch } from '../settings/shop.js';

// Composed from server/settings, one file per section; still exported from here as before.
export { settingsSchema };

export const updateSettings = {
  run(s, input, ctx) {
    ctx.need('settings');
    let patch = parse(settingsSchema, input);
    if (patch.hours) for (const k of Object.keys(patch.hours)) checkIntervals(patch.hours[k], 'horaires');
    if (!Object.keys(patch).length) return { settings: s.settings };
    // the CGV version follows the deposit and cancellation rules, dated here rather than by the screen that saved them
    patch = cgvPatch(s.settings, patch, ctx.local.day);
    if (!Object.keys(patch).length) return { settings: s.settings };
    ctx.emit('settings.updated', { patch });
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
