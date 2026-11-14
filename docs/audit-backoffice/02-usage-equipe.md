# Audit back-office · 02 · L'usage quotidien par l'équipe

Angle : vitesse et simplicité pour l'accueil et les 4 barbiers, sur la tablette du salon (1024×768) et au téléphone (390×844).

## Méthode et limites

- Lecture du code : `web/src/comptoir` (Agenda, Caisse, Clients, Équipe, Mon espace, Login, App, state), `web/src/ui`, `server/http/routes-staff.js`, `server/http/app.js`, `server/commands/agenda.js`, `sales.js`, `team.js`, `server/domain/permissions.js`.
- Exécution : salon de démo en mémoire, horloge fixée au mardi 27/10/2026 15 h 10 (`LX_FAKE_NOW`), piloté avec Playwright (Chromium, écran tactile émulé). Rôles joués : Inès (accueil, PIN), JKut (barbier, PIN), gérant (mot de passe).
- Captures : `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/shots/` (`t..` = tablette, `p..` = téléphone). Les noms cités plus bas sont dans ce dossier.
- Aucun fichier existant modifié, aucune commande git. Le build a été fait hors du dépôt. Le serveur est arrêté.
- **Non vérifié en exécution** : le Z de bout en bout (le script s'est arrêté au comptage ; la suite est lue dans `Closing.tsx`), le verrouillage réel après 4 min (simulé par « Verrouiller », même chemin de code), le réseau lent (seule la coupure a été testée), le QR, le glisser-déposer à la souris. Le thème clair n'a pas été regardé.
- Les « touchers » comptent les appuis, hors saisie au clavier et hors défilement.

## Ce qui marche bien (à ne pas casser)

- Passage sans rendez-vous : 2 touchers (« Passage » → « Installer chez JKut »), prénom facultatif, prestation « Coupe » déjà choisie.
- Barbier malade, côté gérant : Équipe → Poser une absence → Frank → Maladie → « Appliquer et prévenir » = 5 touchers, 3 clients replacés et 3 SMS, avec une proposition par client (`t52-absence-plan`).
- Carte cadeau : code → Vérifier → Utiliser, solde et validité affichés (`t31-gift`). Acompte et carnet se posent tout seuls sur le ticket.
- Espèces : montants rapides, clavier à grosses touches (62 px), monnaie à rendre en grand (`t27-cash-change`).
- Mon espace du barbier : prochain client, dernière coupe, fiche technique, commission du jour, montants floutés sur le poste partagé (`p02b-espace-full`).
- Erreur réseau à l'écriture : message clair, la feuille reste ouverte, rien n'est perdu ; chaque écriture porte un identifiant anti-doublon.

## Les 12 situations

| # | Situation | Touchers observés | Frottement principal |
|---|---|---|---|
| 1 | Passage sans rendez-vous | 2 (installer) ou 2 + prénom (file) | Aucune recherche de client : l'habitué de passage n'a pas de fiche sur son ticket (C1) |
| 2 | Client en retard | 0 (affiché « en retard de X min ») | Rien à faire d'un geste : pas de SMS « on t'attend », « Appeler » est un lien `tel:` inutile sur tablette (B4) |
| 3 | Absent | 3 (carte → défiler → « Absent ») | Bouton de 34 px en bas de feuille, collé à « Annuler » ; refusé avant l'heure + 5 min (normal) (B3) |
| 4 | Déplacer par téléphone | 5 (carte → défiler → Déplacer → créneau → Déplacer) | SMS envoyé d'office, pas de choix ; pas de glisser au doigt (B5) |
| 5 | Pause / barbier malade | Pause : 3 (créneau vide → Bloquer → Bloquer). Malade : 5 pour le gérant | L'accueil ne peut pas poser l'absence d'un collègue (D1) |
| 6 | Carte / espèces / acompte / carte cadeau / carnet | Carte : 2 + défilement. Espèces : 4. Carte cadeau : 4 + code | Bouton de validation sous la ligne de flottaison ; double validation en espèces (A2, C3) |
| 7 | Pourboire | 2 (Pourboire → montant) | Bouton de 34 px ; rien à redire sinon |
| 8 | Vente d'un produit | 3 (Ajouter → Produit → article) | L'onglet « Prestation » s'ouvre par défaut même sur un ticket qui a déjà sa prestation (C5) |
| 9 | Nouveau client rapide | 5 + saisie | Le curseur ne va pas sur le téléphone ; numéro faux signalé seulement à la fin (C6) |
| 10 | Retrouver un habitué | 1 + 3 lettres (réponse en 0,3 s) | « kar » sort Zakaria avant les Karim ; « +33 6… » et « nom prénom » ne trouvent rien (C7) |
| 11 | Clôture (Z) | Compter → Valider → Clôturer → Confirmer | L'accueil compte mais ne clôture pas ; boutons +/− de 32 px ; pas de saisie du total (D3, B6) |
| 12 | Double réservation | Forcer : 1 confirmation | Le second rendez-vous recouvre le premier, qui disparaît de l'écran (A1) |
| 13 | Le barbier regarde sa journée et sa commission | 0 (page d'accueil) + 1 pour « Montants » | Bien. Le chiffre du jour est flouté dans Mon espace mais en clair dans l'Agenda du même poste (D5) |

---

## A. Constats P0 (risque d'erreur réelle avec un client ou de l'argent)

### A1 · Deux rendez-vous qui se chevauchent : l'un cache l'autre
- **Constat** : un rendez-vous forcé sur un créneau pris est dessiné par-dessus l'autre, même largeur, même position. Le premier client n'est plus visible ni touchable. Aucun signe « chevauchement ».
- **Preuve** : `p04b-agenda-full` (16 h 30 : seul « Doublon Test » se voit, « Jordan H. » est dessous ; 15 h 15 / 15 h 30 : « Samir » à moitié recouvert). `Board.tsx:153-158` (toutes les cartes en `left: 5px; right: 5px`, `agenda.css:46`). Recherche de « chevauche / overlap » dans l'agenda : rien.
- **Aggravant** : un barbier peut forcer un doublon dans sa propre colonne sans le gérant (`agenda.js`, `createAppointment` : `ctx.staff?.id === st.id` ; vérifié, réponse 200).
- **Correctif** : dans `Board.tsx`, calculer les groupes qui se chevauchent par colonne et partager la largeur (2 demi-cartes côte à côte) ; ajouter un liseré d'alerte et une ligne « 2 clients à 16 h 30 » dans l'en-tête de colonne.
- **Effort** S–M · **Risque** faible (affichage seul).

### A2 · Un ticket commencé est perdu si on quitte l'écran ou si le poste se verrouille
- **Constat** : lignes ajoutées, pourboire, remise et paiements déjà posés ne vivent que dans l'état du composant. Aller sur l'Agenda puis revenir, ou se reconnecter après verrouillage, rouvre le ticket vide. Le verrouillage part après 4 min sans toucher l'écran, même ticket ouvert.
- **Preuve** : exécution : paiement « Carte · terminal 30 € » posé → Verrouiller → code → même adresse `?rdv=…`, ticket présent, paiement disparu (`t36-after-relogin`) ; idem après aller-retour Agenda. `Checkout.tsx:38-45` (état local), `App.tsx:132-140` (verrou 4 min → `app.lock()` → `onOut` démonte tout).
- **Conséquence** : le barbier passe la carte sur le terminal, retourne finir une nuque, revient : le ticket ne montre plus le paiement. Risque de double encaissement ou de ticket oublié.
- **Correctif** : garder le brouillon par rendez-vous dans `sessionStorage` (lignes, remise, pourboire, paiements non en ligne, identifiant de requête) et le relire à l'ouverture ; ne pas verrouiller pendant qu'un paiement est posé ou qu'un QR attend, mais afficher le pavé de code par-dessus sans démonter la page.
- **Effort** M · **Risque** moyen (le brouillon doit être effacé à la validation et ne jamais contenir de code de carte cadeau en clair).

### A3 · « L'acompte sera remboursé » est promis à ceux qui ne peuvent pas rembourser
- **Constat** : la confirmation d'annulation dit toujours que l'acompte sera remboursé. Le remboursement n'est demandé que si la personne a le droit `sale.refund` (gérant, responsable). Pour l'accueil et les barbiers, rien n'est remboursé et rien ne le dit ; le message final est « Rendez-vous annulé · le client est prévenu ».
- **Preuve** : `Sheets.tsx:110` (texte sans condition) contre `Sheets.tsx:113` (`refundDeposit: !!paid && can('sale.refund')`) ; `routes-staff.js:451` (pas de remboursement sans ce drapeau) ; `permissions.js:50-51` (ni l'accueil ni le barbier n'ont `sale.refund`). Lu dans le code, non rejoué.
- **Correctif** : adapter le texte au droit (« L'acompte de 15 € reste à rembourser par le gérant ») et, dans ce cas, créer une ligne dans le fil du gérant. À décider par le gérant : laisser l'accueil rembourser un acompte.
- **Effort** S · **Risque** faible.

---

## B. Constats P1 · tablette aux doigts gras

### B1 · Les messages du bas recouvrent les boutons d'action
- **Constat** : le message de confirmation s'affiche en bas au centre, par-dessus le pied des feuilles. Il reste 3,8 s (6 s pour une erreur, 7 s avec « Annuler ») et ne se ferme pas au toucher. Le toucher tombe sur le message, pas sur le bouton.
- **Preuve** : sonde `elementFromPoint` sur « Installer chez JKut » : c'est le message qui reçoit le toucher (sortie « TOAST covers button ») ; `t06-walkin-sheet`, `t08-appt-sheet` (« Arrivé » et « Installer » cachés), `t11-move`. `components.css:177`, `kit.tsx:207`.
- **Correctif** : placer les messages en haut de l'écran sur tablette (ou au-dessus du pied de feuille quand une feuille est ouverte) et les fermer au toucher.
- **Effort** S · **Risque** faible.

### B2 · Sur la tablette, l'agenda commence à mi-écran et la file est hors de vue
- **Constat** : à 1024 px, les 4 chiffres passent sur 2 lignes (255 px) ; le planning commence à 483 px et ne montre qu'environ 2 h 30. La file d'attente et « À encaisser » sont à 996 px, soit plus d'un écran plus bas.
- **Preuve** : `t05b-agenda-desk-full` ; mesures : planning à y = 483, panneau latéral à y = 996 ; `components.css:129`, `agenda.css:12`. Au téléphone : planning à 472 px, file à 1133 px (`p04b-agenda-full`).
- **Correctif** : sous 1100 px, une seule bande compacte de chiffres (ou repliée par défaut pour l'accueil) ; file et « À encaisser » en pastilles avec compteur dans l'en-tête, qui ouvrent un panneau.
- **Effort** M · **Risque** faible.

### B3 · Les gestes fréquents du rendez-vous sont petits et tout en bas
- **Constat** : Déplacer, Modifier, Appeler, Absent, Annuler font 34 px de haut (cible conseillée : 44) et se trouvent sous l'historique : il faut défiler pour les atteindre. « Absent » touche « Annuler ».
- **Preuve** : mesures `108x34`, `97x34`, `101x34` ; `t09-appt-sheet-bottom` ; `Sheets.tsx:192-199`, `components.css:17`.
- **Correctif** : remonter cette rangée sous l'en-tête de la feuille, en taille normale (44 px) ; éloigner « Annuler ». Même taille pour « Ajouter » et « Pourboire » du ticket (`98x34`, `113x34`).
- **Effort** S · **Risque** faible.

### B4 · Client en retard : aucun geste proposé
- **Constat** : le retard est affiché, mais la seule action est « Appeler » (lien `tel:`), sans effet sur une tablette Wi-Fi.
- **Preuve** : `Sheets.tsx:196` ; `Agenda.tsx:103`.
- **Correctif** : à partir de 5 min de retard, un bouton « SMS : on t'attend » (modèle fixe) et, à 15 min, « Absent » mis en avant dans le pied de feuille. Le numéro reste lisible pour appeler depuis le téléphone du salon.
- **Effort** M (un modèle de SMS de plus) · **Risque** faible.

### B5 · Déplacer : SMS envoyé d'office, pas de glisser au doigt
- **Constat** : tout déplacement prévient le client (`notify: true`), y compris un simple changement de fauteuil à la même heure. Le glisser-déposer est désactivé au toucher ; sur tablette il reste le chemin en 5 touchers.
- **Preuve** : `Agenda.tsx:56`, `Sheets.tsx:120`, `Board.tsx:62`.
- **Correctif** : ne pas envoyer de SMS quand seul le barbier change le jour même, ou ajouter un interrupteur « Prévenir par SMS » (allumé par défaut). Pour le toucher : appui long sur la carte, puis toucher le créneau cible.
- **Effort** S (SMS) / M (appui long) · **Risque** moyen pour le geste tactile (conflit avec le défilement).

### B6 · Comptage de caisse : petits boutons, pas de raccourci
- **Constat** : les boutons +/− font 32×32 px, 13 lignes à remplir, pas de saisie directe du total ni de « caisse juste ».
- **Preuve** : mesures `32x32`, `t56-count` ; `Closing.tsx:334-336`.
- **Correctif** : boutons de 44 px, champ en `inputMode="numeric"` plus large ; garder le détail par billet (utile en cas d'écart).
- **Effort** S · **Risque** faible.

### B7 · Pavé de code : pas de touche « effacer », validation manuelle
- **Constat** : le pavé a 1–9, Retour, 0, Entrer. Un chiffre faux ne se corrige pas au doigt (Retour ramène aux visages). Un code à 4 chiffres demande « Entrer » ; l'envoi automatique n'existe qu'à 6 chiffres. Connexion : visage + 4 chiffres + Entrer = 6 touchers, plusieurs dizaines de fois par jour avec le verrou de 4 min.
- **Preuve** : `t03-pin`, `Login.tsx:92-98` et `:119-124`.
- **Correctif** : remplacer « Retour » par ⌫ (une flèche retour en haut de l'écran suffit) ; envoyer tout seul après une courte pause à partir de 4 chiffres.
- **Effort** S · **Risque** faible à moyen (une tentative ratée de plus si la pause est trop courte).

### B8 · Texte secondaire peu lisible
- **Constat** : le gris `--tx3` (#77716A sur #171513) a un contraste d'environ 3,8:1, sous le seuil de 4,5:1, et sert à des informations utiles (heure dans la carte, indices, « il y a 19 h »), souvent en 11,5–12,5 px.
- **Preuve** : `base.css:14`, `agenda.css:50` ; calcul de contraste fait à la main, à confirmer avec un outil.
- **Correctif** : éclaircir `--tx3` (vers #8F8980) et ne pas descendre sous 12,5 px pour une information.
- **Effort** S · **Risque** faible.

---

## C. Constats P1 · touchers et décisions en trop

### C1 · Le passage d'un habitué n'a pas de fiche, et la caisse ne permet pas de la rattacher
- **Constat** : la feuille « Passage » ne cherche pas de client. Au ticket, « Associer un client » n'existe que pour une vente libre. Résultat : « Pas de fiche client, pas de tampon », pas de carnet ni d'abonnement utilisable, pas d'historique, pas de relance.
- **Preuve** : `t21-ticket-walkin`, `t29-done` ; `Checkout.tsx:178` (`!apptId`) ; `Sheets.tsx:318` (pas de `clientId` envoyé alors que `addWalkin` l'accepte, `agenda.js` `walkSchema`).
- **Correctif** : dans « Passage », le champ Prénom propose les fiches trouvées dès 2 lettres (même recherche que « Rendez-vous ») ; au ticket, afficher « Associer un client » aussi quand le rendez-vous n'a pas de fiche (le serveur accepte déjà `clientId` sur une vente).
- **Effort** S–M · **Risque** faible.

### C2 · Habitué retrouvé : rien n'est prérempli
- **Constat** : après avoir choisi un client connu, aucune prestation ni barbier n'est proposé. La liste complète (11 prestations) pousse les créneaux sous l'écran.
- **Preuve** : exécution (aucune pastille sélectionnée après le choix de Gabriel) ; `t42-create-slots` ; `Sheets.tsx:226-237`.
- **Correctif** : une pastille « Comme d'habitude : Coupe + taille · JKut » en tête, qui remplit prestation et barbier (les données existent : historique et barbier habituel). Replier les catégories rares.
- **Effort** M · **Risque** faible.

### C3 · Encaisser : le bouton final est hors écran, et les espèces se valident deux fois
- **Constat** : avec une seule ligne, « Valider l'encaissement » est à y = 633–697 sur 768 ; avec un produit ou un pourboire il sort de l'écran. En espèces on valide dans la fenêtre puis sur le ticket.
- **Preuve** : `t21-ticket-walkin`, mesure du bouton ; `Checkout.tsx:248`, `:254`.
- **Correctif** : barre fixe en bas du ticket (reste à payer + bouton). Quand un seul moyen couvre tout le reste : « Carte · 30 € » et « Valider 20 € » (espèces) terminent la vente, avec « Annuler » 7 s sur l'écran de fin… ou, plus prudent, garder la validation mais dans la barre fixe.
- **Effort** S (barre fixe) / M (un toucher) · **Risque** moyen pour le toucher unique (vente validée par erreur : elle ne se corrige que par avoir).

### C4 · Après un ticket, le suivant ne s'ouvre pas ; après une réservation, la fiche s'ouvre
- **Constat** : « Ticket suivant » revient à un écran vide alors que des clients attendent. À l'inverse, après « Réserver », la fiche du rendez-vous créé s'ouvre et doit être refermée.
- **Preuve** : `t29b-after-next` ; `Caisse.tsx:84-85` (le commentaire annonce l'ouverture du premier en attente, le code ne le fait pas) ; `Agenda.tsx:167`.
- **Correctif** : « Ticket suivant » ouvre le premier « À encaisser » ; après réservation, un message avec « Voir » suffit.
- **Effort** S · **Risque** faible.

### C5 · « Ajouter » ouvre toujours sur « Prestation »
- **Constat** : sur un ticket de rendez-vous, on ajoute presque toujours un produit.
- **Preuve** : `t22-add-sheet` ; `Checkout.tsx:267`.
- **Correctif** : ouvrir sur « Produit » quand le ticket a déjà une prestation ; afficher les 3 produits les plus vendus en pastilles directement sous les lignes.
- **Effort** S · **Risque** faible.

### C6 · Nouveau client : le téléphone n'a pas le curseur, l'erreur arrive à la fin
- **Constat** : « Nouveau client » reprend bien le prénom tapé, mais ne place le curseur nulle part. Un numéro incomplet n'est refusé qu'à « Réserver », par un message qui disparaît.
- **Preuve** : exécution (élément actif vide ; « Numéro de téléphone invalide. ») ; `t46-new-client-badphone` ; `Sheets.tsx:275-284`.
- **Correctif** : curseur sur Téléphone ; contrôle du format sous le champ dès la sortie du champ.
- **Effort** S · **Risque** faible.

### C7 · Recherche de client : trois ratés simples
- **Constat** : « kar » classe Zakaria avant les Karim (correspondance n'importe où dans le nom, tri par dernière visite) ; « +33 6 39 » ne trouve rien ; « belkacem gab » (nom puis prénom) ne trouve rien. La page Clients annonce « Nom ou numéro », la feuille « Prénom, nom ou numéro ».
- **Preuve** : sorties d'exécution ; `routes-staff.js:480-491`.
- **Correctif** : découper la recherche en mots, chacun devant se trouver dans le nom ; début de prénom d'abord ; ramener `+33`/`0033` à `0` aussi côté requête.
- **Effort** S · **Risque** faible.

---

## D. Constats P1/P2 · droits qui surprennent

### D1 · (P1) L'accueil ne peut pas poser l'absence d'un barbier malade
- **Constat** : poser l'absence d'un collègue demande le droit `team` (gérant, responsable). L'accueil n'a pas l'entrée « Équipe » dans son menu. Le barbier malade peut seulement envoyer une demande, et ses créneaux restent ouverts jusqu'à la validation. Si le gérant n'est pas joignable à 8 h 45, l'accueil doit déplacer chaque client à la main.
- **Preuve** : `team.js:169` et `:173` ; menu d'Inès observé : Agenda, Caisse, Clients, Relances, Réglages ; la demande d'un barbier renvoie 200 « demande ». L'accueil peut pourtant appliquer le plan d'une absence déjà posée (`team.js:319`, droit `agenda.edit`).
- **Correctif** : autoriser qui a `agenda.edit` à poser une absence du jour même (motif « Maladie »), avec une ligne au gérant ; ou un bouton « Absent aujourd'hui » dans l'en-tête de colonne de l'agenda, qui ouvre directement le plan.
- **Effort** M · **Risque** moyen (élargit un droit : à faire valider par le gérant).

### D2 · (P1) L'accueil ne peut faire aucune remise, alors qu'un plafond de 20 % est prévu pour elle
- **Constat** : le bouton « Remise » n'apparaît pas pour Inès ; les barbiers l'ont (10 %).
- **Preuve** : ticket d'Inès : « Ajouter | Pourboire » seulement (`t21-ticket-walkin`) ; `permissions.js:50` (pas de `sale.discount`) contre `permissions.js:72` (`desk` → 20 %).
- **Correctif** : ajouter `sale.discount` au rôle accueil, ou retirer le plafond mort. Décision du gérant.
- **Effort** S · **Risque** faible.

### D3 · (P2) L'accueil compte la caisse mais ne clôture pas
- **Constat** : « La clôture est faite par le gérant. » Le soir sans gérant, la journée attend la clôture automatique.
- **Preuve** : `t33-cloture-desk` ; `permissions.js:50`.
- **Correctif** : le dire au bon moment (« Caisse comptée. Le Z se fera tout seul cette nuit ») ou ouvrir `closure` à l'accueil par un réglage.
- **Effort** S · **Risque** faible.

### D4 · (P2) Sur téléphone, « Bloquer » n'existe que par un toucher dans un créneau vide
- **Preuve** : bouton masqué (`ph-hide`, `Agenda.tsx:86`) ; menu `p05-empty-menu`.
- **Correctif** : bouton « Pause 15 / 30 min maintenant » dans Mon espace (1 toucher, annulable).
- **Effort** S · **Risque** faible.

### D5 · (P2) Montants floutés dans Mon espace, en clair dans l'Agenda du même poste
- **Preuve** : `p02b-espace-full` (flou) contre `p04b-agenda-full` (« Mon chiffre 166,84 € » lisible).
- **Correctif** : même règle de masquage pour le chiffre de l'agenda sur un poste partagé.
- **Effort** S · **Risque** faible.

---

## E. Interruptions

| Sujet | Constat | Preuve | Correctif | Effort / risque |
|---|---|---|---|---|
| Hors ligne (P1) | Aucun signe pendant 2 minutes, même quand le navigateur sait qu'il est hors ligne ; l'agenda affiché peut être périmé sans le dire | Exécution : rien dans la barre après 6 s de coupure (`t48-offline-6s`) ; `kit.tsx:37-41` (pastille seulement après 2 min), `state.tsx:106` (erreur du pouls ignorée) | Pastille « Hors ligne » dès `navigator.onLine === false` ou après 2 pouls ratés (8 s) | S / faible |
| Écriture hors ligne | Message clair, feuille conservée ; pas de nouvel essai automatique | `t49-offline-write` ; `withRetry` n'est utilisé que pour l'import WordPress | Brancher `withRetry` sur l'encaissement et la réservation (l'identifiant de requête existe déjà) avec « Nouvel essai… » | S / faible |
| Verrou en cours de vente (P0) | Voir A2 | | | |
| Session coupée par le serveur | Après 10 min sans requête, retour au pavé de code avec un message ; tout brouillon ouvert est perdu (même cause que A2) | `app.js:156-164`, `state.tsx:64-72` | Même correctif que A2 | |
| Mises à jour en direct | Pouls toutes les 4 s ; les listes se rafraîchissent sans clignoter. Un formulaire ouvert n'est pas écrasé | `state.tsx:81-113`, `query.ts` | Rien à changer | |
| Messages en direct | Un seul message pour plusieurs nouveautés, même zone que B1 | `state.tsx:97-103` | Réglé par B1 | |
| Rechargement de page | L'adresse garde le jour et le rendez-vous ouverts ; le ticket en cours est perdu (A2) | exécution | A2 | |

---

## F. Vocabulaire à simplifier (P2)

| Mot à l'écran | Problème | Proposition |
|---|---|---|
| « Bloquer » | Le barbier pense « pause » | « Pause / Bloquer » |
| « Installer », « Au fauteuil », « Il est là », « Arrivé » | Deux mots pour le même geste selon la page (`Sheets.tsx:129-130`, `Prochain.tsx`) | Garder « Arrivé » et « Au fauteuil » partout |
| « Sans fiche » (nouveau rendez-vous) | Peu clair | « Juste un prénom » |
| « Le premier libre » / « sans préférence » | Deux formules | Une seule |
| Étiquette « Passage » sur un rendez-vous pris à l'avance | Trompeur (vu sur Gabriel B., `t08-appt-sheet` ; donnée de démo à vérifier) | Vérifier la source enregistrée |
| Source toujours « téléphone » pour un rendez-vous créé au comptoir | `Sheets.tsx:247` (`source: 'phone'`) fausse les statistiques | Deux pastilles « Au téléphone / Au comptoir » ou ne rien enregistrer |
| « CA TTC net, remboursements déduits », « dont HT » | Normal pour le gérant, opaque pour l'accueil | Garder pour le gérant ; pour l'accueil, afficher seulement le tiroir |

---

## G. Idées sobres

1. **Pastille « Comme d'habitude »** à la réservation et au passage (C1 + C2) : un toucher remplit prestation et barbier. Effort M.
2. **Bouton « Absent aujourd'hui » dans l'en-tête de colonne** : ouvre directement le plan de remplacement déjà écrit (D1). Effort M.
3. **Encaissement depuis la carte du rendez-vous** : quand rien n'est à ajouter, « Carte 30 € » et « Espèces » dans le pied de la fiche, sans passer par la page Caisse. Effort M, risque moyen.
4. **Pause en un toucher** depuis Mon espace, avec « Annuler » (D4). Effort S.
5. **Changer de personne sans tout fermer** : le pavé de code par-dessus l'écran en cours ; si la même personne revient, elle retrouve son écran (résout A2 et allège B7). Effort M–L, risque moyen (ne rien laisser lisible derrière le pavé).
6. **Bandeau « à faire maintenant » pour l'accueil** à la place des chiffres : « 3 à encaisser · 1 en retard de 12 min · 1 dans la file », chaque élément ouvrant le bon écran (B2). Effort M.

---

## Top 10, par ordre de priorité

| Rang | Constat | Gravité | Effort | Risque |
|---|---|---|---|---|
| 1 | A1 · Les rendez-vous qui se chevauchent se cachent l'un l'autre | P0 | S–M | faible |
| 2 | A2 · Ticket en cours perdu en quittant l'écran ou au verrouillage | P0 | M | moyen |
| 3 | A3 · Remboursement d'acompte promis à tort à l'accueil et aux barbiers | P0 | S | faible |
| 4 | B1 · Les messages du bas bloquent les boutons d'action | P1 | S | faible |
| 5 | C1 · Passage d'un habitué sans fiche, non rattachable en caisse | P1 | S–M | faible |
| 6 | B2 · Agenda à mi-écran sur tablette, file et « À encaisser » hors de vue | P1 | M | faible |
| 7 | D1 · L'accueil ne peut pas poser l'absence d'un barbier malade | P1 | M | moyen |
| 8 | C3 · Bouton de validation hors écran, double validation en espèces | P1 | S | faible à moyen |
| 9 | B3 + B7 · Petites cibles (34 px), gestes en bas de feuille, pavé sans « effacer » | P1 | S | faible |
| 10 | Hors ligne invisible pendant 2 minutes (section E) | P1 | S | faible |

Viennent ensuite : C2 (comme d'habitude), D2 (remise à l'accueil), C7 (recherche), B5 (SMS d'office), C4, C5, C6, B6, B8, D3–D5, vocabulaire.
