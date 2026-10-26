// @ts-check
// The team: profiles, roles, working hours, time off, credentials and shop devices.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, day, oneOf, id, week, either, parse } from '../lib/validate.js';
import { isEmail as isEmailLike } from '../lib/util.js';
import { getStaff, checkIntervals, COLORS } from './common.js';

const roles = /** @type {const} */ (['owner', 'manager', 'desk', 'barber']);
const staffShape = {
  name: str({ min: 2, max: 40 }), role: oneOf(roles), color: opt(str({ pattern: /^#[0-9A-Fa-f]{6}$/, max: 7 })), initials: opt(str({ min: 1, max: 3 })),
  bookable: opt(bool()), chair: opt(bool()), services: opt(either([oneOf(/** @type {const} */ (['all'])), arr(id(), { max: 80 })])),
  schedule: opt(week()), commission: opt(obj({ service: int({ min: 0, max: 10000 }), product: int({ min: 0, max: 10000 }) })),
  bio: opt(str({ max: 280 })), instagram: opt(str({ max: 120 })), order: opt(int({ min: 0, max: 99 })), email: opt(str({ max: 120, lower: true }))
};
const addSchema = obj(staffShape);
const patchSchema = obj(Object.fromEntries(Object.entries(staffShape).map(([k, v]) => [k, /** @type {any} */ (opt(v))])));

function initialsOf(name) {
  const w = name.replace(/^(le|la|les|l’|l')\s+/i, '').split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}
function checkSchedule(sc) { if (sc) for (const k of Object.keys(sc)) checkIntervals(sc[k], 'horaires'); }
function owners(s) { return [...s.staff.values()].filter((x) => x.active && x.role === 'owner'); }

export const addStaff = {
  run(s, input, ctx) {
    ctx.need('team');
    const x = parse(addSchema, input);
    if (x.role === 'owner' && ctx.staff?.role !== 'owner') fail(403, 'forbidden', 'Seul le gérant peut nommer un autre gérant.');
    if (x.email && !isEmailLike(x.email)) fail(400, 'invalid', 'E-mail invalide.');
    if (x.email && [...s.staff.values()].some((o) => o.email === x.email)) fail(409, 'exists', 'Cet e-mail est déjà utilisé par un membre de l’équipe.');
    checkSchedule(x.schedule);
    const sid = ctx.id('st');
    const { email, ...rest } = x;
    const staff = {
      color: COLORS[s.staff.size % COLORS.length], initials: initialsOf(x.name), bookable: x.role === 'barber', chair: x.role === 'barber' || x.role === 'owner',
      services: 'all', schedule: { ...s.settings.hours }, commission: { service: 4000, product: 1000 }, order: s.staff.size, ...rest
    };
    ctx.emit('staff.added', { id: sid, staff }, email ? { email } : undefined);
    return { id: sid };
  }
};

export const updateStaff = {
  run(s, input, ctx) {
    const st = getStaff(s, input.id);
    const self = ctx.staff && ctx.staff.id === st.id;
    const patch = parse(patchSchema, input.patch || {});
    const selfOnly = ['bio', 'instagram', 'color'];
    if (!ctx.can('team') && !(self && Object.keys(patch).every((k) => selfOnly.includes(k)))) fail(403, 'forbidden', 'Seul le gérant modifie l’équipe.');
    if ((patch.role === 'owner' || st.role === 'owner') && ctx.staff?.role !== 'owner' && patch.role !== undefined) fail(403, 'forbidden', 'Seul le gérant change ce rôle.');
    if (st.role === 'owner' && patch.role && patch.role !== 'owner' && owners(s).length <= 1) fail(409, 'last_owner', 'Il faut au moins un gérant.');
    if (patch.email && !isEmailLike(patch.email)) fail(400, 'invalid', 'E-mail invalide.');
    checkSchedule(patch.schedule);
    const { email, ...rest } = patch;
    if (!Object.keys(rest).length && email === undefined) return { ok: true };
    ctx.emit('staff.updated', { id: st.id, patch: rest }, email !== undefined ? { email } : undefined);
    return { ok: true };
  }
};

export const archiveStaff = {
  run(s, input, ctx) {
    ctx.need('team');
    const st = getStaff(s, input.id);
    if (ctx.staff && ctx.staff.id === st.id) fail(409, 'self', 'Tu ne peux pas désactiver ton propre compte.');
    if (st.role === 'owner' && owners(s).length <= 1) fail(409, 'last_owner', 'Il faut au moins un gérant.');
    ctx.emit(input.restore ? 'staff.restored' : 'staff.archived', { id: st.id });
    return { ok: true };
  }
};

/** Password and PIN arrive already hashed (scrypt runs outside the decision, see server/auth). */
const hashPattern = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;
export const setCredentials = {
  run(s, input, ctx) {
    const st = getStaff(s, input.id);
    const self = ctx.staff && ctx.staff.id === st.id;
    if (!self && !ctx.can('team')) fail(403, 'forbidden', 'Seul le gérant peut changer les accès de l’équipe.');
    if (!self && st.role === 'owner' && ctx.staff?.role !== 'owner') fail(403, 'forbidden', 'Seul le gérant change ses propres accès.');
    const pii = {};
    if (input.pwdHash !== undefined) { if (input.pwdHash !== '' && !hashPattern.test(input.pwdHash)) fail(400, 'invalid', 'Mot de passe invalide.'); pii.pwd = input.pwdHash || ''; }
    if (input.pinHash !== undefined) { if (input.pinHash !== '' && !hashPattern.test(input.pinHash)) fail(400, 'invalid', 'Code invalide.'); pii.pin = input.pinHash || ''; }
    if (!Object.keys(pii).length) return { ok: true };
    // a new password signs out every session of that person, except on a PIN-only change
    ctx.emit('staff.credentials', { id: st.id, revoke: input.pwdHash !== undefined && !self }, pii);
    return { ok: true };
  }
};

export const revokeSessions = {
  run(s, input, ctx) {
    const st = getStaff(s, input.id);
    if (!(ctx.staff && ctx.staff.id === st.id) && !ctx.can('team')) fail(403, 'forbidden', 'Action réservée au gérant.');
    ctx.emit('staff.revoked', { id: st.id });
    return { ok: true };
  }
};

const timeoffSchema = obj({ staffId: id(), from: day(), to: day(), startMin: opt(int({ min: 0, max: 1440 })), endMin: opt(int({ min: 0, max: 1440 })), reason: opt(str({ max: 60 })) });
export const addTimeOff = {
  run(s, input, ctx) {
    const t = parse(timeoffSchema, input);
    getStaff(s, t.staffId);
    const self = ctx.staff && ctx.staff.id === t.staffId;
    if (!ctx.can('team') && !self) fail(403, 'forbidden', 'Seul le gérant pose les absences de l’équipe.');
    if (t.to < t.from) fail(400, 'invalid', 'La date de fin doit suivre la date de début.');
    if ((t.startMin == null) !== (t.endMin == null)) fail(400, 'invalid', 'Heure de début et de fin attendues.');
    if (t.startMin != null && (t.from !== t.to || /** @type {number} */ (t.endMin) <= t.startMin)) fail(400, 'invalid', 'Une absence de quelques heures tient sur une seule journée.');
    const tid = ctx.id('to');
    ctx.emit('timeoff.added', { id: tid, ...t, reason: t.reason || 'Absence' });
    return { id: tid };
  }
};
export const removeTimeOff = {
  run(s, input, ctx) {
    const t = s.timeoff.get(input.id);
    if (!t) fail(404, 'not_found', 'Absence introuvable.');
    if (!ctx.can('team') && !(ctx.staff && ctx.staff.id === t.staffId)) fail(403, 'forbidden', 'Action réservée au gérant.');
    ctx.emit('timeoff.removed', { id: t.id });
    return { ok: true };
  }
};

export const enrollDevice = {
  run(s, input, ctx) {
    if (!input.demo) ctx.need('devices');
    const name = parse(str({ min: 1, max: 40 }), input.name || 'Poste du salon');
    if (!/^[a-f0-9]{64}$/.test(input.tokenHash)) fail(400, 'invalid', 'Jeton invalide.');
    const did = ctx.id('dv');
    ctx.emit('device.enrolled', { id: did, name, tokenHash: input.tokenHash });
    return { id: did };
  }
};
export const revokeDevice = {
  run(s, input, ctx) {
    ctx.need('devices');
    const d = s.devices.get(input.id);
    if (!d || d.revoked) fail(404, 'not_found', 'Appareil introuvable.');
    ctx.emit('device.revoked', { id: d.id });
    return { ok: true };
  }
};
