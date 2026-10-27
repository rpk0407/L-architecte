// @ts-check
// Jour J (projections/bascule.js): freezing WordPress, opening the sends, ticking what only the owner can do. The owner
// only ('settings'). Each moment counts once; the checks that read these are in http/routes-bascule.js.
import { fail } from '../core/engine.js';
import { str, bool, opt, obj, oneOf, parse } from '../lib/validate.js';
import { ITEMS, finalSync } from '../projections/bascule.js';
import { localParts } from '../../shared/dates.js';

/** The owner has blocked online bookings on WordPress: a final sync only counts if it comes after this. */
export const freezeWordpress = {
  run(s, input, ctx) {
    ctx.need('settings');
    if (s.bascule.frozenAt) fail(409, 'frozen', 'WordPress est déjà bloqué.');
    ctx.emit('bascule.frozen', { at: ctx.now });
    return { at: ctx.now };
  }
};

const switchedSchema = obj({ force: opt(bool()), reason: opt(str({ max: 200 })) });
/**
 * The new salon starts sending: the texts that waited for the switch leave (those more than 6 h late are expired).
 * Only after the freeze and a sync that came after it; forcing it (a run that cannot be made) needs a reason, kept in the event.
 */
export const markSwitched = {
  run(s, input, ctx) {
    ctx.need('settings');
    const x = parse(switchedSchema, input || {});
    if (s.bascule.switchedAt) fail(409, 'switched', 'La bascule est déjà faite.');
    const ready = !!s.bascule.frozenAt && !!finalSync(s);
    if (!ready && !x.force) fail(409, 'not_ready', 'Bloque d’abord WordPress et fais la synchro finale.');
    const reason = (x.reason || '').trim();
    if (!ready && !reason) fail(400, 'invalid', 'reason : dis pourquoi tu forces la bascule');
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
