// The abonnement in the Comptoir, part by part (read by the guided tour; data only).
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'caisse.chips', page: '/comptoir/caisse', target: 'till-chips', title: 'Les pastilles du client', body: 'Elles disent d’un coup d’œil si le client est abonné, s’il a un carnet ou une récompense. En orange : son dernier paiement a été refusé.', order: 40 },
  { id: 'caisse.member-line', page: '/comptoir/caisse', target: 'till-member-line', title: 'Coupe d’abonnement à 0 €', body: 'Le mois est déjà payé : la coupe passe à 0 € toute seule. Si le quota est atteint, elle reste au prix normal et une note te dit pourquoi.', order: 41 },
  { id: 'caisse.offer', page: '/comptoir/caisse', target: 'till-offer', roles: ['owner', 'manager'], title: 'Proposer l’abonnement', body: 'Après l’encaissement d’un client sans abonnement, une touche lui envoie le lien par SMS. Il choisit sa carte lui-même.', order: 42 },
  { id: 'clients.abonnes-kpis', page: '/comptoir/clients', target: 'members-kpis', roles: ['owner', 'manager'], title: 'Les abonnés en chiffres', body: 'Le nombre d’abonnés, ce qu’ils rapportent chaque mois, les paiements à régulariser et les départs des 30 derniers jours.', order: 50 },
  { id: 'clients.abonnes-list', page: '/comptoir/clients', target: 'members-list', title: 'Abonnés', body: 'Qui est abonné, où il en est ce mois-ci et qui a un souci de paiement, en premier. Touche une ligne pour ouvrir sa fiche.', order: 51 },
  { id: 'clients.abonnes-carnets', page: '/comptoir/clients', target: 'members-carnets', title: 'Carnets en cours', body: 'Les carnets pas encore finis, avec les coupes restantes et la date limite. Utile pour rappeler ceux qui vont expirer.', order: 52 },
  { id: 'clients.file-chips', page: '/comptoir/clients', target: 'file-chips', title: 'En un coup d’œil', body: 'Une ligne de pastilles résume la fiche : abonnement, carnet et le reste. Touche une pastille pour ouvrir son bloc.', order: 53 },
  { id: 'clients.file-abonnement', page: '/comptoir/clients', target: 'file-abonnement', title: 'Abonnement', body: 'La formule, la carte, le prochain prélèvement et les coupes du mois. Le gérant peut envoyer le lien carte, résilier ou abonner le client.', order: 54 },
  { id: 'clients.member-cancel', page: '/comptoir/clients', target: 'member-cancel', roles: ['owner', 'manager'], title: 'Résilier', body: 'Tu choisis : à la fin du mois payé, ou tout de suite avec les jours non utilisés remboursés. Le client est prévenu par message.', order: 54 },
  { id: 'clients.member-offer', page: '/comptoir/clients', target: 'member-offer', title: 'Abonner le client', body: 'Choisis la formule puis envoie le lien par SMS, ou montre le QR code au client. Il faut son numéro et son e-mail sur la fiche.', order: 55 },
  { id: 'clients.file-carnets', page: '/comptoir/clients', target: 'file-carnets', title: 'Carnets', body: 'Les coupes prépayées du client : combien il en reste et jusqu’à quand. Chaque coupe est décomptée à la caisse.', order: 56 },
  { id: 'reglages.abo-switch', page: '/comptoir/reglages/abonnements', target: 'abo-switch', roles: ['owner'], title: 'Vendre des abonnements', body: 'Allume-le pour proposer les formules sur le site et à la caisse. Il demande que le paiement en ligne soit branché.', order: 60 },
  { id: 'reglages.abo-plans', page: '/comptoir/reglages/abonnements', target: 'abo-plans', roles: ['owner'], title: 'Les formules', body: 'Jusqu’à quatre formules : nom, prix, coupes par mois et prestations couvertes. Les abonnés en cours gardent leur prix.', order: 61 },
  { id: 'reglages.abo-grace', page: '/comptoir/reglages/abonnements', target: 'abo-grace', roles: ['owner'], title: 'Délai de grâce', body: 'Après un paiement refusé, le client garde ses coupes le temps que la banque réessaie. Passé ce délai, l’abonnement s’arrête.', order: 62 },
  { id: 'reglages.abo-preview', page: '/comptoir/reglages/abonnements', target: 'abo-preview', roles: ['owner'], title: 'Aperçu sur le site', body: 'La carte telle que le client la voit sur le site. Elle se met à jour pendant que tu tapes.', order: 63 }
];
export default steps;
