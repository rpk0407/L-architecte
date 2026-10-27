// @ts-check
// What a client does without an account (public/mon-rendez-vous.html): find their appointment from a phone number.
// The answer never says whether the number is known: same words, same status, about the same time.
import { HttpError, guard, limited } from './kit.js';
import { normPhone } from '../lib/util.js';
import { lookupAppointments } from '../commands/lookup.js';
import { maybeTick } from './scheduler.js';
import { waitUntil } from '@vercel/functions';

export const LOOKUP_MESSAGE = 'Si un rendez-vous existe à ce numéro, tu reçois un SMS dans un instant.';
const DAY_MS = 86400000, HOUR_MS = 3600000;
// a known number writes to the journal and an unknown one does not: the answer never waits for that work (it finishes
// in the background) and always leaves after this long plus a little noise, so the time it takes says nothing, on any store
const MIN_MS = 450, JITTER_MS = 200;

// the actor is chained and can never be erased: no name and no number in it (the number travels as pii)
const CLIENT = (r) => ({ actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: r.meta });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** @param {any} app @param {{ minMs?: number, jitterMs?: number, later?: (p: Promise<any>) => void }} [o] tests shorten the wait and await the work */
export function clientRoutes(app, o = {}) {
  const minMs = o.minMs ?? MIN_MS, jitterMs = o.jitterMs ?? JITTER_MS, later = o.later || waitUntil;

  app.post('/api/public/lookup', async (r) => {
    guard('lki|' + r.ip, 10, HOUR_MS, 'Trop de demandes depuis cet appareil. Réessaie dans une heure ou appelle le salon.');
    const phone = normPhone(String((r.body && r.body.phone) || '').slice(0, 32));
    if (!phone) throw new HttpError(400, 'invalid', 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
    const answer = wait(minMs + Math.random() * jitterMs);
    // past 3 asks a day the number gets nothing more, and the asker is not told (a 429 would say the number was tried)
    if (!limited('lkp|' + phone, 3, DAY_MS)) later((async () => {
      try {
        const { sent } = await r.rt.engine.run(lookupAppointments, { phone }, CLIENT(r));
        // the text leaves now rather than at the next tick a visitor happens to bring
        if (sent) await maybeTick(r.rt, r.meta, { force: true });
      } catch (e) {
        // a busy journal or a store hiccup must not answer differently for a known number
        console.error('[lx] lookup', e && e.message);
      }
    })());
    await answer;
    return { ok: true, message: LOOKUP_MESSAGE };
  });
}
