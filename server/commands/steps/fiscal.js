// @ts-check
// Three tick steps (CPT-01a), registered in commands/tick-steps.js after auto-z:
// - period-close: after 05:00, the oldest month that can be closed, one per tick (each reads the perpetual totals the
//   previous one left). A month whose Z waits on an uncounted drawer says so to the owner.
// - sign: every Z, month and year closure without a signature, up to 100 per tick, with the runtime's key (meta.signer,
//   core/signer.js). The anti-rewrite rule: a closure older than 36 h is signed only if it was already waiting when the
//   current key FIRST appeared (its backlog, fixed in the projection then, marked late). Otherwise it stays « non signée »:
//   whoever rewrites the tail of the journal cannot have it signed quietly, not even by logging another key, since only a
//   key never seen before gets a backlog. A key not seen before is first written to the technical log; a known one is not
//   logged again (two deployments on one database would otherwise log a key every tick).
// - jet: the technical log records each software version the first tick it runs (meta.software, server/version.js),
//   once: a build already logged that runs again (a rollover, a rollback) is not logged a second time.
// Without meta.signer or meta.software (a tick run by hand, the tests) the last two do nothing.
import { canonical } from '../../lib/util.js';
import { closePeriod } from '../fiscal.js';
import { closableMonth, waitingWords, allClosures, payloadOf, SIGN_WINDOW, signsAll } from '../../domain/fiscal.js';
import { missedZ } from '../../domain/cash.js';
import { versionOf } from '../../version.js';

const SIGN_PER_TICK = 100;
const PENDING = new Set(['booked', 'arrived', 'in_chair']);

/**
 * The demo checks its own past appointments out after this tick (demoTick, back-dated) and only then makes their Z: a
 * month with some still to check out on a day without its Z would close without them (auto-z waits for them too).
 */
function demoBusy(s, month) {
  if (s.mode !== 'demo') return false;
  for (const [day, ids] of s.apptsByDay) {
    if (!day.startsWith(month) || s.closures.has(day)) continue;
    for (const id of ids) { const a = s.appts.get(id); if (a && a.demo && PENDING.has(a.status)) return true; }
  }
  return false;
}

/** @typedef {{ name: string, run: (s: any, ctx: import('../../core/engine.js').Ctx) => void | { warnings?: string[] } }} Step */

/** @type {Step} */
export const periodCloseStep = {
  name: 'period-close',
  run(s, ctx) {
    if (ctx.local.min < 5 * 60) return;
    const c = closableMonth(s, ctx.local.day);
    if (!c) return;
    // a Z still to make (auto-z does it, one per tick) needs no word; a drawer nobody counted does
    if (c.waiting) return missedZ(s, ctx.local.day).uncounted.includes(c.waiting) ? { warnings: [waitingWords(c, ctx.local.day)] } : undefined;
    if (demoBusy(s, c.month)) return;
    closePeriod.run(s, { month: c.month }, ctx);
  }
};

/** @type {Step} */
export const signStep = {
  name: 'sign',
  run(s, ctx) {
    const signer = ctx.meta && ctx.meta.signer;
    if (!signer) return;
    const all = signsAll(s);
    const fresh = (c) => all || ctx.now - c.at < SIGN_WINDOW;
    const unsigned = allClosures(s).filter((c) => !s.signatures.has(c.ref));
    const known = s.signKeys.get(signer.kid);
    let backlog = known ? known.backlog : null;
    if (!backlog) {
      // the backlog is fixed now, in the tick the key first appears: what is older and comes later is never signed
      const old = unsigned.filter((c) => !fresh(c)).map((c) => c.ref);
      ctx.emit('tech.logged', { kind: 'key', kid: signer.kid, publicKey: signer.publicKey, source: signer.source, backlog: old });
      backlog = new Set(old);
    }
    // the fresh ones first: a long backlog never holds back today's Z
    const todo = [...unsigned.filter(fresh), ...unsigned.filter((c) => !fresh(c) && backlog.has(c.ref))].slice(0, SIGN_PER_TICK);
    for (const c of todo) {
      const p = payloadOf(c);
      ctx.emit('seal.signed', { ref: p.ref, kind: p.kind, of: p.of, digest: p.digest, sig: signer.sign(canonical(p)), kid: signer.kid, ...(fresh(c) ? {} : { late: true }) });
    }
  }
};

/** @type {Step} */
export const jetStep = {
  name: 'jet',
  run(s, ctx) {
    const sw = ctx.meta && ctx.meta.software;
    if (!sw) return;
    const to = versionOf(sw);
    if (!s.softwareSeen.has(to)) ctx.emit('tech.logged', { kind: 'version', from: s.software, to });
  }
};

/**
 * The three steps at one moment, outside a tick: the demo seed runs them as it builds its past, so the demo's months are
 * closed and signed on their own dates (server/domain/seed.js).
 */
export const fiscalSteps = { run(s, input, ctx) { for (const st of [jetStep, periodCloseStep, signStep]) st.run(s, ctx); return {}; } };
