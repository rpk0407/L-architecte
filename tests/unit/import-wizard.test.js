// The wizard's small machines, run as is in Node: sending again after a lost connection (same request id, never a 4xx),
// the sentence for a row the server refuses, the two models of the hand-typed CSVs, the run that stopped (« pas encore traités »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, withRetry } from '../../web/src/lib/api.ts';
import * as W from '../../web/src/lib/wpimport.ts';

test('a request lost to the network is sent again after 1, 2, 4, 8 s, with the same id; a refusal is never sent again', async () => {
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); };
  const ids = [];
  const call = (id, fails) => { let n = 0; return () => { ids.push(id); if (n++ < fails.length) throw fails[n - 1]; return Promise.resolve('ok'); }; };
  const net = new ApiError(0, 'network', 'Pas de connexion. Vérifie le Wi-Fi puis réessaie.');
  assert.equal(await withRetry(call('wp-1', [net, net]), { sleep }), 'ok');
  assert.deepEqual(waits, [1000, 2000]);
  assert.deepEqual(ids, ['wp-1', 'wp-1', 'wp-1'], 'the caller passes its one request id each time');
  // 502, 503 and 504 too
  waits.length = 0;
  assert.equal(await withRetry(call('x', [new ApiError(502, 'bad', 'x'), new ApiError(503, 'bad', 'x'), new ApiError(504, 'bad', 'x')]), { sleep }), 'ok');
  assert.deepEqual(waits, [1000, 2000, 4000]);
  // a 400, a 409, a 500: at once, once
  for (const st of [400, 404, 409, 429, 500]) {
    let n = 0;
    await assert.rejects(withRetry(() => { n++; throw new ApiError(st, 'x', 'no'); }, { sleep }), (e) => e.status === st);
    assert.equal(n, 1, 'status ' + st + ' is not retried');
  }
  // it gives up after four waits, with the last error
  waits.length = 0;
  let n = 0;
  await assert.rejects(withRetry(() => { n++; throw net; }, { sleep }), (e) => e === net);
  assert.deepEqual([n, waits], [5, [1000, 2000, 4000, 8000]]);
  // something that is no ApiError is not a network blip
  await assert.rejects(withRetry(() => { throw new TypeError('bug'); }, { sleep }), TypeError);
});

test('a refused row says which booking, card or carnet, and what was wrong — never the path of the field', () => {
  const body = { appts: [{ wp: 18917 }, { wp: 18918 }], giftcards: [{ code: 'CARTE-0042-AB' }], clients: [{}], packs: [{}] };
  assert.equal(W.refusalWords('appts[1].createdAt : entre 0 et 8640000000000000', body), 'Réservation n° 18918 : date de création illisible');
  assert.equal(W.refusalWords('appts[0].start : entre 0 et 1439', body), 'Réservation n° 18917 : heure illisible');
  assert.equal(W.refusalWords('giftcards[0].amount : entre 0 et 100000', body), 'Carte •••• 42AB : montant illisible');
  assert.equal(W.refusalWords('clients[0].email : 160 caractères maximum', body), 'Fiche client n° 1 du paquet : e-mail illisible');
  assert.equal(W.refusalWords('packs[0].left : entre 1 et 50', body), 'Carnet n° 1 du paquet : nombre de coupes illisible');
  assert.equal(W.refusalWords('Cette reprise est terminée', body), null);
});

test('the models of the two small CSVs are read back as one example line each', () => {
  for (const [kind, key] of [['giftcards', 'giftcards'], ['packs', 'packs']]) {
    const t = W.TEMPLATES[key];
    assert.ok(t.text.startsWith('﻿') && t.text.includes(';') && /\r\n/.test(t.text), kind + ': BOM, semicolon, one line each');
    const p = W.readFiles([{ name: t.name, text: t.text }], '2026-10-27');
    assert.deepEqual([p.files[0].kind, p.files[0].rows, p.problems.length], [kind, 1, 0]);
  }
});

test('a run that stopped has not reached everything yet: « pas encore traités », not a gap', () => {
  const run = { totals: { bookings: 20, clients: 10, giftcards: 0, packs: 0 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 0, by: {} }, counts: { clients: { added: 3 }, appts: { done: 5 } }, skip: {}, finishedAt: null };
  const rep = W.reconcile(run);
  const b = rep.find((x) => x.type === 'bookings'), c = rep.find((x) => x.type === 'clients');
  assert.deepEqual([b.made, b.pending, b.gap], [5, 15, 0]);
  assert.deepEqual([c.made, c.pending, c.skipped, c.gap], [3, 7, 0, 0]);
  // the same numbers on a run said to be over are a gap
  const done = W.reconcile({ ...run, finishedAt: 1 });
  assert.equal(done.find((x) => x.type === 'bookings').gap, 15);
  assert.equal(done.find((x) => x.type === 'bookings').pending, 0);
});
