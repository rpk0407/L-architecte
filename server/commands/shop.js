// @ts-check
// Shop-wide settings: identity, opening hours, closures, online booking rules, payments, messages.
import { fail } from '../core/engine.js';
import { str, obj, day, parse } from '../lib/validate.js';
import { checkIntervals } from './common.js';
import { addDays } from '../../shared/dates.js';
import { occupies } from '../domain/availability.js';
import { normPhone } from '../lib/util.js';
import { settingsSchema } from '../settings/index.js';
import { cgvPatch } from '../settings/shop.js';
import { checkMembership } from '../settings/membership.js';
import compta, { journalClash } from '../settings/compta.js';

const comptaJournals = (s) => ({ ...compta.defaults().journals, ...((s.settings.compta && s.settings.compta.journals) || {}) });

// Composed from server/settings, one file per section; still exported from here as before.
export { settingsSchema };

/**
 * The owner's alert address and mobile (settings.notify) name a person: they leave the chained patch for the event's
 * pii, like a client's details, and the projection merges them back (core/state.js). Mutates the patch.
 */
function contactPii(patch) {
  // the accountant's name, firm and e-mail (CPT-03) are a person's too
  const acc = patch.compta && patch.compta.accountant;
  if (acc) { delete patch.compta.accountant; if (!Object.keys(patch.compta).length) delete patch.compta; }
  const extra = acc ? { compta: { accountant: acc } } : null;
  const n = patch.notify;
  if (!n || (n.to === undefined && n.phone === undefined)) return extra;
  const { to, phone, ...rest } = n;
  if (phone && !normPhone(phone)) fail(400, 'invalid', 'Ce numéro ne peut pas recevoir de SMS. Exemple : 06 12 34 56 78.');
  if (Object.keys(rest).length) patch.notify = rest; else delete patch.notify;
  return { notify: { ...(to !== undefined ? { to } : {}), ...(phone !== undefined ? { phone } : {}) }, ...extra };
}

export const updateSettings = {
  run(s, input, ctx) {
    ctx.need('settings');
    let patch = parse(settingsSchema, input);
    if (patch.hours) for (const k of Object.keys(patch.hours)) checkIntervals(patch.hours[k], 'horaires');
    if (patch.membership) checkMembership(s, patch.membership);
    // a journal code given to one journal while another keeps it (CPT-03): checked against the codes already set
    if (patch.compta && patch.compta.journals) { const dup = journalClash({ ...comptaJournals(s), ...patch.compta.journals }); if (dup) fail(400, 'invalid', 'Deux journaux ne peuvent pas avoir le même code (' + dup + ').'); }
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
    // the same days closed twice (a second tap on a public holiday, a retried request under another id): once is enough
    const twin = s.settings.closures.find((x) => x.from === c.from && x.to === c.to);
    const conflicts = closureConflicts(s, c, { now: ctx.now, local: ctx.local }).reduce((n, x) => n + x.count, 0);
    if (twin) return { ok: true, id: twin.id, conflicts };
    const cid = ctx.id('cl');
    const closures = [...s.settings.closures, { id: cid, ...c }].sort((a, b) => (a.from < b.from ? -1 : 1));
    ctx.emit('settings.updated', { patch: { closures } });
    // closing never cancels anyone: the appointments already taken those days are counted, for whoever closes to move them
    return { ok: true, id: cid, conflicts };
  }
};

const OPEN = new Set(['pending', 'booked', 'arrived']);
/**
 * The appointments already taken on days a closure covers, still to come, by day and by barber: a closure takes the
 * slots off the site at once but moves nobody by itself (Réglages › Horaires lists them, each day leads to its report).
 * @param {any} s @param {{ from: string, to: string }} c @param {{ now: number, local: { day: string, min: number } }} o
 * @returns {{ day: string, staffId: string, count: number }[]}
 */
export function closureConflicts(s, c, o) {
  const out = [];
  for (let d = c.from < o.local.day ? o.local.day : c.from, i = 0; d <= c.to && i < 400; d = addDays(d, 1), i++) {
    const by = new Map();
    for (const id of s.apptsByDay.get(d) || []) {
      const a = s.appts.get(id);
      if (!a || !OPEN.has(a.status) || !occupies(a, o.now, s)) continue;
      if (d === o.local.day && a.start + a.dur <= o.local.min) continue;
      by.set(a.staffId, (by.get(a.staffId) || 0) + 1);
    }
    for (const [staffId, count] of by) out.push({ day: d, staffId, count });
  }
  return out;
}
export const removeClosure = {
  run(s, input, ctx) {
    ctx.need('settings');
    const closures = s.settings.closures.filter((c) => c.id !== input.id);
    if (closures.length === s.settings.closures.length) fail(404, 'not_found', 'Fermeture introuvable.');
    ctx.emit('settings.updated', { patch: { closures } });
    return { ok: true };
  }
};
