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
import { replayAnswer } from './replay.js';

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

/** The store did not answer before anything was written: the till falls back on paper. */
export const STORE_DOWN = 'La base de données ne répond pas : rien n’est enregistré. Note le ticket sur papier.';
/** The store failed while writing: it may have kept it. Paper would count it twice; the till's retry (same id) cannot. */
export const STORE_LOST = 'La base de données ne répond pas : ce n’est peut-être pas enregistré. Ne le note pas sur papier, vérifie quand la bande rouge disparaît.';
/** How long an instance may answer reads from memory while the store is down (http/app.js). */
export const STALE_MAX = 10 * 60000;

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
 * replay: the answer to a request retried on an instance that does not remember the first answer, from the events
 * it wrote; without it, core/replay.js rebuilds the usual shapes.
 * @typedef {{ run: (s: State, input: any, ctx: Ctx) => any, replay?: (events: { type: string, data: any }[]) => any }} Handler
 */

/**
 * The events whose personal data a client.erased event removes: the client's own events and those about them,
 * plus the ones its drop list names.
 * @param {JEvent} erased @returns {(e: JEvent) => boolean}
 */
export function erasedMatch(erased) {
  const ids = new Set(erased.data.ids || [erased.data.id]);
  // drop: what the retention purge removes outside any file (a ticket's typed reason, a walk-in's name), by id
  const drop = new Set(erased.data.drop || []);
  return (x) => !!x.data && (ids.has(x.data.cid) || (x.type.startsWith('client.') && ids.has(x.data.id)) || (drop.size > 0 && drop.has(x.data.id)));
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
  /** engine clock of the last read that reached the store: how old a projection served without it is */
  let lastSyncOk = 0;
  /** when the store last failed (0: it answers), so an outage does not cost every request a connection timeout */
  let failedAt = 0;
  /** @type {any} */
  let lastError = null;
  const retryEvery = Math.min(5000, syncEvery * 2);
  /** @type {Promise<void>|null} */
  let syncing = null;
  /** recent results by idempotency key, so a retried request gets the same answer */
  const results = new Map();
  /** keys whose append failed midway: the store may hold them, so a retry while it is down is not told "nothing saved" */
  const unsure = new Set();
  /** erasures the store has not applied yet (it failed after the append, or before a restart): retried after each read */
  /** @type {((e: JEvent) => boolean)[]} */
  let redactLater = [];

  // nothing read is trusted any more: the next sync reads everything again, and until it does nothing is served stale
  function rebuild() { state = emptyState(); journal = []; lastSync = 0; lastSyncOk = 0; }

  /** @param {JEvent[]} list @param {boolean} [own] this instance's own write, which redacts the store itself (afterAppend) */
  function apply(list, own = false) {
    const fresh = new Set(list);
    for (const e of list) {
      if (e.v !== state.version + 1) throw new Error('journal gap at ' + e.v);
      evolve(state, e);
      journal.push(e);
      // an erasure made by another instance reaches this one here: its memory forgets the client too
      if (e.type === 'client.erased') {
        const match = erasedMatch(e);
        let kept = false;
        for (const x of journal) if (x.pii != null && match(x)) { if (fresh.has(x) && !own) kept = true; delete x.pii; }
        // read just now with its personal data although its erasure is in the store too: the store never redacted it
        if (kept) redactLater.push(match);
      }
    }
  }

  async function redactPending() {
    const todo = redactLater; redactLater = [];
    for (const m of todo) {
      try { await store.redact(m); }
      catch (e) { redactLater.push(m); console.error('[lx] store redact failed, retried after the next read:', e && e.message ? e.message : e); }
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
    lastSyncOk = clock();
    if (redactLater.length) await redactPending();
  }

  /** Catch up with the store. Throttled unless forced; while the store is down, fails fast for a few seconds. */
  async function sync(force = false) {
    if (!force && lastSync && Date.now() - lastSync < syncEvery) return;
    if (!force && failedAt && Date.now() - failedAt < retryEvery) throw lastError;
    if (syncing) return syncing;
    syncing = pull().catch((e) => {
      if (String(e && e.message).startsWith('journal gap')) { rebuild(); epoch = ''; return pull(); }
      throw e;
    }).then(() => {
      if (failedAt) console.warn('[lx] store reachable again');
      failedAt = 0; lastError = null;
    }, (e) => {
      // logged once per outage, not once per request
      if (!failedAt) console.error('[lx] store unreachable:', e && e.message ? e.message : e);
      failedAt = Date.now(); lastError = e;
      throw e;
    }).finally(() => { syncing = null; });
    return syncing;
  }

  /** A store error becomes an answer the screens can show; a refusal from the rules stays what it is. */
  function storeDown(message) {
    return (e) => { if (e instanceof DomainError) throw e; fail(503, 'store_down', message); };
  }

  /** @param {Actor} actor @param {string} [requestId] the idempotency key of a request: per signed-in actor */
  function keyOf(actor, requestId) {
    return requestId ? 'rq_' + sha256(actor.t + ':' + actor.id + ':' + requestId).slice(0, 24) : null;
  }
  /**
   * What this instance knows of a request without the store: 'answered' (its answer is in memory or in the journal),
   * 'unsure' (its append failed midway), '' (nothing: as far as it knows, nothing was written).
   * @param {string|null} key
   */
  function recall(key) {
    if (!key) return '';
    if (results.has(key) || state.eventIds.has(key + '_0')) return 'answered';
    return unsure.has(key) ? 'unsure' : '';
  }
  /** @param {string|null} key @param {Handler} handler the answer the first request got, from memory or from its events */
  function answer(key, handler) {
    if (results.has(key)) return results.get(key);
    // written by another instance, or by this one before a restart: the first answer, rebuilt from its events
    const mine = journal.filter((e) => e.id.startsWith(key + '_'));
    if (!handler.replay) return replayAnswer(mine);
    const events = mine.map((e) => ({ type: e.type, data: e.data }));
    return { ...handler.replay(events), duplicate: true, events };
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
    const key = keyOf(base.actor, base.requestId);
    for (let attempt = 0; attempt < 8; attempt++) {
      try { await sync(attempt > 0); }
      catch (e) {
        // the store is down, but a retry of something this instance already wrote still gets its answer
        const known = recall(key);
        if (known === 'answered') return answer(key, handler);
        storeDown(known === 'unsure' ? STORE_LOST : STORE_DOWN)(e);
      }
      if (key) unsure.delete(key);
      if (recall(key) === 'answered') return answer(key, handler);
      const ctx = makeCtx(base);
      const result = handler.run(state, input, ctx);
      if (!ctx.drafts.length) return result;
      const sealed = seal(ctx.drafts, { version: state.version, hash: state.head }, {
        at: ctx.now, actor: ctx.actor, id: (i) => (key ? key + '_' + i : newId('ev'))
      });
      const r = await store.append(sealed, epoch).catch((e) => {
        // reads may still work (a read-only replica, a quota): the outage would leave no other trace
        console.error('[lx] store append failed:', e && e.message ? e.message : e);
        if (key) { unsure.add(key); if (unsure.size > 500) unsure.delete(unsure.values().next().value); }
        return storeDown(STORE_LOST)(e);
      });
      if (!r.ok) continue;
      apply(sealed, true);
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
      // memory was cleaned by apply; the store forgets now, or after its next read if it fails here (the write stands)
      if (e.type === 'client.erased') redactLater.push(erasedMatch(e));
    }
    if (redactLater.length) await redactPending();
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
        apply(ev, true);
        sealed.push(...ev);
      }
      return result;
    };
    // a re-read that fails leaves an empty projection that rebuild() marks unread: 503 until the store answers again
    const rollback = async () => { rebuild(); epoch = ''; await pull().catch(() => {}); };
    try { await fn(step); } catch (e) { if (sealed.length) await rollback(); throw e; }
    if (!sealed.length) return 0;
    const r = await store.append(sealed, epoch).catch(async (e) => {
      // memory is ahead of the store: undone, or every later write would be sealed at a version the store lacks
      console.error('[lx] store append failed:', e && e.message ? e.message : e);
      await rollback();
      return storeDown(STORE_LOST)(e);
    });
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
    lastSyncOk = clock();
    results.clear();
  }

  const api = {
    store,
    get state() { return state; },
    get journal() { return journal; },
    sync, run, batch, adopt, reset,
    /** what this instance knows of a request while the store is down (see recall) @param {Actor} actor @param {string} [requestId] */
    knows: (actor, requestId) => recall(keyOf(actor, requestId)),
    verify: () => verifyChain(journal),
    clock,
    /** engine clock of the last successful read from the store (0: never) */
    get lastSyncOk() { return lastSyncOk; },
    /** read-only view after a throttled sync */
    async read(fn) { await sync(); return fn(state); }
  };
  return api;
}
/** @typedef {ReturnType<typeof createEngine>} Engine */
