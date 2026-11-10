// What the Accueil says about itself (WP5): one step per part, in the order of the page. Data only; the tour reads it.
// No `roles`: the page is everyone's, each one seeing what the server returns for him.
import type { GuideStep } from '../../../lib/guide';

const PAGE = '/comptoir/accueil';

const steps: GuideStep[] = [
  { id: 'accueil.phrase', page: PAGE, target: 'accueil.phrase', order: 10, title: 'Le moment', body: 'La journée en une ligne et trois chiffres, selon l’heure : avant l’ouverture, pendant, après, ou salon fermé. « Lu à » te dit de quand datent les chiffres.' },
  { id: 'accueil.prochain', page: PAGE, target: 'accueil.prochain', order: 20, title: 'Prochain', body: 'Le prochain client attendu : son heure, sa prestation, son barbier. Touche la ligne pour ouvrir son rendez-vous.' },
  { id: 'accueil.fauteuils', page: PAGE, target: 'accueil.fauteuils', order: 30, title: 'Fauteuils', body: 'Chaque fauteuil dit s’il est libre, pour combien de temps, ou jusqu’à quand il est occupé. « Prendre un passage » apparaît quand un client sans rendez-vous peut s’asseoir tout de suite.' },
  { id: 'accueil.jour', page: PAGE, target: 'accueil.jour', order: 40, title: 'Aujourd’hui', body: 'Les rendez-vous qui restent à venir, le prochain en premier. Touche une ligne pour l’ouvrir, ou le lien du bas pour tout voir dans l’Agenda.' },
  { id: 'accueil.cartes', page: PAGE, target: 'accueil.cartes', order: 50, title: 'À traiter', body: 'Ce qui attend un geste de ta part, le plus urgent en haut, avec un seul bouton par carte. Le menu « ⋯ » remet une carte à demain, la masque ou t’explique pourquoi tu la vois.' },
  { id: 'accueil.perso', page: PAGE, target: 'accueil.perso', order: 60, title: 'Personnaliser', body: 'Choisis les blocs et les cartes que tu veux voir, et leur ordre. Tes chiffres et ta journée restent à un toucher.' }
];

export default steps;
