// @ts-check
// The salon's chart of accounts (CPT-03): each role the books post to, its default number in the French plan comptable
// and its label. One copy for the server (settings/compta.js, domain/ledger.js) and Réglages › Comptabilité, so the
// screen lists exactly what the files use. The owner may change a number (his accountant's chart), never a role.
// The roles marked soon are read by the cash book (CPT-04): bank deposits, expenses, withdrawals, a partner's account.

/** alias: posts by default to another role's account, whose label the files then use (accountLabel); soon: read by the
 *  cash book (CPT-04) only, so Réglages lists it once that exists
 *  @typedef {{ role: string, account: string, label: string, group: string, alias?: boolean, soon?: boolean }} AccountRole */

/** @type {AccountRole[]} */
export const ACCOUNT_ROLES = [
  { role: 'revenue.service', account: '706000', label: 'Prestations de services', group: 'Ventes' },
  { role: 'revenue.pack', account: '706200', label: 'Carnets de coupes', group: 'Ventes' },
  { role: 'revenue.membership', account: '706100', label: 'Abonnements', group: 'Ventes' },
  { role: 'revenue.fee', account: '706300', label: 'Frais d’annulation', group: 'Ventes' },
  { role: 'revenue.product', account: '707000', label: 'Ventes de marchandises', group: 'Ventes' },
  { role: 'vat.2000', account: '445710', label: 'TVA collectée 20 %', group: 'TVA' },
  { role: 'vat.1000', account: '445712', label: 'TVA collectée 10 %', group: 'TVA' },
  { role: 'vat.550', account: '445713', label: 'TVA collectée 5,5 %', group: 'TVA' },
  { role: 'vat.210', account: '445714', label: 'TVA collectée 2,1 %', group: 'TVA' },
  { role: 'vat.intracomDeductible', account: '445662', label: 'TVA déductible intracommunautaire', group: 'TVA' },
  { role: 'vat.intracomDue', account: '445200', label: 'TVA due intracommunautaire', group: 'TVA' },
  { role: 'vatDeductible', account: '445660', label: 'TVA déductible', group: 'TVA', soon: true },
  { role: 'method.card', account: '511500', label: 'Cartes bancaires à encaisser', group: 'Encaissements' },
  { role: 'method.cash', account: '530000', label: 'Caisse', group: 'Encaissements' },
  { role: 'method.online', account: '467100', label: 'Stripe', group: 'Encaissements' },
  { role: 'method.ancien', account: '419100', label: 'Payé sur l’ancien site', group: 'Encaissements', alias: true },
  { role: 'giftcards', account: '419110', label: 'Clients – cartes cadeaux', group: 'Clients et dettes' },
  { role: 'deposits', account: '419100', label: 'Clients – acomptes reçus', group: 'Clients et dettes' },
  { role: 'tips', account: '467200', label: 'Pourboires à reverser', group: 'Clients et dettes' },
  { role: 'bank', account: '512000', label: 'Banque', group: 'Banque et frais' },
  { role: 'fees', account: '627800', label: 'Frais de paiement', group: 'Banque et frais' },
  { role: 'disputes', account: '658000', label: 'Charges diverses de gestion', group: 'Banque et frais' },
  { role: 'breakage', account: '758000', label: 'Produits divers de gestion', group: 'Banque et frais' },
  { role: 'waiting', account: '471000', label: 'Compte d’attente', group: 'Banque et frais' },
  { role: 'transfer', account: '580000', label: 'Virements internes', group: 'Caisse et exploitant', soon: true },
  { role: 'owner', account: '108000', label: 'Compte de l’exploitant', group: 'Caisse et exploitant', soon: true },
  { role: 'partner', account: '455000', label: 'Associés – comptes courants', group: 'Caisse et exploitant', soon: true },
  { role: 'cashShort', account: '658000', label: 'Écart de caisse (manque)', group: 'Caisse et exploitant', alias: true, soon: true },
  { role: 'cashOver', account: '758000', label: 'Écart de caisse (excédent)', group: 'Caisse et exploitant', alias: true, soon: true }
];

/** role → default number */
export const DEFAULT_ACCOUNTS = /** @type {Record<string, string>} */ (Object.fromEntries(ACCOUNT_ROLES.map((x) => [x.role, x.account])));

/** What an account number accepts: 3 to 10 digits. */
export const ACCOUNT_PATTERN = /^\d{3,10}$/;
