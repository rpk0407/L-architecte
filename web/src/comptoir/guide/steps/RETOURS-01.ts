// RETOURS-01 · What the owner asked for before the opening, in the Comptoir (read by the guided tour; data only): a
// booking of several people shown as one group, in the agenda and at the till.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'agenda.groupe', page: '/comptoir/agenda', target: 'agenda-groupe', title: 'Un groupe', body: 'Plusieurs personnes réservées ensemble sur le site : qui a organisé, qui vient et le total. Chaque place garde son propre rendez-vous.', order: 73 },
  { id: 'caisse.groupe', page: '/comptoir/caisse', target: 'tk-groupe', title: 'Encaisser un groupe', body: 'Mets tout le groupe sur un seul ticket, ou encaisse chacun séparément. Chaque prestation reste créditée à son barbier.', order: 47 }
];
export default steps;
