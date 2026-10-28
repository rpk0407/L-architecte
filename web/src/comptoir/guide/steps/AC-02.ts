// AC-02 · What the Comptoir explains of a client's space: the card in the client file, and the switch in Réglages.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  {
    id: 'clients.account', page: '/comptoir/clients', target: 'client-account', order: 60,
    title: 'Espace client',
    body: 'Dit si ce client a ouvert son espace sur le site, depuis quand, et s’il a demandé à être effacé. Ouvre la carte pour agir.'
  },
  {
    id: 'clients.account-invite', page: '/comptoir/clients', target: 'client-account-invite', order: 61,
    title: 'Envoyer le lien de son espace',
    body: 'Envoie-lui par SMS un lien qui ouvre son espace, valable 48 h. Trois liens au plus par jour pour un même client.'
  },
  {
    id: 'clients.account-revoke', page: '/comptoir/clients', target: 'client-account-revoke', order: 62,
    title: 'Déconnecter ses appareils',
    body: 'Ferme son espace sur tous ses téléphones. Utile s’il a perdu le sien : il se reconnecte avec un code par SMS.'
  },
  {
    id: 'clients.account-detach', page: '/comptoir/clients', target: 'client-account-detach', order: 63, roles: ['owner', 'manager', 'desk'],
    title: 'Numéro réattribué ? Détacher ce numéro',
    body: 'Retire le numéro de cette fiche et ferme son espace. À utiliser quand l’opérateur a donné ce numéro à quelqu’un d’autre.'
  },
  {
    id: 'reglages.espace-client', page: '/comptoir/reglages/reservation', target: 'espace-client', order: 20, roles: ['owner'],
    title: 'Espace client sur le site',
    body: 'Ouvre ou ferme l’espace où tes clients retrouvent leurs rendez-vous et leurs reçus avec un code SMS. Le chiffre dessous dit combien l’utilisent.'
  }
];

export default steps;
