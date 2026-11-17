// OFFRE-01 · The carnet bought with its dates (« 5 coupes sur 5 semaines ») in the Comptoir, part by part (read by the
// guided tour; data only): its weekly rule in the Catalogue, its sale with five dates in « Nouveau rendez-vous », and
// the ticket of one of its dates.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'catalogue.carnet-semaine', page: '/comptoir/catalogue', target: 'cat-carnet-semaine', roles: ['owner', 'manager'], title: 'Une visite par semaine', body: 'La formule se prend avec toutes ses dates, sur le site avec un compte client ou ici. Tu choisis aussi ce que devient une semaine sautée : perdue, ou reportable une fois.', order: 45 },
  { id: 'catalogue.carnet-compris', page: '/comptoir/catalogue', target: 'cat-carnet-compris', roles: ['owner', 'manager'], title: 'Compris dans la visite', body: 'Coche ce qui se fait le même jour sans supplément, comme l’entretien de la barbe. À la caisse, la ligne passe à 0 €.', order: 45 },
  { id: 'agenda.carnet', page: '/comptoir/agenda', target: 'agenda-carnet', title: 'Vendre la formule', body: 'Dans « Nouveau rendez-vous », active la formule : la visite est choisie pour toi, il reste la première date. La formule s’encaisse à la première visite.', order: 71 },
  { id: 'agenda.carnet-dates', page: '/comptoir/agenda', target: 'agenda-carnet-dates', title: 'Les autres dates', body: 'Même jour, même heure et même barbier les semaines suivantes, ou le plus proche avec la raison. Chaque ligne se modifie ou se garde pour plus tard.', order: 72 },
  { id: 'caisse.carnet', page: '/comptoir/caisse', target: 'tk-carnet', title: 'Visite 1 sur 5', body: 'Sur un rendez-vous de formule, la caisse sait quoi faire : à la première visite elle vend la formule, ensuite la visite est couverte. L’entretien de la barbe est compris, à 0 €.', order: 46 }
];
export default steps;
