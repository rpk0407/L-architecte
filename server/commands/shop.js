// @ts-check
// Shop-wide settings: identity, opening hours, closures, online booking rules, payments, messages.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, day, oneOf, money, week, record, parse } from '../lib/validate.js';
import { checkIntervals } from './common.js';
import { TEMPLATES } from '../core/state.js';

const url = () => str({ max: 300, pattern: /^https:\/\/[^\s]+$/ });
const templateKeys = Object.keys(TEMPLATES);

export const settingsSchema = obj({
  shop: opt(obj({
    name: opt(str({ min: 2, max: 80 })), legalName: opt(str({ max: 120 })), address: opt(str({ max: 120 })), zip: opt(str({ max: 10 })), city: opt(str({ max: 60 })),
    phone: opt(str({ max: 20 })), email: opt(str({ max: 120 })), siret: opt(str({ max: 20, pattern: /^[\d ]*$/ })), vatNumber: opt(str({ max: 20 })),
    mapsUrl: opt(url()), reviewUrl: opt(url()), instagram: opt(url())
  })),
  hours: opt(week()),
  booking: opt(obj({
    enabled: opt(bool()), stepMin: opt(oneOf(/** @type {const} */ ([15, 20, 30]))), minNoticeMin: opt(int({ min: 0, max: 2880 })), maxDaysAhead: opt(int({ min: 1, max: 180 })),
    holdMin: opt(int({ min: 2, max: 15 })), pendingPayMin: opt(int({ min: 5, max: 60 })), cancelUntilHours: opt(int({ min: 0, max: 72 })), waitlist: opt(bool()), walkinWait: opt(bool())
  })),
  deposits: opt(obj({ mode: opt(oneOf(/** @type {const} */ (['none', 'threshold', 'all']))), thresholdCents: opt(money()), percent: opt(int({ min: 5, max: 100 })), noShowFeeCents: opt(money(20000)) })),
  payments: opt(obj({
    card: opt(bool()), cash: opt(bool()), qr: opt(bool()), giftcard: opt(bool()), tips: opt(bool()),
    tipPresets: opt(arr(money(10000), { max: 4 })), vat: opt(int({ min: 0, max: 3000 })), receiptFooter: opt(str({ max: 160 }))
  })),
  messages: opt(obj({
    confirmation: opt(bool()), reminder: opt(bool()), reminderHour: opt(int({ min: 8, max: 21 })), reminder2h: opt(bool()), review: opt(bool()),
    reviewDelayMin: opt(int({ min: 30, max: 1440 })), rebook: opt(bool()), waitlist: opt(bool()),
    templates: opt(record(new RegExp('^(' + templateKeys.join('|') + ')$'), str({ min: 10, max: 320 })))
  })),
  team: opt(obj({ barberCheckout: opt(bool()), barberAllAgenda: opt(bool()), barberMaxDiscountPct: opt(int({ min: 0, max: 50 })), barberSeeRevenue: opt(bool()) })),
  goals: opt(obj({ monthCents: opt(money(100000000)) }))
});

export const updateSettings = {
  run(s, input, ctx) {
    ctx.need('settings');
    const patch = parse(settingsSchema, input);
    if (patch.hours) for (const k of Object.keys(patch.hours)) checkIntervals(patch.hours[k], 'horaires');
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
