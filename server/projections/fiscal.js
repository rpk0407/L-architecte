// @ts-check
// Month and year closures, their signatures and the technical log (CPT-01a), as the projection folds them. Registered in
// core/extensions.js; the commands are in commands/fiscal.js and commands/steps/fiscal.js, the rules in domain/fiscal.js.
// Nothing here is personal data: closures hold totals and numbers, the log holds versions and public keys.
// No import of the engine or the state here (see core/extensions.js).
import { monthNo, yearNo, monthWords } from '../domain/fiscal.js';
import { fmtEur } from '../../shared/money.js';

/** The technical log kept in memory: the newest entries; techCount counts them all. */
const TECH_KEEP = 200;

/** @param {any} s @param {any} entry */
function logTech(s, entry) {
  s.tech.push(entry);
  if (s.tech.length > TECH_KEEP) s.tech.splice(0, s.tech.length - TECH_KEEP);
  s.techCount += 1;
}

/** @type {import('../core/extensions.js').Extension} */
export const fiscalExtension = {
  init(s) {
    s.periods = new Map(); s.periodByKey = new Map(); s.monthSeq = 0; s.yearSeq = 0;
    s.signatures = new Map(); s.signKey = null; s.signKeys = new Map();
    s.tech = []; s.techCount = 0; s.software = null; s.softwareSeen = new Set();
  },
  on: {
    'period.closed': (s, e, d) => {
      const month = d.kind === 'month';
      const ref = month ? monthNo(d.number) : yearNo(d.number);
      // sealed like a Z: the journal hash before the closure
      // the signature covers the emitted fields only (domain/fiscal.js PERIOD_FIELDS): a field added here stays out of it
      const rec = { ...d, ref, at: e.at, by: e.actor.id, seal: e.p };
      s.periods.set(ref, rec);
      // a fiscal year moved back and forth can end twice in one calendar year: the key keeps the first, the ref has both
      const key = (month ? 'M:' : 'Y:') + d.period;
      if (month || !s.periodByKey.has(key)) s.periodByKey.set(key, rec);
      if (month) s.monthSeq = Math.max(s.monthSeq, d.number); else s.yearSeq = Math.max(s.yearSeq, d.number);
    },
    // the first signature of a closure stands; the step never writes a second one
    'seal.signed': (s, e, d) => {
      if (s.signatures.has(d.ref)) return;
      s.signatures.set(d.ref, { kind: d.kind, of: d.of, sig: d.sig, kid: d.kid, digest: d.digest, late: !!d.late, at: e.at });
      // the key in use is the one that signed last: a key already logged comes back without a second log entry
      if (s.signKeys.has(d.kid)) s.signKey = s.signKeys.get(d.kid);
    },
    'tech.logged': (s, e, d) => {
      logTech(s, { kind: d.kind, at: e.at, v: e.v, ...(d.kind === 'key' ? { kid: d.kid, source: d.source, backlog: (d.backlog || []).length } : {}), ...(d.kind === 'version' ? { from: d.from ?? null, to: d.to } : {}), ...(d.kind !== 'key' && d.kind !== 'version' ? { data: d } : {}) });
      if (d.kind === 'key') {
        // backlog: the closures older than the window when this key FIRST appeared, the only ones it may ever sign late.
        // Fixed then: a second entry for a known key (an older journal, a forged tail) never re-arms it.
        if (!s.signKeys.has(d.kid)) s.signKeys.set(d.kid, { kid: d.kid, publicKey: d.publicKey, source: d.source, at: e.at, backlog: new Set(d.backlog || []) });
        s.signKey = s.signKeys.get(d.kid);
      }
      if (d.kind === 'version') { s.software = d.to; s.softwareSeen.add(d.to); }
    },
    // a restore is part of the software's history: shown in the same log
    'shop.restored': (s, e, d) => { logTech(s, { kind: 'restore', at: e.at, v: e.v, from: d.from || '', count: d.count || 0 }); }
  },
  feed: ['period.closed'],
  // « Octobre clôturé · M0010 », for whoever closes or reads the salon's figures (as the Z)
  item(r, f) {
    if (!r.caps.has('closure') && !r.caps.has('report.shop')) return null;
    const d = f.data || {};
    const month = d.kind === 'month';
    const ref = month ? monthNo(d.number) : yearNo(d.number);
    const name = month ? monthWords(d.period) : 'Exercice ' + d.period;
    const net = d.totals ? d.totals.netTtc : 0;
    return { v: f.v, at: f.at, by: f.actor.t, kind: 'closure', title: name[0].toUpperCase() + name.slice(1) + ' clôturé · ' + ref, sub: fmtEur(net) + ' · ' + (month ? ((d.tickets && d.tickets.count) || 0) + ' tickets' : ((d.months && d.months.count) || 0) + ' mois'), money: true };
  }
};
