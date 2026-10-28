// GUIDE-01b · What the other pages say about themselves: Relances, Rapports, Équipe, Catalogue and every Réglages section
// (Mise en route, Agenda, Caisse and Clients are GUIDE-01a's; Abonnements, Fidélité and Espace client have their own files).
// Data only: the parts carry the data-guide ids below, and each step names who sees it, so the desk's tour is the pages it
// can open and a barber's tour never reaches a page his rights keep shut.
import type { GuideRole, GuideStep } from '../../../lib/guide';

const OWNER: GuideRole[] = ['owner'];
const SHOP: GuideRole[] = ['owner', 'manager'];
const DESK: GuideRole[] = ['owner', 'manager', 'desk'];
const SHOP_BARBER: GuideRole[] = ['owner', 'manager', 'barber'];
const ALL: GuideRole[] = ['owner', 'manager', 'desk', 'barber'];

const step = (page: string, id: string, target: string, roles: GuideRole[], order: number, title: string, body: string): GuideStep => ({ id, page, target, roles, order, title, body });

const R = '/comptoir/relances';
const RP = '/comptoir/rapports';
const EQ = '/comptoir/equipe';
const CA = '/comptoir/catalogue';
const RG = '/comptoir/reglages';

const steps: GuideStep[] = [
  // ---- Relances
  step(R, 'relances.tabs', 'relances-tabs', DESK, 10, 'Les quatre onglets', 'À relancer, Liste d’attente, Demandes et Messages envoyés. Un nombre sur un onglet dit combien de lignes attendent quelqu’un.'),
  step(R, 'relances.kpis', 'relances-kpis', DESK, 20, 'À relancer, Relancés, Revenus', 'Les clients en retard, ceux que tu as relancés ces 60 derniers jours, et ceux qui ont repris rendez-vous. Ce dernier chiffre compte les clients revenus dans les 21 jours après le SMS.'),
  step(R, 'relances.list', 'relances-list', DESK, 30, 'Clients à relancer', 'Les habitués qui ont dépassé leur rythme, seulement ceux d’accord pour les bons plans. Coche ceux à qui écrire, ou touche un nom pour ouvrir sa fiche.'),
  step(R, 'relances.message', 'relances-message', DESK, 40, 'Le message', 'Écris le SMS, ajoute {prenom}, {jours} ou {lien} avec les pastilles et vérifie l’aperçu. Personne n’est relancé deux fois le même jour, et la mention STOP est ajoutée toute seule.'),
  step(R, 'relances.auto', 'relances-auto', DESK, 50, 'Messages automatiques', 'Ce qui part sans toi : confirmation, rappels, demande d’avis, place libérée. Le gérant les règle dans Réglages › Messages.'),
  step(R + '/attente', 'attente.kpis', 'attente-kpis', DESK, 10, 'En attente, Inscrits, Placés', 'Combien de personnes attendent une place, combien se sont inscrites ces 30 derniers jours, et combien ont obtenu un créneau.'),
  step(R + '/attente', 'attente.rule', 'attente-rule', DESK, 20, 'Comment une place est proposée', 'Un rendez-vous annulé est proposé par SMS au premier inscrit compatible, qui a 30 minutes pour répondre. Sinon la place passe au suivant, sans que personne ait rien à faire.'),
  step(R + '/attente', 'attente.list', 'attente-list', DESK, 30, 'Liste d’attente', 'Les inscrits du site, jour par jour, avec le créneau qu’ils veulent. L’accueil et le gérant peuvent retirer quelqu’un avec la croix.'),
  step(R + '/demandes', 'demandes.seg', 'demandes-seg', DESK, 10, 'À traiter, Traitées', 'À traiter garde les nouvelles demandes du site, Traitées celles que tu as rangées, Toutes les deux ensemble.'),
  step(R + '/demandes', 'demandes.card', 'demandes-card', DESK, 20, 'Une demande', 'Un message du site (Contact, Formations) ou une réponse par SMS arrive ici. Réponds par SMS et elle passe en traitée ; après un appel ou un e-mail, touche Marquer traité.'),
  step(R + '/envoyes', 'envoyes.list', 'envoyes-list', DESK, 10, 'Derniers messages', 'Chaque SMS ou e-mail parti du salon, avec son état : envoyé, prévu ou en échec. Le motif de chaque échec est dans sa ligne.'),

  // ---- Rapports (the owner's and manager's figures of the salon; a barber's are his own)
  step(RP, 'rapports.filters', 'rapports-filters', SHOP, 10, 'Période et barbier', 'Choisis la période, puis un barbier si tu veux ses chiffres seuls. Tout ce qui suit se recalcule et se compare à la période d’avant.'),
  step(RP, 'rapports.filters-own', 'rapports-filters', ['barber'], 10, 'Période', 'Choisis la période : tes chiffres se recalculent et se comparent à la période d’avant.'),
  step(RP, 'rapports.goal', 'rapports-goal', OWNER, 20, 'Objectif du mois', 'Où en est le salon face à ton objectif, avec la projection de fin de mois au rythme actuel ; avec un barbier choisi, c’est le sien. Tu fixes les cibles dans Réglages › Objectifs.'),
  step(RP, 'rapports.goal-manager', 'rapports-goal', ['manager'], 20, 'Objectif du mois', 'Où en est le salon face à l’objectif, avec la projection de fin de mois au rythme actuel ; avec un barbier choisi, c’est le sien. C’est le propriétaire du salon qui fixe les cibles.'),
  step(RP, 'rapports.goal-own', 'rapports-goal', ['barber'], 20, 'Mon objectif', 'Ton objectif du mois, mesuré sur ce que tu réalises, avec ce qu’il te faut par jour ouvré pour l’atteindre. Il n’apparaît que si le gérant l’a ouvert.'),
  step(RP, 'rapports.kpis', 'rapports-kpis', SHOP, 30, 'Chiffre d’affaires, Panier moyen, Clients', 'Les chiffres clés de la période, chacun comparé à la précédente : remplissage, absences et pourboires compris. Un barbier choisi plus haut les restreint à lui.'),
  step(RP, 'rapports.kpis-own', 'rapports-kpis', ['barber'], 30, 'Mes chiffres', 'Ton chiffre, ta commission estimée, tes pourboires et ton panier moyen. « Repris avant de partir » dit la part de tes clients qui ont repris rendez-vous avant de quitter le fauteuil.'),
  step(RP, 'rapports.statement', 'rapports-statement', SHOP, 40, 'Relevé du mois', 'Le relevé imprimable d’un barbier : réalisé, commission, pourboires, coupes de carnet et d’abonnement. Il apparaît dès que tu choisis un barbier.'),
  step(RP, 'rapports.statement-own', 'rapports-statement', ['barber'], 40, 'Mon relevé du mois', 'Ton relevé à imprimer : ce que tu as réalisé, ta commission et tes pourboires. C’est une estimation, la paie fait foi.'),
  step(RP, 'rapports.days', 'rapports-days', SHOP_BARBER, 50, 'Chiffre par jour', 'Une barre par jour, ou par semaine au-delà de 45 jours, avec la période précédente en pointillés. Elle montre d’un coup d’œil les jours forts et les creux.'),
  step(RP, 'rapports.insights', 'rapports-insights', SHOP_BARBER, 60, 'Ce que disent les chiffres', 'Jusqu’à quatre constats tirés de la période : heure pleine ou vide, coût des absences, rendez-vous repris. Lis-les d’abord, ils disent où regarder.'),
  step(RP, 'rapports.heat', 'rapports-heat', SHOP_BARBER, 70, 'Quand les fauteuils sont pleins', 'Chaque case est une heure d’un jour de la semaine : plus c’est rouge, plus c’est plein, et le survol donne le pourcentage. Sers-t’en pour placer les pauses, les congés et les relances.'),
  step(RP, 'rapports.sources', 'rapports-sources', SHOP_BARBER, 80, 'D’où viennent les rendez-vous', 'La part des rendez-vous pris sur le site, au salon, par téléphone ou autrement. Elle dit si la réservation en ligne prend sa place.'),
  step(RP, 'rapports.services', 'rapports-services', SHOP_BARBER, 90, 'Prestations', 'Les prestations de la période classées par chiffre, avec le nombre de fois vendues. Les produits suivent en dessous.'),
  step(RP, 'rapports.team', 'rapports-team', SHOP, 100, 'L’équipe', 'Une ligne par barbier : chiffre, commission estimée selon les règles écrites dans l’en-tête, pourboires. Touche un nom pour le détail et son relevé du mois.'),
  step(RP, 'rapports.teamview', 'rapports-teamview', ['barber'], 100, 'L’équipe', 'Les chiffres de tes collègues, sans leurs commissions ni leurs pourboires. Tu ne les vois que si le gérant l’a décidé, dans Réglages › Équipe et accès.'),
  step(RP, 'rapports.avis', 'rapports-avis', SHOP, 110, 'Avis Google', 'Combien de demandes d’avis sont parties après les visites et combien de liens ont été ouverts, par barbier. Les avis eux-mêmes se lisent sur ta fiche Google.'),
  step(RP, 'rapports.exports', 'rapports-exports', SHOP, 120, 'Exports', 'Les fichiers de la période affichée : ventes, TVA et clôtures Z, commissions ; la paie est celle du mois. Donne-les à ton comptable, ils s’ouvrent dans Excel.'),

  // ---- Équipe
  step(EQ, 'equipe.bar', 'equipe-bar', SHOP, 10, 'Poser une absence, Ajouter', 'Pose une absence pour quelqu’un, ou ajoute un membre avec Ajouter. Il reprend les horaires du salon, à ajuster sur sa fiche.'),
  step(EQ, 'equipe.requests', 'equipe-requests', SHOP, 20, 'Demandes d’absence', 'Quand un barbier demande une absence, elle apparaît ici. Valide ou refuse : en validant, tu peux replacer ses clients tout de suite.'),
  step(EQ, 'equipe.list', 'equipe-list', SHOP, 30, 'Les cartes de l’équipe', 'Une carte par personne : où elle en est aujourd’hui, ses jours travaillés, ses rendez-vous, son accès. Touche une carte pour ouvrir sa fiche.'),
  step(EQ, 'equipe.absences', 'equipe-absences', SHOP, 40, 'Absences à venir', 'Toutes les absences prévues, avec les rendez-vous à replacer. Touche « à replacer » pour décider qui reprend ses clients.'),
  step(EQ + '/:id', 'equipe.profil', 'equipe-profil', SHOP, 10, 'Sa fiche', 'Son nom, sa couleur dans l’agenda, son rôle, et s’il a un fauteuil et se réserve en ligne. Les modifications s’enregistrent avec le bouton qui apparaît.'),
  step(EQ + '/:id', 'equipe.horaires', 'equipe-horaires', SHOP, 20, 'Horaires de la semaine', 'Ses plages de travail, jour par jour, à l’intérieur des horaires du salon. Le site ne propose jamais un créneau hors de ces plages.'),
  step(EQ + '/:id', 'equipe.prestations', 'equipe-prestations', SHOP, 30, 'Ce qu’il fait', 'Coche les prestations qu’il assure : le site ne lui propose que celles-là. Tout cocher veut dire toutes les prestations.'),
  step(EQ + '/:id', 'equipe.commission', 'equipe-commission', SHOP, 40, 'Rémunération', 'Ses taux de commission sur les prestations et sur les produits. Ils servent à sa commission estimée et à son relevé de paie.'),
  step(EQ + '/:id', 'equipe.acces', 'equipe-acces', SHOP, 50, 'Accès', 'Son code PIN, son mot de passe et ses téléphones liés. Déconnecter partout ferme toutes ses sessions, Désactiver le retire en gardant son historique.'),
  step(EQ + '/:id', 'equipe.phones', 'equipe-phones', SHOP, 60, 'Lier son téléphone', 'Affiche un QR code que la personne scanne avec son téléphone, puis elle tape son code. Le QR vaut 10 minutes et ne sert qu’une fois.'),

  // ---- Catalogue
  step(CA, 'catalogue.tabs', 'catalogue-tabs', SHOP, 10, 'Prestations, Produits & stock, Cartes cadeaux', 'Les prix du salon, les produits en rayon et les cartes cadeaux vendues.'),
  step(CA, 'catalogue.bar', 'catalogue-bar', SHOP, 20, 'Nouvelle prestation', 'Crée une prestation, ou reprends d’un geste la carte de l’ancien site quand la liste est vide. L’ordre ici est celui du site.'),
  step(CA, 'catalogue.prestations', 'catalogue-prestations', SHOP, 30, 'Prestations', 'Une carte par catégorie, avec prix, durée, acompte et visibilité sur le site. Touche une prestation pour la modifier, la déplacer ou l’archiver.'),
  step(CA, 'catalogue.carnet', 'catalogue-prestations', SHOP, 40, 'Vendre un carnet', 'Dans la fiche d’une prestation, active « C’est un carnet » : tu fixes le nombre de passages, leur validité et les prestations couvertes. La caisse décompte chaque passage.'),
  step(CA + '/produits', 'catalogue.stock', 'catalogue-stock', SHOP, 10, 'Références, Valeur du stock, À commander', 'Le nombre de produits, la valeur du stock au prix d’achat et ceux à recommander. Un produit passe en « à commander » à son seuil d’alerte ou en dessous.'),
  step(CA + '/produits', 'catalogue.inventaire', 'catalogue-inventaire', SHOP, 20, 'Inventaire', 'Saisis ce que tu comptes en rayon : seuls les écarts avec le stock enregistré sont corrigés. Laisse vide ce que tu n’as pas compté.'),
  step(CA + '/produits', 'catalogue.produits', 'catalogue-produits', SHOP, 30, 'Produits', 'Prix, achat, marge et stock de chaque produit, les plus bas d’abord. Touche le nom pour modifier, Stock pour ajouter ou retirer des unités.'),
  step(CA + '/cartes', 'catalogue.cartes-kpis', 'catalogue-cartes-kpis', SHOP, 10, 'En circulation, Vendues, Expirent bientôt', 'Ce que représentent les cartes encore utilisables, combien ont été vendues, et celles qui expirent dans les 30 jours. Une carte est une dette envers le client, pas du chiffre d’affaires.'),
  step(CA + '/cartes', 'catalogue.code', 'catalogue-code', SHOP, 20, 'Vérifier un code', 'Tape le code d’une carte pour lire son solde et sa date de fin. Vendre une carte cadeau ouvre la caisse.'),
  step(CA + '/cartes', 'catalogue.cartes', 'catalogue-cartes', SHOP, 30, 'Toutes les cartes', 'Les cartes vendues, avec leurs quatre derniers caractères et leur solde. Touches-en une pour voir son détail, renvoyer son code ou la réémettre.'),

  // ---- Réglages (the owner's sections; Mon compte is everyone's)
  step(RG, 'reglages.nav', 'reglages-nav', SHOP, 10, 'Les sections', 'Les réglages sont rangés par groupe : Démarrage, Moi, Salon, Sécurité. Chacun ne voit que les sections que ses droits ouvrent.'),
  step(RG, 'reglages.nav-own', 'reglages-nav', ['desk', 'barber'], 10, 'Mon compte', 'Tu n’as ici que Mon compte : ton profil, ton téléphone, ton code et tes sessions. Le reste des réglages est au propriétaire du salon.'),
  step(RG + '/compte', 'reglages.compte-profil', 'compte-profil', ALL, 10, 'Ton profil', 'Ta photo, et pour un fauteuil ta couleur dans l’agenda, ta présentation et ton Instagram. La présentation s’affiche sur le site.'),
  step(RG + '/compte', 'reglages.compte-telephone', 'compte-telephone', ALL, 20, 'Mon téléphone', 'Lie ton téléphone avec un QR code : il s’ouvre ensuite avec ton code une fois par jour. Tes téléphones liés sont listés ici, retires-en un s’il est perdu.'),
  step(RG + '/compte', 'reglages.compte-comptoir', 'compte-comptoir', ALL, 30, 'Mon Comptoir', 'Choisis ta page d’accueil et les alertes que tu reçois : tes clients, tout le salon ou rien. Vibrer fait vibrer ton téléphone avec chaque alerte.'),
  step(RG + '/compte', 'reglages.compte-agenda', 'compte-agenda', ALL, 40, 'Mon agenda dans mon téléphone', 'Active-le pour voir tes rendez-vous dans Apple ou Google Agenda, mis à jour tout seul. Un nouveau lien coupe l’ancien.'),
  step(RG + '/compte', 'reglages.compte-pin', 'compte-pin', ALL, 50, 'Code PIN', 'Ton code de 4 à 6 chiffres ouvre les appareils du salon en deux secondes. Choisis-en un difficile à deviner : il protège la caisse.'),
  step(RG + '/compte', 'reglages.compte-mdp', 'compte-mdp', ALL, 60, 'Mot de passe', 'Il te connecte de n’importe où, chez toi ou en déplacement. Le changer ferme tes autres sessions.'),
  step(RG + '/compte', 'reglages.compte-sessions', 'compte-sessions', ALL, 70, 'Sessions', 'Un téléphone perdu ? Me déconnecter partout ferme toutes tes sessions d’un coup, il faudra te reconnecter.'),
  step(RG + '/compte', 'reglages.compte-absences', 'equipe-mes-absences', SHOP_BARBER, 65, 'Mes absences', 'Touche Poser pour déclarer une absence. Si le gérant doit la valider, tes créneaux restent ouverts jusqu’à sa réponse.'),
  step(RG + '/salon', 'reglages.salon-coordonnees', 'salon-coordonnees', OWNER, 10, 'Coordonnées', 'Le nom, le téléphone, l’adresse et l’e-mail du salon. Ils servent au site, aux messages et aux tickets.'),
  step(RG + '/salon', 'reglages.salon-ticket', 'salon-ticket', OWNER, 20, 'Mentions légales du ticket', 'Raison sociale, SIRET et TVA, imprimés sur chaque ticket. Le SIRET est obligatoire sur ce que tu remets au client.'),
  step(RG + '/salon', 'reglages.salon-legal', 'salon-legal', OWNER, 30, 'Site et mentions légales', 'Les pages Mentions légales, Confidentialité et CGV du site se remplissent avec ces informations. Les avertissements te disent ce qui manque.'),
  step(RG + '/horaires', 'reglages.horaires-semaine', 'horaires-semaine', OWNER, 10, 'Semaine type', 'Les heures d’ouverture du salon, jour par jour. Les horaires de chaque barbier restent à l’intérieur, et le site ne propose rien en dehors.'),
  step(RG + '/horaires', 'reglages.horaires-fermetures', 'horaires-fermetures', OWNER, 20, 'Fermetures exceptionnelles', 'Donne un motif et des dates, puis Fermer : le site ne propose plus de créneau ces jours-là. Les rendez-vous déjà pris ne sont pas annulés, déplace-les depuis l’agenda.'),
  step(RG + '/horaires', 'reglages.horaires-ouvertures', 'horaires-ouvertures', OWNER, 30, 'Ouvertures exceptionnelles', 'Un jour où le salon ouvre alors qu’il est fermé d’habitude, ou avec d’autres horaires. Le site l’annonce deux semaines avant.'),
  step(RG + '/reservation', 'reglages.reservation-prise', 'reservation-prise', OWNER, 10, 'Prise de rendez-vous', 'Ouvre ou ferme la réservation en ligne et fixe les créneaux, le délai minimum et jusqu’à quand on peut annuler. Ce dernier délai figure dans les CGV du site.'),
  step(RG + '/reservation', 'reglages.reservation-acomptes', 'reservation-acomptes', OWNER, 20, 'Acomptes et absences', 'Demande un acompte jamais, au-delà d’un montant ou toujours, en pourcentage du prix. Il protège le salon des clients qui ne viennent pas.'),
  step(RG + '/paiements', 'reglages.paiements-moyens', 'paiements-moyens', OWNER, 10, 'Moyens acceptés à la caisse', 'Allume les moyens que la caisse propose : carte, espèces, QR code, cartes cadeaux. Le QR code demande que Stripe soit branché.'),
  step(RG + '/paiements', 'reglages.paiements-pourboires', 'paiements-pourboires', OWNER, 20, 'Pourboires et TVA', 'Propose un pourboire avec les montants que tu choisis : il va au barbier, hors chiffre et hors TVA. La TVA par défaut vaut pour les nouvelles prestations.'),
  step(RG + '/paiements', 'reglages.paiements-stripe', 'paiements-stripe', OWNER, 30, 'Paiement en ligne', 'Stripe encaisse les acomptes, les QR codes et les abonnements. Recopie l’adresse du webhook et les événements dans ton compte Stripe.'),
  step(RG + '/messages', 'reglages.messages-auto', 'messages-auto', OWNER, 10, 'Envois automatiques', 'Allume ou coupe chaque message qui part tout seul, et choisis l’heure du rappel de la veille. Les avis, les relances et les places libérées attendent le matin.'),
  step(RG + '/messages', 'reglages.messages-canal', 'messages-canal', OWNER, 20, 'Canal d’envoi', 'Par où partent les SMS : le téléphone du salon, WhatsApp, Brevo ou Twilio. Envoie un test à ton portable pour vérifier la route en service.'),
  step(RG + '/messages', 'reglages.messages-avis', 'messages-avis', OWNER, 30, 'Avis Google', 'Demande un avis après chaque visite, au plus une fois par trimestre et par client. Colle le lien Google de ta fiche : le champ te dit s’il ouvre la bonne page.'),
  step(RG + '/messages', 'reglages.messages-stop', 'messages-stop', OWNER, 40, 'Bons plans et STOP', 'Les relances ne partent qu’aux clients d’accord pour les bons plans, avec la mention STOP. Un client qui répond STOP est retiré tout seul.'),
  step(RG + '/messages', 'reglages.messages-textes', 'messages-textes', OWNER, 50, 'Les textes', 'Ouvre un message pour le réécrire, avec l’aperçu et le nombre de SMS. Les mots entre accolades sont remplacés pour chaque client.'),
  step(RG + '/equipe', 'reglages.equipe-droits', 'equipe-droits', OWNER, 10, 'Ce que les barbiers peuvent faire', 'Un interrupteur par droit : encaisser, voir tout l’agenda, relancer leurs habitués, lier leur téléphone. La remise maximale se règle ici aussi.'),
  step(RG + '/equipe', 'reglages.equipe-vue', 'equipe-vue', OWNER, 20, 'Ce que chacun voit des autres', 'Choisis si un barbier voit les chiffres de ses collègues, et à quel niveau. Les commissions et les pourboires restent toujours privés.'),
  step(RG + '/equipe', 'reglages.equipe-remuneration', 'equipe-remuneration', OWNER, 30, 'Rémunération', 'Les règles qui calculent les commissions : sur le HT ou le TTC, et à qui revient une coupe de carnet, d’abonnement ou offerte. Elles changent les commissions estimées, jamais le chiffre encaissé.'),
  step(RG + '/equipe', 'reglages.equipe-matrice', 'equipe-matrice', OWNER, 40, 'Qui peut quoi', 'Le tableau de ce que chaque rôle peut faire, d’après les réglages enregistrés. Lis-le avant de donner un accès.'),
  step(RG + '/objectifs', 'reglages.objectifs-mois', 'objectifs-mois', OWNER, 10, 'Objectif de chiffre mensuel', 'Fixe le chiffre à atteindre chaque mois : Rapports le suit avec la projection de fin de mois. Des cibles réalistes sont proposées d’après le mois dernier.'),
  step(RG + '/objectifs', 'reglages.objectifs-barbiers', 'objectifs-barbiers', OWNER, 20, 'L’objectif de chaque barbier', 'Laisse un barbier vide pour qu’il suive sa part de l’objectif du salon, ou fixe le sien. Tu choisis aussi s’ils voient leur objectif dans Mes chiffres.'),
  step(RG + '/appareils', 'reglages.appareils-ici', 'appareils-ici', OWNER, 10, 'Cet appareil', 'Enregistre l’iPad du comptoir, le téléphone de la caisse ou l’ordinateur du salon : l’équipe s’y connecte avec son code en deux secondes. Ailleurs, seul le mot de passe fonctionne.'),
  step(RG + '/appareils', 'reglages.appareils-liste', 'appareils-liste', OWNER, 20, 'Appareils autorisés', 'Tous les postes qui proposent la connexion par code. Un appareil perdu ou volé : retire-le ici, il ne peut plus rien ouvrir.'),
  step(RG + '/donnees', 'reglages.donnees-integrite', 'donnees-integrite', OWNER, 10, 'Intégrité du journal', 'Chaque opération est scellée à la précédente : Vérifier relit toute la chaîne et prouve que rien n’a été modifié. Lance-le avant une clôture ou un contrôle.'),
  step(RG + '/donnees', 'reglages.donnees-sauvegardes', 'donnees-sauvegardes', OWNER, 20, 'Sauvegardes', 'Le salon entier est chiffré chaque nuit avec ta clé BACKUP_KEY. Télécharge la dernière copie ou lance Sauvegarder maintenant avant un grand changement.'),
  step(RG + '/donnees', 'reglages.donnees-exports', 'donnees-exports', OWNER, 30, 'Exports', 'Tes données t’appartiennent : l’archive du journal, les clients et la TVA s’exportent à tout moment, sans demander à personne.'),
  step(RG + '/donnees', 'reglages.donnees-rgpd', 'donnees-rgpd', OWNER, 40, 'Données personnelles (RGPD)', 'Les noms, numéros et notes des clients sont rangés à part des opérations comptables. Effacer un client ne casse donc pas la chaîne.'),
  step(RG + '/donnees', 'reglages.donnees-demo', 'donnees-demo', OWNER, 50, 'Démo', 'Remet la démo à zéro : dix semaines d’activité sont recréées autour d’aujourd’hui. Tout ce qui a été fait pendant la démo est effacé.'),
  step(RG + '/wordpress', 'reglages.wp-export', 'wp-export', OWNER, 10, '1 · Exporte depuis WordPress', 'Exporte le calendrier de l’ancien site en CSV, une année à la fois, et si tu veux le contenu complet. Le jour de la bascule, refais le même export.'),
  step(RG + '/wordpress', 'reglages.wp-fichiers', 'wp-fichiers', OWNER, 20, '2 · Dépose les fichiers', 'Glisse ici les fichiers exportés, CSV et XML. Chaque fichier est lu et compté avant que quoi que ce soit entre dans le salon.'),
  step(RG + '/wordpress', 'reglages.wp-apercu', 'wp-apercu', OWNER, 30, '3 · Ce qui va être repris', 'Après le dépôt, ce que la reprise va créer, calculé avant d’importer. Relis-le avant de valider.'),
  step(RG + '/wordpress', 'reglages.wp-correspondance', 'wp-correspondance', OWNER, 40, '4 · Fais correspondre', 'Une fois les fichiers lus, associe les prestations et les barbiers de l’ancien site à ceux d’ici. Une reprise refaite avec les mêmes fichiers ne compte rien deux fois.'),
  step(RG + '/wordpress', 'reglages.wp-rapport', 'wp-rapport', OWNER, 50, 'Rapport de la reprise', 'Après une reprise, ce qui a été repris ligne par ligne et ce qui reste à regarder. Garde-le : il prouve que rien ne s’est perdu.'),
  step(RG + '/wordpress', 'reglages.wp-jourj', 'wp-jourj', OWNER, 5, 'Jour J', 'En haut de la page dès qu’une reprise a eu lieu : les dix étapes du jour de la bascule, dans l’ordre. Les coches viennent de ce que le Comptoir vérifie, le reste c’est toi qui le dis.'),
  step(RG + '/journal', 'reglages.journal-filtres', 'journal-filtres', SHOP, 10, 'Journal d’activité', 'Filtre par type d’opération avec les pastilles, ou par personne avec Qui, pour retrouver qui a fait quoi. Chaque ligne garde son numéro et son sceau.'),
  step(RG + '/journal', 'reglages.journal-jour', 'journal-jour', SHOP, 20, 'Les jours du journal', 'Les opérations jour par jour, avec l’auteur et l’appareil. Une ligne ne se modifie jamais : une erreur se corrige par une nouvelle opération.')
];
export default steps;
