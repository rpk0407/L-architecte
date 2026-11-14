// What the readiness parts say about themselves: the salon put in place in one gesture (Mise en route), the public
// holidays proposed in Horaires, and the appointments a new weekly day off leaves outside a barber's hours (Équipe).
// Data only; the parts carry the data-guide ids below (Preset.tsx, Horaires.tsx, Equipe.tsx).
import type { GuideRole, GuideStep } from '../../../lib/guide';

const OWNER: GuideRole[] = ['owner'];
const SHOP: GuideRole[] = ['owner', 'manager'];

const steps: GuideStep[] = [
  { id: 'mer.preset', page: '/comptoir/reglages/mise-en-route', target: 'mer-preset', roles: OWNER, order: 15, title: 'Le salon, en un geste', body: 'L’équipe et ses horaires, la carte, les horaires du salon et ses règles, tels qu’ils sont sur l’ancien site. Tu lis tout avant de confirmer, et ce qui existe déjà n’est jamais modifié.' },
  { id: 'reglages.horaires-feries', page: '/comptoir/reglages/horaires', target: 'horaires-feries', roles: OWNER, order: 25, title: 'Jours fériés', body: 'Les jours fériés des 12 mois à venir où le salon serait ouvert. Touche ceux où tu ne travailles pas, les autres restent ouverts.' },
  { id: 'equipe.hors-horaires', page: '/comptoir/equipe/:id', target: 'equipe-hors-horaires', roles: SHOP, order: 25, title: 'Hors de ses horaires', body: 'Les rendez-vous déjà pris qui tombent sur son nouveau jour de repos. Rien n’est annulé tout seul : reporte chaque journée, le client est prévenu par SMS.' }
];
export default steps;
