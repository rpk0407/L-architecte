// OFFRE-01 · The carnet bought with its dates (« 5 coupes sur 5 semaines ») in the Comptoir, part by part (read by the
// guided tour; data only): its weekly rule in the Catalogue, its sale with five dates in « Nouveau rendez-vous », and
// the ticket of one of its dates.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'catalogue.carnet-semaine', page: '/comptoir/catalogue', target: 'cat-carnet-semaine', roles: ['owner', 'manager'], title: 'Une coupe par semaine', body: 'Le carnet se prend avec toutes ses dates, sur le site avec un compte client ou ici. Tu choisis aussi ce que devient une semaine manquée : perdue, ou reportable une fois.', order: 45 },
  { id: 'agenda.carnet', page: '/comptoir/agenda', target: 'agenda-carnet', title: 'Vendre le carnet', body: 'Dans « Nouveau rendez-vous », active le carnet : la coupe est choisie pour toi, il reste la première date. Le carnet s’encaisse à la première coupe.', order: 71 },
  { id: 'agenda.carnet-dates', page: '/comptoir/agenda', target: 'agenda-carnet-dates', title: 'Les autres dates', body: 'Même jour, même heure et même barbier les semaines suivantes, ou le plus proche avec la raison. Chaque ligne se modifie ou se garde pour plus tard.', order: 72 },
  { id: 'caisse.carnet', page: '/comptoir/caisse', target: 'tk-carnet', title: 'Coupe 1 sur 5', body: 'Sur un rendez-vous de carnet, la caisse sait quoi faire : à la première coupe elle vend le carnet, ensuite la coupe est couverte. La barbe se paie à part.', order: 46 }
];
export default steps;
