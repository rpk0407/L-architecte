// What the WordPress takeover says about its new parts (the QA round): how the first lines were read, the lines nobody could
// read, the models of the two small files, Jour J. Data only; the tour reads it. The older parts are in GUIDE-01b.ts.
import type { GuideStep } from '../../../lib/guide';

const PAGE = '/comptoir/reglages/wordpress';
const OWNER: GuideStep['roles'] = ['owner'];

const steps: GuideStep[] = [
  { id: 'reglages.wp-modeles', page: PAGE, target: 'wp-modeles', roles: OWNER, order: 12, title: 'Modèles à remplir', body: 'Pour les cartes cadeaux papier et les carnets en cours, télécharge le modèle, remplis-le dans Excel et dépose-le avec les autres fichiers. Une ligne par carte ou par carnet.' },
  { id: 'reglages.wp-lecture', page: PAGE, target: 'wp-lecture', roles: OWNER, order: 25, title: 'Comment j’ai lu tes lignes', body: 'Les trois premières lignes du fichier, telles qu’elles ont été comprises : date, nom, prestation, barbier, prix. Si l’une est fausse, retire le fichier et refais l’export.' },
  { id: 'reglages.wp-soucis', page: PAGE, target: 'wp-soucis', roles: OWNER, order: 26, title: 'Lignes illisibles', body: 'Les lignes que la lecture n’a pas pu comprendre, avec leur fichier et leur numéro de ligne. Télécharge la liste pour la donner à ton prestataire : le rapport la garde aussi.' },
  { id: 'reglages.jj-backup', page: PAGE, target: 'jj-backup', roles: OWNER, order: 6, title: 'Sauvegarde avant d’importer', body: 'La dernière sauvegarde chiffrée, et « Sauvegarder maintenant » pour en faire une avant le premier passage ou la synchro finale. Une reprise ne s’annule pas, une sauvegarde se restaure.' },
  { id: 'reglages.jj-values', page: PAGE, target: 'jj-values', roles: OWNER, order: 7, title: 'Valeurs DNS à copier', body: 'Les deux lignes à mettre chez IONOS, chacune avec son bouton « Copier ». Supprime les anciennes lignes A, AAAA et CNAME du domaine.' },
  { id: 'reglages.jj-rollback', page: PAGE, target: 'jj-rollback', roles: OWNER, order: 8, title: 'Annuler la bascule', body: 'Si le nouveau site ne tient pas, le plan de retour se termine ici : les envois se ferment, blocage et bascule sont à refaire. La liste des rendez-vous à ressaisir reste complète.' },
  // the till: a booking taken over from the old site, with its deposit and its note (no roles: whoever opens the till sees it)
  { id: 'caisse.ancien', page: '/comptoir/caisse', target: 'tk-old', order: 12, title: 'Acompte de l’ancien site', body: 'Un rendez-vous repris de WordPress rappelle ici l’acompte déjà payé là-bas et la note du client. Touche « Payé sur l’ancien site » pour le déduire, une seule fois.' }
];

export default steps;
