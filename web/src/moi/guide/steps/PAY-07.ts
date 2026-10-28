// PAY-07 · The weekly membership as its member reads it (/abo/… and the sheet of /moi « Mes avantages »; data only).
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'abo.week', page: '/abo', target: 'member-counter', roles: ['client'], order: 12, title: 'Ta coupe de la semaine', body: 'Avec un abonnement à la semaine, le compteur dit si ta coupe de cette semaine est prise. La semaine va du lundi au dimanche.' },
  { id: 'abo.rule', page: '/abo', target: 'member-rule', roles: ['client'], order: 13, title: 'Ta règle', body: 'Combien de coupes sont incluses, et ce que devient une semaine où tu ne viens pas. C’est la règle de ton contrat, elle ne change pas sans toi.' },
  { id: 'moi.membership.week', page: '/moi', target: 'moi-membership', roles: ['client'], order: 31, title: 'Abonnement', body: 'Ta formule et ta semaine : « à prendre » tant que tu n’es pas venu. Touche la ligne pour ouvrir ton abonnement.' }
];
export default steps;
