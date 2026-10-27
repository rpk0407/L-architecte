// @ts-check
// One JSON-lines file on disk, for local development (`npm run dev`). Single process only.
import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/** @typedef {import('./memory.js').Store} Store */
/** @typedef {import('../core/journal.js').JEvent} JEvent */

/** @returns {Store} */
export function fileStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const secretsPath = path + '.secrets.json';
  /** @type {JEvent[]} */
  let events = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  let epoch = 'f' + (events[0] ? events[0].h.slice(0, 8) : 'empty');
  const rewrite = () => writeFileSync(path, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
  return {
    kind: 'file',
    async read(after) { return { epoch, events: events.slice(after) }; },
    async append(list, ep) {
      if (ep !== epoch) return { ok: false };
      if (!list.length) return { ok: true };
      if (list[0].v !== events.length + 1) return { ok: false };
      appendFileSync(path, list.map((e) => JSON.stringify(e)).join('\n') + '\n');
      events = events.concat(list);
      return { ok: true };
    },
    async redact(match) {
      let n = 0;
      // from the disk: the events in memory are the engine's own objects, whose pii it drops before asking, so they
      // would read as already clean while the file still holds the personal data
      const disk = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
      const clean = disk.map((e) => { if (e.pii != null && match(e)) { n++; const { pii, ...rest } = e; return rest; } return e; });
      if (n) { events = clean; rewrite(); }
      return n;
    },
    async reset() { events = []; rewrite(); epoch = 'f' + randomBytes(4).toString('hex'); return epoch; },
    async secret(name, make) {
      const all = existsSync(secretsPath) ? JSON.parse(readFileSync(secretsPath, 'utf8')) : {};
      if (!all[name]) { all[name] = make(); writeFileSync(secretsPath, JSON.stringify(all), { mode: 0o600 }); }
      return all[name];
    }
  };
}
