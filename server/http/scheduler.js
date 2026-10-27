// @ts-check
// The salon's background work, carried by regular traffic (the Comptoir polls every few seconds while
// the shop is open) and by /api/cron/tick when a platform cron is available. At most once a minute.
import { tick } from '../commands/system.js';
import { claimMessage, messageResult } from '../commands/messages.js';
import { demoTick } from '../domain/seed.js';
import { startsAt } from '../domain/policy.js';

const SYSTEM = { actor: /** @type {const} */ ({ t: 'system', id: 'scheduler', n: 'Automatique' }), caps: new Set() };

export function maybeTick(rt, meta, { force = false } = {}) {
  const now = Date.now();
  if (rt.ticking) return rt.ticking;
  if (!force && now - rt.lastTick < 55000) return null;
  rt.lastTick = now;
  rt.ticking = (async () => {
    const e = rt.engine;
    if (!e.state.version) return;
    await e.run(tick, {}, { ...SYSTEM, meta });
    if (e.state.mode === 'demo') await demoTick(e, meta);
    await dispatch(rt);
  })().catch((err) => console.error('[lx] tick', err && err.stack ? err.stack : err)).finally(() => { rt.ticking = null; });
  return rt.ticking;
}

const STALE_MS = 6 * 3600000;

/**
 * A message that waited too long (no provider yet, a long outage) is no longer worth sending:
 * due more than 6 h ago, or about an appointment that has already started.
 * @returns {string} why, or '' when it may still leave
 */
export function staleReason(s, m, now) {
  if (now - m.dueAt > STALE_MS) return 'Trop tard : en attente depuis plus de 6 h';
  const a = m.apptId ? s.appts.get(m.apptId) : null;
  // queued before the appointment (confirmation, reminder), not after it (thanks and review)
  if (a && m.at < startsAt(a) && startsAt(a) <= now) return 'Trop tard : le rendez-vous est passé';
  return '';
}

/** Deliver queued messages: claim them in one write, send, record the outcome in one write. */
export async function dispatch(rt, limit = 10) {
  const e = rt.engine;
  const demo = e.state.mode === 'demo';
  // production without a provider: nothing is claimed, the messages wait in the outbox for one
  if (!rt.sms && !demo) return 0;
  const now = e.clock();
  const queued = [...e.state.messages.values()].filter((m) => m.status === 'queued' && m.dueAt <= now);
  // the stale ones go first and cost nothing to close, so a backlog never holds the fresh ones back
  const stale = demo ? [] : queued.filter((m) => staleReason(e.state, m, now)).slice(0, 100);
  const isStale = new Set(stale);
  const due = [...stale, ...queued.filter((m) => !isStale.has(m)).slice(0, limit)];
  if (!due.length) return 0;
  const claimed = [];
  await e.batch((step) => { for (const m of due) { const r = step(claimMessage, { id: m.id }, SYSTEM); if (r.ok) claimed.push(m.id); } });
  const outcomes = [];
  for (const id of claimed) {
    const m = e.state.messages.get(id);
    if (!m || m.status !== 'claimed') continue;
    if (!rt.sms || demo) { outcomes.push({ id, status: 'simulated' }); continue; }
    const late = staleReason(e.state, m, now);
    if (late) { outcomes.push({ id, status: 'expired', error: late }); continue; }
    if (!m.to) { outcomes.push({ id, status: 'skipped', error: 'Numéro effacé' }); continue; }
    try { const r = await rt.sms.send(m.to, m.body); outcomes.push({ id, status: 'sent', providerRef: r.ref }); }
    catch (err) { outcomes.push({ id, status: 'failed', error: String(err && err.message || err) }); }
  }
  if (outcomes.length) await e.batch((step) => { for (const o of outcomes) step(messageResult, o, SYSTEM); });
  return outcomes.length;
}
