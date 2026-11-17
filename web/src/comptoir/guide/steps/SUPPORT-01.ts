// What Réglages › Accès prestataire says about itself. Data only; the tour reads it. The owner's.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'reglages.prestataire', page: '/comptoir/reglages/prestataire', target: 'prestataire-main', roles: ['owner'], order: 10, title: 'Accès prestataire', body: 'Pour laisser ton prestataire remplir le salon à ta place pendant 24 heures, sans lui donner ton mot de passe. Tu vérifies le code, tu confirmes, et tu retires l’accès quand tu veux.' }
];

export default steps;
