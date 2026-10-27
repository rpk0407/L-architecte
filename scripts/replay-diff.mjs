#!/usr/bin/env node
// Replays a copy of a journal into a fresh projection with the code of this checkout, and prints the figures a code
// change must never move: the Z and their grand total (sealed and recomputed), the month and year closures, gift card and
// carnet balances, deposits held, client and file counts, and, when the code has them, members and loyalty. Run it on the
// same journal with the base and with the merged tip of a wave, and diff the two outputs: any difference is drift.
//
//   node scripts/replay-diff.mjs <journal> [--json] [--compare <earlier output.json>]
//
// <journal>: one event per line (the file store, LX_DATA_FILE), or the JSON of Réglages › Données › Exporter le journal
// ({ events: [...] }), or a JSON array of events. --json prints one compact line instead of indented JSON. --compare reads
// an earlier output and lists the paths that differ (exit 1 when any does). Prints figures only, never personal data.
import { readFileSync } from 'node:fs';
import { emptyState, evolve } from '../server/core/state.js';
import { verifyChain } from '../server/core/journal.js';
import { closureNo, dayTotals, zFigures } from '../server/domain/cash.js';
import { canonical, sha256 } from '../server/lib/util.js';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--compare');
const compact = args.includes('--json');
const against = args.includes('--compare') ? args[args.indexOf('--compare') + 1] : null;
if (!file) {
  console.error('usage: node scripts/replay-diff.mjs <journal.jsonl|export.json> [--json] [--compare <output.json>]');
  process.exit(2);
}

/** The events of a journal copy, in whichever of the three forms it comes. */
function readJournal(text) {
  const t = text.trim();
  if (t.startsWith('[')) return JSON.parse(t);
  if (t.startsWith('{')) {
    try { const o = JSON.parse(t); if (Array.isArray(o.events)) return o.events; } catch { /* JSON lines */ }
  }
  return t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** A short fingerprint of a list of rows: equal lists, equal digests. */
const digest = (rows) => sha256(canonical(rows)).slice(0, 16);
const sum = (xs) => xs.reduce((t, x) => t + (x || 0), 0);

/** The key figures of a state, deterministic for a given journal and code (no clock). */
function figures(s, events) {
  const chain = verifyChain(events);
  const zs = [...s.closures.values()].sort((a, b) => a.number - b.number);
  // a sealed Z recomputed from the tickets and credit notes of its day with this code: they must still agree
  const recomputed = zs.filter((z) => dayTotals(s, z.day).net !== z.net).map((z) => closureNo(z.number));
  const cards = [...s.giftcards.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const packs = [...s.packs.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const held = [...s.appts.values()].filter((a) => a.deposit && a.deposit.paid && !a.saleId && (!a.deposit.paymentId || (s.payments.get(a.deposit.paymentId) || {}).status === 'paid'));
  const clients = [...s.clients.values()];
  const out = {
    journal: { events: events.length, head: s.head, chain: chain.ok ? 'ok' : 'broken at ' + chain.brokenAt },
    z: {
      count: zs.length, last: zs.length ? closureNo(zs[zs.length - 1].number) : null, grandTotal: s.grandTotal,
      net: sum(zs.map((z) => z.net)), gross: sum(zs.map((z) => z.revenue)), refunds: sum(zs.map((z) => z.refunded)), tips: sum(zs.map((z) => z.tips)),
      vat: sum(zs.map((z) => sum((z.vat || []).map((v) => v.tax)))), takings: sum(zs.map((z) => zFigures(z).takings)),
      recomputedMismatch: recomputed,
      digest: digest(zs.map((z) => [z.number, z.day, z.net, z.grandTotal, zFigures(z).paymentsNet]))
    },
    sales: { count: s.sales.size, lastNumber: s.saleSeq, revenue: sum([...s.sales.values()].map((x) => x.totals.revenue)) },
    refunds: { count: s.refunds.size, lastNumber: s.refundSeq, amount: sum([...s.refunds.values()].map((r) => r.amount)) },
    giftcards: { count: cards.length, balance: sum(cards.filter((g) => g.status === 'active').map((g) => g.balance)), digest: digest(cards.map((g) => [g.id, g.status, g.balance])) },
    carnets: { count: packs.length, left: sum(packs.map((k) => k.total - k.used)), digest: digest(packs.map((k) => [k.id, k.total, k.used])) },
    deposits: { held: held.length, amount: sum(held.map((a) => a.deposit.paid)) },
    clients: { files: clients.length, active: clients.filter((c) => !c.erased && !c.mergedInto).length, erased: clients.filter((c) => c.erased).length, merged: clients.filter((c) => c.mergedInto).length },
    files: { appts: s.appts.size, messages: s.messages.size, staff: s.staff.size, services: s.services.size, products: s.products.size, payments: s.payments.size }
  };
  // what a wave adds is printed only once the journal has some of it: the same old journal then reads the same with the
  // code from before that wave and with the code after it (an empty area is no drift)
  /** @type {Record<string, any>} */
  const more = {};
  if (s.periods && s.periods.size) more.periods = [...s.periods.values()].sort((a, b) => (a.ref < b.ref ? -1 : 1)).map((p) => ({ ref: p.ref, period: p.period, net: p.totals.netTtc, gross: p.totals.grossTtc, perpetual: p.perpetual }));
  if (s.signatures && s.signatures.size) more.signatures = { count: s.signatures.size, late: [...s.signatures.values()].filter((x) => x.late).length };
  // members and loyalty (later waves), whatever their shape: a count and a fingerprint
  for (const key of Object.keys(s).sort()) {
    if (!/^(member|loyalty)/i.test(key)) continue;
    const v = s[key];
    const rows = v instanceof Map ? [...v.entries()] : Array.isArray(v) ? v : v && typeof v === 'object' ? Object.entries(v) : [v];
    if (rows.length) more[key] = { count: rows.length, digest: digest(rows.map((r) => (r instanceof Set ? [...r] : r))) };
  }
  const active = s.memberships instanceof Map ? [...s.memberships.values()].filter((m) => m && m.status === 'active') : [];
  if (active.length) more.mrr = sum(active.map((m) => m.price || m.amount || 0));
  return { ...out, ...more };
}

/** The paths where two outputs differ. */
function differences(a, b, path = '') {
  if (canonical(a) === canonical(b)) return [];
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [path || '(root)'];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => differences(a[k], b[k], path ? path + '.' + k : k));
}

const events = readJournal(readFileSync(file, 'utf8'));
const s = emptyState();
for (const e of events) evolve(s, e);
const out = figures(s, events);
if (against) {
  const diff = differences(JSON.parse(readFileSync(against, 'utf8')), JSON.parse(JSON.stringify(out)));
  if (diff.length) { console.log('drift: ' + diff.join(', ')); process.exit(1); }
  console.log('no drift (' + events.length + ' events)');
} else console.log(compact ? JSON.stringify(out) : JSON.stringify(out, null, 2));
