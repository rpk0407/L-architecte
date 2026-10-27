// What the loyalty card says about itself in /moi (FID-03). Data only; the parts carry the data-guide ids below
// (avantages/Loyalty.tsx, cards/LoyaltyOptOut.tsx).
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'moi.loyalty', page: '/moi', target: 'moi.loyalty', roles: ['client'], order: 30, title: 'Ma carte fidélité', body: 'Ton nombre de passages avant la prochaine coupe offerte. Touche la ligne pour voir ta carte, parrainer un ami et lire le règlement.' },
  { id: 'moi.loyalty-off', page: '/moi', target: 'moi.loyalty-off', roles: ['client'], order: 40, title: 'Participer à la carte fidélité', body: 'Coupe ce réglage si tu ne veux plus que tes passages soient comptés. Tes récompenses déjà gagnées restent valables.' }
];
export default steps;
