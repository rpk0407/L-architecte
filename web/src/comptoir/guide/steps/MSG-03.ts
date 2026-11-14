// What the Messages screen says about itself (« mode téléphone »): the texts to clients a person sends from the salon's
// WhatsApp, one tap each. Data only; the tour reads it. The page is in the menu while the salon sends by hand.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'messages.main', page: '/comptoir/messages', target: 'messages-main', order: 10, title: 'Messages à envoyer', body: 'Les confirmations et les rappels à envoyer depuis le WhatsApp du salon. Un bouton ouvre WhatsApp avec le message déjà écrit, puis tu touches « Envoyé ».' },
  // Réglages › Connexion IONOS: the salon's mailbox and its domain, the owner's
  { id: 'reglages.ionos-mail', page: '/comptoir/reglages/ionos', target: 'ionos-mail', roles: ['owner'], order: 10, title: 'E-mail du salon', body: 'Ce qui est posé dans Vercel pour la boîte IONOS, les valeurs à taper avec un bouton Copier, et l’e-mail test. Le mot de passe n’apparaît jamais ici.' },
  { id: 'reglages.ionos-domain', page: '/comptoir/reglages/ionos', target: 'ionos-domain', roles: ['owner'], order: 20, title: 'Nom de domaine', body: 'Les deux lignes qui changent chez IONOS le lundi de la bascule, et rien avant. « Vérifier » dit si le domaine pointe déjà vers le nouveau site.' }
];

export default steps;
