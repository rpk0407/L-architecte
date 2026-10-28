// What Réglages › Comptabilité says about itself (CPT-03): the VAT choices, the chart of accounts, the accountant, and the
// month's files for him (the files also for a manager, cap `compta`). Data only; the parts carry the data-guide ids below (reglages/sections/Compta.tsx).
import type { GuideStep } from '../../../lib/guide';

const page = '/comptoir/reglages/compta';
const steps: GuideStep[] = [
  { id: 'compta.vat', page, target: 'compta.vat', roles: ['owner'], order: 10, title: 'TVA', body: 'Choisis ton régime et quand la TVA des prestations est due, avec ton comptable. Les fichiers du mois suivent ces choix.' },
  { id: 'compta.giftcards', page, target: 'compta.giftcards', roles: ['owner'], order: 20, title: 'Cartes cadeaux', body: 'Une carte vendue n’est pas encore du chiffre : sa TVA est due quand elle sert, comme sur tes tickets. Ton comptable confirme ce choix une fois.' },
  { id: 'compta.accounts', page, target: 'compta.accounts', roles: ['owner'], order: 30, title: 'Plan de comptes', body: 'Le numéro de compte de chaque ligne des fichiers : ventes, TVA, encaissements, Stripe. Garde ceux par défaut ou recopie ceux de ton comptable.' },
  { id: 'compta.accountant', page, target: 'compta.accountant', roles: ['owner'], order: 40, title: 'Ton comptable', body: 'Son nom et son e-mail, pour lui envoyer le pack du mois. Ses coordonnées restent hors du journal scellé.' },
  { id: 'compta.exports', page, target: 'compta.exports', roles: ['owner', 'manager'], order: 50, title: 'Pour ton comptable', body: 'Choisis un mois clôturé et télécharge ses écritures : le fichier d’import pour son logiciel, ou la version Excel. Tant qu’un jour n’a pas son Z, seule la version provisoire est possible.' },
  { id: 'compta.vatdue', page, target: 'compta.vatdue', roles: ['owner', 'manager'], order: 60, title: 'TVA à déclarer', body: 'La TVA du mois par taux, acomptes et frais Stripe compris : une aide pour ta CA3. Ton comptable la valide avant de déclarer.' },
  { id: 'compta.balances', page, target: 'compta.balances', roles: ['owner', 'manager'], order: 70, title: 'Soldes de fin de mois', body: 'Ce que tu dois encore à tes clients (cartes cadeaux, carnets, acomptes) et l’argent en ligne pas encore viré. Ton comptable te les demandera à la clôture.' }
];
export default steps;
