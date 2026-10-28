// GUIDE-01a · Profil › Aide: the space's guided tour, again.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  {
    id: 'moi.profile-help', page: '/moi/profil', target: 'profile-help', roles: ['client'], order: 45,
    title: 'Comment ça marche ?',
    body: 'Revois cette visite quand tu veux : elle te montre chaque partie de ton espace, puis te ramène où tu étais.'
  }
];
export default steps;
