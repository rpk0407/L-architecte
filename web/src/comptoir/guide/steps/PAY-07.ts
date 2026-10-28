// PAY-07 · The salon's real membership in the Comptoir, part by part (read by the guided tour; data only): the weekly
// rule in Réglages › Abonnements, and every member's weeks on Clients › Abonnés.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'reglages.abo-rhythm', page: '/comptoir/reglages/abonnements', target: 'abo-rhythm', roles: ['owner'], title: 'Rythme', body: 'Par semaine : une coupe incluse chaque semaine. Par mois : un nombre de coupes à prendre dans le mois.', order: 64 },
  { id: 'reglages.abo-missed', page: '/comptoir/reglages/abonnements', target: 'abo-missed', roles: ['owner'], title: 'S’il ne vient pas une semaine', body: 'Tu choisis ce que devient une semaine sans visite : perdue, rattrapable dans le mois, ou pas de limite. Les abonnés en cours gardent la règle qu’ils ont prise.', order: 65 },
  { id: 'reglages.abo-offer-line', page: '/comptoir/reglages/abonnements', target: 'abo-offer-line', roles: ['owner'], title: 'Ce que voit le client', body: 'La phrase de l’offre telle que le site et sa page d’abonné la disent. Elle change dès que tu touches un réglage.', order: 66 },
  { id: 'clients.abonnes-presence', page: '/comptoir/clients', target: 'members-presence', roles: ['owner', 'manager'], title: 'Présence', body: 'Les semaines où tes abonnés sont venus, sur les semaines déjà passées de leur mois. Elle baisse quand quelqu’un saute des semaines.', order: 57 },
  { id: 'clients.abonnes-missed', page: '/comptoir/clients', target: 'members-missed', roles: ['owner', 'manager'], title: 'Semaines manquées', body: 'Les semaines finies sans visite ce mois-ci, et qui n’est pas encore venu cette semaine.', order: 58 },
  { id: 'clients.abonnes-notyet', page: '/comptoir/clients', target: 'members-notyet', title: 'Pas venu cette semaine', body: 'Ne garde que les abonnés pas encore venus cette semaine, le plus ancien passage en premier.', order: 59 },
  { id: 'clients.abonnes-write', page: '/comptoir/clients', target: 'members-write', roles: ['owner', 'manager'], title: 'Écrire', body: 'Un SMS prêt à partir pour lui garder sa place cette semaine. Il n’apparaît que si le client a dit oui aux SMS du salon.', order: 60 },
  { id: 'clients.abonnes-weeks', page: '/comptoir/clients', target: 'members-weeks', title: 'Ses semaines', body: 'Un rond par semaine de son mois : plein s’il est venu, barré s’il l’a manquée, cerclé pour cette semaine, en pointillés pour celles à venir.', order: 61 },
  { id: 'clients.abonnes-thisweek', page: '/comptoir/clients', target: 'members-thisweek', title: 'Cette semaine', body: 'Une coche s’il est déjà venu cette semaine, un point s’il n’est pas encore passé.', order: 62 }
];
export default steps;
