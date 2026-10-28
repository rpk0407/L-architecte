// What the loyalty screens say about themselves (FID-03): Réglages › Fidélité, the till's reward chip, the card on a client
// file. Data only; the parts carry the data-guide ids below (Fidelite.tsx, RewardChip.tsx, LoyaltyCard.tsx).
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'fidelite.switch', page: '/comptoir/reglages/fidelite', target: 'fidelite.switch', roles: ['owner'], order: 10, title: 'Programme de fidélité', body: 'Allume ou éteins la carte à tampons pour tout le salon. Éteinte, personne ne cumule et rien n’apparaît chez les clients.' },
  { id: 'fidelite.rules', page: '/comptoir/reglages/fidelite', target: 'fidelite.rules', roles: ['owner'], order: 20, title: 'La carte', body: 'Choisis après combien de passages la récompense tombe, ce qu’elle offre et combien de temps elle reste valable. Un passage ne compte qu’à partir du montant que tu fixes.' },
  { id: 'fidelite.referral', page: '/comptoir/reglages/fidelite', target: 'fidelite.referral', roles: ['owner'], order: 30, title: 'Parrainage', body: 'Un client qui en amène un nouveau reçoit un cadeau, et son ami aussi. Le lien est dans l’espace du parrain, ou l’ami le dit à la caisse.' },
  { id: 'fidelite.simulator', page: '/comptoir/reglages/fidelite', target: 'fidelite.simulator', roles: ['owner'], order: 40, title: 'Ce que ça coûte', body: 'Rejoue les 12 derniers mois avec les règles que tu viens de saisir. Au-delà de 8 % du chiffre des prestations, on te prévient.' },
  { id: 'fidelite.preview', page: '/comptoir/reglages/fidelite', target: 'fidelite.preview', roles: ['owner'], order: 50, title: 'Ce que voit ton client', body: 'La carte telle qu’elle s’affiche dans son espace, avec la règle en une phrase. Elle suit ce que tu règles plus haut.' },
  { id: 'fidelite.launch', page: '/comptoir/reglages/fidelite', target: 'fidelite.launch', roles: ['owner'], order: 60, title: 'Lancement', body: 'Ouvre toutes les cartes d’un coup, avec une avance tirée des 12 derniers mois. Tu ne le fais qu’une fois, quand les clients de l’ancien site sont repris.' },
  { id: 'fidelite.terms', page: '/comptoir/reglages/fidelite', target: 'fidelite.terms', roles: ['owner'], order: 70, title: 'Règlement', body: 'Le texte que tes clients lisent, écrit d’après tes réglages : tu n’as rien à rédiger. Il est le même dans leur espace.' },
  { id: 'caisse.reward', page: '/comptoir/caisse', target: 'caisse.reward', order: 50, title: 'Récompense fidélité', body: 'Quand le client a une récompense, appuie sur Appliquer : la prestation est offerte sur le ticket. À sa première visite, demande-lui qui l’a envoyé.' },
  { id: 'clients.loyalty', page: '/comptoir/clients', target: 'clients.loyalty', order: 60, title: 'Fidélité', body: 'La carte du client : ses tampons, ses récompenses et ses derniers mouvements. Un tampon oublié s’ajoute ici, une fois par jour.' },
  { id: 'clients.loyalty-manage', page: '/comptoir/clients', target: 'clients.loyalty', roles: ['owner', 'manager'], order: 61, title: 'Ajuster ou offrir', body: 'Corrige la carte avec une raison, ou offre une récompense en geste commercial. Le client peut aussi demander à ne plus participer.' }
];
export default steps;
