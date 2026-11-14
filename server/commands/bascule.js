// @ts-check
// Jour J (projections/bascule.js): freezing WordPress, opening the sends, ticking what only the owner can do. The owner
// only ('settings'). Each moment counts once; the checks that read these are in http/routes-bascule.js.
import { fail } from '../core/engine.js';
import { str, bool, opt, obj, oneOf, parse } from '../lib/validate.js';
import { ITEMS, finalSync, lateBookings, staleSync, remindedThere } from '../projections/bascule.js';
import { shopIntervals, staffIntervals } from '../domain/availability.js';
import { localParts } from '../../shared/dates.js';

const OPEN = new Set(['pending', 'booked', 'arrived', 'in_chair']);
/**
 * The bookings of the old site still to come that the new salon cannot hold as it stands: `gone`, on a barber who has no place in the
 * agenda any more (archived, no chair: nobody would see them); `shut`, on a day the salon is closed or the barber does not work (a closure,
 * a day off, an absence). `accepted`: the owner said he keeps the second kind as exceptions, after the last run (a later run asks again).
 * @param {any} s @param {string} today
 */
export function noPlace(s, today) {
  const gone = [], shut = [];
  for (const a of s.appts.values()) {
    if (!a.ext || !a.ext.wp || !OPEN.has(a.status) || a.day < today) continue;
    const st = s.staff.get(a.staffId);
    if (!st || !st.active || !st.chair || st.legacy) gone.push(a);
    else if (!shopIntervals(s, a.day).length || !staffIntervals(s, a.staffId, a.day).length) shut.push(a);
  }
  const byDay = (x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.start - y.start);
  const last = Math.max(0, ...[...s.imports.runs.values()].filter((r) => !r.undoneAt).map((r) => r.finishedAt || r.lastAt || 0));
  return { gone: gone.sort(byDay), shut: shut.sort(byDay), accepted: !!s.bascule.ticks['exceptions-ok'] && s.bascule.ticks['exceptions-ok'] >= last };
}

/** The owner has blocked online bookings on WordPress: a final sync only counts if it comes after this. */
export const freezeWordpress = {
  run(s, input, ctx) {
    ctx.need('settings');
    if (s.bascule.frozenAt) fail(409, 'frozen', 'WordPress est déjà bloqué.');
    ctx.emit('bascule.frozen', { at: ctx.now });
    return { at: ctx.now };
  }
};

const rollbackSchema = obj({ reason: str({ min: 3, max: 200 }) });
/**
 * The return plan, in the product: the switch is taken back (WordPress is back on its own domain). The freeze, the final sync and the
 * switch are to do again; the sends are held again; what was changed here since the first freeze stays in the list for WordPress.
 */
export const rollbackBascule = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(rollbackSchema, input || {});
    if (!s.bascule.frozenAt && !s.bascule.switchedAt) fail(409, 'not_frozen', 'Rien à annuler : WordPress n’est pas encore bloqué.');
    ctx.emit('bascule.rolledback', { at: ctx.now, reason: x.reason });
    return { at: ctx.now };
  }
};

const switchedSchema = obj({ force: opt(bool()), reason: opt(str({ max: 200 })) });
/**
 * The new salon starts sending: the texts that waited for the switch leave (those more than 6 h late are expired).
 * Only after the freeze and a sync that came after it, which brought nothing the old site took after the freeze; forcing it
 * (a run that cannot be made) needs a reason, kept in the event.
 */
export const markSwitched = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(switchedSchema, input || {});
    if (s.bascule.switchedAt) fail(409, 'switched', 'La bascule est déjà faite.');
    const synced = !!s.bascule.frozenAt && !!finalSync(s);
    // the same rule as the card's final-sync step: a late booking means online booking was still on, so sync again once it is off
    const late = synced && lateBookings(s) > 0;
    // an export made before the freeze cannot hold what changed since: it is not a final sync
    const stale = synced && !late && staleSync(s);
    // a booking to come on a barber with no place in the agenda, or on a closed day nobody accepted: the client would come to a shut door
    const place = noPlace(s, ctx.local.day);
    const homeless = synced && !late && !stale && (place.gone.length > 0 || (place.shut.length > 0 && !place.accepted));
    const ready = synced && !late && !stale && !homeless;
    if (!ready && !x.force) {
      if (late) fail(409, 'late_bookings', 'Des rendez-vous ont été pris sur WordPress après le gel : coupe la réservation en ligne, puis refais la synchro finale.');
      if (stale) fail(409, 'stale_export', 'L’export de la synchro finale est plus ancien que le gel de WordPress : refais l’export maintenant, puis dépose-le.');
      if (homeless) fail(409, 'no_place', place.gone.length ? 'Des rendez-vous à venir sont sur un barbier qui n’a plus de place dans l’agenda : déplace-les d’abord.' : 'Des rendez-vous à venir tombent un jour où le salon est fermé ou le barbier absent : déplace-les, ou dis que tu les gardes (Jour J, sous « Synchro finale »).');
      fail(409, 'not_ready', 'Bloque d’abord WordPress et fais la synchro finale.');
    }
    const reason = (x.reason || '').trim();
    if (!ready && !reason) fail(400, 'invalid', 'reason : dis pourquoi tu forces la bascule');
    // WordPress already reminded these clients (the reminder was written here while it still sent its own): not a second time
    for (const m of remindedThere(s)) ctx.emit('message.updated', { id: m.id, patch: { status: 'expired', error: 'Déjà rappelé par l’ancien site' } });
    ctx.emit('bascule.switched', { at: ctx.now, ...(ready ? {} : { force: true, reason }) });
    return { at: ctx.now, day: localParts(ctx.now).day };
  }
};

const tickSchema = obj({ item: oneOf(ITEMS), done: bool() });
/** A step the Comptoir cannot see (WordPress's reminders, the copy of the old site, the licences) ticked, or unticked, by the owner. */
export const tickBascule = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(tickSchema, input);
    if (!!s.bascule.ticks[x.item] !== x.done) ctx.emit('bascule.ticked', { item: x.item, done: x.done });
    return { item: x.item, done: x.done };
  }
};
