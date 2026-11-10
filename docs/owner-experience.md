# L'expérience du gérant · concept, budget et plan

Document de conception, écrit le 10 novembre 2026 après les cinq audits (`docs/audit-backoffice/01` à `05`) et leurs cinq lots de correctifs. Il ne modifie aucun code. Il sert de cahier des charges à des agents d'exécution : chaque lot de la section 5 se lit seul.

**Lu** : les audits, `docs/refonte-conventions.md`, `docs/roadmap.md`, `web/src/comptoir` (coquille, Pilotage, Rapports, Relances, Équipe, Réglages, recherche, fil), `server/domain/cockpit.js`, `insights.js`, `rhythm.js`, `risk.js`, `server/http/routes-cockpit.js`, `routes-staff.js`.

**Regardé en vrai** : démo en mémoire, compte gérant, téléphone 390×844, mardi 10 nov. 7 h 40 (préfixe `am-`) et samedi 14 nov. 18 h 45 (préfixe `pm-`). Captures dans `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/owner-brainstorm/`.

**Non vérifié** : aucun test lancé, aucune mesure de performance refaite (les chiffres de la section 4 viennent de l'audit 04, sauf les tailles de bundle, relues sur un build de ce jour). Le thème clair et le rôle « manager » (Jessica) n'ont pas été joués à l'écran.

---

## 1. Ce que le gérant vient faire

« Fait en 10 secondes » = téléphone sorti de la poche, une main, sans défilement, sans saisie.

| # | Travail | Quand | Qui | « Fait en 10 secondes » veut dire | Aujourd'hui |
|---|---|---|---|---|---|
| 1 | **Coup d'œil du matin** | avant l'ouverture | gérant | Une phrase : rendez-vous, chiffre prévu, qui est absent, heures libres. Et la liste de ce qui bloque. | Bon : carte « Aujourd'hui » en tête de Pilotage (`pages/pilotage/Today.tsx`). Les choses à traiter sont ailleurs (badges, bandeaux, toasts). |
| 2 | **Regard de mi-journée** | 13 h–15 h | gérant | Fait / prévu, trous de l'après-midi, encaissements en attente : 3 chiffres, 0 tap. | Les 3 chiffres existent mais sur 4 écrans de défilement (Pilotage : 3 348 px mesurés à 390×844). |
| 3 | **Clôture du soir** | après la fermeture | gérant ou accueil | « Z à faire » → 1 tap → comptage. Savoir si la journée est bonne par rapport à un jour normal. | Bandeau caisse en tête, bien. Le lien dit « Ouvrir la caisse » même caisse ouverte (`pilotage/Cash.tsx:28`, vu sur `pm-pilotage-fold.png`). |
| 4 | **Préparer la semaine** | dimanche ou lundi fermé | gérant | « Semaine remplie à 58 %, jeudi creux chez Le Soldat » + une action (proposer les trous). | Tableau « 7 prochains jours » présent, sans action au bout. |
| 5 | **Fin de mois avec le comptable** | du 1er au 5 | Jessica | Un bouton : les fichiers du mois clos partent (ou se téléchargent). | Exports en bas de Rapports (5,8 écrans), fichiers du comptable dans Réglages › Comptabilité : deux endroits. |
| 6 | **Paie et relevés** | fin de mois | Jessica | Relevé d'un barbier en 2 taps, CSV de paie en 1. | 2 taps depuis Pilotage (bien), CSV au fond de Rapports. |
| 7 | **Absences et planning d'équipe** | à la demande | gérant | Demande d'un barbier : Valider / Refuser depuis l'accueil, clients replacés dans le même geste. | Toast de 20 s si le Comptoir est ouvert (`App.tsx:251`), sinon Plus › Équipe. |
| 8 | **Reconquête** | 1 fois par semaine | Jessica | « 17 habitués en retard » → aperçu → envoyer. 3 taps. | Plus › Relances (badge invisible avant d'ouvrir « Plus »), puis 3 écrans de défilement jusqu'au bouton (`am-relances-full.png`). |
| 9 | **Répondre aux demandes** (site, SMS) | au fil de l'eau | Jessica | Non lues en tête de l'accueil, réponse en 1 écran. | Plus › Relances › Demandes (3ᵉ onglet, hors écran sur téléphone). |
| 10 | **Prix et carte** | 2 à 4 fois par an | gérant | Trouver une prestation par son nom, changer son prix, voir l'effet. | Plus › Catalogue, une fiche à la fois. Pas de changement groupé. |
| 11 | **Retrouver quelque chose** | tout le temps | les deux | Un champ : un client, un ticket, un réglage, une action. | Palette ⌘K complète sur ordinateur ; sur téléphone : Plus › Rechercher (2 taps), clients et pages seulement. |
| 12 | **Contrôle** (remises, avoirs, écarts de caisse, SMS en échec) | hebdomadaire | gérant | Rien à faire tant que tout va bien ; une carte quand un seuil est dépassé. | Chiffres présents sur Pilotage, sans seuil ni liste derrière (`Tile` est un `div`, `pilotage/shared.tsx:37`). |

Deux personnes, deux profils : le **gérant** regarde et décide (1, 2, 3, 4, 7, 12) ; **Jessica** traite des piles (5, 6, 8, 9). Le produit ne les distingue aujourd'hui que par le rôle (`owner` / `manager`), pas par ce qu'ils font.

---

## 2. Regard critique sur l'architecture actuelle

### 2.1 Ce qui est bon et qu'on garde

- Une seule lecture serveur par écran de chiffres (`cockpit()`, `report()`), mémoïsée ; états de chargement, d'erreur et de données périmées exemplaires sur Pilotage.
- Le briefing « Aujourd'hui » et « 7 prochains jours » (fait depuis l'audit 01), les deltas à jours ouverts égaux, « Chiffres lus à 7 h 40 ».
- Relances a déjà le bon geste : cocher, aperçu du texte, envoyer, consentement respecté côté serveur (`rebookable`, `routes-staff.js:284`).
- Mon espace a déjà une personnalisation explicite (ordre et masquage des cartes, `pages/espace/Customize.tsx`, `prefs.cards` / `prefs.hidden`). Pilotage n'en a pas.
- Le découpage par page (`lazy`), le fil en direct, la palette ⌘K.

### 2.2 Navigation

- **Dix entrées à plat** (`App.tsx:94-105`), sans regroupement. Sur téléphone, 4 onglets fixes pris dans `PHONE_TABS` : pour le gérant « Pilotage, Agenda, Caisse, Clients ». Relances, Rapports, Équipe, Catalogue, Réglages sont derrière « Plus » (`am-plus.png`).
- **« Plus » n'a pas de pastille** : les 17 clients à relancer et les demandes d'absence ne se voient qu'en l'ouvrant.
- Un gérant qui a un fauteuil reçoit « Mon espace » en 2ᵉ onglet, ce qui pousse Clients dans « Plus ». L'ordre est décidé par le code, jamais par la personne.
- **Barre du haut sur téléphone : 5 boutons** (Visite, ?, œil, cloche, avatar) et pas de recherche (`className="hide-phone"`, `App.tsx:195`).
- La carte « Bienvenue, on fait le tour ? » occupe tout le premier écran de Relances, Rapports, Clients tant que la visite n'est pas faite (`am-relances-fold.png`, `am-rapports-fold.png`).

### 2.3 Où vivent les choses : ce qui est illogique ou en double

| Sujet | Endroits | Problème |
|---|---|---|
| Les chiffres | Pilotage (jour / semaine / mois, pas à pas) et Rapports (aujourd'hui / 7 jours / ce mois / mois dernier…, par barbier) | Deux tableaux de bord, deux modèles de période. Vu le 10 nov. : Rapports écrit « comparé à jeu. 22 oct. → sam. 31 oct. » quand Pilotage compare à jours ouverts égaux. |
| « Équipe » | page Équipe (personnes, horaires, absences, rémunération, accès), Réglages › « Équipe et accès » (droits), Pilotage › « L'équipe », Rapports › « L'équipe » | Quatre choses sous le même mot. |
| « Relances » | À relancer (marketing), Liste d'attente (agenda), Demandes (boîte de réception), Messages envoyés (journal) | Le nom ne couvre qu'un onglet sur quatre. La boîte de réception est au 3ᵉ rang. |
| Exports | bas de Rapports (`Rapports.tsx:612`), Réglages › Comptabilité (`ComptaFiles`), bouton dans Clients, Réglages › Données | Quatre portes pour « sortir un fichier ». |
| Objectif du mois | réglé dans Réglages › Objectifs, lu sur Pilotage et Rapports | 3 taps pour un chiffre qu'on ajuste chaque mois ; le lien « Le fixer » n'existe que sans objectif (`Tiles.tsx:67`). |
| Ce qui demande une action | pastilles du menu, bandeau d'alerte, bandeau caisse, toasts, fil (cloche), bannière de l'agenda (`orphans`) | Six canaux, aucun endroit où tout est listé. La cloche est un historique : son compteur se remet à zéro à l'ouverture (`markRead`). |
| Période de Pilotage | mémorisée (`lx-pilotage-periode`) | Après un dimanche en « Mois », le lundi matin s'ouvre sur le mois. |

### 2.4 Trop de taps sur téléphone

| Tâche | Taps aujourd'hui | Cible |
|---|---|---|
| Voir qu'il y a des clients à relancer | 1 (ouvrir « Plus ») | 0 |
| Envoyer la relance | 2 + 3 écrans de défilement + 2 | 3, sans défilement |
| Valider une demande d'absence (Comptoir fermé au moment de la demande) | 3 | 1 |
| Exports du mois | 3 + 5,8 écrans | 2 |
| Changer l'objectif | 3 | 1 (depuis le chiffre) |
| Chercher un client | 2 puis saisie | 1 puis saisie |
| Stock bas | 3 | 0 (carte seulement s'il y en a) |

### 2.5 Ce qui ne tient pas à grande échelle

| Liste | État | Limite |
|---|---|---|
| Clients (`Clients.tsx:85`) | recherche, segments avec compteurs, tri, état dans l'URL : bien | Pas de sélection multiple, donc aucune action groupée (étiquette, SMS, export du filtre). « Voir 60 de plus » redemande toute la liste (`limit` qui grossit) alors que le serveur accepte `offset`. L'export CSV ignore le filtre. Chaque appel recalcule doublons et fiches inactives (`routes-staff.js:504-505`). |
| À relancer (`Relances.tsx:99`) | sélection, tout cocher, aperçu, envoi par paquets de 200 | Coupée à 200 sans le dire (`routes-staff.js:766`). Pas de filtre (barbier habituel, une seule visite, valeur). Sur téléphone le message et le bouton sont sous la liste. |
| Messages envoyés (`Relances.tsx:391`) | tableau des 150 derniers | 12,4 écrans sur téléphone, ni recherche, ni filtre par état ou par type, ni page suivante, ni « renvoyer les échecs ». Le serveur trie tous les messages à chaque appel (p50 ×5 entre 10 semaines et 5 ans, audit 04 §3.1). |
| Tickets (Caisse › Ventes) | par jour | Pas de recherche par numéro ou par client hors de la fiche client. |
| Catalogue | une fiche à la fois | Aucun changement groupé de prix, aucun aperçu d'effet. |
| Le fil | 80 lignes en mémoire | Pas de filtre par type. |
| Vues enregistrées | aucune | Jessica refait le même filtre chaque semaine. |

---

## 3. La proposition : « À traiter, puis le reste à sa place »

### 3.1 L'idée en une phrase

Le gérant n'ouvre plus un tableau de bord : il ouvre **une courte pile de choses à traiter, chacune réglée par une seule action**, sous une phrase qui résume le moment ; tout le reste est rangé selon une règle unique, et un champ de recherche fait tout ce que la pile ne propose pas.

### 3.2 La règle de rangement (une chose = un endroit)

Toute information ou fonction relève d'une seule de ces quatre natures. La question à se poser est dans la colonne 2.

| Nature | Question | Endroit | Exemples |
|---|---|---|---|
| **À traiter** | « Quelqu'un doit-il faire un geste, maintenant ou cette semaine ? » | **Accueil** | Z manquant, demande d'absence, clients à relancer, demande du site, SMS en échec |
| **Objets** | « Est-ce une liste de choses qu'on cherche, filtre, ouvre ? » | sa **liste** : Agenda, Clients, Tickets (Caisse), Messages, Équipe, Catalogue | une fiche client, un rendez-vous, un barbier, un produit |
| **Chiffres** | « Est-ce un nombre qu'on lit sans agir ? » | **Chiffres** (Pilotage et Rapports réunis) ; chaque nombre ouvre la liste d'objets qui le compose | chiffre d'affaires, remplissage, panier, absences |
| **Règles** | « Le règle-t-on une fois pour longtemps ? » | **Réglages** | horaires, acomptes, textes des SMS, droits |

Conséquences directes, à appliquer partout :

1. Un chiffre n'est jamais une impasse : toucher « 9 absences » ouvre la liste des 9.
2. Une carte « À traiter » ne contient jamais de réglage et ne montre jamais plus de 3 lignes : elle renvoie à la liste filtrée ou ouvre l'action.
3. Ce qu'on ajuste chaque mois n'est pas une règle : l'objectif se modifie depuis son chiffre (une feuille), Réglages garde la même feuille pour qui le cherche là.
4. Un nom désigne une seule chose : « Équipe » = les personnes ; Réglages › « Droits et accès » ; « Messages » = tout ce qui part et arrive (Demandes, Relances, Envoyés) ; la liste d'attente va avec l'Agenda.
5. Les fichiers à sortir ont une seule porte : Chiffres › Exports (et la recherche : « export octobre »).

### 3.3 L'Accueil du gérant (téléphone d'abord)

Nouvelle page `/comptoir/accueil`, page d'ouverture du gérant et des managers. Un seul appel serveur. Trois zones, dans cet ordre, sur un seul écran quand tout va bien :

```
┌──────────────────────────────────────┐
│ Mardi 10 novembre · ouverture à 9 h  │  ← le moment (une ligne)
│ 44 rendez-vous · 1 188 € prévus      │  ← la phrase (3 chiffres au plus)
│ 12 h libres · Esteban absent         │
├──────────────────────────────────────┤
│ À TRAITER · 3                        │
│ ● Z d'hier manquant        [Faire le Z]        │
│ ● Frank demande le 21–22 nov.                  │
│   3 clients à replacer     [Voir et valider]   │
│ ● 17 habitués en retard · env. 450 €           │
│   Wassim, Amine, Kaïs…     [Aperçu et envoi]   │
│ 2 autres ▾                                     │
├──────────────────────────────────────┤
│ Tout va bien pour : caisse, stock, messages    │  ← une ligne, pas de tuiles vertes
│ Voir les chiffres ›        Personnaliser       │
└──────────────────────────────────────┘
```

**La phrase** change avec le moment (calculé par le serveur à partir des horaires du salon, jamais de l'horloge du téléphone) :

| Moment (`moment`) | Condition | La phrase dit |
|---|---|---|
| `avant` | salon ouvert aujourd'hui, pas encore commencé | rendez-vous, chiffre prévu, heures libres, absents |
| `pendant` | ouvert | fait / prévu, encaissements en attente, prochain trou |
| `apres` | journée finie | chiffre du jour contre un jour normal, état du Z, pourboires |
| `ferme` | salon fermé ce jour | semaine écoulée en une ligne, semaine à venir en une ligne |
| + `finDeMois` | 3 derniers jours ouverts du mois ou 5 premiers jours du suivant | ajoute l'objectif, ou le mois clos |

**Les cartes** (catalogue de la phase 1). Chaque carte = un compte, au plus 3 lignes d'aperçu, **un seul bouton**.

| id | Apparaît quand | Bouton unique | Nature de l'action | Source déjà calculée |
|---|---|---|---|---|
| `z` | Z d'hier manquant, ou journée finie et Z pas fait | Faire le Z | aller (`/caisse/cloture`) | `cashOf` (`cockpit.js:242`) |
| `encaisser` | rendez-vous finis non encaissés | Encaisser | aller (`/caisse`) | `toPayAppts` |
| `absence-demande` | demande d'absence en attente | Voir et valider | feuille (`HandoverSheet`, `Equipe.tsx:361`) | `s.timeoffRequests` |
| `orphelins` | clients réservés chez un barbier absent | Replacer | feuille (la même) | `timeoffConflicts` |
| `demandes` | demandes du site ou réponses SMS non lues | Répondre | aller (`/relances/demandes`) | `/api/v1/inquiries` |
| `relances` | N habitués en retard, N ≥ seuil (5 par défaut) | Aperçu et envoi | **groupée** (feuille d'envoi) | `clientStats` + `rebookable` |
| `echecs` | messages en échec depuis 7 jours | Voir | aller (liste filtrée) | `s.messages` |
| `stock` | produits sous leur seuil | Voir | aller (`/catalogue`) | produits du bootstrap |
| `purge` | fiches au-delà des 3 ans | Purger | aller (segment « inactifs ») | `inactiveClients` |
| `comptable` | `finDeMois` et mois précédent clos | Fichiers du mois | aller (`/reglages/compta`) | clôtures |
| `objectif` | début de mois sans objectif | Fixer l'objectif | feuille | `settings.goals` |
| `semaine` | `ferme`, ou dernier jour ouvert de la semaine après la fermeture | Voir la semaine | aller (`/agenda`, vue semaine) | `aheadOf` (`cockpit.js:181`) |

Ordre : d'abord ce qui **bloque** (`z`, `encaisser`), puis ce qu'**une personne attend** (`absence-demande`, `orphelins`, `demandes`), puis ce qui **rapporte** (`relances`, `semaine`), puis l'**entretien** (`echecs`, `stock`, `purge`, `comptable`, `objectif`). Cinq cartes visibles au plus ; le reste est replié (« 2 autres »). Zéro carte : « Rien à traiter. », pas d'illustration.

Pour un gérant qui a un fauteuil, une ligne « Ma journée › » mène à Mon espace (elle existe déjà en tête de Pilotage).

### 3.4 Personnalisation : quels signaux, et comment elle reste lisible

Cinq signaux, pas un de plus. Aucun apprentissage automatique, aucun classement caché.

| Signal | D'où il vient | Ce qu'il change | Comment le gérant le voit et le contrôle |
|---|---|---|---|
| **Rôle et droits** | `boot.me.caps` | Quelles cartes existent pour lui (une carte sans le droit de son action n'est pas calculée) | Réglages › Droits et accès |
| **Fauteuil** | `boot.me.chair` | La ligne « Ma journée » | — |
| **Moment** | horaires du salon, côté serveur | La phrase ; les cartes `z`, `semaine`, `comptable` | Écrit en clair en tête (« ouverture à 9 h ») |
| **État du salon** | les comptes ci-dessus, avec un seuil par carte | Si une carte apparaît | Menu de la carte › « Pourquoi je vois ça » : « 17 habitués ont dépassé leur rythme (seuil : 5) » |
| **Choix explicites** | `prefs` de la personne (serveur, suivent d'un appareil à l'autre) | Ordre épinglé, cartes masquées, onglets du téléphone, vues enregistrées | Feuille « Personnaliser » (le modèle de Mon espace) : chaque carte avec un interrupteur, des flèches, et « Remettre par défaut » |

Et un sixième, borné : **l'usage**, compté **sur l'appareil seulement** (`localStorage`, clé `lx-accueil-usage` : par carte, nombre de fois traitée et de fois remise à plus tard sur 30 jours). Il ne sert qu'à deux choses, toutes deux visibles :

- **proposer**, jamais faire : « Tu remets "Stock" à plus tard depuis 5 fois : la masquer ? » [Masquer] [Garder] ; « Tu ouvres Relances plus que Caisse : la mettre dans la barre ? » ;
- trier les « Récents » de la recherche.

Pourquoi pas sur le serveur : chaque `prefs.set` est un événement du journal scellé et, aujourd'hui, **toute** écriture vide tous les mémos (audit 04, constat 4). Compter des clics dans le journal ferait grossir la chaîne et recalculer les chiffres pour rien. Les choix explicites, rares, y ont leur place ; les compteurs, non.

Menu de chaque carte (« ⋯ ») : **Plus tard** (masquée jusqu'à demain, sur l'appareil) · **Masquer cette carte** (dans `prefs`) · **Pourquoi je vois ça**. Les cartes `z` et `absence-demande` ne se masquent pas : elles engagent le salon.

Onglets du téléphone : « Accueil » en premier, fixe ; les trois suivants viennent de `prefs.tabs` s'il existe, sinon du rôle (gérant : Agenda, Clients, Chiffres ; avec fauteuil : Agenda, Caisse, Clients). « Plus » porte la somme des pastilles de ce qu'il contient. Les onglets ne bougent **jamais** tout seuls.

### 3.5 L'action groupée : « aperçu, puis envoyer »

Un seul composant (`BulkSheet`) pour toute action sur plusieurs objets, d'abord pour les relances :

1. **Qui** : la liste, tout coché selon la règle, les exclus expliqués en une ligne (« 10 exclus : pas d'accord pour les bons plans », « 3 décochés : relancés il y a moins de 14 jours »). On peut décocher.
2. **Quoi** : l'aperçu réel pour le premier destinataire, le nombre de SMS, l'heure de départ si on est hors des heures d'envoi. « Modifier le texte » déplie le champ ; par défaut il est replié.
3. **Un bouton collé en bas** : « Envoyer à 17 clients ». Pas de fenêtre de confirmation en plus : l'aperçu **est** la confirmation.
4. **Annuler** : le toast « Envoi dans 5 s · Annuler » retient l'appel réseau 5 secondes. C'est une annulation honnête pour ce qui ne se rattrape pas (il n'existe pas de commande d'annulation d'un message en file ; on n'en crée pas en phase 1). Pour ce qui se rattrape (une étiquette), le toast « Annuler » rejoue l'inverse.

Depuis l'Accueil : carte → feuille → bouton = **3 taps**, sans défilement jusqu'à 6 destinataires visibles.

### 3.6 Les listes : un seul gabarit (`ListKit`)

Toute liste d'objets suit le même ordre de gestes : **filtrer → sélectionner → agir → annuler**.

- **En-tête** : recherche, puces de filtre avec compteurs calculés par le serveur, tri. L'état est dans l'adresse (`?q=&segment=&tri=`), comme Clients le fait déjà : un filtre se partage et se retrouve.
- **Vues enregistrées** : une vue = un nom + la chaîne de requête, dans `prefs.views` (8 au plus), affichée comme première puce. « Enregistrer cette vue » apparaît dès qu'un filtre est actif.
- **Sélection** : bouton « Sélectionner » (pas d'appui long caché) ; cases à cocher ; « Tout sélectionner (214) » sélectionne **le filtre**, pas les lignes chargées.
- **Barre d'action** collée en bas dès qu'une ligne est cochée : une action principale, les autres sous « ⋯ ». Phase 1 pour Clients : Envoyer un SMS (consentement appliqué par le serveur, exclus comptés), Ajouter ou retirer une étiquette, Exporter la sélection.
- **Pages** : 60 lignes, « Voir 60 de plus » charge la page suivante (`offset`), sans redemander les précédentes. Toute liste coupée le dit (« 200 premiers sur 412 »).
- **Export** : toujours celui du filtre ou de la sélection en cours.

Ordre d'application : Clients (phase 1), puis Messages envoyés, Tickets, Liste d'attente, Catalogue (phase 2).

### 3.7 La barre de commande

La palette existe (`Palette.tsx`) ; elle devient l'outil « à grande échelle » et passe au premier plan sur téléphone (une loupe dans la barre du haut).

- **Trouve** : clients (existe), sections de Réglages par mots-clés (« acompte » → Réservation en ligne ; « TVA » → Comptabilité), pages, barbiers.
- **Fait** : un registre statique de commandes `{ id, label, mots, cap, run }` dans `comptoir/commands.ts` : « Poser une absence », « Relancer les habitués », « Faire le Z », « Fixer l'objectif », « Exports du mois », « Nouveau rendez-vous », « Vente libre », « Masquer les montants », « Thème », « Revoir la visite ».
- **Récents** en tête quand le champ est vide (compteur local, 5 lignes).
- Pas de langage naturel, pas de modèle : une correspondance de mots sans accents, comme aujourd'hui. Phase 2 : un appel `/api/v1/search` unique pour tickets par numéro et rendez-vous à venir par prénom.

### 3.8 Un système visuel calme : ce qu'on retire

| On retire | Où | Pourquoi |
|---|---|---|
| 3 des 5 boutons du haut sur téléphone (Visite, ?, œil) : dans le menu de l'avatar et la recherche | `App.tsx:191-202` | Reste : loupe, cloche, avatar. |
| La carte « Bienvenue » au-dessus du contenu | `App.tsx:205` | Elle descend sous le contenu sur toutes les pages au téléphone ; proposée une fois sur l'Accueil. |
| Les dix tuiles comme page d'ouverture | Pilotage | Elles restent dans Chiffres. L'Accueil a 3 chiffres. |
| Le dégradé rouge (`hot`) sur ce qui ne demande rien | `pl-tile hot`, `Kpi hot` | Le rouge = « à traiter ». La tuile du chiffre d'affaires n'est pas une alerte. |
| Les flèches ↑ ↓ sans signification | `Dlt` | Déjà neutres quand la journée court ; les masquer sous 5 % d'écart. |
| Les phrases d'explication permanentes sous les cartes | `pl-note`, pied de Relances | Derrière « Pourquoi / Comment c'est calculé » (le `<details>` existe). |
| La mémoire de période | `lx-pilotage-periode` | Chiffres s'ouvre sur « Aujourd'hui » ; on change de période pour la séance. |
| Les lignes « tout va bien » en tuiles vertes | — | Une ligne de texte : « Tout va bien pour : caisse, stock, messages ». |

Règles : une seule couleur d'accent, réservée au bouton de l'action ; un seul bouton plein par écran ; chiffres en `tnum` ; cible tactile de 44 px ; rien ne clignote (voir 4.3, animations).

### 3.9 Trois pistes écartées

| Piste | Pourquoi non |
|---|---|
| **A. Garder Pilotage comme accueil et ajouter des tuiles** (reconquête, stock : idées 5 et 7 de l'audit 01) | Le moins cher, mais la page fait déjà 4 écrans, mélange lire et agir, et n'apporte aucune règle de rangement. Chaque nouvelle idée deviendrait une tuile de plus. |
| **B. Un assistant conversationnel** (« demande au Comptoir ») | Boîte noire sur des montants, latence et coût à chaque question, réponses non reproductibles. La barre de commande donne l'essentiel du bénéfice avec des résultats exacts. À revoir quand les commandes seront nombreuses. |
| **C. Un accueil et une navigation qui se réorganisent seuls selon l'usage** | Deux utilisateurs : trop peu de données pour apprendre, et un écran qui bouge casse l'habitude du pouce. L'usage sert seulement à proposer. |
| D. (variante) Un résumé quotidien par e-mail ou SMS à la place | Utile en complément (phase 2, idée 6 de l'audit 01) mais on ne peut pas agir depuis un e-mail. |

---

## 4. Budget de performance

### 4.1 D'où l'on part (mesuré)

| Fait | Valeur | Source |
|---|---|---|
| JS initial du Comptoir | 119 Ko gzip : entrée 38,6 + partagé (React + commun) 74,5 + visite guidée 9 | audit 04 §9.1, confirmé sur le build du 10 nov. |
| Morceau Pilotage | 8,7 Ko gzip JS + 2,4 Ko CSS | build du 10 nov. |
| Pas de `manualChunks` | 74,5 Ko retéléchargés à chaque déploiement | `web/vite.config.ts` |
| Écran de connexion, 4G, CPU ×4 | FCP 0,62 s | audit 04 §9.2 |
| Chaîne avant le premier contenu | `auth/state` → `bootstrap` (5,5 Ko gz) → morceau de page + `cockpit` (1,6 Ko gz), puis 3 lectures de tuiles, `feed`, `pulse` à 1,5 s | `App.tsx:57-66`, `pilotage/tiles/*` |
| Toute écriture vide tous les mémos | Pilotage après une écriture : 170 ms contre 0,4 ms à chaud ; `pulse` 4 à 42 ms selon l'historique | audit 04 constat 4 ; toujours vrai (`insights.js:12`, `cockpit.js:25`, `espace.js`, `loyalty.js` comparent `s.version`) |
| `pulse` toutes les 4 s re-rend tout ce qui lit le contexte | 15 re-rendus par minute au repos | audit 04 §9.4 ; toujours vrai (`state.tsx:127-138`, `value` recréé à chaque rendu) |
| Animations `box-shadow` infinies | 12,6 s de fil principal par minute, agenda au repos, CPU ×4 | audit 04 §9.4 ; toujours là (`base.css:73-74`, `agenda.css:155`) |
| Démarrage à froid | 0,10 s (10 semaines) à 4,0 s (5 ans) sur Postgres local ; 3,2 s pour la démo en mémoire | audit 04 §2.2 |

### 4.2 Le budget

Téléphone moyen (CPU ×4), 4G (9 Mbit/s, 40 ms), instance chaude, session ouverte.

| Mesure | Budget | Comment la tenir |
|---|---|---|
| Accueil lisible, visite répétée | **≤ 0,8 s** | Dernière réponse de `/api/v1/home` gardée sur l'appareil et affichée tout de suite avec « lu à 7 h 31 », puis remplacée |
| Accueil lisible, première visite | ≤ 1,5 s (≤ 2,5 s en 4G lente) | Démarrage en parallèle, morceau de l'Accueil préchargé |
| Appels pour le premier écran | 3 en parallèle (`auth/state`, `bootstrap`, `home`), **0 par carte** | Une seule lecture serveur pour toutes les cartes |
| JS initial jusqu'à l'Accueil | ≤ 120 Ko gzip, morceau Accueil ≤ 10 Ko gzip, aucune dépendance nouvelle | Visite guidée en `lazy`, React dans son morceau |
| `/api/v1/home` | ≤ 4 Ko gzip ; ≤ 20 ms à chaud ; ≤ 60 ms après une écriture à 1 an d'historique | Mémo par minute ; invalidation sélective |
| Réponse à un toucher | ≤ 100 ms visible ; feuille ouverte ≤ 200 ms ; INP ≤ 200 ms | Feuilles déjà dans le morceau ; pas de requête avant d'ouvrir |
| Une page de liste | 60 lignes, ≤ 8 Ko gzip, rendue en ≤ 100 ms | `offset`, pas de `limit` qui grossit |
| Accueil au repos | ≤ 1 s de fil principal par minute ; 0 re-rendu quand le `pulse` n'apporte rien ; ≤ 5 appels par minute après 2 minutes sans geste | Contexte mémorisé, `pulse` ralenti au repos |

### 4.3 Ce que le serveur précalcule

`home(s, me, now)` assemble en une passe, à partir de mémos existants : `cockpit(s, { range: 'day' })` (phrase, caisse, 7 jours), `clientStats` (relances et leur valeur estimée = dépense ÷ visites de chacun), demandes d'absence et clients à replacer, demandes non lues, messages en échec, stock bas, fiches à purger. Mémo par `(version des données, minute, personne)`. Rien n'est stocké : c'est une lecture de la projection en mémoire.

### 4.4 Les six optimisations qui comptent pour le gérant au téléphone

| Rang | Optimisation | Gain attendu | Risque | Lot |
|---|---|---|---|---|
| 1 | **Une lecture `/api/v1/home` + copie locale affichée d'abord** | Visite répétée : contenu dès la fin du démarrage JS (≈ 0,6 à 0,8 s) au lieu d'attendre 3 allers-retours en chaîne ; masque aussi un démarrage à froid du serveur (0,1 à 4 s) ; −3 appels de tuiles | Chiffres périmés affichés quelques centaines de ms : toujours avec « lu à … ». **Jamais de copie sur un poste partagé** (session par code) ; effacée à la déconnexion | WP5 |
| 2 | **Invalidation sélective des mémos** (compteur `dataVersion` qui n'avance pas pour les holds, messages mis en file, clics d'avis, préférences) | 25 à 40 % des écritures ne coûtent plus rien : Pilotage 170 ms → 0,4 ms, `pulse` 42 ms → 0,5 ms à 5 ans | Faible si l'on procède par **liste des types qui n'invalident pas** : un type oublié recalcule, il ne ment pas. Touche `server/core/state.js` | WP2 |
| 3 | **Démarrage en parallèle** : `auth/state`, `bootstrap` et `home` partent ensemble ; le morceau de la page d'accueil est demandé sans attendre `bootstrap` | −2 allers-retours en série (≈ 80 ms en 4G, 300 ms en 4G lente) et la cascade du morceau | Faible : déconnecté, `bootstrap` et `home` répondent 401, à ignorer sans toast | WP4 |
| 4 | **Contexte mémorisé, `pulse` sans re-rendu quand rien ne change, `pulse` ralenti** (4 s → 15 s après 2 min sans geste ni changement, retour à 4 s au premier toucher) | 15 → 0 re-rendus par minute au repos ; 15 → 4 appels par minute ; batterie | Faible : l'horloge de l'agenda (`nowMin`) doit continuer d'avancer ; un toast peut arriver avec 15 s de retard sur un téléphone posé | WP1 |
| 5 | **Bundles** : React dans son morceau (`manualChunks`), visite guidée en `lazy` | −9 Ko gzip au premier chargement ; 74,5 Ko gardés en cache d'un déploiement à l'autre | Nul ; vérifier `npm run test:e2e` | WP1 (`vite.config`), WP4 (visite) |
| 6 | **Animations sur le compositeur** (`transform` + `opacity` sur un pseudo-élément, au lieu de `box-shadow`) | Agenda au repos : 12,6 s → environ 0,5 s de fil principal par minute | Nul | WP1 |

Hors périmètre ici, déjà classés par l'audit 04 : snapshot de la projection, journal hors mémoire, ETag sur l'agenda.

---

## 5. Plan par lots

### 5.1 Ce qu'aucun lot ne change

- **Prix, durées, TVA** du catalogue ; la démo (`server/domain/seed.js`).
- **Politique d'acompte** : `server/domain/policy.js`, `risk.js`, `server/settings/*` des acomptes.
- **Exports fiscaux et comptables** : `kind=sales|vat|closures|journal|commissions|payroll` de `/api/v1/export` (`routes-admin.js:345`), `routes-compta.js`, `server/domain/cash.js`, les clôtures Z.
- **Format du journal** : `server/core/journal.js`, `engine.js`, le scellement, la forme des événements existants. Un lot peut ajouter des clés à `prefs.set` (lot WP3), rien d'autre.
- **Parcours de réservation** : `public/site.html`, `public/refonte/*`, `web/src/client/*`, et les dix points de `docs/refonte-conventions.md`.
- **Règle de consentement** des SMS : `rebookable` et `sendRebook` gardent leur logique ; on les appelle, on ne les réécrit pas.
- **Les calculs** de `report()` et `cockpit()` : on les lit.
- **La ligne `ROUTES` de `App.tsx`** garde sa forme `nom: { C: Nom, title: '…', cap: '…' }` : `tests/unit/guide-coverage.test.js` la lit par expression régulière.
- Vocabulaire à l'écran : tutoiement, heures « 14 h 30 », espaces insécables avant « € » et « % », comme l'existant.

Vérifications communes à tout lot : `npm test`, `npm run typecheck`, `npm run build` sans avertissement nouveau ; captures Playwright à **390×844** et **1280×900** (démo en mémoire, `LX_FAKE_NOW=2026-11-10T07:40:00+01:00`, compte gérant du README) jointes au compte rendu.

### 5.2 Ordre et parallélisme

```
Vague A (en parallèle) : WP1 · WP2 · WP3 · WP7
Vague B               : WP5            (après WP3)
Vague C (en parallèle) : WP4 · WP6 · WP8   (après WP5 ; WP8 aussi après WP3)
```

Deux lots d'une même vague ne touchent aucun fichier commun (voir « Peut toucher »).

### WP1 · Le front au repos · M · modèle économique

- **But** : plus aucun travail du navigateur quand rien ne change ; bundles prêts pour le cache.
- **Peut toucher** : `web/vite.config.ts`, `web/src/ui/base.css` (lignes 73-74 et leurs usages), `web/src/comptoir/pages/agenda.css`, `web/src/comptoir/state.tsx`, `web/src/comptoir/pages/agenda/Board.tsx`.
- **À faire** : (1) `manualChunks` : `react` et `react-dom` dans un morceau `vendor`. (2) `@keyframes pulse` et `pulseOk` : un pseudo-élément animé en `transform: scale` + `opacity`. (3) `state.tsx` : `value` et les deux `Map` sous `useMemo` ; `setPulse` seulement si `version`, `cfg`, `today`, `min`, `badges` ou `alerts` ont changé ; `setPulseAt` gardé hors du contexte principal (un second contexte ou une référence lue par `Stale`). (4) `pulse` à 15 s après 2 minutes sans `pointerdown`/`keydown` ni changement de version, retour à 4 s au premier geste, au retour de visibilité, ou si la page est l'Agenda ou la Caisse. (5) `Board` en `React.memo`.
- **Acceptation** : le build montre un morceau `vendor` et l'entrée `comptoir` sans React ; script Playwright + CDP (`Performance.getMetrics`, `TaskDuration`, CPU ×4) : agenda au repos 60 s **< 1,5 s** (avant : 12,6 s) ; Accueil ou Pilotage au repos 60 s : **0 mutation DOM** hors horloge ; l'heure rouge de l'agenda avance toujours (capture à T et T+70 s) ; `npm run test:e2e`.
- **Ne pas changer** : l'intervalle de 4 s sur l'Agenda et la Caisse ; la logique des toasts.

### WP2 · Mémos : n'invalider que ce qui change les chiffres · M · modèle fort

- **But** : une écriture qui ne touche pas aux chiffres ne coûte plus rien aux lectures suivantes.
- **Peut toucher** : `server/core/state.js` (ajout d'un compteur `dataVersion` dans `evolve`), les fonctions `memo` de `server/domain/insights.js`, `cockpit.js`, `espace.js`, `loyalty.js` (elles comparent `dataVersion` au lieu de `version`), un nouveau `tests/unit/memo-invalidation.test.js`.
- **À faire** : liste explicite, en un seul endroit, des types qui **n'avancent pas** `dataVersion` : holds posés et libérés, `message.queued`, `message.updated`, `prefs.set`, clics et ouvertures d'avis, événements de téléphone lié. Tout autre type, connu ou futur, l'avance. Avant d'inscrire un type, vérifier qu'aucune lecture mémoïsée n'en dépend (attention : `attribution` des relances lit les messages ; si elle est mémoïsée, `message.*` ne va pas dans la liste).
- **Acceptation** : test : après un hold, `report()` et `clientStats()` rendent **le même objet** (identité) ; après `sale.completed`, un objet neuf et des totaux à jour ; après `message.queued`, `/api/v1/relances` montre bien la relance prévue ; `npm test` entier vert ; mesure jointe : `cockpit` après un hold ≤ 2 ms sur la démo (avant : 18 ms).
- **Ne pas changer** : `s.version`, le scellement, `engine.js`, la forme des événements, le résultat de n'importe quel calcul.

### WP3 · Serveur : la lecture « home » et les préférences de l'Accueil · M · modèle fort

- **But** : une route qui dit le moment, la phrase et les cartes à traiter de la personne.
- **Peut toucher** : nouveaux `server/domain/home.js`, `server/http/routes-home.js`, `server/domain/rebook.js` ; `server/http/app.js` (une ligne d'enregistrement, comme `cockpitRoutes`) ; `server/http/routes-staff.js` **uniquement** pour importer `rebookable` depuis `rebook.js` au lieu de le définir ; `server/projections/staffprefs.js` et le `prefsSchema` de `server/commands/team.js` ; `web/src/comptoir/types.ts` (types `Home`, `HomeCard`, et les clés de `Prefs`) ; nouveaux `tests/unit/home.test.js`, `tests/api/home.test.js`.
- **Contrat** `GET /api/v1/home` (droit `report.shop`) :

```
{ asOf, moment: 'avant'|'pendant'|'apres'|'ferme', finDeMois: boolean,
  line: { label, facts: [{ k, v, unit?: 'eur'|'min'|'pct' }] },        // 3 faits au plus
  cards: [{ id, group: 'bloque'|'attend'|'rapporte'|'entretien',
            count, amount?: number,                                    // centimes, estimation
            title, why,                                                // phrases prêtes à afficher
            preview: [{ id, text }],                                   // 3 au plus
            action: { kind: 'go'|'sheet'|'bulk', label, to?: string, ref?: string },
            canHide: boolean }],
  quiet: string[] }                                                    // « caisse », « stock », « messages »
```

- **Règles** : cartes et conditions du tableau 3.3 ; une carte dont l'action demande un droit absent n'est pas renvoyée ; ordre par groupe puis par `count` ; `prefs.homeHidden` retire une carte sauf si `canHide` est faux ; `prefs.homeCards` fixe l'ordre à l'intérieur d'un groupe. Seuils en constantes exportées (`RELANCES_MIN = 5`). Mémo par minute et par personne.
- **Préférences ajoutées** (toutes facultatives, mêmes règles que `cards`) : `homeCards`, `homeHidden` (listes d'ids, 20 au plus), `tabs` (3 noms de page au plus), `views` (8 au plus : `{ page, name ≤ 30, query ≤ 200 }`), et `'accueil'` dans `HOMES`.
- **Acceptation** : tests unitaires par moment (4 horloges) et par carte (présente au seuil, absente dessous, absente sans le droit) ; un barbier reçoit 403 ; le compte de `relances` est **égal** à `badges.relances` du `pulse` au même instant ; réponse ≤ 4 Ko gzip sur la démo ; `tests/unit/phones-prefs.test.js` toujours vert.
- **Ne pas changer** : le sens de `rebookable` (déplacement sans réécriture) ; `cockpit.js` ; aucun calcul de chiffre.

### WP7 · La barre de commande · M · modèle économique

- **But** : un champ qui trouve et qui fait, utilisable au pouce.
- **Peut toucher** : `web/src/comptoir/Palette.tsx`, nouveaux `web/src/comptoir/commands.ts` et `web/src/comptoir/palette.css`, nouveau `tests/unit/commands.test.js`.
- **À faire** : registre `{ id, label, mots[], cap?, run }` (liste de 3.7) ; les 16 sections de Réglages avec mots-clés et leur droit (lus de `pages/reglages/caps.ts`) ; « Récents » (clé locale `lx-palette-recents`, 5) ; sur téléphone : plein écran, champ en haut, lignes de 48 px, clavier ouvert d'emblée ; un seul tableau d'entrées (plus de liste de pages écrite deux fois avec `useNav`).
- **Acceptation** : test : chaque commande a un droit cohérent avec sa page, « acompte » trouve Réservation en ligne, un barbier ne voit aucune commande du gérant ; captures de la palette ouverte aux deux tailles ; « rel » + Entrée ouvre Relances.
- **Ne pas changer** : les raccourcis ⌘K et « / » ; la recherche de clients côté serveur.

### WP5 · La page Accueil · L · modèle fort

- **But** : la page de 3.3, branchée sur `/api/v1/home`.
- **Peut toucher** : nouveaux `web/src/comptoir/pages/Accueil.tsx`, `pages/accueil/*` (`Card.tsx`, `Customize.tsx`, `actions.ts`, `usage.ts`), `pages/accueil.css`, `guide/steps/ACCUEIL-01.ts` ; dans `App.tsx` **seulement** : l'import `lazy`, la ligne `accueil` de `ROUTES`, l'entrée de `useNav` ; `home.ts` (le gérant et les managers ouvrent `accueil`) ; `guide/ComptoirTour.tsx` (`GLANCE_PAGES`).
- **À faire** : la phrase ; les cartes (5 visibles, « N autres ») ; menu « ⋯ » (Plus tard, Masquer, Pourquoi) ; feuille « Personnaliser » sur le modèle de `espace/Customize.tsx` ; `actions.ts` : `go` navigue, `sheet` ouvre `HandoverSheet` ou la feuille d'objectif, `bulk` navigue vers `/relances` en attendant WP6 ; copie locale de la dernière réponse (clé `lx-home`, affichée d'abord avec « lu à … », **non écrite** si `useSharedScreen()` est vrai, effacée à la déconnexion) ; montants masqués comme Pilotage (`useMaskedAmounts`) ; états vide, erreur avec « Réessayer », hors ligne.
- **Acceptation** : captures 390×844 aux 4 moments (`07:40`, `15:10`, `19:30` un mardi ; un dimanche) : **phrase et première carte visibles sans défilement**, hauteur de page ≤ 2 écrans ; capture 1280×900 ; un seul appel `/api/v1/home` au chargement (trace réseau jointe), aucun appel par carte ; morceau `Accueil` ≤ 10 Ko gzip ; rechargement : contenu peint depuis la copie locale avant la réponse réseau (capture avec le réseau coupé) ; `tests/unit/guide-*.test.js` verts.
- **Ne pas changer** : Pilotage (il reste entier à son adresse) ; `state.tsx` ; la coquille au-delà des trois lignes citées.

### WP4 · La coquille au téléphone · M · modèle économique

- **But** : une barre du haut à 3 boutons, des onglets choisis, un « Plus » qui dit ce qu'il contient, un démarrage en parallèle.
- **Peut toucher** : `web/src/comptoir/App.tsx`, `shell.css`, `access.ts`, `home.ts`.
- **À faire** : (1) téléphone : loupe, cloche, avatar ; Visite, aide, œil et thème passent dans le menu de l'avatar. (2) Onglets : Accueil (ou la page d'ouverture de la personne) puis `prefs.tabs` ou le défaut du rôle (3.4) ; libellés : « Pilotage » devient « Chiffres » dans le menu (l'adresse ne change pas). (3) « Plus » : pastille = somme des pastilles des pages qu'il contient. (4) Carte « Bienvenue » sous le contenu sur toutes les pages au téléphone. (5) `Root` : `auth/state`, `bootstrap` et le morceau de la page d'ouverture demandés en parallèle ; un 401 de `bootstrap` est ignoré. (6) Visite guidée en `lazy`. (7) Le choix des onglets dans Réglages › Mon compte est hors de ce lot : `prefs.tabs` est seulement lu.
- **Acceptation** : captures 390×844 de l'Accueil, de Relances et de « Plus » (3 boutons en haut, pastille sur « Plus », pas de carte « Bienvenue » au-dessus du contenu) ; capture 1280×900 inchangée hors libellé ; l'entrée `comptoir` perd ≥ 8 Ko gzip (visite sortie) ; trace réseau : `auth/state` et `bootstrap` partent dans la même tranche de 50 ms ; `tests/unit/tour.test.js`, `guide-coverage.test.js`, `npm run test:e2e` verts.
- **Ne pas changer** : la navigation sur ordinateur (ordre et entrées) ; le verrouillage automatique des postes ; les règles de `canOpenPath`.

### WP6 · Relancer en trois gestes · M · modèle économique

- **But** : le gabarit d'action groupée, appliqué aux relances, ouvrable depuis l'Accueil.
- **Peut toucher** : nouveau `web/src/ui/BulkSheet.tsx` ; `web/src/comptoir/pages/Relances.tsx` (composant `Rebook` seulement), `relances.css` ; `web/src/comptoir/pages/accueil/actions.ts` (brancher `bulk` → la feuille).
- **À faire** : `BulkSheet` selon 3.5 (qui, quoi, bouton collé, envoi retenu 5 s avec « Annuler ») ; `Rebook` exporte `RebookSheet` ; sur téléphone la page À relancer montre la liste et une barre collée « Aperçu et envoi (17) » ; le texte est replié derrière « Modifier le texte » ; « Messages automatiques » passe sous un lien ; la tuile « Revenus » devient « Clients revenus » ; si la liste est coupée, le dire (« 200 premiers sur N »).
- **Acceptation** : parcours Playwright à 390×844 : Accueil → carte → feuille → « Envoyer à N » = **3 touchers, 0 défilement** ; « Annuler » dans les 5 s : aucun `POST /api/v1/relances/send` dans la trace ; sans annulation : un seul `POST`, toast « N relances en route » ; captures aux deux tailles ; les exclusions affichées sont celles de la réponse serveur (`excludedNoConsent`).
- **Ne pas changer** : `sendRebook`, la règle des 14 jours, les heures d'envoi, la mention STOP ; les onglets Liste d'attente, Demandes, Messages envoyés.

### WP8 · Le gabarit de liste, appliqué aux Clients · L · modèle fort

- **But** : filtrer, sélectionner, agir, annuler sur des centaines de fiches.
- **Peut toucher** : nouveaux `web/src/ui/ListKit.tsx`, `server/http/routes-bulk.js`, `tests/api/clients-bulk.test.js` ; `web/src/comptoir/pages/Clients.tsx` (composant `ClientList` seulement), `clients.css` ; `server/http/routes-staff.js` **uniquement** le gestionnaire `GET /api/v1/clients` (paramètre `fields=ids`) ; `server/commands/clients.js` (commande `tagClients`) ; `server/http/app.js` (une ligne).
- **À faire** : `ListKit` : `useSelection` (par ids ou par filtre), `ActionBar`, `LoadMore` par `offset`, `SavedViews` sur `prefs.views` ; `ClientList` : pages par `offset`, « Sélectionner », « Tout sélectionner (N) » via `fields=ids` (2 000 au plus, sinon le dire) ; `POST /api/v1/clients/bulk` `{ ids, op: 'tag'|'untag'|'sms'|'export', tag?, text? }` : `tag` et `untag` (droit `client.edit`, l'étiquette de confiance exige `agenda.edit` comme aujourd'hui), `sms` (droit `marketing`, passe par `sendRebook`, renvoie envoyés et exclus), `export` (droit `client.export`, mêmes colonnes que `kind=clients`, limité aux ids) ; toast « Annuler » qui rejoue l'inverse pour les étiquettes.
- **Acceptation** : tests API : 300 ids étiquetés en une requête et une seule écriture au journal ; `sms` n'atteint aucun client sans consentement ; un barbier reçoit 403 ; `export` ne sort que les ids demandés ; à l'écran : la 2ᵉ page ne redemande pas la 1ʳᵉ (trace réseau : `offset=60`) ; captures aux deux tailles, barre d'action visible avec 3 fiches cochées ; une vue enregistrée survit à un rechargement.
- **Ne pas changer** : la fiche client, la fusion, l'effacement RGPD, les segments et leurs compteurs, `kind=clients` de `/api/v1/export`.

### 5.3 Phase 2 (après retour du gérant sur la phase 1)

1. **Chiffres** : Pilotage et Rapports sous une seule entrée (Résumé, Détail, Exports) ; chaque tuile ouvre sa liste ; un seul modèle de période ; l'objectif se modifie depuis son chiffre.
2. **Messages** : « Relances » renommée ; Demandes en premier ; Messages envoyés sur `ListKit` (filtre par état et par type, « Renvoyer les échecs ») ; liste d'attente rattachée à l'Agenda ; index des messages côté serveur.
3. **Trous à vendre** : carte `semaine` avec action groupée « Proposer jeudi 14 h–16 h aux 12 clients en retard » (idée 9 de l'audit 01).
4. **Prix** : changement groupé dans le Catalogue (« +1 € sur les coupes ») avec aperçu d'effet sur le mois passé, puis application.
5. **Recherche serveur unique** (`/api/v1/search`) : tickets par numéro, rendez-vous à venir par prénom.
6. **Résumé du dimanche soir** par e-mail, au choix, sans nom de client (idée 6 de l'audit 01).
7. Réglages › « Droits et accès » (renommage) et choix des onglets du téléphone dans Mon compte.

---

## 6. Questions pour le gérant

| # | Décision | Recommandation par défaut |
|---|---|---|
| 1 | **L'Accueil remplace-t-il Pilotage comme page d'ouverture**, pour toi et pour Jessica ? | Oui pour les deux. Pilotage reste, sous le nom « Chiffres », à un tap. |
| 2 | **Onglets du téléphone** : lesquels après « Accueil » ? | Agenda, Clients, Chiffres (Caisse à la place de Chiffres si tu encaisses toi-même). Modifiable ensuite. |
| 3 | **Relance des habitués** : reste-t-elle une décision à chaque envoi, ou part-elle seule au rythme de chacun ? | Décision à chaque envoi en phase 1 (3 touchers). L'envoi automatique est une option à ouvrir plus tard, avec un plafond par semaine. |
| 4 | **Seuils des cartes** : à partir de combien une carte apparaît (relances : 5 clients ; SMS en échec : 1 ; stock : 1 produit) ? | Ces valeurs, les mêmes pour tous au départ. |
| 5 | **Jessica voit-elle les mêmes montants que toi** sur l'Accueil (chiffre du jour, objectif) ? | Oui si son rôle a déjà les chiffres du salon (`report.shop`) ; sinon elle a les cartes sans la phrase chiffrée. |
| 6 | **Copie locale de l'Accueil sur ton téléphone** (affichage immédiat, chiffres de la dernière ouverture pendant une demi-seconde) : d'accord ? | Oui sur un téléphone personnel, jamais sur la tablette du salon. |
