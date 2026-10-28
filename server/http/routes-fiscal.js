// @ts-check
// Month and year closures over HTTP (CPT-01a): the list Caisse › Clôture shows under the Z, one record to print, closing a
// month before the tick does, and the technical log. The rules are in domain/fiscal.js, the command in commands/fiscal.js.
import { HttpError } from './kit.js';
import { closePeriod } from '../commands/fiscal.js';
import { closableMonth, monthWords, signatureState, isMonth } from '../domain/fiscal.js';
import { missedZ } from '../domain/cash.js';

const SIGN_FR = { signed: '✓ signée', late: 'signée en retard', pending: 'signature en cours', unsigned: 'non signée' };
const TECH_FR = { key: 'Clé de signature', version: 'Version du logiciel', restore: 'Salon restauré', archive: 'Archive', export: 'Export' };
const SOURCE_FR = { env: 'hors des données', store: 'gardée avec les données', demo: 'démo' };

/** The name of whoever closed it: a person, or the tick. */
const byName = (s, id) => (s.staff.get(id) || {}).name || 'Automatique';

/** One month or year as the list shows it. Its counts are ticketCount / monthCount: the record's tickets and months are spans. */
function row(r, p) {
  const s = r.s;
  const state = signatureState(s, p.ref, r.now);
  return {
    ref: p.ref, kind: p.kind, period: p.period, number: p.number, from: p.from, to: p.to, at: p.at, by: byName(s, p.by),
    net: p.totals.netTtc, gross: p.totals.grossTtc, ticketCount: p.tickets ? p.tickets.count : null, monthCount: p.months ? p.months.count : null,
    signature: state, signatureLabel: SIGN_FR[state]
  };
}
/** The key in use, as both lists show it. */
const keyOf = (s) => (s.signKey ? { kid: s.signKey.kid, source: s.signKey.source, sourceLabel: SOURCE_FR[s.signKey.source] || s.signKey.source } : null);

/** @param {any} app */
export function fiscalRoutes(app) {
  app.get('/api/v1/periods', (r) => {
    const s = r.s;
    const today = r.local.day;
    // newest first; a year above the month that ends it
    const items = [...s.periods.values()].sort((a, b) => b.to.localeCompare(a.to) || (a.kind === b.kind ? b.number - a.number : a.kind === 'year' ? -1 : 1)).map((p) => row(r, p));
    // the month the tick would close: offered at once, or what it waits for
    const c = closableMonth(s, today);
    const waiting = c && c.waiting ? { day: c.waiting, uncounted: missedZ(s, today).uncounted.includes(c.waiting) } : null;
    return {
      items,
      closable: c ? { month: c.month, label: monthWords(c.month, today), waiting } : null,
      key: keyOf(s)
    };
  }, { cap: 'closure' });

  app.get('/api/v1/periods/:ref', (r) => {
    const p = r.s.periods.get(r.params.ref);
    if (!p) throw new HttpError(404, 'not_found', 'Clôture introuvable.');
    const sg = r.s.signatures.get(p.ref);
    // the record last: its tickets, z, credits and months are the { count, first, last } the report prints
    return { ...row(r, p), ...p, by: byName(r.s, p.by), signedAt: sg ? sg.at : null, kid: sg ? sg.kid : null };
  }, { cap: 'closure' });

  app.post('/api/v1/periods/close', (r) => {
    const month = r.body && r.body.month;
    if (!isMonth(month)) throw new HttpError(400, 'invalid', 'Mois invalide (AAAA-MM attendu).');
    return r.run(closePeriod, { month });
  }, { cap: 'closure' });

  // the technical log (JET): signing keys, software versions, restores; newest first. `keys` carries each public key, so
  // an auditor or the accountant can check a signature without the Comptoir (they are public)
  app.get('/api/v1/fiscal/log', (r) => {
    const s = r.s;
    const limit = Math.max(1, Math.min(200, Number(r.query.get('limit')) || 50));
    const items = s.tech.slice(-limit).reverse().map((x) => ({ ...x, label: TECH_FR[x.kind] || x.kind }));
    const keys = [...s.signKeys.values()].map((k) => ({ kid: k.kid, publicKey: k.publicKey, source: k.source, sourceLabel: SOURCE_FR[k.source] || k.source, at: k.at, backlog: k.backlog.size }));
    return { items, count: s.techCount, software: s.software, key: keyOf(s), keys };
  }, { cap: 'audit' });
}
