import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vatSplit, ticketTotals, fmtEur, parseEur } from '../../shared/money.js';

test('VAT is extracted from TTC prices', () => {
  assert.deepEqual(vatSplit(2000, 2000), { base: 1667, tax: 333 });
  assert.deepEqual(vatSplit(2500, 2000), { base: 2083, tax: 417 });
  assert.deepEqual(vatSplit(1000, 0), { base: 1000, tax: 0 });
});

test('a ticket-level discount is spread over lines pro rata', () => {
  const t = ticketTotals([
    { kind: 'service', name: 'Coupe', qty: 1, unit: 3000, vat: 2000 },
    { kind: 'product', name: 'Huile', qty: 1, unit: 1000, vat: 2000 }
  ], 400);
  assert.deepEqual(t.nets, [2700, 900]);
  assert.equal(t.total, 3600);
  assert.equal(t.revenue, 3600);
  assert.equal(t.vat[0].base + t.vat[0].tax, 3600);
});

test('gift cards sold are not revenue and carry no VAT', () => {
  const t = ticketTotals([
    { kind: 'service', name: 'Coupe', qty: 1, unit: 2000, vat: 2000 },
    { kind: 'giftcard', name: 'Carte', qty: 1, unit: 5000, vat: 0 }
  ], 1000, 200);
  assert.equal(t.revenue, 1000, 'the discount never touches the gift card');
  assert.equal(t.liability, 5000);
  assert.equal(t.tip, 200);
  assert.equal(t.due, 6200);
});

test('a discount cannot exceed what can be discounted', () => {
  const t = ticketTotals([{ kind: 'service', name: 'Coupe', qty: 1, unit: 2000, vat: 2000 }], 99999);
  assert.equal(t.total, 0);
  assert.equal(t.discount, 2000);
});

test('amounts read and print the French way', () => {
  assert.equal(fmtEur(2000), '20 €');
  assert.equal(fmtEur(2050), '20,50 €');
  assert.equal(fmtEur(124050), '1 240,50 €');
  assert.equal(parseEur('20,5'), 2050);
  assert.equal(parseEur('abc'), null);
});
