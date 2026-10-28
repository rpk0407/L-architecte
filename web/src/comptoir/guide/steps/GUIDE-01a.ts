// GUIDE-01a · The owner's tour of Mise en route, Agenda, Caisse and Clients, in the order of a day at the salon (the
// places and their order: web/src/ui/tour/order.ts). Each step names the part as the screen shows it, says what it does
// and when to use it. A part that only some people see says who (roles); the others follow the page's own rights.
import type { GuideStep } from '../../../lib/guide';

const BOSS: GuideStep['roles'] = ['owner', 'manager'];
const TILL: GuideStep['roles'] = ['owner', 'manager', 'desk'];

const steps: GuideStep[] = [
  /* ---------------- Réglages › Mise en route (the owner's first page) ---------------- */
  { id: 'mer.head', page: '/comptoir/reglages/mise-en-route', target: 'mer-head', roles: ['owner'], order: 10,
    title: 'Mise en route', body: 'Ce qu’il reste à faire avant d’ouvrir le salon au public, et où tu en es. La barre avance toute seule à chaque étape cochée.' },
  { id: 'mer.replay', page: '/comptoir/reglages/mise-en-route', target: 'mer-replay', roles: ['owner'], order: 20,
    title: 'Revoir la visite', body: 'Relance cette visite depuis le début, quand tu veux. Le « ? » en haut de chaque page ne montre que cette page.' },
  { id: 'mer.list', page: '/comptoir/reglages/mise-en-route', target: 'mer-list', roles: ['owner'], order: 30,
    title: 'Étapes de mise en route', body: 'Fais-les dans l’ordre : chacune compte sur les précédentes. Chaque ligne dit ce qui manque et son bouton t’emmène au bon écran.' },
  { id: 'mer.features', page: '/comptoir/reglages/mise-en-route', target: 'mer-features', roles: ['owner'], order: 40,
    title: 'Nouveautés', body: 'Les fonctions qui attendent un réglage ou un feu vert avant de s’allumer. Chaque ligne dit ce qu’elle attend et mène à son réglage.' },

  /* ---------------- Agenda ---------------- */
  { id: 'agenda.date', page: '/comptoir/agenda', target: 'ag-date', order: 10,
    title: 'Le jour affiché', body: 'Les flèches passent au jour d’avant ou d’après, et un appui sur la date ouvre le calendrier. « Aujourd’hui » te ramène au jour même.' },
  { id: 'agenda.view', page: '/comptoir/agenda', target: 'ag-view', order: 20,
    title: 'Jour ou Semaine', body: 'La semaine montre d’un coup d’œil les rendez-vous de chacun, jour par jour. Touche un jour pour revenir à son planning.' },
  { id: 'agenda.block', page: '/comptoir/agenda', target: 'ag-block', order: 30,
    title: 'Bloquer', body: 'Ferme un créneau pour une pause ou un rendez-vous perso : le site ne le propose plus. Touche-le dans le planning pour le rouvrir.' },
  { id: 'agenda.walkin', page: '/comptoir/agenda', target: 'ag-walkin', order: 40,
    title: 'Passage', body: 'Un client entre sans rendez-vous : ajoute-le à la file d’attente. Le temps d’attente affiché sur le site suit tout seul.' },
  { id: 'agenda.new', page: '/comptoir/agenda', target: 'ag-new', order: 50,
    title: 'Rendez-vous', body: 'Prends un rendez-vous au téléphone ou au comptoir : le client, la prestation, le barbier et l’heure. La touche N fait pareil au clavier.' },
  { id: 'agenda.kpis', page: '/comptoir/agenda', target: 'ag-kpis', order: 60,
    title: 'La journée en chiffres', body: 'Ce qui est fait, ce qui reste et le remplissage, en direct. Le prochain client s’ouvre d’un appui.' },
  { id: 'agenda.board', page: '/comptoir/agenda', target: 'ag-board', order: 70,
    title: 'Le planning', body: 'Une colonne par barbier, la ligne de l’heure qui avance. Touche un rendez-vous pour l’ouvrir ou fais-le glisser pour le déplacer, et touche une case libre pour en créer un.' },
  { id: 'agenda.queue', page: '/comptoir/agenda', target: 'ag-queue', order: 80,
    title: 'La file', body: 'Les clients sans rendez-vous, dans l’ordre d’arrivée. Préviens-les par SMS quand leur tour approche, puis installe-les chez le barbier libre.' },
  { id: 'agenda.topay', page: '/comptoir/agenda', target: 'ag-topay', order: 90,
    title: 'À encaisser', body: 'Les prestations finies qui attendent leur ticket. Touche une ligne pour l’ouvrir directement en caisse.' },
  { id: 'agenda.feed', page: '/comptoir/agenda', target: 'ag-feed', order: 100,
    title: 'Le fil', body: 'Tout ce qui arrive en direct : réservations du site, annulations, paiements. Touche une ligne pour voir le rendez-vous.' },
  { id: 'agenda.waitlist', page: '/comptoir/agenda', target: 'ag-waitlist', order: 110,
    title: 'Liste d’attente', body: 'Les clients qui attendent qu’une place se libère ce jour-là. Dès qu’un créneau s’ouvre, il leur est proposé par SMS et gardé 30 minutes.' },
  { id: 'agenda.week', page: '/comptoir/agenda', target: 'ag-week', order: 120,
    title: 'La semaine', body: 'Chaque barbier, chaque jour : ses rendez-vous et son remplissage. Touche un jour pour ouvrir son planning.' },

  /* ---------------- Caisse › Encaisser ---------------- */
  { id: 'caisse.tabs', page: '/comptoir/caisse', target: 'cs-tabs', order: 10,
    title: 'Encaisser, Ventes du jour, Caisse & clôture', body: 'Les trois temps de la caisse : encaisser un client, revoir les tickets du jour, puis compter le tiroir et clôturer le soir.' },
  { id: 'caisse.online', page: '/comptoir/caisse', target: 'cs-online', roles: TILL, order: 15,
    title: 'En ligne · à traiter', body: 'Les paiements du site qui demandent une décision : l’acompte d’un absent, un litige, un remboursement. Chaque ligne dit quoi faire.' },
  { id: 'caisse.free', page: '/comptoir/caisse', target: 'cs-free', order: 20,
    title: 'Vente libre', body: 'Un produit, une carte cadeau ou un client sans rendez-vous : ouvre un ticket vide. Associe-le à un client pour que la vente aille sur sa fiche.' },
  { id: 'caisse.topay', page: '/comptoir/caisse', target: 'cs-topay', order: 30,
    title: 'À encaisser', body: 'Les rendez-vous terminés ou au fauteuil arrivent ici d’eux-mêmes. Touche un client : sa prestation, son barbier et son acompte sont déjà sur le ticket.' },
  { id: 'caisse.later', page: '/comptoir/caisse', target: 'cs-later', order: 40,
    title: 'Plus tard aujourd’hui', body: 'Les rendez-vous qui viennent, si un client veut payer avant sa coupe.' },

  /* ---------------- Caisse › the ticket (the first client waiting, or a free sale) ---------------- */
  { id: 'caisse.ticket', page: '/comptoir/caisse', target: 'tk-head', order: 10,
    title: 'Le ticket', body: 'Le client et le rendez-vous d’où vient le ticket, avec ses pastilles : fidèle, abonné, carnet. « Fermer » l’abandonne sans rien enregistrer.' },
  { id: 'caisse.lines', page: '/comptoir/caisse', target: 'tk-lines', order: 30,
    title: 'Les lignes', body: 'Touche une ligne pour changer qui l’a faite, son prix ou la payer avec un carnet. « Retirer » l’enlève du ticket.' },
  { id: 'caisse.add', page: '/comptoir/caisse', target: 'tk-add', order: 40,
    title: 'Ajouter, Remise, Pourboire', body: 'Ajoute un produit ou une prestation, une remise avec son motif, ou le pourboire laissé au barbier.' },
  { id: 'caisse.methods', page: '/comptoir/caisse', target: 'tk-methods', order: 60,
    title: 'Comment paie-t-il ?', body: 'Carte, espèces, QR code ou carte cadeau, et tu peux en mélanger plusieurs. Les espèces calculent la monnaie à rendre.' },
  { id: 'caisse.validate', page: '/comptoir/caisse', target: 'tk-validate', order: 70,
    title: 'Valider l’encaissement', body: 'S’allume quand tout est payé. L’écran suivant propose le reçu et son prochain rendez-vous.' },

  /* ---------------- Caisse › Ventes du jour ---------------- */
  { id: 'ventes.day', page: '/comptoir/caisse/ventes', target: 'sales-day', order: 10,
    title: 'Le jour des ventes', body: 'Les flèches remontent les jours passés, pour retrouver un ticket.' },
  { id: 'ventes.kpis', page: '/comptoir/caisse/ventes', target: 'sales-kpis', order: 20,
    title: 'Chiffre du jour', body: 'Le chiffre TTC net, le nombre de tickets, les moyens de paiement et les pourboires, comme sur le Z du soir.' },
  { id: 'ventes.list', page: '/comptoir/caisse/ventes', target: 'sales-list', order: 30,
    title: 'Les tickets', body: 'Touche un ticket pour le revoir ou le réimprimer. Une erreur se corrige par un remboursement, jamais en effaçant.' },

  /* ---------------- Caisse › Caisse & clôture ---------------- */
  { id: 'cloture.drawer', page: '/comptoir/caisse/cloture', target: 'cl-drawer', roles: TILL, order: 10,
    title: 'Le tiroir', body: 'Ouvre la caisse le matin avec son fond, note un apport ou un retrait dans la journée. Le soir, compte-la : l’écart s’affiche tout seul.' },
  { id: 'cloture.z', page: '/comptoir/caisse/cloture', target: 'cl-z', roles: BOSS, order: 20,
    title: 'Clôture du jour', body: 'Le Z scelle la journée : plus aucun ticket de ce jour ne bouge ensuite. Le Comptoir te prévient s’il reste des clients à encaisser.' },
  { id: 'cloture.history', page: '/comptoir/caisse/cloture', target: 'cl-history', roles: BOSS, order: 30,
    title: 'Les dernières clôtures', body: 'Chaque Z avec son numéro, et le grand total perpétuel qui ne fait que grandir. Imprime-les pour ton comptable.' },
  { id: 'cloture.months', page: '/comptoir/caisse/cloture', target: 'cl-months', roles: BOSS, order: 40,
    title: 'Clôtures mensuelles', body: 'Chaque mois fini est additionné et signé, tout seul dès que ses jours sont clos. Imprime-le pour ton comptable.' },

  /* ---------------- Clients › the list ---------------- */
  { id: 'clients.search', page: '/comptoir/clients', target: 'cl-search', order: 10,
    title: 'Rechercher un client', body: 'Tape un nom ou les derniers chiffres de son numéro. « Nouveau » crée une fiche.' },
  { id: 'clients.segments', page: '/comptoir/clients', target: 'cl-segs', order: 20,
    title: 'Les segments', body: 'Tous, à relancer, fidèles, abonnés… chaque pastille filtre la liste et dit combien ils sont.' },
  { id: 'clients.tools', page: '/comptoir/clients', target: 'cl-tools', order: 30,
    title: 'Trier', body: 'Range la liste par visite récente, par dépense ou par retard sur son rythme. Le gérant l’exporte en CSV avec l’icône à droite.' },
  { id: 'clients.rows', page: '/comptoir/clients', target: 'cl-rows', order: 40,
    title: 'La liste', body: 'Chaque ligne dit quand il revient ou depuis quand il n’est pas venu, sa dépense et ses visites. Touche-la pour ouvrir sa fiche.' },

  /* ---------------- Clients › a client's file ---------------- */
  { id: 'clients.file-head', page: '/comptoir/clients/:id', target: 'file-head', order: 10,
    title: 'La fiche du client', body: 'Son nom, ses badges, son numéro et depuis quand il vient. « Prendre RDV » lui réserve une place, le crayon corrige sa fiche.' },
  { id: 'clients.file-kpis', page: '/comptoir/clients/:id', target: 'file-kpis', order: 30,
    title: 'Visites, Rythme, Dépensé, Absences', body: 'Son rythme se calcule dès deux visites : c’est lui qui dit quand le relancer. Les absences comptent ses rendez-vous manqués.' },
  { id: 'clients.file-tech', page: '/comptoir/clients/:id', target: 'file-tech', order: 40,
    title: 'Fiche technique', body: 'Sa coupe en quelques mots, pour que n’importe quel barbier la refasse. Les notes privées restent dans l’équipe, mais il peut demander à les lire.' },
  { id: 'clients.file-prefs', page: '/comptoir/clients/:id', target: 'file-prefs', order: 50,
    title: 'Préférences', body: 'Ses étiquettes, et ses deux sortes de SMS : les rappels d’un côté, les bons plans de l’autre. Il peut répondre STOP aux bons plans.' },
  { id: 'clients.file-history', page: '/comptoir/clients/:id', target: 'file-history', order: 90,
    title: 'Rendez-vous, Tickets, Messages', body: 'Tout son passé au salon et chaque SMS qu’il a reçu. Touche une ligne pour l’ouvrir.' }
];

export default steps;
