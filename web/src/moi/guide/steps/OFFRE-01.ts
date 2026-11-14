// OFFRE-01 · The carnet bought with its dates as its holder reads it in /moi (data only).
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'moi.carnet-dates', page: '/moi', target: 'moi-carnet', roles: ['client'], order: 22, title: 'Ton carnet', body: 'Un trait par coupe : faite, réservée ou à réserver. Touche « Gérer » pour déplacer une date, et réserve en un geste une semaine sans rendez-vous.' },
  { id: 'moi.carnet-reprendre', page: '/moi', target: 'moi-carnet-reprendre', roles: ['client'], order: 23, title: 'Reprendre 5 coupes', body: 'Après ta dernière coupe, tu repars pour cinq semaines. Tu choisis de nouveau tes dates.' }
];
export default steps;
