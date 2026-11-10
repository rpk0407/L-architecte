# Audit back-office · 01 · Le tableau de bord du gérant (Pilotage, Rapports)

Audit en lecture seule, fait le 10 novembre 2026. Aucun fichier existant modifié, aucune commande git.

**Périmètre lu** : `README.md`, `docs/*.md`, `web/src/comptoir/pages/Pilotage.tsx` et `pilotage/*`, `Rapports.tsx`, `server/domain/insights.js`, `cockpit.js`, `balances.js`, `statement.js`, `cash.js`, `availability.js`, `shared/figures.js`, `shared/dates.js`, `server/http/routes-cockpit.js`, `routes-compta.js`, la partie rapports de `routes-staff.js`.

**Vérifié en faisant tourner la démo** (mémoire, horloge fixée par `LX_FAKE_NOW`, connexion gérant du README) :

- instance A, mardi 10 novembre à 7 h 30 : `/api/v1/cockpit` (jour, semaine, mois), `/api/v1/reports`, `/api/v1/agenda`, `/api/v1/compta/balances`, `/api/v1/pulse` ;
- instance B, samedi 14 novembre à 18 h 40 : mêmes lectures, plus deux écritures sur cette instance jetable (un avoir sur un ticket de la veille, l'archivage d'un barbier) pour mesurer l'effet sur les chiffres.

Les deux instances ont été arrêtées. La suite de tests (`npm test`) n'a pas été lancée. Les montants cités viennent de ces lectures ; la démo est tirée au hasard à chaque démarrage, donc les valeurs exactes changent d'un lancement à l'autre, pas les écarts.

**Ce qui est solide** : une seule fonction (`report()`) alimente Pilotage, Rapports, le relevé et la paie ; l'identité « Encaissé = Réalisé + prépayé vendu − prépayé consommé − remises fidélité + sans barbier » tombe juste au centime (4 533,00 € vérifié) ; les jours sont des clés Europe/Paris calculées à midi UTC, le changement d'heure ne décale rien ; Pilotage a de bons états de chargement, d'erreur et de données périmées.

---

## 1. Exactitude

### P0-1 · Le delta du mois et de la semaine s'affiche en rouge alors que le salon fait mieux

- **Constat** : la période en cours est comparée au même nombre de jours *calendaires* du début de la période d'avant, sans tenir compte des jours ouverts, et la journée d'aujourd'hui compte comme un jour entier dès le matin. La couleur d'alarme n'est coupée que pour la vue « Aujourd'hui ».
- **Mesuré (mardi 10 nov., 7 h 30)** :
  - Mois : 4 533 € contre 6 935 € (1er au 10 octobre), soit **↓ 35 % en rouge**. Or le 1er au 10 novembre compte 5 jours ouverts terminés, le 1er au 10 octobre en compte 8. Par jour ouvert : environ 907 € contre 867 €, soit **+5 %**.
  - Semaine : 160 € contre 899 € (lundi et mardi derniers en entier), soit **↓ 82 % en rouge**, avant l'ouverture.
- **Preuve** : `server/domain/cockpit.js:68-73` (`n` en jours calendaires, `partial: live && n === 1`), `web/src/comptoir/pages/pilotage/shared.tsx:13-19` (seul `soft` retire la couleur).
- **Correctif** : comparer à jours ouverts égaux (`openDays()` existe, `insights.js:543`) ; tant que la journée court, soit exclure aujourd'hui des deux côtés, soit couper la comparaison à la même heure ; étendre `soft` à toute période dont le dernier jour est en cours. Dire la base dans le libellé (« sur 5 jours ouverts »).
- **Effort** : S. **Risque** : faible (affichage et choix de bornes ; `tests/unit/cockpit.test.js` à compléter).

### P0-2 · « À ce rythme » : sous-estimé chaque matin, et deux projections différentes selon l'écran

- **Constat** : Pilotage projette `encaissé ÷ jours ouverts écoulés × jours ouverts du mois`, en comptant aujourd'hui comme écoulé dès minuit. Rapports projette sur les jours *calendaires*.
- **Mesuré (même instant, même objectif)** : Pilotage « À ce rythme : 15 110 € », Rapports « Au rythme actuel : 13 599 € ». En retirant la journée non commencée, le rythme réel donne environ 17 500 €. Le gérant lit donc −14 % le matin, et le chiffre remonte tout seul dans la journée.
- **Preuve** : `cockpit.js:229-231` ; `web/src/comptoir/pages/Rapports.tsx:200` avec `elapsed` calendaire calculé dans `server/http/routes-staff.js:709`.
- **Correctif** : une seule fonction de projection côté serveur (dans `goalOf`, `insights.js:513`), renvoyée aux deux écrans ; jour en cours compté au prorata des heures de fauteuil passées (`pastCap` existe déjà, `insights.js:339`). Mieux : voir l'idée 4 (prévision avec les rendez-vous déjà pris).
- **Effort** : S. **Risque** : faible.

### P1-3 · Archiver un barbier réécrit les mois passés

- **Constat** : `staffIntervals()` renvoie zéro heure pour un barbier inactif, y compris sur le passé. Ses rendez-vous restent au numérateur du remplissage du salon, ses heures quittent le dénominateur, et les objectifs automatiques des autres sont recalculés rétroactivement.
- **Mesuré (instance B, octobre, avant puis après l'archivage d'Esteban)** : remplissage du salon **48,3 % → 61,9 %** ; son propre remplissage 39 % → 0 % ; objectif d'octobre de JKut **89 % → 69 %** (Frank 82 → 64, Le Soldat 78 → 61).
- **Preuve** : `server/domain/availability.js:60` ; `insights.js:452` (minutes de tous) contre `insights.js:459-460` (capacité des seuls actifs) ; `insights.js:494-502` (`goalShares`).
- **Même famille** : les horaires et l'objectif n'ont pas d'historique. Changer les heures du salon ou l'objectif (`server/settings/goals.js:11`, une seule valeur `monthCents`) change le remplissage et le « % de l'objectif » de tous les mois passés.
- **Correctif** : pour les jours passés, lire la capacité d'un barbier tant qu'il a des rendez-vous ou jusqu'à sa date d'archivage (garder `archivedAt` et l'utiliser dans `staffIntervals`) ; figer l'objectif et les parts à la clôture du mois (un événement `goal.month.sealed`, ou une table `goals.byMonth`).
- **Effort** : M. **Risque** : moyen (touche la disponibilité ; à borner aux lectures de rapport).

### P1-4 · Un avoir ne tombe pas le même jour sur l'Agenda et sur Pilotage

- **Constat** : l'Agenda retire l'avoir du jour *du ticket* ; Pilotage, Rapports et le Z le retirent du jour *de l'avoir*.
- **Mesuré (instance B, avoir de 22 € fait samedi sur un ticket de vendredi)** : vendredi, Agenda 700 € / Pilotage 722 € ; samedi, Agenda 914 € / Pilotage 892 €.
- **Preuve** : `routes-staff.js:305-308` (`x.totals.revenue - x.refunded`) contre `insights.js:429-434`.
- **Correctif** : faire lire à `dayKpis` le `report()` du jour, comme il le fait déjà pour un barbier (`routes-staff.js:303`).
- **Effort** : S. **Risque** : faible.

### P1-5 · Les prélèvements d'abonnement et les ventes de carnet comptent comme des clients et des tickets

- **Constat** : un mois d'abonnement prélevé est un ticket avec un client. Il entre dans « Clients », « tickets » et « Panier moyen », sans visite.
- **Mesuré (7 h 30, salon fermé)** : « Encaissé 160 € · 2 tickets », « Clients 2 · 2 habitués », « Panier moyen 80 € », « Chiffre réalisé 0 € ». Sur le mois, 480 € de prépayé dans un panier moyen de 26,20 €.
- **Preuve** : `insights.js:399-401` (tout ticket compte), `insights.js:471` (panier = encaissé net ÷ tickets), `cockpit.js:251`.
- **Autres effets** : un ticket sans fiche client (passage anonyme) n'est compté dans aucun « client » (173 tickets, 166 clients) ; un ticket qui ne vend qu'une carte cadeau compte au dénominateur du panier sans rien au numérateur ; un avoir d'une autre période baisse le panier.
- **Correctif** : « Clients » = personnes passées au fauteuil (visites terminées et passages) ; panier moyen = lignes prestation et produit ÷ tickets qui en portent ; afficher le prépayé à part (« dont 160 € d'abonnements et carnets »).
- **Effort** : S à M. **Risque** : faible, mais le panier moyen affiché bougera (à annoncer).

### P1-6 · La marge des produits est calculée sur le TTC

- **Constat** : Rapports affiche `marge = prix TTC encaissé − prix d'achat`. Le Catalogue calcule la marge sur le HT.
- **Mesuré** : Huile à barbe, 7 vendues à 15 € TTC, achat 6 € : Rapports dit « marge 63 € » ; sur le HT (12,50 €) la marge est 45,50 €. Surévaluation de 38 %.
- **Preuve** : `insights.js:415` ; `web/src/comptoir/pages/Catalogue.tsx:363` (définition HT) ; affichage `Rapports.tsx:171`.
- **Correctif** : `margin += htOf(l.net, l.vat) − cost × qty` (`htOf` est déjà dans le fichier, ligne 103), libellé « marge HT ». Les avoirs de produits ne sont pas déduits non plus : les retirer.
- **Effort** : S. **Risque** : faible.

### P1-7 · Le coût des absences a deux définitions, et l'acompte l'efface en entier

- **Constat** : Pilotage additionne le prix des rendez-vous manqués *sans aucun acompte* ; dès qu'un acompte existe, la perte comptée est 0, même pour 15 € gardés sur 50 €. Rapports écrit « Les absences ont coûté environ » = nombre d'absences × panier moyen (lui-même gonflé, voir P1-5). Les deux écrans ne donnent pas le même montant pour la même période.
- **Preuve** : `cockpit.js:91-99` ; `Rapports.tsx:574-578`.
- **Correctif** : une seule fonction serveur : `prix − acompte gardé − frais d'absence encaissés`, renvoyée dans `report()` et lue par les deux écrans. Ajouter les annulations tardives (voir P2-15).
- **Effort** : S. **Risque** : faible.

### P1-8 · Trois noms pour le même chiffre, et « Encaissé » n'est pas l'argent entré

- **Constat** : le même nombre s'appelle « Encaissé » (Pilotage), « Chiffre d'affaires » (Rapports) et « net TTC » (Z). Il s'agit du chiffre d'affaires TTC net d'avoirs : il **exclut** les cartes cadeaux vendues et les pourboires (argent entré), il **inclut** les prestations payées par carte cadeau ou acompte (argent entré un autre jour).
- **Mesuré (samedi)** : « Encaissé » 914 € ; argent réellement entré selon le Z (`takings`) 942 €.
- **Preuve** : `pilotage/Tiles.tsx:35` ; `Rapports.tsx:124` ; `server/domain/cash.js:98-108` (`netTtc`, `takings`, `prepaid`).
- **Correctif** : un seul mot partout (« Chiffre d'affaires TTC »), et sous la tuile une ligne « entré en caisse aujourd'hui : 942 € (carte, espèces, en ligne) » lue du Z. Montrer le HT sur Pilotage (il est sur Rapports).
- **Effort** : S. **Risque** : faible ; toucher aux visites guidées (`data-guide="pilotage.encaisse"`).

### P1-9 · Pilotage et Rapports ne comparent pas à la même période

- **Constat** : pour « ce mois », Pilotage compare au 1er–10 octobre, Rapports aux dix jours précédents (22–31 octobre). Pour « aujourd'hui », Pilotage compare au même jour de la semaine dernière, Rapports à la veille (un lundi fermé : delta absent ou absurde le mardi).
- **Mesuré** : même mois, même instant : −35 % sur Pilotage, −31 % sur Rapports.
- **Preuve** : `cockpit.js:49-74` ; `insights.js:537-540` appelé par `routes-staff.js:700`.
- **Correctif** : faire utiliser `periodOf()` à la route des rapports pour les périodes nommées (jour, mois) ; garder « même durée avant » pour 7 jours, 3 mois et les dates libres.
- **Effort** : S. **Risque** : faible.

### P2-10 · Une semaine à cheval sur deux mois affiche l'objectif du mauvais mois

- **Mesuré** : semaine du 26 octobre au 1er novembre (3 809 € encaissés, presque tout en octobre) : la tuile affiche « Objectif de novembre : 0 € sur 24 000 € (0 %) · Encore 24 000 € ». La ligne « Cette semaine : X sur Y » ne compte que la partie de la semaine dans le mois du dernier jour.
- **Preuve** : `cockpit.js:223-232` (objectif pris au jour `upTo`) ; `insights.js:524-525` (semaine rognée au mois).
- **Correctif** : en vue semaine, ne montrer que l'objectif de la semaine entière (somme des deux parts) ; garder l'objectif du mois pour les vues jour et mois.
- **Effort** : S. **Risque** : faible.

### P2-11 · Le repère « où on devrait en être » est en jours calendaires

- **Preuve** : `pilotage/Tiles.tsx:33` (`jour du mois ÷ jours du mois`), `Rapports.tsx:211`. Un mois qui commence par un dimanche et un lundi fermés montre un retard qui n'existe pas. À aligner sur les jours ouverts (`openDays`). Effort S, risque faible.

### P2-12 · Remplissage : ce qui entre et ce qui n'entre pas

- Les indisponibilités posées dans l'agenda (`/api/v1/blocks` : pause, formation) ne sont pas retirées de la capacité : remplissage sous-estimé, « heures libres » surestimées, et l'alerte d'équité « X a 6 h libres » peut viser un barbier en formation (`availability.js:58-73` ne lit pas les blocs ; `cockpit.js:196-201`).
- Une absence de client sort du numérateur : le fauteuil réservé puis vide baisse le remplissage (`insights.js:451-452`). À afficher à part (« 66 % réservé, dont 3 % perdus en absences »).
- Un rendez-vous en attente d'acompte dont le délai est passé compte encore (`insights.js:452`, alors que `occupies()` l'exclut, `availability.js:81-85`).
- Effort S chacun, risque faible.

### P2-13 · Carte de chaleur arrondie à la demi-heure

- `insights.js:455` ajoute 30 minutes par pas : une prestation de 45 minutes compte 60, une de 20 compte 30. Sans effet sur la démo (toutes les durées sont des multiples de 30), faux dès qu'une durée de 20 ou 45 minutes ou un temps de battement existe. Les phrases « Mardi 14 h est plein à 92 % » (`Rapports.tsx:571`) en dépendent. Correctif : ajouter les minutes réelles par heure. Effort S.

### P2-14 · « En cours » (dû aux clients) ne correspond pas aux soldes du comptable

- Pilotage valorise les carnets repris de l'ancien site au prix du catalogue (`cockpit.js:102-111`, `insights.js:110-121`) ; l'écran comptable les compte à 0 € (`balances.js:85`). Les arrondis diffèrent (par coupe contre au prorata). Une carte cadeau le jour de son expiration est « active » sur Pilotage et « expirée » en compta (`cockpit.js:104` contre `balances.js:31,48`).
- La tuile oublie les acomptes payés en ligne pour des rendez-vous à venir (`balances.js:95-108`) et les coupes d'abonnement déjà payées.
- Le mot « En cours » ne dit pas ce que c'est : préférer « Dû aux clients ».
- Démo : mêmes totaux des deux côtés (140 € et 704 €), l'écart n'apparaît qu'avec des carnets repris. Effort S.

### P2-15 · Définitions à resserrer

- `lateCancels` compte *toutes* les annulations faites par le client, quel que soit le délai (`insights.js:447`). Le libellé à l'écran (« annulations du client ») est juste, mais l'annulation tardive, celle qui coûte, n'est mesurée nulle part.
- « Repris avant de partir » ne compte qu'un rendez-vous créé dans les 15 minutes après l'encaissement (`insights.js:363-371`) : le client qui avait déjà son prochain rendez-vous compte comme non repris. Mesurer plutôt « repart avec un rendez-vous à venir ».
- « Reviennent sous 60 j » porte sur les visites d'il y a 2 à 5 mois, pas sur la période affichée, et son delta compare deux fenêtres presque identiques (`insights.js:322-334`, `cockpit.js:259,264`). Retirer le delta, dire la fenêtre.
- « Habitués » = tout client déjà venu une fois (`cockpit.js:251`, `Tiles.tsx:73`). « Déjà clients » est plus exact.
- Jours fériés : aucun calendrier. Le 11 novembre ou le 25 décembre comptent comme ouverts dans « par jour ouvré » et la projection tant que le gérant n'a pas saisi de fermeture. Proposer les fériés à la saisie des fermetures.
- Rapports trie l'équipe par chiffre et affiche la part de chacun (`insights.js:357`, `Rapports.tsx:483`), Pilotage affirme « jamais un classement » (`pilotage/Team.tsx:1-2`). À trancher.

---

## 2. Ce qui manque au gérant

Ce que Pilotage répond en dix secondes aujourd'hui : chiffre contre objectif, remplissage du jour par fauteuil, absences et leur coût, état de la caisse et du Z, encaissements en attente. C'est un bon rétroviseur. Il manque le pare-brise.

| # | Question du gérant | État | Preuve | Sévérité |
|---|---|---|---|---|
| C1 | « Qu'est-ce qui m'attend aujourd'hui ? » (rendez-vous, chiffre prévu, premier client, trous) | Absent de Pilotage. L'Agenda calcule déjà `planned` (1 188 € prévus à 7 h 30) et `upcoming` (44) ; `cash.remaining` est renvoyé par le cockpit et jamais affiché | `routes-staff.js:309`, `cockpit.js:137`, aucun usage dans `pilotage/` | **P0** |
| C2 | « Demain et la semaine sont-ils pleins ? Qui est sous-réservé ? » | Absent. Le cockpit ne lit que jusqu'à aujourd'hui, la flèche « avancer » est désactivée, la vue semaine donne le remplissage de lundi à aujourd'hui | `cockpit.js:68`, `Pilotage.tsx:86` | **P0** |
| C3 | « Qui est absent ou en congé aujourd'hui ? » | Seulement dans la fiche de chaque barbier (un tap par barbier). Pas de retard ni de pointage dans le produit | `pilotage/BarberSheet.tsx:55-59` | P1 |
| C4 | « Qui dois-je relancer, et combien ça vaut ? » | La page Relances existe (17 clients dans la démo), rien sur Pilotage ; sur téléphone le compteur est caché derrière « Plus ». Un client parti depuis plus de 180 jours sort de la liste et n'apparaît nulle part comme « perdu » | `App.tsx:88,101`, `insights.js:78` | P1 |
| C5 | « Quelle est ma marge ? » | Aucune. Ni charges, ni total des commissions de la période sur Pilotage (1 697,50 € dans la démo, visible seulement en additionnant le tableau de Rapports) | `Rapports.tsx:494` | P1 |
| C6 | « Mon stock ? » | Seuils bas dans le Catalogue seulement ; rien sur Pilotage alors que `stock` et `low` sont déjà dans le bootstrap | `Catalogue.tsx:342-369` | P2 |
| C7 | « Par rapport à l'an dernier ? À un mardi normal ? » | Aucune comparaison N-1 ni moyenne des mêmes jours | `cockpit.js:49-74` | P2 |
| C8 | « D'où viennent mes clients, mes heures creuses ? » | Sur Rapports (sources, carte de chaleur), pas sur Pilotage, et sans action au bout | `Rapports.tsx:150-163` | P2 |
| C9 | « Liste d'attente, acomptes en attente, argent chez Stripe » | Liste d'attente : compteur dans le pulse (3) non affiché ; Stripe : 1 920 € « pas encore viré », visible seulement en compta | `routes-staff.js:187`, `balances.js:125` | P2 |
| C10 | Courbe de tendance | `kpis.cashed.series` est renvoyé et jamais dessiné | `cockpit.js:253` | P2 |
| C11 | Résumé reçu sans ouvrir l'application | Aucun envoi au gérant hors alertes (réservation, abonnement, RGPD) | `server/domain/mails.js:102`, `notices.js:45` | P2 |

**Ce que montrent Planity Pro, Fresha, Booksy ou Square et qui manque ici** : le chiffre *réservé à venir* à côté du chiffre fait ; le taux d'occupation des 7 prochains jours par collaborateur ; la rétention par cohorte (nouveaux revenus une deuxième fois) ; la valeur des créneaux récupérés par la liste d'attente ; le chiffre par heure travaillée en tête (ici calculé, `perHour`, mais affiché seulement dans une fiche de Rapports) ; un résumé quotidien par e-mail ou notification ; la comparaison à l'année précédente.

---

## 3. Interaction

### Nombre de taps, téléphone du gérant, depuis l'ouverture de `/comptoir` (qui arrive sur Pilotage)

| Tâche | Taps | Remarque |
|---|---|---|
| Chiffre du jour contre objectif | 0 | Si la dernière période choisie était « Aujourd'hui » ; elle est mémorisée (`Pilotage.tsx:39`) : après un dimanche soir en « Mois », le lundi matin s'ouvre sur le mois (1 tap) |
| Aujourd'hui est-il plein ? | 0 | Tuile Remplissage, par fauteuil |
| Coût des absences | 0 | Mais pas la liste : la tuile n'ouvre rien |
| Z fait ? Caisse ouverte ? | 0 | Bandeau caisse |
| Encaissements en attente | 1 | Puce vers la Caisse |
| Détail d'un barbier | 1 | Ligne de l'équipe |
| Relevé du mois d'un barbier | 2 | Bien |
| Qui est absent aujourd'hui | 1 à 4 | Une fiche par barbier, ou l'Agenda |
| Clients à relancer | 2 | Plus › Relances ; le compteur n'est pas visible avant |
| Semaine prochaine | 2 + lecture | Agenda › semaine ; pas de chiffre de synthèse |
| Exports du comptable | 3 + long défilement | Plus › Rapports › tout en bas |
| Changer l'objectif | 3 | Plus › Réglages › Objectifs ; le lien « Le fixer » n'existe que sans objectif (`Tiles.tsx:51`) |
| Stock bas | 3 | Plus › Catalogue › Produits |
| Marge | impossible | |

### Constats

- **P1 · Les tuiles ne mènent nulle part.** `Tile` est un `div` (`pilotage/shared.tsx:29-38`). « 9 absences · 218 € perdus » n'ouvre pas la liste des neuf ; « 15 nouveaux » n'ouvre pas les clients ; « Remises 20 € » ne dit pas qui les a accordées. Chaque tuile devrait ouvrir sa liste (Clients filtrés, Agenda du jour, ventes avec remise). Effort M, risque faible.
- **P1 · L'écran de 7 h 30 est fait de zéros et de bruit** : « Chiffre réalisé 0 € », « Repris avant de partir 0 % », « Pourboires 0 € », « Panier moyen 80 € » (un abonnement). Avant le premier encaissement, remplacer les tuiles de résultat par le briefing du jour (idée 1).
- **P2 · « Ouvrir la caisse »** (`pilotage/Cash.tsx:28`) est le lien vers la page de clôture, affiché même quand la caisse est déjà ouverte ou le Z fait. Écrire « Voir la caisse » ou « Faire le Z » selon l'état.
- **P2 · « comparé à mardi dernier en entier »** (`cockpit.js:66`) : la phrase est juste mais demande une relecture. « Mardi dernier, journée complète : 899 € » sous le chiffre se lit plus vite qu'un pourcentage sans couleur.
- **P2 · Vocabulaire** : « Encaissé », « Chiffre réalisé », « Chiffre d'affaires », « En cours », « Repris avant de partir », « Revenus sous 60 j » (qui se lit « revenus » au sens d'argent). Proposer : « Chiffre d'affaires », « Travail de l'équipe », « Dû aux clients », « Repartent avec un rendez-vous », « Clients revenus sous 60 jours ». Le tutoiement est constant, bien.
- **P2 · Téléphone** : dix tuiles, le bandeau caisse, l'équipe, l'équité puis les abonnés, les comptes et les avis : cinq à six écrans de défilement. Pas d'ordre personnalisable (Mon espace en a un). La carte de chaleur de Rapports dit « Survole une case » sur un écran tactile (`Rapports.tsx:416`) ; le tableau de l'équipe y perd dix colonnes sur treize.
- **P2 · États** : Pilotage est exemplaire (squelette, « Réessayer », période précédente gardée, bandeau hors ligne). Deux trous : les tuiles ajoutées (Abonnés, Espace client, Avis) disparaissent sans un mot si leur route échoue (`pilotage/tiles/Members.tsx:17`) ; l'erreur de Rapports n'a pas de bouton « Réessayer » (`Rapports.tsx:88`).
- **P2 · Rafraîchissement** : le pied de page ne dit pas l'heure de la lecture (`asOf` est renvoyé, `cockpit.js:270`, non affiché). Un « à jour à 7 h 31 » rassure.

---

## 4. Idées sobres, adaptées à un salon de quatre fauteuils

| # | Idée | Ce que le gérant voit | Où dans le code | Effort | Risque |
|---|---|---|---|---|---|
| 1 | **Briefing du matin** | En tête de Pilotage tant que rien n'est encaissé : « 44 rendez-vous, 1 188 € prévus · premier client 9 h · Esteban absent · 6 h 30 libres (Frank 14 h–16 h) · 3 en liste d'attente · 2 clients à risque d'absence » | Serveur : `todayOf()` dans `cockpit.js` (réutilise `dayKpis.planned`, `staffIntervals`, `bookedMinutes`, `s.timeoff`, `clientStats().risk`) ; écran : `pilotage/Today.tsx`, placé avant `Tiles` dans `Pilotage.tsx:109` | S | Faible |
| 2 | **Remplissage à venir** | Tuile « 7 prochains jours : 58 % », une barre par fauteuil et par jour ; flèche « avancer » réactivée | `aheadOf()` dans `cockpit.js` ; lever `disabled={current}` (`Pilotage.tsx:86`) et la borne `day > today` (`cockpit.js:50`) ; tuile `pilotage/tiles/Ahead.tsx` | S à M | Faible |
| 3 | **Alertes d'anomalie** (trois au plus, silencieuses sinon) | « Absences : 9 ce mois contre 5 d'habitude », « Écart de caisse 3 jours de suite », « Remises de Frank : 4 fois la moyenne », « Jeudi : Le Soldat à 20 % » | `alertsOf()` dans `cockpit.js` sur le modèle d'`equityOf` (seuil minimal d'événements, tri par écart) ; écran : copie de `pilotage/Equity.tsx` | M | Moyen : faux positifs ; exiger un volume minimal et comparer aux quatre mêmes jours de semaine |
| 4 | **Prévision de fin de mois réaliste** | « Fait 4 533 € + réservé 6 200 € + passages attendus 2 900 € = 13 600 € » au lieu de la règle de trois | Dans `goalOf` (`insights.js:513`) : somme des `a.price` des rendez-vous à venir du mois + moyenne des passages et ventes sans rendez-vous par jour ouvert ; affichage `Tiles.tsx:45` | M | Faible ; dire « estimation » |
| 5 | **À reconquérir** | Tuile « 17 clients ont dépassé leur rythme · environ 450 € · Relancer » ; segment « Perdus (plus de 6 mois) » | Tuile `pilotage/tiles/Winback.tsx` lisant `/api/v1/relances` (`routes-staff.js:747`) ; `x.lost` dans `clientStats` (`insights.js:78`) et segment dans `routes-staff.js:498` | S | Faible ; respecter le consentement déjà filtré |
| 6 | **Bilan du dimanche soir** | Un e-mail ou une page : la semaine en cinq lignes, la semaine suivante en trois (remplissage, absences d'équipe, trous à remplir) | Étape dans `server/commands/tick-steps.js`, gabarit `owner_digest` dans `server/domain/mails.js` (même voie que `owner_booking`) ; réglage dans `server/settings/notify.js` | M | Moyen : un e-mail de chiffres part hors de l'application ; l'activer par choix, sans noms de clients |
| 7 | **Stock bas** | Tuile « 2 produits sous le seuil » visible seulement quand il y en a | `pilotage/tiles/Stock.tsx`, données déjà dans le bootstrap (`stock`, `low`) : aucun changement serveur | S | Nul |
| 8 | **Marge estimée après commissions** | « Chiffre HT 3 778 € − commissions 1 698 € − achats produits 108 € = 1 972 € » (ordres de grandeur de la démo) | Champs `commissionTotal` et `productCost` dans `report()` ; tuile dans `Tiles.tsx` | S | Moyen : sera lu comme un résultat comptable ; l'appeler « reste après commissions », hors loyer et charges |
| 9 | **Heures creuses actionnables** | Sous la carte de chaleur : « Mardi 14 h–16 h à 30 % : proposer ce créneau aux 12 clients à relancer » | Bouton dans `Insights` (`Rapports.tsx:572`) vers `/relances?creneau=…` ; préremplissage dans `Relances.tsx` | M | Faible |
| 10 | **Comparer à un jour normal** | « Un mardi moyen (4 dernières semaines) : 870 € » ; N-1 dès un an d'historique | `periodOf` (`cockpit.js:49`) : `prev` devient une moyenne de quatre jours | S | Faible |

---

## 5. Les dix priorités, dans l'ordre

| Rang | Quoi | Réf. | Effort | Pourquoi d'abord |
|---|---|---|---|---|
| 1 | Deltas à jours ouverts égaux, sans alarme tant que la journée court | P0-1 | S | Le chiffre le plus regardé dit −35 % quand c'est +5 % |
| 2 | Une seule projection, jour en cours au prorata | P0-2 | S | Deux écrans, deux prévisions, 1 500 € d'écart |
| 3 | Briefing du matin (rendez-vous, prévu, absents, trous) | C1, idée 1 | S | À 7 h 30 l'écran n'affiche que des zéros |
| 4 | Remplissage à venir et flèche « avancer » | C2, idée 2 | S à M | « La semaine est-elle pleine ? » n'a pas de réponse |
| 5 | Clients, tickets et panier moyen sans le prépayé | P1-5 | S à M | Chiffres faux tous les jours de prélèvement |
| 6 | Capacité historique d'un barbier archivé, objectif figé par mois | P1-3 | M | Un départ réécrit les mois passés |
| 7 | Avoirs au même jour sur l'Agenda et Pilotage ; même base de comparaison sur Rapports | P1-4, P1-9 | S | Deux écrans qui se contredisent |
| 8 | Marge produit en HT ; coût des absences unique, net de l'acompte | P1-6, P1-7 | S | Deux chiffres faux sur Rapports |
| 9 | Un seul mot pour le chiffre d'affaires, et l'argent entré à côté | P1-8 | S | « Encaissé » n'est pas ce qui est entré en caisse |
| 10 | Tuiles cliquables, tuile « À reconquérir », tuile stock | Interaction, idées 5 et 7 | M | Chaque chiffre doit mener à la liste et à l'action |
