// @ts-check
// The very first events of a journal: the shop exists, and so does its owner. Then a preset: the real salon in one step.
import { fail } from '../core/engine.js';
import { str, obj, parse } from '../lib/validate.js';
import { isEmail } from '../lib/util.js';
import { localParts } from '../../shared/dates.js';
import hoursSetting from '../settings/hours.js';
import bookingSetting from '../settings/booking.js';
import { updateSettings } from './shop.js';
import { addService } from './catalog.js';
import { addStaff, updateStaff, addTimeOff } from './team.js';

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

/* ---------------- a preset: the real salon put in place in one confirmed step ---------------- */
//
// A preset (server/presets) lists what a salon is made of: its hours, its booking rules, its services, its barbers
// and the days off already known. presetPlan says, against the state of now, what applying it would do; applyPreset
// does exactly that, through the normal commands (updateSettings, addService, addStaff, updateStaff, addTimeOff) in
// one atomic batch, with the rights of whoever asks. Three rules make a second run change nothing:
// - a service or a person that already exists (same slug, or same name whatever the case and accents) is left as it
//   is, archived or renamed fields included: the preset creates, it never overwrites;
// - the salon's hours and each booking rule are set only while they still hold their factory value: a value the
//   owner chose himself is his;
// - a day off is posted once (same barber, same dates) and never for days already past.

const fold = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** the week as the settings hold it: every weekday present, each with its intervals */
const weekOf = (w) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, ((w && (w[d] || w[String(d)])) || []).map(([a, b]) => [a, b])]));

/** @type {string[]} */
export const PRESET_PARTS = ['hours', 'rules', 'services', 'team', 'absences'];
const RULE_LABEL = { stepMin: 'Un créneau toutes les', minNoticeMin: 'Réservation au plus tard', maxDaysAhead: 'Réservation jusqu’à', cancelUntilHours: 'Annulation en ligne jusqu’à' };
const ruleWords = (k, v) => (k === 'stepMin' ? v + ' min' : k === 'minNoticeMin' ? v + ' min avant' : k === 'maxDaysAhead' ? v + ' jours à l’avance' : v + ' h avant');

/**
 * What applying the preset would do now. Pure: state in, plan out.
 * status — hours and rules: 'set' (will be written), 'same' (already that), 'kept' (the owner's own value, left);
 * services: 'create' | 'exists'; team: 'create' | 'chair' (the owner or a manager of that name gets his chair and
 * week) | 'exists'; absences: 'create' | 'exists' | 'past'.
 * @param {any} s @param {any} P a preset @param {{ today: string }} o
 */
export function presetPlan(s, P, o) {
  const st = s.settings;
  const hoursNow = weekOf(st.hours), hoursTo = weekOf(P.hours);
  const hours = { to: hoursTo, now: hoursNow, status: same(hoursNow, hoursTo) ? 'same' : same(hoursNow, weekOf(hoursSetting.defaults())) ? 'set' : 'kept' };
  const factory = bookingSetting.defaults();
  const rules = Object.entries(P.booking).map(([key, to]) => {
    const now = st.booking[key];
    return { key, label: RULE_LABEL[key] || key, to, now, text: ruleWords(key, to), nowText: ruleWords(key, now), status: now === to ? 'same' : now === factory[key] ? 'set' : 'kept' };
  });

  const all = [...s.services.values()];
  const services = P.services.map((x, order) => {
    const have = all.find((v) => v.slug === x.slug) || all.find((v) => fold(v.name) === fold(x.name)) || null;
    return {
      slug: x.slug, name: x.name, category: x.category, price: x.price, dur: x.dur, from: !!x.from, online: x.online !== false, pack: x.pack ? { credits: x.pack.credits, days: x.pack.days } : null,
      wp: x.wp, draft: x.wpStatus === 'draft', order, status: have ? 'exists' : 'create', id: have ? have.id : null, archived: !!have && have.active === false
    };
  });

  const people = [...s.staff.values()].filter((x) => !x.legacy);
  // « Le Soldat » is Soldat: a leading article is not another person
  const who = (n) => fold(n).replace(/^(le|la|les|l) /, '');
  const team = P.staff.map((x, order) => {
    const have = people.find((v) => who(v.name) === who(x.name)) || null;
    // the owner (or a manager) who also cuts: his account exists since the setup screen, without a chair or a week
    const chair = !!have && have.active && !have.chair && !Object.values(have.schedule || {}).some((iv) => iv && iv.length);
    return {
      name: x.name, color: x.color, initials: x.initials, schedule: weekOf(x.schedule), order, wp: x.wp,
      status: !have ? 'create' : chair ? 'chair' : 'exists', id: have ? have.id : null, archived: !!have && !have.active, hasPin: !!have && !!have.hasPin
    };
  });

  const absences = (P.absences || []).map((a) => {
    const who = team.find((t) => fold(t.name) === fold(a.staff));
    const posted = !!who && !!who.id && [...s.timeoff.values()].some((t) => t.staffId === who.id && t.from === a.from && t.to === a.to);
    // an absence already running is posted from today on: the days behind us are nobody's business
    const from = a.from < o.today ? o.today : a.from;
    return { staff: a.staff, from, to: a.to, reason: a.reason || 'Absence', status: a.to < o.today || !who || who.archived ? 'past' : posted || [...s.timeoff.values()].some((t) => who.id && t.staffId === who.id && t.from === from && t.to === a.to) ? 'exists' : 'create' };
  });

  // an old title the import cannot match by name (its service is a carnet): where its bookings go instead
  const aliases = Object.fromEntries(P.services.filter((x) => x.alias).map((x) => [x.wp.replace(/\s+/g, ' '), (all.find((v) => v.slug === x.alias) || {}).id || '']).filter(([, id]) => id));
  const count = { hours: hours.status === 'set' ? 1 : 0, rules: rules.filter((r) => r.status === 'set').length, services: services.filter((x) => x.status === 'create').length, team: team.filter((x) => x.status !== 'exists').length, absences: absences.filter((x) => x.status === 'create').length };
  return { id: P.id, name: P.name, source: P.source, hours, rules, services, team, absences, aliases, notes: P.notes || [], count, todo: Object.values(count).reduce((a, b) => a + b, 0) };
}

/**
 * Put the preset in place: everything the plan marks to do, for the parts asked, in one atomic batch (any step
 * refused, a right missing included, and nothing is written). Each step is a normal command run as the person who
 * asks, so the rights are the commands' own: `settings` for the hours and rules, `catalog` for the services, `team`
 * for the barbers and their days off. A second call finds nothing left to do and writes nothing.
 * @param {any} engine @param {any} P a preset @param {{ parts?: string[] }} input
 * @param {{ actor: any, staff?: any, caps?: Set<string>, meta?: any }} base
 * @returns {Promise<{ hours: number, rules: number, services: number, team: number, absences: number, written: number }>}
 */
export async function applyPreset(engine, P, input, base) {
  const asked = Array.isArray(input && input.parts) && input.parts.length ? input.parts : [...PRESET_PARTS];
  for (const p of asked) if (!PRESET_PARTS.includes(p)) fail(400, 'invalid', 'Partie inconnue : ' + String(p).slice(0, 20) + '.');
  const parts = new Set(asked);
  for (let attempt = 0; attempt < 4; attempt++) {
    const done = { hours: 0, rules: 0, services: 0, team: 0, absences: 0, written: 0 };
    const n = await engine.batch((step) => {
      const s = engine.state;
      if (s.version === 0) fail(409, 'not_initialized', 'Crée d’abord le compte du gérant.');
      const today = localParts(engine.clock()).day;
      const plan = presetPlan(s, P, { today });

      const patch = {};
      if (parts.has('hours') && plan.hours.status === 'set') { patch.hours = plan.hours.to; done.hours = 1; }
      const rules = parts.has('rules') ? plan.rules.filter((r) => r.status === 'set') : [];
      if (rules.length) { patch.booking = Object.fromEntries(rules.map((r) => [r.key, r.to])); done.rules = rules.length; }
      if (Object.keys(patch).length) step(updateSettings, patch, base);

      if (parts.has('services')) {
        const ids = Object.fromEntries(plan.services.filter((x) => x.id).map((x) => [x.slug, x.id]));
        for (const x of plan.services) {
          if (x.status !== 'create') continue;
          const src = P.services[x.order];
          const { wp: _wp, wpStatus: _st, alias: _al, pack, ...sv } = src;
          const covers = pack ? (pack.covers || []).map((k) => ids[k]).filter(Boolean) : [];
          ids[x.slug] = step(addService, { ...sv, order: x.order, ...(pack ? { pack: { credits: pack.credits, days: pack.days, ...(covers.length ? { serviceIds: covers } : {}) } } : {}) }, base).id;
          done.services++;
        }
      }

      /** name → id, for the days off of people this very batch creates */
      const who = new Map(plan.team.filter((t) => t.id).map((t) => [fold(t.name), t.id]));
      if (parts.has('team')) {
        for (const t of plan.team) {
          if (t.status === 'create') {
            // no commission is known: 0 % until the owner sets it (addStaff's own default would promise 40 %)
            const r = step(addStaff, { name: t.name, role: 'barber', color: t.color, initials: t.initials, schedule: t.schedule, order: t.order + 1, commission: { service: 0, product: 0 } }, base);
            who.set(fold(t.name), r.id); done.team++;
          } else if (t.status === 'chair') {
            step(updateStaff, { id: t.id, patch: { chair: true, bookable: true, schedule: t.schedule } }, base); done.team++;
          }
        }
      }
      if (parts.has('absences')) {
        for (const a of plan.absences) {
          const sid = who.get(fold(a.staff));
          if (a.status !== 'create' || !sid) continue;
          step(addTimeOff, { staffId: sid, from: a.from, to: a.to, reason: a.reason }, base); done.absences++;
        }
      }
    });
    if (n === -1) continue;
    done.written = n;
    return done;
  }
  return fail(503, 'busy', 'Le salon reçoit beaucoup de demandes en même temps. Réessaie dans un instant.');
}
