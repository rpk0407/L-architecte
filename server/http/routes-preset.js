// @ts-check
// The salon put in place (server/presets, commands/setup.js) and what keeps it in order afterwards:
// - GET  /api/v1/preset            what the preset « L’Architecte » would do now, and who still has no code
// - POST /api/v1/preset/apply      do it ({ parts? }), through the normal commands, in one batch; twice changes nothing
// - POST /api/v1/preset/codes      a first code for each barber who has none, shown once to whoever manages the team
// - GET  /api/v1/staff/:id/stranded            his appointments to come that fall outside his hours (a new day off)
// - GET  /api/v1/settings/closures/conflicts   the appointments already taken on the days the salon closes
// Reading the plan is the owner's (`settings`); applying a part needs the right of the command that writes it
// (settings, catalog, team), checked here and again by each command.
import { randomInt } from 'node:crypto';
import { HttpError } from './kit.js';
import { ARCHITECTE } from '../presets/architecte.js';
import { presetPlan, applyPreset, PRESET_PARTS } from '../commands/setup.js';
import { setCredentials, strandedAppts } from '../commands/team.js';
import { closureConflicts } from '../commands/shop.js';
import { hashSecret, pinProblem } from '../auth/password.js';

/** Whoever has a chair and no code yet: he cannot sign in on the tablet, nor link his phone. */
const noCode = (s) => [...s.staff.values()].filter((x) => x.active && !x.legacy && x.chair && !x.hasPin).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
const planOf = (r) => ({ ...presetPlan(r.s, ARCHITECTE, { today: r.local.day }), noCode: noCode(r.s).map((x) => ({ id: x.id, name: x.name })) });

/** The right each part of the preset needs: the one of the command that writes it. */
const NEED = { hours: 'settings', rules: 'settings', services: 'catalog', team: 'team', absences: 'team' };

/** Four digits nobody would guess first (no 0000, no 1234), different from the others of the same batch. */
function freshPin(taken) {
  for (;;) {
    const pin = String(randomInt(0, 10000)).padStart(4, '0');
    if (!pinProblem(pin) && !taken.has(pin)) { taken.add(pin); return pin; }
  }
}

export function presetRoutes(app) {
  app.get('/api/v1/preset', (r) => planOf(r), { cap: 'settings' });

  app.post('/api/v1/preset/apply', async (r) => {
    // every part asked needs its right, checked before anything runs (and again by each command)
    const parts = Array.isArray(r.body && r.body.parts) && r.body.parts.length ? r.body.parts.map(String) : [...PRESET_PARTS];
    for (const p of parts) if (NEED[p] && !r.caps.has(NEED[p])) throw new HttpError(403, 'forbidden', 'Seul le gérant met le salon en place.');
    const base = { actor: { t: /** @type {const} */ ('staff'), id: r.me.id, n: r.me.name, ...(r.device ? { dev: r.device.id } : {}) }, staff: r.me, caps: r.caps, meta: r.meta };
    const done = await applyPreset(r.rt.engine, ARCHITECTE, { parts }, base);
    return { done, ...(r.caps.has('settings') ? { plan: planOf(r) } : {}) };
  });

  // a brand-new barber has no code: without one he is not on the tablet's list and cannot link his phone. One tap
  // gives each of them a random code, returned once (never stored in clear, never shown again): the owner says it to
  // him, and he changes it himself in Mon compte. Someone who already has a code keeps it: this never replaces one.
  app.post('/api/v1/preset/codes', async (r) => {
    const taken = new Set();
    const codes = [];
    for (const st of noCode(r.s)) {
      const pin = freshPin(taken);
      await r.run(setCredentials, { id: st.id, pinHash: await hashSecret(pin) });
      codes.push({ id: st.id, name: st.name, pin });
    }
    return { codes };
  }, { cap: 'team' });

  app.get('/api/v1/staff/:id/stranded', (r) => {
    if (!r.caps.has('team') && r.params.id !== r.me.id) throw new HttpError(403, 'forbidden', 'Seul le gérant voit les horaires de l’équipe.');
    if (!r.s.staff.has(r.params.id)) throw new HttpError(404, 'not_found', 'Membre de l’équipe introuvable.');
    const rows = strandedAppts(r.s, r.params.id, { now: r.now, local: r.local });
    const days = new Map();
    for (const a of rows) days.set(a.day, (days.get(a.day) || 0) + 1);
    return { count: rows.length, days: [...days].map(([day, count]) => ({ day, count })) };
  }, { cap: 'agenda.own' });

  app.get('/api/v1/settings/closures/conflicts', (r) => {
    const o = { now: r.now, local: r.local };
    return {
      items: r.s.settings.closures.filter((c) => c.to >= r.local.day).map((c) => {
        const days = closureConflicts(r.s, c, o);
        return { id: c.id, count: days.reduce((n, x) => n + x.count, 0), days };
      }).filter((x) => x.count)
    };
  }, { cap: 'settings' });
}
