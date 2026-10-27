// What Mon espace says about itself (TEAM-04): one step per part, in the order of the page. Data only; the tour reads it.
import type { GuideStep } from '../../../lib/guide';

const PAGE = '/comptoir/espace';
// the page is for whoever has a chair: a barber, or the owner or a manager who cuts too (not the desk)
const CHAIR: GuideStep['roles'] = ['barber', 'owner', 'manager'];

const steps: GuideStep[] = [
  { id: 'espace.entete', page: PAGE, target: 'espace.entete', roles: CHAIR, order: 10, title: 'Salut', body: 'C’est ta page d’accueil : ton nom, ta photo et la date. Elle ne montre que tes rendez-vous, tes clients et tes chiffres.' },
  { id: 'espace.statut', page: PAGE, target: 'espace.statut', roles: CHAIR, order: 20, title: 'Où tu en es', body: 'Une phrase te dit si tu es au fauteuil, libre jusqu’à quelle heure ou pas encore arrivé. Elle suit ton agenda en direct.' },
  { id: 'espace.prochain', page: PAGE, target: 'espace.prochain', roles: CHAIR, order: 30, title: 'Prochain client', body: 'Ton prochain client avec ce qu’on a fait la dernière fois. Les boutons suivent le rendez-vous : Il est là, Au fauteuil, puis Encaisser.' },
  { id: 'espace.journee', page: PAGE, target: 'espace.journee', roles: CHAIR, order: 40, title: 'Ma journée', body: 'Tous tes rendez-vous du jour, dans l’ordre. Touche « + note » après une coupe pour écrire ce qu’il faut retenir.' },
  { id: 'espace.trous', page: PAGE, target: 'espace.trous', roles: CHAIR, order: 50, title: 'Mes trous', body: 'Tes créneaux libres de 20 minutes ou plus d’ici la fin de ta journée. C’est là que tu places un passage sans rendez-vous.' },
  { id: 'espace.chiffres', page: PAGE, target: 'espace.chiffres', roles: CHAIR, order: 60, title: 'Mes chiffres', body: 'Ce que tu as fait, ta commission et tes pourboires, sur le jour, la semaine ou le mois. L’anneau montre où tu en es de ton objectif du mois.' },
  { id: 'espace.anniversaires', page: PAGE, target: 'espace.anniversaires', roles: CHAIR, order: 70, title: 'Anniversaires', body: 'Tes habitués dont l’anniversaire tombe cette semaine. Un petit mot au fauteuil fait toujours plaisir.' },
  { id: 'espace.avis', page: PAGE, target: 'espace.avis', roles: CHAIR, order: 80, title: 'Avis demandés', body: 'Les demandes d’avis Google parties après tes clients ce mois-ci, et combien ont été ouvertes. Elle n’apparaît que si le salon demande des avis.' },
  { id: 'espace.absences', page: PAGE, target: 'espace.absences', roles: CHAIR, order: 90, title: 'Mes absences', body: 'Ta prochaine absence et tes demandes en attente. « Demander une absence » l’envoie au gérant, qui la valide.' },
  { id: 'espace.salon', page: PAGE, target: 'espace.salon', roles: CHAIR, order: 100, title: 'Le salon', body: 'L’avancement du salon sur le mois, en pourcentage et sans les euros. Le gérant décide ce que chacun voit des autres.' },
  { id: 'espace.personnaliser', page: PAGE, target: 'espace.personnaliser', roles: CHAIR, order: 110, title: 'Personnaliser', body: 'Choisis les cartes que tu veux voir et leur ordre, avec les flèches et les interrupteurs. Ça ne change que ton espace.' },
  // on a client's file, for everyone who may open it
  { id: 'clients.notes-coupe', page: '/comptoir/clients', target: 'clients.notes-coupe', order: 200, title: 'Notes de coupe', body: 'Ce que les barbiers ont écrit après chaque coupe de ce client, avec leur nom et la date. Elles s’affichent aussi dans « Prochain client » à sa prochaine visite.' }
];

export default steps;
