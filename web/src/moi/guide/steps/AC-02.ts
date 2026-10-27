// AC-02 · What /moi explains of the Profil tab, part by part.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  {
    id: 'moi.profile-barber', page: '/moi/profil', target: 'profile-barber', roles: ['client'], order: 10,
    title: 'Mon barbier',
    body: 'Choisis le barbier que tu préfères, ou « Peu importe ». Ton choix est noté sur ta fiche : le salon sait qui tu préfères.'
  },
  {
    id: 'moi.profile-infos', page: '/moi/profil', target: 'profile-infos', roles: ['client'], order: 20,
    title: 'Mes infos',
    body: 'Corrige ton prénom, ton nom ou ton anniversaire : ça s’enregistre tout seul. Pour changer de numéro ou d’e-mail, dis-le au salon.'
  },
  {
    id: 'moi.profile-messages', page: '/moi/profil', target: 'profile-messages', roles: ['client'], order: 30,
    title: 'Messages',
    body: 'Choisis si tu veux les SMS de confirmation et de rappel, et les bons plans du salon. Les bons plans ne sont jamais imposés : tu peux les couper à tout moment.'
  },
  {
    id: 'moi.profile-data', page: '/moi/profil', target: 'profile-data', roles: ['client'], order: 40,
    title: 'Mes données',
    body: 'Reçois par e-mail tout ce que le salon garde de toi, ou demande l’effacement de ta fiche. Le salon s’en occupe sous un mois.'
  },
  {
    id: 'moi.profile-session', page: '/moi/profil', target: 'profile-session', roles: ['client'], order: 50,
    title: 'Mon espace',
    body: 'Déconnecte ce téléphone ou tous tes appareils, ou supprime ton espace. Ta fiche au salon reste, avec tes rendez-vous.'
  }
];

export default steps;
