// @ts-check
// Who may do what. Checked on the server for every request; the Comptoir only hides what you cannot use.

export const ROLES = {
  owner: 'Gérant',
  manager: 'Responsable',
  desk: 'Accueil',
  barber: 'Barbier'
};

/** Every capability, with the words the owner sees in Réglages. */
export const CAPS = {
  'agenda.all': 'Voir l’agenda de tous les fauteuils',
  'agenda.edit': 'Modifier tous les rendez-vous',
  'agenda.own': 'Gérer ses propres rendez-vous',
  'sale.create': 'Encaisser',
  'sale.all': 'Voir toutes les ventes',
  'sale.refund': 'Rembourser',
  'sale.discount': 'Faire une remise',
  'drawer': 'Ouvrir et compter la caisse',
  'closure': 'Clôturer la journée',
  'client.view': 'Voir les fiches clients',
  'client.edit': 'Modifier les fiches clients',
  'client.contact': 'Voir les numéros complets',
  'client.export': 'Exporter les clients',
  'client.erase': 'Effacer un client (RGPD)',
  'report.shop': 'Voir les chiffres du salon',
  'report.own': 'Voir ses propres chiffres',
  'marketing': 'Envoyer des relances',
  'team': 'Gérer l’équipe',
  'catalog': 'Gérer prestations et produits',
  'settings': 'Modifier les réglages',
  'devices': 'Gérer les appareils',
  'audit': 'Voir le journal d’activité',
  'data': 'Exporter et vérifier les données'
};

const ALL = Object.keys(CAPS);
const BASE = {
  owner: ALL,
  manager: ALL.filter((c) => !['settings', 'devices', 'client.erase', 'data'].includes(c)),
  desk: ['agenda.all', 'agenda.edit', 'agenda.own', 'sale.create', 'sale.all', 'drawer', 'client.view', 'client.edit', 'client.contact', 'marketing', 'report.own'],
  barber: ['agenda.all', 'agenda.own', 'sale.create', 'sale.discount', 'client.view', 'client.edit', 'report.own']
};

/** Capabilities of one staff member, after the owner's toggles in Réglages › Équipe. */
export function capsOf(staff, settings) {
  if (!staff || !staff.active) return new Set();
  const caps = new Set(BASE[staff.role] || []);
  if (staff.role === 'barber') {
    const t = settings.team || {};
    if (!t.barberCheckout) caps.delete('sale.create');
    if (!t.barberAllAgenda) caps.delete('agenda.all');
    if (t.barberSeeRevenue) caps.add('report.shop');
  }
  return caps;
}

/** Largest discount, in percent of the ticket, this person may grant. */
export function maxDiscountPct(staff, settings) {
  if (!staff) return 0;
  if (staff.role === 'owner' || staff.role === 'manager') return 100;
  if (staff.role === 'desk') return 20;
  return settings.team?.barberMaxDiscountPct ?? 10;
}
