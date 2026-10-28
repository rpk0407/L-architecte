// @ts-check
// The steps the system tick runs after its built-in work, one after the other, each in its own corner:
// a package that needs background work adds one line to REGISTRY instead of editing tick itself.
// A step is { name, run(s, ctx) }: it reads the state, emits events through ctx, and may return
// { warnings } for the owner. A step that throws is skipped for this tick, without its half-written events.
import { closeDay } from './sales.js';
import { missedZ, dayWords } from '../domain/cash.js';
import { DAYS_FR, dayParts } from '../../shared/dates.js';
import digest from './steps/digest.js';
import simBilling from './steps/sim-billing.js';
import { periodCloseStep, signStep, jetStep } from './steps/fiscal.js';
import demoPurge from './steps/demo-purge.js';

export { missedZ, dayWords };
/** "samedi 31" for the feed. */
export function dayAndDate(day) { const p = dayParts(day); return DAYS_FR[p.wd] + ' ' + p.d; }
/**
 * What the owner should know about the days behind: the open drawer of a past day keeps its days from
 * being sealed. One warning per drawer, named after the day it was opened, however many days it spans.
 */
export function closingWarnings(s, today) {
  const { uncounted } = missedZ(s, today);
  if (!uncounted.length || !s.drawer) return [];
  return [`La caisse de ${dayWords(s.drawer.day, today)} n’est pas comptée. Compte-la\u202f: ${uncounted.length > 1 ? 'les journées en attente seront clôturées' : 'sa journée sera clôturée'} juste après.`];
}

const PENDING = new Set(['booked', 'arrived', 'in_chair']);

/** @type {{ name: string, run: (s: any, ctx: import('../core/engine.js').Ctx) => void | { warnings?: string[] } }[]} */
export const REGISTRY = [
  {
    // a forgotten Z is caught up just after midnight; an uncounted drawer is left to a human
    name: 'auto-z',
    run(s, ctx) {
      if (ctx.local.min < 5) return;
      const { close } = missedZ(s, ctx.local.day);
      // the demo checks its own past appointments out (demoTick, right after this tick) and then closes the day
      const demoBusy = (d) => s.mode === 'demo' && [...(s.apptsByDay.get(d) || [])].some((id) => { const a = s.appts.get(id); return a && a.demo && PENDING.has(a.status); });
      // one Z per tick, oldest first: each Z reads the number and the grand total the previous one left
      if (close.length && !demoBusy(close[0])) {
        const asCloser = { ...ctx, can: (c) => c === 'closure' || ctx.can(c), need: (c) => { if (c !== 'closure') ctx.need(c); } };
        closeDay.run(s, { day: close[0], auto: true }, asCloser);
      }
      return { warnings: closingWarnings(s, ctx.local.day) };
    }
  },
  // the owner's evening summary and Monday report, by e-mail (WP-02)
  digest,
  // the demo's memberships renew by themselves, as Stripe would (PAY-02)
  simBilling,
  // CPT-01a: month and year closures, their signatures, the software version in the technical log
  periodCloseStep,
  signStep,
  jetStep,
  // AC-01: the demo forgets its visitors' files two hours after they were made
  demoPurge
];

/** Run every registered step; a failing step costs only its own work. */
export function runSteps(s, ctx) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const failed = [];
  for (const step of REGISTRY) {
    const mark = ctx.drafts.length;
    try {
      const r = step.run(s, ctx);
      if (r && r.warnings) warnings.push(...r.warnings);
    } catch (e) {
      ctx.drafts.length = mark;
      failed.push(step.name);
      console.error('[lx] tick step ' + step.name, e && /** @type {any} */ (e).message);
    }
  }
  return { warnings, failed };
}
