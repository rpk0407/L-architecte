// What the client space says about itself (AC-03a), data only: the sign-in, the three tabs, the next appointment and its
// gestures, « Mes avantages », the history, and the two ways in from a booking (the site's done step, the /r/ page).
// Each target is a data-guide attribute of these screens (tests/unit/moi-guide.test.js checks they exist).
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'moi.signin', page: '/moi', target: 'moi.signin', roles: ['client'], order: 10, title: 'Ton espace', body: 'Tes rendez-vous, tes reçus et ce que tu as au salon, sur ton téléphone. Pas de mot de passe : un code par SMS suffit.' },
  { id: 'moi.signin.phone', page: '/moi', target: 'moi.signin.phone', roles: ['client'], order: 20, title: 'Ton numéro', body: 'Donne ton numéro de mobile : celui de ta réservation, ou que le salon a pour toi. Si le salon le connaît, un code part par SMS.' },
  { id: 'moi.signin.code', page: '/moi', target: 'moi.signin.code', roles: ['client'], order: 30, title: 'Le code reçu par SMS', body: 'Tape les 6 chiffres : ça part tout seul au sixième. Rien reçu au bout de 30 secondes, « Renvoyer le code » s’active.' },
  { id: 'moi.signin.demo', page: '/moi', target: 'moi.signin.demo', roles: ['client'], order: 40, title: 'Essayer avec un client de démo', body: 'Dans la démo, aucun SMS ne part : ce bouton ouvre l’espace d’un client du salon de démonstration.' },
  { id: 'moi.signin.book', page: '/moi', target: 'moi.signin.book', roles: ['client'], order: 50, title: 'Jamais venu ?', body: 'Ton espace s’ouvre avec ta première réservation. Réserver ne demande jamais d’espace.' },
  { id: 'moi.hello', page: '/moi', target: 'moi.hello', roles: ['client'], order: 60, title: 'Ton accueil', body: 'Ton espace te salue et te montre ce qui t’attend : ton prochain rendez-vous, ou quand ta prochaine coupe tombe.' },
  { id: 'moi.next', page: '/moi', target: 'moi.next', roles: ['client'], order: 70, title: 'Ton prochain rendez-vous', body: 'Le jour, l’heure, la prestation et ton barbier, comme sur ton SMS. Un acompte à régler s’affiche ici.' },
  { id: 'moi.next.actions', page: '/moi', target: 'moi.next.actions', roles: ['client'], order: 80, title: 'Agenda · Itinéraire · Déplacer · Annuler', body: 'Ajoute le rendez-vous à ton agenda, trouve le salon, ou change-le jusqu’à l’heure indiquée dessous. Après, appelle le salon.' },
  { id: 'moi.others', page: '/moi', target: 'moi.others', roles: ['client'], order: 90, title: 'Aussi à venir', body: 'Tes autres rendez-vous réservés. Touche-en un pour le voir en grand et le gérer.' },
  { id: 'moi.avantages', page: '/moi', target: 'moi.avantages', roles: ['client'], order: 100, title: 'Mes avantages', body: 'Tout ce que tu as au salon : carnet, carte cadeau, abonnement, carte fidélité. Touche une ligne pour le détail.' },
  { id: 'moi.carnet', page: '/moi', target: 'moi.carnet', roles: ['client'], order: 110, title: 'Carnet', body: 'Les coupes qu’il te reste et jusqu’à quand. Chaque coupe se déduit au salon, au moment de payer.' },
  { id: 'moi.giftcard', page: '/moi', target: 'moi.giftcard', roles: ['client'], order: 120, title: 'Carte cadeau', body: 'Ce qu’il reste sur ta carte et jusqu’à quand. Présente-la au salon pour payer.' },
  { id: 'moi.tabs', page: '/moi', target: 'moi.tabs', roles: ['client'], order: 130, title: 'Rendez-vous · Historique · Profil', body: 'Les trois pages de ton espace, toujours en bas de l’écran.' },
  { id: 'moi.history', page: '/moi/historique', target: 'moi.history', roles: ['client'], order: 10, title: 'Tes visites', body: 'Tes passages au salon, du plus récent au plus ancien. « Reçu » ouvre le ticket de la visite.' },
  { id: 'site.espace', page: '/', target: 'site.espace', roles: ['client'], order: 900, title: 'Garde tout au même endroit', body: 'Après une réservation, ouvre ton espace en un geste : un code arrive par SMS au numéro donné, sans mot de passe. C’est facultatif.' },
  { id: 'r.espace', page: '/r', target: 'r.espace', roles: ['client'], order: 900, title: 'Ouvre ton espace', body: 'Depuis la page de ton rendez-vous, ouvre ton espace en un geste : un code arrive par SMS. Déjà ouvert, le lien t’y emmène.' }
];

export default steps;
