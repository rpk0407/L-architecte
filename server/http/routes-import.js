// @ts-check
// Taking over the old WordPress salon: the owner's import (Réglages › Reprendre WordPress), the single takeovers of a
// paper gift card or a running subscription, and the old e-mail links that land on /ancien-lien.
import { HttpError, failureGuard } from './kit.js';
import { signLink } from '../auth/session.js';
import { str, int, day, opt, obj, arr, parse } from '../lib/validate.js';
import { safeEqual, sha256 } from '../lib/util.js';
import { importBatch, importGiftcard, importPack, knownClient, priorView, rowTomb, inWindow, busyView, haveView, startImportRun, finishImportRun, runSummary, runLines } from '../commands/import.js';
import { tombKeyOf } from '../commands/clients.js';

export const previewSchema = obj({
  // a cell that is too long is cut, not refused: it must not lock the page (the batch cuts the same way)
  keys: opt(arr(obj({ phone: opt(str({ max: 32, cut: true })), prefix: opt(str({ max: 6, cut: true })), email: opt(str({ max: 160, cut: true })), wpUser: opt(int({ min: 1, max: 999999999999 })) }), { max: 500 })),
  wp: opt(arr(int({ min: 1, max: 999999999999 }), { max: 5000 })),
  // the periods an export covers → the bookings still to come in them; the days whose agenda the double-booking check reads
  window: opt(arr(obj({ from: day(), to: day() }), { max: 12 })),
  busy: opt(arr(day(), { max: 120 })),
  // the cards and carnets of the files: which are already here (a second drop of the same file is not work)
  gift: opt(arr(str({ max: 40, cut: true }), { max: 500 })),
  packs: opt(arr(obj({ phone: opt(str({ max: 32, cut: true })), prefix: opt(str({ max: 6, cut: true })) }), { max: 500 }))
});

export function importRoutes(app) {
  // read only: which of these people already have a file (known: the salon's, again: an earlier run's; erased: their
  // file was erased at, rows from before are skipped), and where the bookings an earlier run brought in stand now,
  // so the preview can tell what a delta run will change
  app.post('/api/v1/import/preview', (r) => {
    const x = parse(previewSchema, r.body);
    const key = tombKeyOf(r.rt.secret);
    const known = [], again = [], erased = [];
    (x.keys || []).forEach((k, i) => { const w = knownClient(r.s, k, key); if (w === 'salon') known.push(i); else if (w === 'wordpress') again.push(i); else if (w === 'erased') erased.push({ i, at: rowTomb(r.s, k, key).at }); });
    const appts = priorView(r.s, x.wp || []);
    return { known, again, erased, imported: appts.map((a) => a.wp), appts, ...(x.window ? { inWindow: inWindow(r.s, x.window, r.local.day) } : {}), ...(x.busy ? { busy: busyView(r.s, x.busy) } : {}), ...(x.gift || x.packs ? (({ cards, carnets }) => ({ haveCards: cards, haveCarnets: carnets }))(haveView(r.s, x.gift, x.packs)) : {}) };
  }, { cap: 'settings' });
  // a run's record (projections/imports.js): the last 20, and one with its lines (names rebuilt from the files, never stored)
  app.post('/api/v1/import/runs', (r) => r.run(startImportRun, r.body), { cap: 'settings' });
  app.post('/api/v1/import/runs/:id/finish', (r) => r.run(finishImportRun, { id: r.params.id }), { cap: 'settings' });
  app.get('/api/v1/import/runs', (r) => ({ runs: r.s.imports.order.slice(-20).reverse().map((id) => runSummary(r.s, r.s.imports.runs.get(id))) }), { cap: 'settings' });
  app.get('/api/v1/import/runs/:id', (r) => {
    const run = r.s.imports.runs.get(r.params.id);
    if (!run) throw new HttpError(404, 'not_found', 'Cette reprise n’existe pas.');
    return { run: runSummary(r.s, run), lines: runLines(r.s, run) };
  }, { cap: 'settings' });
  // the key of the erased files' tombstones (commands/clients.js): an erased client stays out
  app.post('/api/v1/import/batch', (r) => { r.meta.tombKey = tombKeyOf(r.rt.secret); return r.run(importBatch, r.body); }, { cap: 'settings' });
  app.post('/api/v1/import/giftcard', (r) => r.run(importGiftcard, r.body), { cap: 'settings' });
  app.post('/api/v1/import/pack', (r) => r.run(importPack, r.body), { cap: 'settings' });

  // an old cancel or pay link: the post id alone finds nothing (ids are sequential), the booking's secret must match.
  // It only ever opens the appointment's own page, where the client decides.
  app.get('/api/public/legacy/:wpId', (r) => {
    // only the wrong guesses count: the secret is the lock, and clients on one carrier address all click right on the day of the switch
    const tries = failureGuard('legacy|' + r.ip, 20, 3600000, 'Trop de tentatives. Appelle le salon.');
    const wp = /^\d{1,12}$/.test(r.params.wpId) ? String(Number(r.params.wpId)) : '';
    const u = String(r.query.get('u') || '').toLowerCase();
    const id = wp ? r.s.apptByWp.get(wp) : null;
    const a = id ? r.s.appts.get(id) : null;
    if (!a || !a.ext || !a.ext.uniq || !/^[a-z0-9]{1,64}$/.test(u) || !safeEqual(a.ext.uniq, sha256(u))) { tries.fail(); throw new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.'); }
    tries.done();
    return { url: '/r/' + signLink(r.rt.secret, 'appt', a.code) };
  });
}
