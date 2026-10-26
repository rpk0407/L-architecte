// @ts-check
// In-process store: tests and local development. Same contract as the Blob and Postgres stores.

/** @typedef {import('../core/journal.js').JEvent} JEvent */

/**
 * The storage contract. Stores know nothing about the domain: they keep an ordered list of events
 * and refuse an append that does not follow the last stored version (optimistic concurrency).
 * `epoch` changes when the journal is wiped (demo reset) so other instances rebuild from scratch.
 *
 * @typedef {Object} Store
 * @property {string} kind
 * @property {(after: number) => Promise<{ epoch: string, events: JEvent[] }>} read
 * @property {(events: JEvent[], epoch: string) => Promise<{ ok: boolean }>} append
 * @property {(match: (e: JEvent) => boolean) => Promise<number>} redact   drop the personal data of matching events
 * @property {() => Promise<string>} reset                               wipe everything, returns the new epoch
 * @property {(name: string, make: () => string) => Promise<string>} secret read a server secret, creating it once
 * @property {() => Promise<void>} [close]
 */

/** @returns {Store} */
export function memoryStore() {
  /** @type {JEvent[]} */
  let events = [];
  let epoch = 'm' + Date.now().toString(36);
  /** @type {Map<string, string>} */
  const secrets = new Map();
  return {
    kind: 'memory',
    async read(after) { return { epoch, events: events.slice(after).map((e) => structuredClone(e)) }; },
    async append(list, ep) {
      if (ep !== epoch) return { ok: false };
      if (!list.length) return { ok: true };
      if (list[0].v !== events.length + 1) return { ok: false };
      events = events.concat(list.map((e) => structuredClone(e)));
      return { ok: true };
    },
    async redact(match) {
      let n = 0;
      events = events.map((e) => { if (e.pii != null && match(e)) { n++; const { pii, ...rest } = e; return rest; } return e; });
      return n;
    },
    async reset() { events = []; epoch = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); return epoch; },
    async secret(name, make) {
      if (!secrets.has(name)) secrets.set(name, make());
      return /** @type {string} */ (secrets.get(name));
    }
  };
}
