// @ts-check
// Taking over the old WordPress salon: the owner's import (Réglages › Reprendre WordPress), the single takeovers of a
// paper gift card or a running subscription, and the old e-mail links that land on /ancien-lien.
import { HttpError, guard } from './kit.js';
import { signLink } from '../auth/session.js';
import { str, int, opt, obj, arr, parse } from '../lib/validate.js';
import { safeEqual, sha256 } from '../lib/util.js';
import { importBatch, importGiftcard, importPack, knownClient, priorView } from '../commands/import.js';

const previewSchema = obj({
  keys: opt(arr(obj({ phone: opt(str({ max: 32 })), prefix: opt(str({ max: 6 })), email: opt(str({ max: 160 })) }), { max: 500 })),
  wp: opt(arr(int({ min: 1, max: 999999999999 }), { max: 5000 }))
});

export function importRoutes(app) {
  // read only: which of these people already have a file (known: the salon's, again: an earlier run's), and where the
  // bookings an earlier run brought in stand now, so the preview can tell what a delta run will change
  app.post('/api/v1/import/preview', (r) => {
    const x = parse(previewSchema, r.body);
    const known = [], again = [];
    (x.keys || []).forEach((k, i) => { const w = knownClient(r.s, k); if (w === 'salon') known.push(i); else if (w === 'wordpress') again.push(i); });
    const appts = priorView(r.s, x.wp || []);
    return { known, again, imported: appts.map((a) => a.wp), appts };
  }, { cap: 'settings' });
  app.post('/api/v1/import/batch', (r) => r.run(importBatch, r.body), { cap: 'settings' });
  app.post('/api/v1/import/giftcard', (r) => r.run(importGiftcard, r.body), { cap: 'settings' });
  app.post('/api/v1/import/pack', (r) => r.run(importPack, r.body), { cap: 'settings' });

  // an old cancel or pay link: the post id alone finds nothing (ids are sequential), the booking's secret must match.
  // It only ever opens the appointment's own page, where the client decides.
  app.get('/api/public/legacy/:wpId', (r) => {
    guard('legacy|' + r.ip, 20, 3600000, 'Trop de tentatives. Appelle le salon.');
    const wp = /^\d{1,12}$/.test(r.params.wpId) ? String(Number(r.params.wpId)) : '';
    const u = String(r.query.get('u') || '').toLowerCase();
    const id = wp ? r.s.apptByWp.get(wp) : null;
    const a = id ? r.s.appts.get(id) : null;
    if (!a || !a.ext || !a.ext.uniq || !/^[a-z0-9]{1,64}$/.test(u) || !safeEqual(a.ext.uniq, sha256(u))) throw new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
    return { url: '/r/' + signLink(r.rt.secret, 'appt', a.code) };
  });
}
