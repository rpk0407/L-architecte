// @ts-check
// The very first events of a journal: the shop exists, and so does its owner. Then a preset: the real salon in one step.
import { fail } from '../core/engine.js';
import { str, obj, parse } from '../lib/validate.js';
import { isEmail } from '../lib/util.js';
import { localParts, addDays, weekday } from '../../shared/dates.js';
import hoursSetting from '../settings/hours.js';
import bookingSetting from '../settings/booking.js';
import { updateSettings, addClosure } from './shop.js';
import { addService, updateService } from './catalog.js';
import { addStaff, updateStaff, addTimeOff, setPhoto, strandedAppts, timeoffConflicts } from './team.js';
import { UNDECIDED } from '../domain/availability.js';
import { schoolYearOf, schoolDay } from '../presets/vacances-zone-b.js';
import { readFile } from 'node:fs/promises';

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
// does exactly that, through the normal commands (updateSettings, addClosure, addService, addStaff, updateStaff,
// addTimeOff) in one atomic batch, with the rights of whoever asks. These rules make a second run change nothing:
// - a service or a person that already exists (same slug, or same name whatever the case and accents) is left as it
//   is, archived or renamed fields included: the preset creates, it never overwrites. The gérant of the preset (owner)
//   is the owner's own account whatever first name he typed at setup: it gets his chair, never a second account;
// - the salon's hours and each booking rule are set only while they still hold their factory value, or (the hours)
//   the value an earlier version of the preset gave them: a value the owner chose himself is his;
// - a barber's week is the same: someone who still has the week an earlier preset gave him (`was`) is offered today's
//   (« horaires à mettre à jour », before and after), a week changed by hand since is kept;
// - a day off is posted once (same barber, same dates) and never for days already past; a CFA day of the apprentice
//   (`school`) is posted only on a day he has no absence yet;
// - a day the salon closes, or opens exceptionally, is posted once and never for a day already past;
// - a portrait is set (setPhoto) only on someone who has no photo yet: a photo he chose himself is his.

const fold = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** the week as the settings hold it: every weekday present, each with its intervals */
const weekOf = (w) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, ((w && (w[d] || w[String(d)])) || []).map(([a, b]) => [a, b])]));

/** @type {string[]} */
export const PRESET_PARTS = ['hours', 'rules', 'closures', 'openings', 'services', 'team', 'absences', 'photos'];
const RULE_LABEL = { stepMin: 'Un créneau toutes les', minNoticeMin: 'Réservation au plus tard', maxDaysAhead: 'Réservation jusqu’à', cancelUntilHours: 'Annulation en ligne jusqu’à' };
const ruleWords = (k, v) => (k === 'stepMin' ? v + ' min' : k === 'minNoticeMin' ? v + ' min avant' : k === 'maxDaysAhead' ? v + ' jours à l’avance' : v + ' h avant');

/**
 * What applying the preset would do now. Pure: state in, plan out.
 * status — hours and rules: 'set' (will be written), 'same' (already that), 'kept' (the owner's own value, left);
 * services: 'create' | 'exists'; team: 'create' | 'chair' (the owner, or a manager of that name, gets his chair, week,
 * colour and initials) | 'exists', with photo 'create' | 'exists' | null (no portrait, or someone archived);
 * absences: 'create' | 'exists' | 'past'. staffAliases: the old site's name of the gérant → the owner's account, for
 * the WordPress import (his account may be called « Frank R. » or anything else).
 * team[].hours: 'update' (he still has the week of an earlier preset: today's is offered, `now` is the one he has),
 * 'kept' (his week was changed by hand: left), or null. closures, openings: 'create' | 'exists' | 'past'. school: the
 * apprentice's CFA days of the school year, each 'create' | 'exists'. stranded: the appointments already taken that
 * fall outside the hours as they will be (counted, never moved).
 * @param {any} s @param {any} P a preset @param {{ today: string, now?: number, min?: number }} o
 */
export function presetPlan(s, P, o) {
  const st = s.settings;
  const hoursNow = weekOf(st.hours), hoursTo = weekOf(P.hours);
  // the hours an earlier version of the preset set are not the owner's own choice: today's replace them
  const hoursOld = (P.hoursWas || []).some((w) => same(hoursNow, weekOf(w)));
  const hours = { to: hoursTo, now: hoursNow, was: hoursOld, status: same(hoursNow, hoursTo) ? 'same' : hoursOld || same(hoursNow, weekOf(hoursSetting.defaults())) ? 'set' : 'kept' };
  const factory = bookingSetting.defaults();
  const rules = Object.entries(P.booking).map(([key, to]) => {
    const now = st.booking[key];
    return { key, label: RULE_LABEL[key] || key, to, now, text: ruleWords(key, to), nowText: ruleWords(key, now), status: now === to ? 'same' : now === factory[key] ? 'set' : 'kept' };
  });

  const all = [...s.services.values()];
  const services = P.services.map((x, order) => {
    const have = all.find((v) => v.slug === x.slug) || all.find((v) => fold(v.name) === fold(x.name)) || null;
    // a line the preset itself renamed since (`was`): a salon that still has the old name is offered the new one, with
    // what the offer holds now; a name the owner typed himself is never touched, and once renamed nothing is left to do
    const renamed = !!have && have.active !== false && !!x.pack && !!have.pack && (x.was || []).some((n) => fold(n) === fold(have.name));
    return {
      ...(renamed ? { was: have.name } : {}),
      slug: x.slug, name: x.name, category: x.category, price: x.price, dur: x.dur, from: !!x.from, online: x.online !== false, pack: x.pack ? { credits: x.pack.credits, days: x.pack.days, ...(x.pack.weekly ? { weekly: true, missed: x.pack.missed || 'lost' } : {}) } : null,
      wp: x.wp, draft: x.wpStatus === 'draft', order, status: renamed ? 'update' : have ? 'exists' : 'create', id: have ? have.id : null, archived: !!have && have.active === false
    };
  });

  const people = [...s.staff.values()].filter((x) => !x.legacy);
  // « Le Soldat » is Soldat: a leading article is not another person
  const who = (n) => fold(n).replace(/^(le|la|les|l) /, '');
  const named = (x) => people.find((v) => who(v.name) === who(x.name)) || null;
  // the gérant of the preset is the owner who created the salon, whatever first name he typed (« Frank », « Frank R. »,
  // or another): the first active owner that no other name of the preset already points to
  const claimed = new Set(P.staff.map(named).filter(Boolean).map((v) => v.id));
  const owner = people.filter((v) => v.active && v.role === 'owner' && !claimed.has(v.id)).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || (a.createdAt || 0) - (b.createdAt || 0))[0] || null;
  const team = P.staff.map((x, order) => {
    const have = named(x) || (x.owner ? owner : null);
    // the owner (or a manager) who also cuts: his account exists since the setup screen, without a chair or a week
    const chair = !!have && have.active && !have.chair && !Object.values(have.schedule || {}).some((iv) => iv && iv.length);
    const photo = !x.photo || (have && !have.active) ? null : have && s.staffPhotos && s.staffPhotos.has(have.id) ? 'exists' : 'create';
    // his week against the preset's: the one an earlier preset gave him is updated, one changed by hand is his
    const to = weekOf(x.schedule), now = have ? weekOf(have.schedule) : to;
    const prev = have && have.active && !chair && !same(now, to) ? (x.was || []).find((w) => same(weekOf(w.schedule), now)) || null : null;
    const hoursSt = !have || !have.active || chair || same(now, to) ? null : prev ? 'update' : 'kept';
    return {
      name: x.name, as: x.as || '', color: x.color, initials: x.initials, schedule: to, order, wp: x.wp || '', online: x.online !== false,
      hours: hoursSt, ...(hoursSt ? { now } : {}),
      // kept off the site by the earlier preset only for want of a week: he goes online with it
      goOnline: !!prev && prev.online === false && x.online !== false && !have.bookable,
      status: !have ? 'create' : chair ? 'chair' : 'exists', id: have ? have.id : null, archived: !!have && !have.active, hasPin: !!have && !!have.hasPin,
      // the owner's account holds this chair: the plan says whose account it is when its name is another
      owner: !!have && have.role === 'owner' && !!x.owner, account: have && have.name !== x.name ? have.name : '', photo
    };
  });

  const absences = (P.absences || []).map((a) => {
    const who = team.find((t) => fold(t.name) === fold(a.staff));
    const posted = !!who && !!who.id && [...s.timeoff.values()].some((t) => t.staffId === who.id && t.from === a.from && t.to === a.to);
    // an absence already running is posted from today on: the days behind us are nobody's business
    const from = a.from < o.today ? o.today : a.from;
    return { staff: a.staff, from, to: a.to, reason: a.reason || 'Absence', status: a.to < o.today || !who || who.archived ? 'past' : posted || [...s.timeoff.values()].some((t) => who.id && t.staffId === who.id && t.from === from && t.to === a.to) ? 'exists' : 'create' };
  });

  // the days the salon closes and the ones it opens exceptionally: posted once, never for a day already past
  const closures = (P.closures || []).map((c) => ({ from: c.from, to: c.to, label: c.label, status: c.to < o.today ? 'past' : st.closures.some((x) => x.from <= c.from && x.to >= c.to) ? 'exists' : 'create' }));
  const openings = (P.openings || []).map((x) => ({ day: x.day, intervals: x.intervals.map(([a, b]) => [a, b]), label: x.label, staff: x.staff || 'all', ...(x.like != null ? { like: x.like } : {}), status: x.day < o.today ? 'past' : (st.openings || []).some((y) => y.day === x.day) ? 'exists' : 'create' }));
  const closed = (d) => st.closures.some((c) => d >= c.from && d <= c.to) || closures.some((c) => c.status === 'create' && d >= c.from && d <= c.to);

  // the apprentice's school weeks: his CFA days from today to the end of the school year (the summer belongs to the next
  // one), outside the holidays and the days the salon is closed; a day he already has an absence on is left as it is
  let school = null;
  if (P.school) {
    const sc = P.school, cal = sc.calendar;
    const who = team.find((t) => fold(t.name) === fold(sc.staff)) || null;
    const year = schoolYearOf(o.today, cal);
    const mine = who && who.id ? [...s.timeoff.values()].filter((t) => t.staffId === who.id && !UNDECIDED.has(t.status)) : [];
    const days = [];
    if (year && who && !who.archived) {
      for (let d = o.today < year.start ? year.start : o.today, i = 0; d <= year.end && i < 400; d = addDays(d, 1), i++) {
        const rule = sc.days[weekday(d)];
        if (!rule || schoolDay(d, cal) !== 'school' || closed(d)) continue;
        days.push({ day: d, ...(rule === 'day' ? {} : { startMin: rule.startMin, endMin: rule.endMin }), status: mine.some((t) => d >= t.from && d <= t.to) ? 'exists' : 'create' });
      }
    }
    school = {
      staff: sc.staff, reason: sc.reason, zone: cal.zone, academie: cal.academie, source: cal.source, read: cal.read, year: year ? year.id : null, unconfirmed: !year,
      days, todo: days.filter((d) => d.status === 'create').length, from: days.length ? days[0].day : null, until: days.length ? days[days.length - 1].day : null,
      // the holidays still to come this year, first to last day without class: he works his full week then
      holidays: year ? year.holidays.filter((h) => h.back > o.today).map((h) => ({ name: h.name, from: addDays(h.after, 1), to: addDays(h.back, -1) })) : []
    };
  }

  // the appointments already taken that the hours to come leave outside (an old site's booking at 8 h 30, one on a day
  // now closed, one on a CFA day): counted with the logic of Équipe (strandedAppts, timeoffConflicts), never moved
  const at = { now: o.now || 0, local: { day: o.today, min: o.min || 0 } };
  const staff2 = new Map(s.staff);
  for (const t of team) if (t.id && (t.status === 'chair' || t.hours === 'update')) staff2.set(t.id, { ...s.staff.get(t.id), chair: true, schedule: t.schedule });
  const after = { ...s, staff: staff2, settings: { ...st, hours: hours.status === 'set' ? hoursTo : st.hours, closures: [...st.closures, ...closures.filter((c) => c.status === 'create')], openings: [...(st.openings || []), ...openings.filter((x) => x.status === 'create')] } };
  const cfaId = school && (team.find((t) => fold(t.name) === fold(school.staff)) || {}).id;
  const strandedBy = team.filter((t) => t.id && !t.archived).map((t) => {
    const cfa = t.id === cfaId && school ? school.days.filter((d) => d.status === 'create').reduce((n, d) => n + timeoffConflicts(s, { staffId: t.id, from: d.day, to: d.day, startMin: d.startMin, endMin: d.endMin }, at).length, 0) : 0;
    return { name: t.name, id: t.id, count: strandedAppts(after, t.id, at).length + cfa };
  }).filter((x) => x.count);
  const stranded = { count: strandedBy.reduce((n, x) => n + x.count, 0), by: strandedBy };

  // an old title the import cannot match by name (its service is a carnet): where its bookings go instead
  const aliases = Object.fromEntries(P.services.filter((x) => x.alias).map((x) => [x.wp.replace(/\s+/g, ' '), (all.find((v) => v.slug === x.alias) || {}).id || '']).filter(([, id]) => id));
  // the gérant's old bookings go to the owner's account, whatever its name (the import matches the others by name)
  const staffAliases = Object.fromEntries(team.filter((t) => t.owner && t.wp && t.id).map((t) => [t.wp, t.id]));
  const count = {
    hours: hours.status === 'set' ? 1 : 0, rules: rules.filter((r) => r.status === 'set').length, closures: closures.filter((x) => x.status === 'create').length, openings: openings.filter((x) => x.status === 'create').length,
    services: services.filter((x) => x.status === 'create').length, updates: services.filter((x) => x.status === 'update').length, team: team.filter((x) => x.status !== 'exists').length, schedules: team.filter((x) => x.hours === 'update').length,
    absences: absences.filter((x) => x.status === 'create').length, cfa: school ? school.todo : 0, photos: team.filter((x) => x.photo === 'create').length
  };
  // said first, in his words: his own account takes the gérant's chair, there is no second « Frank »
  const mine = team.find((t) => t.owner && t.status === 'chair');
  const notes = [
    ...(mine ? [mine.name + ' est le gérant : ' + (mine.account ? 'ton compte « ' + mine.account + ' »' : 'ton compte') + ' reçoit son fauteuil, sa semaine, sa couleur et ses initiales' + (mine.as ? ', et s’affiche « ' + mine.as + ' » pour les clients et l’équipe' : '') + '. Aucun second compte « ' + mine.name + ' » n’est créé.'] : []),
    ...(stranded.count ? [(stranded.count > 1 ? stranded.count + ' rendez-vous déjà pris tombent' : '1 rendez-vous déjà pris tombe') + ' en dehors de ces horaires (' + stranded.by.map((x) => x.name + ' : ' + x.count).join(', ') + '). Aucun n’est déplacé : dans Équipe, sur la fiche du barbier, « Reporter ses rendez-vous ».'] : []),
    ...(school && school.unconfirmed ? ['Vacances scolaires non confirmées pour l’année qui vient : à vérifier. Les absences « ' + school.reason + ' » de ' + school.staff + ' ne sont pas posées.'] : []),
    ...(P.notes || [])
  ];
  return { id: P.id, name: P.name, source: P.source, hours, rules, closures, openings, services, team, absences, school, stranded, aliases, staffAliases, notes, count, todo: Object.values(count).reduce((a, b) => a + b, 0) };
}

/**
 * A preset's portrait as setPhoto takes it (a data URL), or '' when its file cannot be read: the rest of the preset
 * goes on without it. Read only when the preset is applied.
 * @param {URL|undefined} file
 */
export async function presetPhoto(file) {
  if (!(file instanceof URL) || !/\.(webp|jpe?g)$/i.test(file.pathname)) return '';
  try { return 'data:image/' + (/\.webp$/i.test(file.pathname) ? 'webp' : 'jpeg') + ';base64,' + (await readFile(file)).toString('base64'); }
  catch { return ''; }
}

/**
 * Put the preset in place: everything the plan marks to do, for the parts asked, in one atomic batch (any step
 * refused, a right missing included, and nothing is written). Each step is a normal command run as the person who
 * asks, so the rights are the commands' own: `settings` for the hours and rules, `catalog` for the services, `team`
 * for the barbers, their days off and their portraits; `settings` again for the closed days and the exceptional
 * openings. A second call finds nothing left to do and writes nothing. Nobody's appointment is moved: those the new
 * hours leave outside are counted by the plan (stranded) and stay where they are.
 * @param {any} engine @param {any} P a preset @param {{ parts?: string[] }} input
 * @param {{ actor: any, staff?: any, caps?: Set<string>, meta?: any }} base
 * @returns {Promise<{ hours: number, rules: number, closures: number, openings: number, services: number, updates: number, team: number, schedules: number, absences: number, cfa: number, photos: number, written: number }>}
 */
export async function applyPreset(engine, P, input, base) {
  const asked = Array.isArray(input && input.parts) && input.parts.length ? input.parts : [...PRESET_PARTS];
  for (const p of asked) if (!PRESET_PARTS.includes(p)) fail(400, 'invalid', 'Partie inconnue : ' + String(p).slice(0, 20) + '.');
  const parts = new Set(asked);
  // the portraits' bytes, read once before the batch (a file that cannot be read is skipped)
  /** @type {Map<string, string>} */
  const pics = new Map();
  if (parts.has('photos')) for (const x of P.staff) if (x.photo) { const d = await presetPhoto(x.photo); if (d) pics.set(fold(x.name), d); }
  for (let attempt = 0; attempt < 4; attempt++) {
    const done = { hours: 0, rules: 0, closures: 0, openings: 0, services: 0, updates: 0, team: 0, schedules: 0, absences: 0, cfa: 0, photos: 0, written: 0 };
    const n = await engine.batch((step) => {
      const s = engine.state;
      if (s.version === 0) fail(409, 'not_initialized', 'Crée d’abord le compte du gérant.');
      const today = localParts(engine.clock()).day;
      const plan = presetPlan(s, P, { today, now: engine.clock(), min: localParts(engine.clock()).min });

      const patch = {};
      if (parts.has('hours') && plan.hours.status === 'set') { patch.hours = plan.hours.to; done.hours = 1; }
      const rules = parts.has('rules') ? plan.rules.filter((r) => r.status === 'set') : [];
      if (rules.length) { patch.booking = Object.fromEntries(rules.map((r) => [r.key, r.to])); done.rules = rules.length; }
      // an exceptional opening: the whole list goes in one patch (settings/hours.js), the owner's own kept as they are
      const opens = parts.has('openings') ? plan.openings.filter((x) => x.status === 'create') : [];
      if (opens.length) { patch.openings = [...(s.settings.openings || []), ...opens.map((x) => ({ day: x.day, intervals: x.intervals, label: x.label, staff: x.staff, ...(x.like != null ? { like: x.like } : {}) }))]; done.openings = opens.length; }
      if (Object.keys(patch).length) step(updateSettings, patch, base);
      if (parts.has('closures')) for (const c of plan.closures) if (c.status === 'create') { step(addClosure, { from: c.from, to: c.to, label: c.label }, base); done.closures++; }

      if (parts.has('services')) {
        const ids = Object.fromEntries(plan.services.filter((x) => x.id).map((x) => [x.slug, x.id]));
        for (const x of plan.services) {
          if (x.status !== 'create') continue;
          const src = P.services[x.order];
          const { wp: _wp, wpStatus: _st, alias: _al, pack, ...sv } = src;
          const { was: _was, ...fields } = sv;
          const covers = pack ? (pack.covers || []).map((k) => ids[k]).filter(Boolean) : [];
          const withIds = pack ? (pack.with || []).map((k) => ids[k]).filter(Boolean) : [];
          ids[x.slug] = step(addService, { ...fields, order: x.order, ...(pack ? { pack: { credits: pack.credits, days: pack.days, ...(covers.length ? { serviceIds: covers } : {}), ...(withIds.length ? { withIds } : {}), ...(pack.weekly ? { weekly: true, missed: pack.missed || 'lost' } : {}) } } : {}) }, base).id;
          done.services++;
        }
        // the lines the preset renamed (the « Carnet 5 coupes » of the first days is the « Formule Entretien »): its name,
        // what it holds and what a visit covers; the price, the link, the place on the site and the owner's « semaine
        // manquée » setting stay his
        for (const x of plan.services) {
          if (x.status !== 'update' || !x.id) continue;
          const src = P.services[x.order], have = s.services.get(x.id);
          const covers = (src.pack.covers || []).map((k) => ids[k]).filter(Boolean);
          const withIds = (src.pack.with || []).map((k) => ids[k]).filter(Boolean);
          const pack = { ...have.pack, serviceIds: [...new Set([...(have.pack.serviceIds || []), ...covers])], ...(withIds.length ? { withIds: [...new Set([...(have.pack.withIds || []), ...withIds])] } : {}) };
          step(updateService, { id: x.id, patch: { name: src.name, short: src.short || src.name, category: src.category, tag: src.tag || '', includes: src.includes || [], description: src.description || '', pack } }, base);
          done.updates++;
        }
      }

      /** name → id, for the days off of people this very batch creates */
      const who = new Map(plan.team.filter((t) => t.id).map((t) => [fold(t.name), t.id]));
      if (parts.has('team')) {
        for (const t of plan.team) {
          if (t.status === 'create') {
            // no commission is known: 0 % until the owner sets it (addStaff's own default would promise 40 %); someone
            // without a week yet (Aland) is not offered online until the owner enters it
            const r = step(addStaff, { name: t.name, role: 'barber', color: t.color, initials: t.initials, schedule: t.schedule, bookable: t.online, order: t.order + 1, commission: { service: 0, product: 0 } }, base);
            who.set(fold(t.name), r.id); done.team++;
          } else if (t.status === 'chair') {
            // his account of the setup screen: the chair, the week, the colour and the initials of the preset's line
            // `as`: the name clients and the team see for him (the gérant goes by the salon's name), asked by the owner
            step(updateStaff, { id: t.id, patch: { chair: true, bookable: t.online, schedule: t.schedule, color: t.color, initials: t.initials, ...(t.as ? { name: t.as } : {}) } }, base); done.team++;
          } else if (t.hours === 'update') {
            // the week of an earlier preset becomes today's; the appointments it leaves outside stay (the plan counts them)
            step(updateStaff, { id: t.id, patch: { schedule: t.schedule, ...(t.goOnline ? { bookable: true } : {}) } }, base); done.schedules++;
          }
        }
      }
      if (parts.has('absences')) {
        for (const a of plan.absences) {
          const sid = who.get(fold(a.staff));
          if (a.status !== 'create' || !sid) continue;
          step(addTimeOff, { staffId: sid, from: a.from, to: a.to, reason: a.reason }, base); done.absences++;
        }
        // the apprentice's CFA days, one absence each: the owner sees them, and removes one the day the school is shut
        const sid = plan.school ? who.get(fold(plan.school.staff)) : null;
        if (plan.school && sid) for (const d of plan.school.days) {
          if (d.status !== 'create') continue;
          step(addTimeOff, { staffId: sid, from: d.day, to: d.day, ...(d.startMin != null ? { startMin: d.startMin, endMin: d.endMin } : {}), reason: plan.school.reason }, base); done.cfa++;
        }
      }
      if (parts.has('photos')) {
        for (const t of plan.team) {
          const sid = who.get(fold(t.name)), data = pics.get(fold(t.name));
          if (t.photo !== 'create' || !sid || !data) continue;
          // set as the person who applies the preset: by the owner, so shown on the site (he can hide it in Équipe)
          step(setPhoto, { staffId: sid, data }, base); done.photos++;
        }
      }
    });
    if (n === -1) continue;
    done.written = n;
    return done;
  }
  return fail(503, 'busy', 'Le salon reçoit beaucoup de demandes en même temps. Réessaie dans un instant.');
}
