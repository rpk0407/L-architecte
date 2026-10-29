// What the WordPress takeover says about its new parts (the QA round): how the first lines were read, the lines nobody could
// read, the models of the two small files, Jour J. Data only; the tour reads it. The older parts are in GUIDE-01b.ts.
import type { GuideStep } from '../../../lib/guide';

const PAGE = '/comptoir/reglages/wordpress';
const OWNER: GuideStep['roles'] = ['owner'];

const steps: GuideStep[] = [
  { id: 'reglages.wp-modeles', page: PAGE, target: 'wp-modeles', roles: OWNER, order: 12, title: 'Modèles à remplir', body: 'Pour les cartes cadeaux papier et les carnets en cours, télécharge le modèle, remplis-le dans Excel et dépose-le avec les autres fichiers. Une ligne par carte ou par carnet.' },
  { id: 'reglages.wp-lecture', page: PAGE, target: 'wp-lecture', roles: OWNER, order: 25, title: 'Comment j’ai lu tes lignes', body: 'Les trois premières lignes du fichier, telles qu’elles ont été comprises : date, nom, prestation, barbier, prix. Si l’une est fausse, retire le fichier et refais l’export.' },
  { id: 'reglages.wp-soucis', page: PAGE, target: 'wp-soucis', roles: OWNER, order: 26, title: 'Lignes illisibles', body: 'Les lignes que la lecture n’a pas pu comprendre, avec leur fichier et leur numéro de ligne. Télécharge la liste pour la donner à ton prestataire : le rapport la garde aussi.' }
];

export default steps;
