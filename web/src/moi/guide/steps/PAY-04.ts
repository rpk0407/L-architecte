// PAY-04 · What the membership's screens say about themselves the first time (data only, read by the tour of Wave 14):
// the site's « Abonnement & carnet » block and its sheet, the member page (/abo/… and /moi), /resilier.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'site.abonnement', page: '/', target: 'site-abonnement', roles: ['client'], order: 70, title: 'Abonnement & carnet', body: 'Les deux façons de payer tes coupes d’avance. L’abonnement se prend ici, le carnet au salon.' },
  { id: 'site.abonnement.plans', page: '/', target: 'site-abonnement-plans', roles: ['client'], order: 71, title: 'Abonnement mensuel', body: 'Un prix par mois, des coupes incluses, sans engagement. « Je m’abonne » ouvre la feuille d’abonnement.' },
  { id: 'site.abonnement.carnet', page: '/', target: 'site-abonnement-carnet', roles: ['client'], order: 72, title: 'Carnet', body: 'Cinq coupes payées une fois, à prendre au salon. Le salon fixe tes rendez-vous avec toi.' },
  { id: 'site.subscribe', page: '/', target: 'site-subscribe', roles: ['client'], order: 73, title: 'Je m’abonne', body: 'Ton prénom, ton numéro et ton e-mail, puis le paiement sécurisé. La confirmation part par e-mail.' },
  { id: 'site.subscribe.recap', page: '/', target: 'site-subscribe-recap', roles: ['client'], order: 74, title: 'Ta formule', body: 'Ce que tu prends et son prix par mois. Tu peux résilier à tout moment en 3 clics.' },
  { id: 'site.subscribe.start', page: '/', target: 'site-subscribe-start', roles: ['client'], order: 75, title: 'Commencer tout de suite', body: 'Coche si tu veux tes coupes incluses dès aujourd’hui. Sinon l’abonnement démarre dans 14 jours, rien n’est prélevé avant.' },
  { id: 'abo.status', page: '/abo', target: 'member-status', roles: ['client'], order: 10, title: 'L’état de ton abonnement', body: 'Actif, à régulariser, ou la date où il s’arrête. Tout se gère depuis cette page.' },
  { id: 'abo.due', page: '/abo', target: 'member-due', roles: ['client'], order: 11, title: 'Le paiement n’est pas passé', body: 'Ta carte a été refusée. « Mettre ma carte à jour » règle le mois et garde tes coupes.' },
  { id: 'abo.counter', page: '/abo', target: 'member-counter', roles: ['client'], order: 12, title: 'Tes coupes ce mois-ci', body: 'Combien de coupes tu as prises dans le mois payé, et jusqu’à quand il court.' },
  { id: 'abo.book', page: '/abo', target: 'member-book', roles: ['client'], order: 13, title: 'Réserver ma coupe', body: 'Ouvre la réservation du site avec ton abonnement. Une coupe incluse ne demande rien en ligne.' },
  { id: 'abo.charge', page: '/abo', target: 'member-charge', roles: ['client'], order: 14, title: 'Prochain prélèvement', body: 'Le montant, la date et la carte utilisée. Rien d’autre n’est prélevé.' },
  { id: 'abo.card', page: '/abo', target: 'member-card', roles: ['client'], order: 15, title: 'Changer de carte', body: 'Ouvre la page sécurisée de paiement pour mettre une autre carte. Elle sert dès le prochain prélèvement.' },
  { id: 'abo.ack', page: '/abo', target: 'member-ack', roles: ['client'], order: 16, title: 'Confirmation', body: 'Quand la confirmation t’a été envoyée. « Télécharger la confirmation » te donne un fichier à garder.' },
  { id: 'abo.cancel', page: '/abo', target: 'member-cancel', roles: ['client'], order: 17, title: 'Résilier mon abonnement', body: 'Montre ce qui s’arrête et quand, puis un seul bouton pour confirmer. Tes coupes restent incluses jusqu’à la fin du mois payé.' },
  { id: 'abo.cancel.confirm', page: '/abo', target: 'member-cancel-confirm', roles: ['client'], order: 18, title: 'Confirmer la résiliation', body: 'Enregistre la résiliation tout de suite, avec sa date et son heure. L’accusé de réception t’est envoyé et se télécharge.' },
  { id: 'abo.withdraw', page: '/abo', target: 'member-withdraw', roles: ['client'], order: 19, title: 'Renoncer au contrat ici', body: 'Avant que ton abonnement commence, ou pendant les 14 jours après le premier paiement. On te rembourse le mois, moins les coupes déjà faites.' },
  { id: 'abo.withdraw.confirm', page: '/abo', target: 'member-withdraw-confirm', roles: ['client'], order: 20, title: 'Confirmer la rétractation', body: 'Arrête l’abonnement aujourd’hui et lance le remboursement indiqué. La confirmation t’est envoyée et se télécharge.' },
  { id: 'moi.membership', page: '/moi', target: 'moi-membership', roles: ['client'], order: 31, title: 'Ton abonnement', body: 'Où en est ton mois de coupes. Touche la ligne pour réserver, changer de carte ou résilier.' },
  { id: 'resilier.lookup', page: '/resilier', target: 'resilier-lookup', roles: ['client'], order: 10, title: 'Ton numéro ou ton e-mail', body: 'On envoie le lien de ton abonnement au numéro et à l’e-mail que le salon a pour toi. Il ouvre directement la résiliation.' },
  { id: 'resilier.fallback', page: '/resilier', target: 'resilier-fallback', roles: ['client'], order: 11, title: 'Sans ton numéro ni ton e-mail', body: 'Ton prénom et l’e-mail de l’abonnement suffisent. La résiliation est enregistrée à l’instant, le salon la confirme.' },
  { id: 'resilier.space', page: '/resilier', target: 'resilier-space', roles: ['client'], order: 9, title: 'Ouvrir mon espace', body: 'Connecté à ton espace, ton abonnement y est directement. Rien à recevoir.' }
];
export default steps;
