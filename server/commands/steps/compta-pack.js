// @ts-check
// « Lui envoyer le pack chaque mois » (Réglages › Comptabilité, settings.compta.autoSend), a tick step: once last month
// is closed (CPT-01a, period.closed), its entries go to the accountant by e-mail: the import file in the FEC layout and
// its CSV copy, with the VAT of the month in the text. No file carries a client's name (domain/ledger.js).
// - once per month: the key is the month, so two ticks or two servers queue one mail;
// - only the month just ended, closed less than PACK_WINDOW_DAYS ago: switching the option on never sends old months;
// - never before the switch (projections/bascule.js cutoverHold), nor a month closed before it: the old site's months
//   are not this till's;
// - the files are built as the mail leaves (ATTACHERS), from the sealed month: they are not copied into the journal. A
//   file the check refuses fails the mail with its words, in Relances › Messages envoyés.
import { addDays, monthEnd, monthStart, MONTHS_FR } from '../../../shared/dates.js';
import { fmtEur } from '../../../shared/money.js';
import { isEmail } from '../../lib/util.js';
import { queueMessage, ATTACHERS } from '../../domain/messages.js';
import { ledger, vatReturn, fecText, csvText, checkFec } from '../../domain/ledger.js';
import { cutoverHold } from '../../projections/bascule.js';

export const PACK_TEMPLATE = 'compta_pack';
export const PACK_WINDOW_DAYS = 31;
export const packKey = (month) => 'pack_' + month;
const monthWords = (month) => MONTHS_FR[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);

/** The month's two files, from the state as it is now. Throws when the import file would be refused. */
export function packFiles(s, month, today) {
  const { entries } = ledger(s, { from: month + '-01', to: monthEnd(month + '-01'), today });
  const text = fecText(entries);
  const chk = checkFec(text);
  if (!chk.ok) throw new Error('Fichier d’écritures invalide : ' + chk.errors.join(' ; '));
  return [
    { name: 'ecritures-' + month + '.txt', type: 'text/plain; charset=utf-8', content: text },
    { name: 'ecritures-' + month + '.csv', type: 'text/csv; charset=utf-8', content: csvText(entries) }
  ];
}
// the mail's id ends with its month (msg_pack_2026-10)
ATTACHERS[PACK_TEMPLATE] = (m, rt) => packFiles(rt.engine.state, String(m.id).slice(-7), '9999-12-31');

/** The month to send now, or null: last month, closed after the switch and not long ago, not sent yet. */
export function packDue(s, ctx) {
  const C = s.settings.compta;
  if (!C || !C.autoSend || !C.accountant || !isEmail(C.accountant.email) || cutoverHold(s)) return null;
  const month = addDays(monthStart(ctx.local.day), -1).slice(0, 7);
  const p = s.periodByKey && s.periodByKey.get('M:' + month);
  if (!p || s.messages.has('msg_' + packKey(month))) return null;
  const switched = (s.bascule && s.bascule.switchedAt) || 0;
  if (p.at < switched || ctx.now - p.at > PACK_WINDOW_DAYS * 24 * 3600000) return null;
  return month;
}

/** @type {{ name: string, run: (s: any, ctx: import('../../core/engine.js').Ctx) => void }} */
export default {
  name: 'compta-pack',
  run(s, ctx) {
    const month = packDue(s, ctx);
    if (!month) return;
    const C = s.settings.compta, shop = s.settings.shop;
    const v = vatReturn(s, month, { today: ctx.local.day });
    const lines = [
      'Bonjour' + (C.accountant.name ? ' ' + C.accountant.name : '') + ',', '',
      'Voici les écritures de ' + monthWords(month) + ' pour ' + (shop.legalName || shop.name) + ' : le mois est clôturé, chaque jour a son Z.',
      '· ecritures-' + month + '.txt : le fichier d’import, au format des écritures comptables (FEC)',
      '· ecritures-' + month + '.csv : les mêmes écritures, pour un tableur', '',
      'TVA du mois (aide à la déclaration) :',
      ...v.rows.map((x) => '· ' + String(x.rate / 100).replace('.', ',') + ' % : base ' + fmtEur(x.base, { decimals: true }) + ', TVA ' + fmtEur(x.tax, { decimals: true })),
      '· Total TVA : ' + fmtEur(v.tax, { decimals: true }),
      '', 'Ce message part tout seul chaque mois depuis le logiciel de caisse du salon. Une question : réponds au gérant' + (shop.email ? ', ' + shop.email : '') + '.'
    ];
    queueMessage(s, ctx, {
      key: packKey(month), channel: 'email', template: PACK_TEMPLATE, to: C.accountant.email, vars: {},
      subject: 'Écritures de ' + monthWords(month) + ' · ' + shop.name, text: lines.join('\n')
    });
  }
};
