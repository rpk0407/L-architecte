// @ts-check
// The accountant's files over HTTP (CPT-03): a month's entries in the FEC layout (an import file for the accountant's
// software, never named <SIREN>FEC<date>.txt: the legal FEC is that software's own output), the same as CSV, the VAT
// of the month, and the month-end balances. Owner and managers (cap `compta`). No file here carries a client's name.
// The rules are in domain/ledger.js and domain/balances.js.
import { HttpError } from './kit.js';
import { ledger, vatReturn, fecText, csvText, checkFec, openDays, openWords, VAT_LABEL, REVERSE_LABEL } from '../domain/ledger.js';
import { giftcardRoll, packsAt, depositsHeld, stripeBalance } from '../domain/balances.js';
import { isMonth } from '../domain/fiscal.js';
import { csv } from '../lib/csv.js';
import { isDay, monthStart, monthEnd } from '../../shared/dates.js';

const eu = (c) => (c / 100).toFixed(2).replace('.', ',');
const pct = (rate) => String(rate / 100).replace('.', ',') + ' %';

/** The month asked, or 400. */
function monthOf(r) {
  const m = r.query.get('month') || '';
  if (!isMonth(m)) throw new HttpError(400, 'invalid', 'Mois attendu au format AAAA-MM.');
  return m;
}
/** « définitif » once the month closure (CPT-01a) is sealed, « provisoire » before. */
const periodOf = (s, month) => (s.periodByKey && s.periodByKey.has('M:' + month) ? 'definitif' : 'provisoire');

function file(body, name, type, period) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-lx-period': period }
  });
}

/** @param {any} app */
export function comptaRoutes(app) {
  app.get('/api/v1/compta/entries', (r) => {
    const month = monthOf(r);
    const format = r.query.get('format') || 'fec';
    if (format !== 'fec' && format !== 'csv') throw new HttpError(400, 'invalid', 'Format attendu : fec ou csv.');
    const provisional = r.query.get('provisional') === '1';
    if (provisional && format === 'fec') throw new HttpError(400, 'invalid', 'Le fichier d’import attend que chaque jour ait son Z : prends le CSV provisoire.');
    const open = openDays(r.s, month, r.local.day);
    if (open.length && !provisional) throw new HttpError(409, 'open', openWords(open[0]) + '.', { days: open });
    const { entries } = ledger(r.s, { from: month + '-01', to: monthEnd(month + '-01'), today: r.local.day, provisional });
    const period = open.length ? 'provisoire' : periodOf(r.s, month);
    if (format === 'csv') return file(csvText(entries), 'ecritures-' + month + (provisional && open.length ? '-provisoire' : '') + '.csv', 'text/csv; charset=utf-8', period);
    const text = fecText(entries);
    // never served broken: the accountant's software would refuse it, or worse, take it
    const chk = checkFec(text);
    if (!chk.ok) throw new HttpError(500, 'fec_invalid', 'Fichier d’écritures invalide : ' + chk.errors.join(' ; '), { errors: chk.errors });
    return file(text, 'ecritures-' + month + '.txt', 'text/plain; charset=utf-8', period);
  }, { cap: 'compta' });

  app.get('/api/v1/compta/vat', (r) => {
    const month = monthOf(r);
    const v = vatReturn(r.s, month, { today: r.local.day });
    const open = openDays(r.s, month, r.local.day);
    const period = open.length ? 'provisoire' : periodOf(r.s, month);
    if (r.query.get('csv') === '1') {
      const rows = [[VAT_LABEL], ['Mois', month, period === 'definitif' ? 'définitif' : 'provisoire'], ['Taux', 'Base HT', 'TVA']];
      for (const x of v.rows) rows.push([pct(x.rate), eu(x.base), eu(x.tax)]);
      rows.push(['Total', '', eu(v.tax)]);
      rows.push(['dont acomptes encaissés moins utilisés', eu(v.adjustments.deposits.base), eu(v.adjustments.deposits.tax)]);
      rows.push([REVERSE_LABEL + ' (autoliquidation)', eu(v.autoliquidation.base), eu(v.autoliquidation.tax)]);
      rows.push([]);
      rows.push(['TVA des tickets (Z) pour comparaison', '', '']);
      for (const x of v.ticketsVat) rows.push([pct(x.rate), eu(x.base), eu(x.tax)]);
      for (const w of v.warnings) rows.push(['À vérifier', w]);
      return file(csv(rows), 'tva-' + month + '.csv', 'text/csv; charset=utf-8', period);
    }
    return { ...v, period, open };
  }, { cap: 'compta' });

  app.get('/api/v1/compta/balances', (r) => {
    const q = r.query.get('day') || '';
    if (q && !isDay(q)) throw new HttpError(400, 'invalid', 'Jour attendu au format AAAA-MM-JJ.');
    const day = q && q < r.local.day ? q : r.local.day;
    return {
      day,
      giftcards: giftcardRoll(r.s, monthStart(day), day),
      packs: packsAt(r.s, day),
      deposits: depositsHeld(r.s, day),
      stripe: stripeBalance(r.s, day, { today: r.local.day })
    };
  }, { cap: 'compta' });
}
