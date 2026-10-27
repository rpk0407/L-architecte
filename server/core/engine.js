// @ts-check
// The engine owns one in-memory projection and keeps it in step with the store.
//
// A write is: decide on the current state → seal the resulting events → append them if, and only if,
// nobody appended since (compare-and-swap on the version). On a conflict the engine catches up and
// decides again. Two phones booking the same chair at the same second: exactly one wins.
import { seal, verifyChain } from './journal.js';
import { emptyState, evolve } from './state.js';
import { localParts } from '../../shared/dates.js';
import { newId, newToken, humanCode, sha256 } from '../lib/util.js';

/** @typedef {import('./journal.js').JEvent} JEvent */
/** @typedef {import('./journal.js').Actor} Actor */
/** @typedef {import('./state.js').State} State */
/** @typedef {import('../store/memory.js').Store} Store */

export class DomainError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {any} [extra] */
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
/** @returns {never} */
export function fail(status, code, message, extra) { throw new DomainError(status, code, message, extra); }

/**
 * @typedef {Object} Ctx
 * @property {number} now
 * @property {{ y: number, m: number, d: number, wd: number, min: number, day: string }} local
 * @property {Actor} actor
 * @property {any} staff
 * @property {Set<string>} caps
 * @property {any} meta
 * @property {{ type: string, data: any, pii?: any }[]} drafts
 * @property {(type: string, data: any, pii?: any) => void} emit
 * @property {(prefix: string) => string} id
 * @property {() => string} token
 * @property {(prefix?: string) => string} code
 * @property {(cap: string) => boolean} can
 * @property {(cap: string) => void} need
 */

/**
 * @typedef {{ run: (s: State, input: any, ctx: Ctx) => any }} Handler
 */

/**
 * The events whose personal data a client.erased event removes: the client's own events and those about them.
 * @param {JEvent} erased @returns {(e: JEvent) => boolean}
 */
export function erasedMatch(erased) {
  const ids = new Set(erased.data.ids || [erased.data.id]);
  return (x) => !!x.data && (ids.has(x.data.cid) || (x.type.startsWith('client.') && ids.has(x.data.id)));
}

/**
 * @param {Store} store
 * @param {{ clock?: () => number, syncEveryMs?: number, onEvents?: (ev: JEvent[], engine: any) => void }} [opts]
 */
export function createEngine(store, opts = {}) {
  const clock = opts.clock || Date.now;
  const syncEvery = opts.syncEveryMs ?? 1500;
  let state = emptyState();
  /** @type {JEvent[]} */
  let journal = [];
  let epoch = '';
  let lastSync = 0;
  /** @type {Promise<void>|null} */
  let syncing = null;
  /** recent results by idempotency key, so a retried request gets the same answer */
  const results = new Map();

  function rebuild() { state = emptyState(); journal = []; }

  function apply(list) {
    for (const e of list) {
      if (e.v !== state.version + 1) throw new Error('journal gap at ' + e.v);
      evolve(state, e);
      journal.push(e);
      // an erasure made by another instance reaches this one here: its memory forgets the client too
      if (e.type === 'client.erased') { const match = erasedMatch(e); for (const x of journal) if (x.pii != null && match(x)) delete x.pii; }
    }
  }

  async function pull() {
    const r = await store.read(state.version);
    if (r.epoch !== epoch) {
      // the journal was wiped elsewhere (demo reset): start over
      rebuild();
      epoch = r.epoch;
      const full = r.events[0] && r.events[0].v === 1 ? r : await store.read(0);
      apply(full.events);
    } else apply(r.events);
    lastSync = Date.now();
  }

  /** Catch up with the store. Throttled unless forced. */
  async function sync(force = false) {
    if (!force && lastSync && Date.now() - lastSync < syncEvery) return;
    if (syncing) return syncing;
    syncing = pull().catch((e) => {
      if (String(e && e.message).startsWith('journal gap')) { rebuild(); epoch = ''; return pull(); }
      throw e;
    }).finally(() => { syncing = null; });
    return syncing;
  }

  /** @param {{ actor: Actor, staff?: any, caps?: Set<string>, meta?: any }} base @returns {Ctx} */
  function makeCtx(base) {
    const now = clock();
    const caps = base.caps || new Set();
    /** @type {Ctx} */
    const ctx = {
      now, local: localParts(now), actor: base.actor, staff: base.staff || null, caps, meta: base.meta || {},
      drafts: [],
      emit(type, data, pii) { ctx.drafts.push(pii == null ? { type, data } : { type, data, pii }); },
      id: (p) => newId(p), token: newToken, code: humanCode,
      can: (c) => caps.has(c),
      need(c) { if (!caps.has(c)) fail(403, 'forbidden', 'Tu n’as pas accès à cette action.'); }
    };
    return ctx;
  }

  /**
   * Run a command. Retries on write conflicts; replays the stored answer for a repeated request id.
   * @param {Handler} handler
   * @param {any} input
   * @param {{ actor: Actor, staff?: any, caps?: Set<string>, meta?: any, requestId?: string }} base
   */
  async function run(handler, input, base) {
    await sync();
    const key = base.requestId ? 'rq_' + sha256(base.actor.t + ':' + base.actor.id + ':' + base.requestId).slice(0, 24) : null;
    if (key && results.has(key)) return results.get(key);
    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt > 0) await sync(true);
      if (key && state.eventIds.has(key + '_0')) {
        return { duplicate: true, events: journal.filter((e) => e.id.startsWith(key + '_')).map((e) => ({ type: e.type, data: e.data })) };
      }
      const ctx = makeCtx(base);
      const result = handler.run(state, input, ctx);
      if (!ctx.drafts.length) return result;
      const sealed = seal(ctx.drafts, { version: state.version, hash: state.head }, {
        at: ctx.now, actor: ctx.actor, id: (i) => (key ? key + '_' + i : newId('ev'))
      });
      const r = await store.append(sealed, epoch);
      if (!r.ok) continue;
      apply(sealed);
      await afterAppend(sealed);
      if (key) {
        results.set(key, result);
        if (results.size > 500) results.delete(results.keys().next().value);
      }
      return result;
    }
    fail(503, 'busy', 'Le salon reçoit beaucoup de demandes en même temps. Réessaie dans un instant.');
  }

  /** @param {JEvent[]} list */
  async function afterAppend(list) {
    for (const e of list) {
      // memory was cleaned by apply; the store forgets now
      if (e.type === 'client.erased') await store.redact(erasedMatch(e));
    }
    if (opts.onEvents) { try { opts.onEvents(list, api); } catch { /* hooks never break a write */ } }
  }

  /**
   * Several commands, one atomic append (demo upkeep, imports). Each step sees the previous ones.
   * A step that throws is skipped by the caller; on a write conflict the batch is dropped and the
   * state rebuilt from the store, so nothing half-applied ever survives.
   * @param {(step: (h: Handler, input: any, base: { actor: Actor, staff?: any, caps?: Set<string>, meta?: any }) => any) => void | Promise<void>} fn
   */
  async function batch(fn) {
    await sync(true);
    /** @type {JEvent[]} */
    const sealed = [];
    const step = (handler, input, base) => {
      const ctx = makeCtx(base);
      const result = handler.run(state, input, ctx);
      if (ctx.drafts.length) {
        const ev = seal(ctx.drafts, { version: state.version, hash: state.head }, { at: ctx.now, actor: ctx.actor, id: () => newId('ev') });
        apply(ev);
        sealed.push(...ev);
      }
      return result;
    };
    const rollback = async () => { rebuild(); epoch = ''; await pull(); };
    try { await fn(step); } catch (e) { if (sealed.length) await rollback(); throw e; }
    if (!sealed.length) return 0;
    const r = await store.append(sealed, epoch);
    if (!r.ok) { await rollback(); return -1; }
    await afterAppend(sealed);
    return sealed.length;
  }

  /** Append a journal built elsewhere (the demo seed) to an empty store. */
  async function adopt(events) {
    await sync(true);
    if (state.version > 0) return false;
    const r = await store.append(events, epoch);
    if (!r.ok) { await sync(true); return false; }
    apply(events);
    return true;
  }

  async function reset() {
    epoch = await store.reset();
    rebuild();
    lastSync = Date.now();
    results.clear();
  }

  const api = {
    store,
    get state() { return state; },
    get journal() { return journal; },
    sync, run, batch, adopt, reset,
    verify: () => verifyChain(journal),
    clock,
    /** read-only view after a throttled sync */
    async read(fn) { await sync(); return fn(state); }
  };
  return api;
}
/** @typedef {ReturnType<typeof createEngine>} Engine */
