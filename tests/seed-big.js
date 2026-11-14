// WP8 · A salon with thousands of client files, for the list and bulk tests and for the measures of
// docs/owner-experience.md (5 000 files). Added on top of any salon (the demo, or tests/helpers.js salon()): the files
// and their past visits are written as the WordPress import writes them (client.added, then appt.booked with
// status 'done' and legacy: true, whose price counts as spend), in a few large appends. Deterministic: same seed, same salon.
import { normPhone } from '../server/lib/util.js';
import { addDays } from '../shared/dates.js';
import { localParts } from '../shared/dates.js';

const FIRST = ['Adam', 'Amine', 'Anis', 'Bilal', 'Camille', 'Dylan', 'Elias', 'Enzo', 'Farid', 'Gabriel', 'Hugo', 'Idriss', 'Ilyes', 'Ismaël', 'Jules', 'Karim', 'Kaïs', 'Léo', 'Liam', 'Louis',
  'Lucas', 'Malik', 'Mehdi', 'Nassim', 'Nathan', 'Noah', 'Omar', 'Paul', 'Rayan', 'Sacha', 'Sami', 'Sofiane', 'Théo', 'Tom', 'Wassim', 'Yacine', 'Yanis', 'Younès', 'Zakaria', 'Éric'];
const LAST = ['Abadie', 'Benali', 'Bernard', 'Blanc', 'Bouzid', 'Carré', 'Chevalier', 'Colin', 'Da Silva', 'Diallo', 'Dubois', 'Dumas', 'Durand', 'Fabre', 'Faure', 'Fontaine', 'Garcia', 'Gauthier', 'Girard', 'Haddad',
  'Henry', 'Kone', 'Lambert', 'Leroy', 'Lopez', 'Marchand', 'Martin', 'Masson', 'Mercier', 'Meyer', 'Morel', 'Moulin', 'N’Diaye', 'Noël', 'Perrin', 'Petit', 'Picard', 'Renard', 'Robin', 'Roux',
  'Saïdi', 'Sanchez', 'Simon', 'Traoré', 'Vidal'];

/** mulberry32: a small seeded generator */
export function prng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * @param {any} engine
 * @param {{ clients?: number, seed?: number, visits?: boolean }} [opt]
 * @returns {Promise<{ ids: string[], events: number, ms: number }>} the ids of the files added, in order
 */
export async function seedBigSalon(engine, opt = {}) {
  const n = opt.clients ?? 5000;
  const r = prng(opt.seed ?? 8);
  const t0 = Date.now();
  await engine.sync(true);
  const s0 = engine.state;
  const today = localParts(engine.clock()).day;
  const chairs = [...s0.staff.values()].filter((x) => x.chair && x.active).map((x) => x.id);
  const svc = [...s0.services.values()].filter((x) => x.active && !x.pack)[0];
  const sys = { actor: { t: 'system', id: 'seed' }, caps: new Set() };
  const ids = [];
  let events = 0;
  const CHUNK = 250;
  for (let from = 0; from < n; from += CHUNK) {
    const res = await engine.run({
      run(s, input, ctx) {
        const made = [];
        for (let i = from; i < Math.min(n, from + CHUNK); i++) {
          const cid = 'cl_big' + String(i).padStart(6, '0');
          // 40 first names × 45 last names, then a number: no two files share a name, so the duplicate finder stays quiet
          const round = Math.floor(i / (FIRST.length * LAST.length));
          const first = FIRST[i % FIRST.length], last = LAST[Math.floor(i / FIRST.length) % LAST.length] + (round ? ' ' + (round + 1) : '');
          const noPhone = r() < 0.04;
          const pii = { first, last, phone: noPhone ? '' : normPhone('07' + String(10000000 + i)), email: r() < 0.4 ? 'c' + i + '@exemple.fr' : '', notes: '', tech: '', birthday: r() < 0.3 ? String(1 + Math.floor(r() * 28)).padStart(2, '0') + '-' + String(1 + Math.floor(r() * 12)).padStart(2, '0') : '' };
          const tags = [...(r() < 0.06 ? ['VIP'] : []), ...(r() < 0.1 ? ['Barbe'] : [])];
          const visits = opt.visits === false || r() < 0.25 ? 0 : 1 + Math.floor(r() * r() * 12);
          const cadence = 21 + Math.floor(r() * 22);
          const lastAgo = 2 + Math.floor(r() * r() * 400);
          ctx.emit('client.added', { id: cid, cid, source: 'salon', sms: r() < 0.92, marketing: r() < 0.55, tags, createdAt: ctx.now - (lastAgo + visits * cadence + 5) * 86400000 }, pii);
          for (let k = 0; k < visits; k++) {
            const day = addDays(today, -(lastAgo + k * cadence));
            const aid = 'ap_big' + String(i).padStart(6, '0') + '_' + k;
            ctx.emit('appt.booked', { id: aid, code: 'B' + i + 'K' + k, clientId: cid, cid, staffId: chairs[(i + k) % chairs.length], day, start: 540 + ((i + k) % 18) * 30, dur: svc.dur, services: [{ id: svc.id, name: svc.name, price: svc.price, dur: svc.dur, buffer: 0 }], price: svc.price, source: 'import', status: 'done', legacy: true, sms: false });
          }
          made.push(cid);
        }
        return { made, n: ctx.drafts.length };
      }
    }, {}, sys);
    ids.push(...res.made);
    events += res.n;
  }
  return { ids, events, ms: Date.now() - t0 };
}
