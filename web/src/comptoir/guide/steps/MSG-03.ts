// What the Messages screen says about itself (« mode téléphone »): the texts to clients a person sends from the salon's
// WhatsApp, one tap each. Data only; the tour reads it. The page is in the menu while the salon sends by hand.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'messages.main', page: '/comptoir/messages', target: 'messages-main', order: 10, title: 'Messages à envoyer', body: 'Les confirmations et les rappels à envoyer depuis le WhatsApp du salon. Un bouton ouvre WhatsApp avec le message déjà écrit, puis tu touches « Envoyé ».' }
];

export default steps;
