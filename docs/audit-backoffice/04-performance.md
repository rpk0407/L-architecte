# Audit back-office · 04 · Performance et optimisation

Audit en lecture seule, **mesuré** : aucun fichier du dépôt n'a été modifié, aucune commande git lancée.
Date des mesures : 10 novembre 2026.

## 0. Ce qu'il faut retenir

| # | Constat | Mesure | Gravité |
|---|---|---|---|
| 1 | **Écritures simultanées sur une même instance : tempête de conflits, 503, et réservations enregistrées mais répondues en erreur.** Le moteur n'a pas de file d'écriture par instance : N écritures concurrentes font N(N+1)/2 `append`, la 9ᵉ reçoit un 503 `busy`, et une lecture concurrente peut faire échouer `apply` après un `append` réussi. | 20 holds simultanés : **8 réussis, 12 × 503**, 132 `append` pour 20 écritures. Sur un vrai Postgres local, 12 parcours « hold → réservation » simultanés : **5 réservations en base, 4 répondues 201, 1 répondue 500** ; à 5 ans d'historique le même test dure **12 s** (relecture complète du journal) contre 0,26 à 0,46 s à 10 semaines. | **Critique** (performance **et** exactitude) |
| 2 | **Le journal entier reste en mémoire** : 90 % du tas. | Tas après démarrage : 28 Mo (10 sem.), 92 Mo (1 an), 246 Mo (3 ans), **416 Mo (5 ans)**, dont projection seule 42 Mo. Sauvegarde nocturne : +443 Mo de pic et 2,4 s bloquantes à 5 ans. | Haute à partir de 3 ans |
| 3 | **Démarrage à froid = relecture complète**, linéaire, sans snapshot. | Postgres local (lecture + rejeu) : 0,10 s (10 sem.), 0,49 s (1 an), 1,7 s (3 ans), **4,0 s (5 ans)**. Extrapolé à 80 RDV/jour sur 5 ans : environ 10 s, sur un `maxDuration` de 30 s. | Haute à terme |
| 4 | **Chaque écriture vide tous les mémos** (`memo` par version du journal), y compris un hold ou un SMS mis en file. Le premier `pulse` qui suit recalcule les statistiques de toute la clientèle. | `pulse` après une écriture : 4 ms (10 sem.), 14 ms (1 an), 26 ms (3 ans), **42 ms (5 ans)** contre 0,45 ms à chaud. Agenda : 59 ms contre 2,4 ms. Pilotage : 170 ms contre 0,4 ms. | Moyenne, croît avec l'historique |
| 5 | **Le site public interroge 5 fois la disponibilité toutes les 30 s, page d'accueil ouverte, sans rien réserver** ; et le cache `s-maxage=5, stale-while-revalidate=10` peut montrer libre un créneau pris depuis 15 s. | 6 appels API toutes les 30 s par onglet (12 invocations/min). Après un 409 « créneau pris », le site redemande la même URL cachable. | Moyenne (coût et expérience ; pas de double réservation) |
| 6 | **Le Comptoir re-rend tout l'agenda à chaque `pulse` (4 s)** et l'agenda au repos consomme le fil principal à cause d'animations `box-shadow` infinies. | Agenda au repos, 60 s, CPU ×4 : **12,6 s de fil principal** (Caisse : 0,2 s sur 30 s). 15 `pulse` par minute, chacun change la valeur du contexte React. | Moyenne (tablette allumée toute la journée) |

Le rapport détaille chaque point, donne l'endroit exact à modifier, le gain attendu et le risque.
Le plan priorisé (10 optimisations sûres) est en section 9.

## 1. Méthode et limites

### Banc de mesure

- Machine : conteneur Linux 4 vCPU partagé, Node 22.23. Les chiffres sont des ordres de grandeur de laboratoire, pas ceux de Vercel `cdg1`.
- Historiques : produits par le vrai générateur de démo (`buildDemoJournal`, `server/domain/seed.js:233`, option `weeks`), donc par les vraies commandes. Quatre tailles : 10, 52, 156 et 260 semaines.
- Serveur HTTP : `node scripts/dev.mjs --port 3174`, en `--memory` pour la démo de 10 semaines, avec `LX_DATA_FILE` pointant sur une copie du journal pour les grands historiques.
- Latences : 20 clients concurrents en keep-alive, 15 requêtes chacun (300 par route), après une première requête isolée.
- Écritures : en processus, par `handle()` (comme `tests/api/client.js`), avec des IP distinctes pour ne pas déclencher les limites `guard`. Magasin mémoire, magasin à latence injectée, puis **vrai Postgres 16 local** (boucle locale, `fsync=off`).
- Allers-retours magasin : comptés sur `fakeBlobSdk` (Blob) et sur un double de `pg.Pool` qui compte les requêtes.
- Front : `vite build` vers le scratchpad (pas vers `dist/`), servi derrière un petit proxy brotli. Chromium (Playwright) avec limitation CDP : CPU ×4, « slow 4G » (1,6 Mbit/s, 150 ms RTT) ou « 4G » (9 Mbit/s, 40 ms).

Scripts : `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/perf/` (`seed.mjs`, `replay.mjs`, `http.mjs`, `conc.mjs`, `ghost.mjs`, `pg.mjs`, `stores.mjs`, `mixed.mjs`, `lh.cjs`, `idle.cjs`, `reqs.cjs`).

### Limites à garder en tête

- **Volume.** Le générateur produit environ 160 RDV par semaine (32 par jour ouvré), soit 27 500 événements par an. La cible « 4 fauteuils, environ 80 RDV/jour » représente environ 2,5 fois cette densité. Les colonnes « cible » ci-dessous sont des **extrapolations linéaires** (la linéarité est vérifiée sur les quatre tailles mesurées), pas des mesures.
- **Clientèle.** Le générateur garde 520 clients quel que soit l'historique. Un vrai salon en aura plusieurs milliers après 5 ans : les routes Clients, Relances et doublons sont donc sous-estimées.
- **Réseau.** Pas de latence réseau vers la base, pas de TLS, pas de démarrage à froid de Vercel ni de Neon. Les latences Postgres réelles s'ajoutent (voir section 5).
- **Concurrence.** Un seul processus Node : sous 20 clients, le p50 mesure surtout l'attente dans la file. Le temps de service réel d'une requête est `1000 / req/s`.
- **Lighthouse.** Chiffres de type Lighthouse (FCP, LCP, TBT, CLS) mesurés par `PerformanceObserver` sous limitation CDP, pas un score Lighthouse officiel.

## 2. Démarrage à froid, rejeu et mémoire

### 2.1 Rejeu de la projection (un seul exemplaire du journal en mémoire)

| Historique | Événements | Journal JSON | gzip | `JSON.parse` | `evolve` (rejeu) | Événements/s | `verifyChain` | Tas : journal | Tas : projection | Tas total | RSS |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 semaines | 7 461 | 5,3 Mo | 0,9 Mo | 27 ms | 31 ms | 238 000 | 153 ms | 19 Mo | 2,4 Mo | 28 Mo | 92 Mo |
| 1 an | 27 552 | 20,9 Mo | 3,5 Mo | 146 ms | 133 ms | 207 000 | 495 ms | 77 Mo | 9,1 Mo | 92 Mo | 185 Mo |
| 3 ans | 76 352 | 58,7 Mo | 9,6 Mo | 359 ms | 211 ms | 362 000 | 1 114 ms | 214 Mo | 25,5 Mo | 246 Mo | 355 Mo |
| 5 ans | 129 024 | 100,6 Mo | 16,4 Mo | 560 ms | 325 ms | 397 000 | 1 953 ms | 367 Mo | 42,2 Mo | 416 Mo | 525 Mo |
| 5 ans, cible 80 RDV/j (extrapolé) | environ 322 000 | environ 250 Mo | environ 41 Mo | environ 1,4 s | environ 0,8 s | | environ 4,9 s | environ 920 Mo | environ 105 Mo | **environ 1,0 Go** | |

Lecture :

- Le rejeu lui-même est rapide (plus de 200 000 événements par seconde) : `docs/architecture.md` dit vrai sur ce point.
- **Le coût est ailleurs** : lire et désérialiser le journal, puis le **garder** (`journal.push(e)`, `server/core/engine.js:126`). La projection que lisent les écrans ne pèse que 10 % du tas.
- Un événement pèse 800 octets en moyenne. Trois types font 85 % du volume : `sale.completed` (34 %, 1 008 octets), `appt.booked` (26 %, 682 octets), `message.queued` (24 %, 1 319 octets).

### 2.2 Démarrage à froid de bout en bout

| Scénario | 10 sem. | 1 an | 3 ans | 5 ans |
|---|---|---|---|---|
| Processus Node → première réponse 200, magasin fichier | 0,35 s | 0,89 s | 1,80 s | 2,84 s |
| Idem, RSS après démarrage (le magasin fichier garde sa propre copie) | 145 Mo | 250 Mo | 492 Mo | 762 Mo |
| Postgres local : `read(0)` seul | 76 ms | 346 ms | 1 435 ms | 3 719 ms |
| Postgres local : `read(0)` + rejeu | 99 ms | 486 ms | 1 710 ms | **4 042 ms** |
| Taille de la table `lx_events` | 7 Mo | 28 Mo | 78 Mo | 134 Mo |
| Blob (SDK simulé) : GET au démarrage | | 29 GET, 21 Mo | | |
| Démo `--memory` (rejoue le générateur à chaque démarrage) | **3,17 s** | | | |
| Import des modules (`api/main.js`, 1,5 Mo de sources non groupées) | 100 ms | | | |

Lecture :

- Avec Postgres, la lecture domine le rejeu d'un facteur 10 : le pilote `pg` désérialise trois colonnes `jsonb` par ligne, par pages de 5 000 (`server/store/postgres.js:79`), soit 26 allers-retours à 5 ans.
- À la cible (80 RDV/j, 5 ans), compter environ **10 s** en local, plus le réveil de Neon et le réseau. Pendant ce temps, toutes les requêtes de l'instance attendent la même promesse `booting` (`server/http/runtime.js:87`).
- Une démo sans magasin durable régénère 10 semaines d'historique à chaque instance froide : 3,2 s. C'est le cas que `runtime.js:121` signale déjà (« Aucun stockage durable »).

## 3. Latence des routes chaudes

### 3.1 Vingt clients concurrents (serveur HTTP local, réponses non compressées)

Colonnes : première requête isolée (mémo froid) / p50 / p95, en millisecondes, puis débit.

| Route | 10 sem. | 1 an | 3 ans | 5 ans | req/s à 5 ans | Octets JSON (gzip) | `Cache-Control` |
|---|---|---|---|---|---|---|---|
| `GET /api/public/salon` | 4 / 8 / 28 | 5 / 9 / 28 | 4 / 10 / 28 | 5 / 10 / 34 | 1 174 | 7 506 (2 069) | `s-maxage=20, swr=60` |
| `GET /api/public/live` | 10 / 9 / 29 | 20 / 12 / 97 | 20 / 12 / 207 | 27 / 16 / 334 | 520 | 88 | `s-maxage=15` |
| `GET /api/public/availability` (10 j) | 4 / 17 / 34 | 4 / 18 / 37 | 4 / 23 / 42 | 5 / 23 / 46 | 705 | 4 900 (500) | `s-maxage=5, swr=10` |
| `GET /api/public/availability` (14 j) | 2 / 19 / 39 | 3 / 20 / 43 | 2 / 21 / 43 | 2 / 24 / 52 | 733 | 6 300 (580) | idem |
| `GET /api/v1/pulse` | 12 / 11 / 22 | 25 / 13 / 26 | 48 / 12 / 25 | **69** / 13 / 28 | 1 256 | 695 (335) | `no-store` |
| `GET /api/v1/bootstrap` | 3 / 13 / 25 | 3 / 13 / 26 | 3 / 17 / 32 | 7 / 19 / 36 | 922 | 17 260 (5 535) | `no-store` |
| `GET /api/v1/agenda` (aujourd'hui) | 12 / 39 / 80 | 19 / 41 / 83 | 23 / 44 / 90 | **54** / 47 / 95 | 375 | 46 000 à 50 000 (6 000) | `no-store` |
| `GET /api/v1/agenda` (12 autres jours) | 8 / 22 / 50 | 19 / 24 / 110 | 52 / 24 / 199 | 51 / 26 / **309** | 367 | 31 000 (4 200) | `no-store` |
| `GET /api/v1/week` | 4 / 37 / 77 | 4 / 39 / 78 | 4 / 39 / 75 | 5 / 42 / 87 | 416 | 5 770 (1 030) | `no-store` |
| `GET /api/v1/sales` (caisse du jour) | 3 / 9 / 20 | 4 / 13 / 26 | 4 / 18 / 35 | 5 / 26 / 53 | 678 | 9 000 à 12 000 (1 900) | `no-store` |
| `GET /api/v1/drawer` | 3 / 15 / 30 | 3 / 17 / 33 | 7 / 27 / 54 | 14 / 35 / 71 | 498 | 2 600 (830) | `no-store` |
| `GET /api/v1/clients` | 12 / 57 / 116 | 12 / 59 / 121 | 19 / 66 / 133 | 33 / 62 / 128 | 263 | 29 800 (4 200) | `no-store` |
| `GET /api/v1/reports` (mois) | 15 / 14 / 28 | 57 / 15 / 30 | 142 / 19 / 36 | **117** / 14 / 29 | 1 215 | 8 100 (2 270) | `no-store` |
| `GET /api/v1/reports` (365 j) | 34 / 16 / 31 | 100 / 16 / 31 | 339 / 17 / 33 | **455** / 16 / 32 | 1 130 | 36 300 (6 400) | `no-store` |
| `GET /api/v1/cockpit` (Pilotage) | 18 / 7 / 18 | 54 / 6 / 14 | 89 / 10 / 22 | **99** / 5 / 13 | 3 351 | 6 000 (1 600) | `no-store` |
| `GET /api/v1/relances` | 3 / 18 / 36 | 7 / 33 / 69 | 21 / 89 / 172 | 22 / 96 / 195 | 188 | 7 800 à 16 600 | `no-store` |
| `GET /api/v1/messages` | 3 / 16 / 33 | 4 / 28 / 57 | 7 / 56 / 115 | 7 / 80 / 162 | 224 | 55 000 (4 100) | `no-store` |
| `GET /api/v1/integrity` (2 clients) | 122 / 199 / 204 | 393 / 730 / 741 | 1 268 / 2 230 / 2 429 | **2 038 / 3 848 / 3 882** | 1 | 1 370 | `no-store` |

Lecture :

- **À chaud, tout est bon.** Les mémos par version font leur travail : un rapport sur 365 jours répond en 16 ms une fois calculé. La disponibilité ne dépend pas de l'historique (index `apptsByDay`) : 0,8 ms de calcul à toutes les tailles.
- **Le coût est dans la première requête après une écriture** (colonne de gauche), qui croît avec l'historique. La section 4 le quantifie.
- Trois routes croissent même à chaud, faute d'index ou de mémo : `relances` (p50 ×5 entre 10 semaines et 5 ans), `messages` (×5), `drawer` (×2,3). Elles parcourent la clientèle, `s.messages` ou `s.drawers` en entier à chaque appel.
- `integrity` recalcule tout le SHA-256 de la chaîne de façon synchrone : **2 s de boucle d'événements bloquée** à 5 ans, pendant lesquelles aucune autre requête n'est servie. `routes-health.js:61` fait la même chose toutes les 10 minutes au plus quand la page Santé est ouverte.
- L'agenda du jour pèse 46 à 50 Ko pour 45 rendez-vous, soit 1,1 Ko par rendez-vous : chaque rendez-vous embarque la fiche client complète (`apptView` → `clientCard`, `server/http/views.js:103`).

### 3.2 Écritures (en processus, une instance)

| Scénario | Magasin mémoire | Latence injectée (3 ms lecture, 12 ms écriture) | Postgres local réel |
|---|---|---|---|
| `POST /api/public/holds`, en séquence, médiane | 1,2 ms | 14,1 ms | 2,1 ms |
| `POST /api/public/bookings` (avec hold), en séquence, médiane | 1,2 ms | 14,4 ms | |
| Allers-retours magasin par réservation en démo (réservation + paiement d'acompte) | 2 `append` | 2 `append` | |
| Lectures magasin par écriture, en séquence rapprochée | 0 (throttle 1,5 s) | 0 | |

En séquence, l'écriture est saine : une décision pure, un `append`, pas de relecture. Le problème apparaît dès que deux écritures se chevauchent (section 6).

## 4. Recalcul complet à chaque écriture, ou mémo incrémental

### 4.1 Le mécanisme

Tous les modèles de lecture coûteux sont mémorisés dans une `WeakMap` indexée par l'état, **vidée dès que `s.version` change** :

- `server/domain/insights.js:11-17` (`clientStats`, `report`, `teamRows`, parts d'objectif) ;
- `server/domain/loyalty.js:26`, `server/domain/cockpit.js:23`, `server/domain/espace.js:26`, `server/domain/membership.js:246`, `server/commands/clients.js:157` et `:302`.

Or **toute** écriture change la version : un hold posé par un visiteur du site, un SMS mis en file par le tick, un `message.updated`, un clic sur un lien d'avis, une signature de clôture. Dans l'historique généré, 25 % des événements ne touchent ni rendez-vous, ni ventes, ni clients (`message.*`, `review.clicked`, `seal.signed`) ; en production s'y ajoutent les holds, absents du générateur.

Deux lectures très fréquentes retombent alors sur un calcul complet :

- `GET /api/v1/pulse` → `badges()` → `clientStats()` pour compter les relances (`server/http/routes-staff.js:186`), dès que la personne a la permission `marketing`. Chaque tablette ouverte l'appelle toutes les 4 s.
- `GET /api/v1/agenda` → `agendaView()` → `clientStats(s, day, now)` (`server/http/views.js:129`). La clé du mémo est le **jour affiché**, pas aujourd'hui : chaque jour consulté recalcule les statistiques de toute la clientèle (colonne « autres jours » du tableau 3.1, p95 de 309 ms à 5 ans).

### 4.2 Coût mesuré : première lecture après une écriture, puis seconde lecture

Médianes en millisecondes, en processus, 12 répétitions ; l'écriture est un hold posé depuis le site.

| Route | 10 sem. froid / chaud | 1 an | 3 ans | 5 ans | 5 ans, cible (extrapolé) |
|---|---|---|---|---|---|
| `pulse` | 4,3 / 0,44 | 13,5 / 0,43 | 25,6 / 0,44 | **42,3 / 0,46** | environ 105 |
| `agenda` (aujourd'hui) | 6,9 / 2,4 | 16,6 / 2,3 | 36,0 / 2,2 | **58,7 / 2,4** | environ 145 |
| `agenda` (un autre jour) | 6,6 / 1,8 | 16,4 / 1,8 | 34,6 / 1,6 | 58,1 / 1,9 | environ 145 |
| `cockpit` (Pilotage) | 18,6 / 0,37 | 82,7 / 0,49 | 128 / 0,49 | **170 / 0,42** | environ 425 |
| `reports` (mois courant + précédent) | 10,2 / 0,72 | 52,8 / 0,81 | 76,1 / 0,81 | 111 / 0,86 | environ 280 |
| `clients` | 9,8 / 4,1 | 21,1 / 3,7 | 43,4 / 3,7 | 75,9 / 4,3 | plus (clientèle réelle) |
| `relances` | 5,3 / 1,3 | 16,7 / 2,0 | 35,7 / 3,6 | 62,8 / 6,3 | |
| `sales`, `drawer`, `feed`, `live` | moins de 1 | moins de 1,2 | moins de 1,6 | moins de 2,6 | |
| `availability` (10 j) | 0,75 / 0,78 | 0,76 / 0,79 | 0,84 / 0,80 | 0,87 / 0,75 | inchangé |
| **Une écriture, une tablette sur l'agenda** (`pulse` froid + `agenda` + `feed`) | 6,9 | 15,9 | 27,9 | **44,8** | environ 110 |

Lecture :

- Aujourd'hui (10 semaines) le coût est invisible : 7 ms par écriture et par tablette.
- Il est linéaire en historique et en nombre de tablettes : à 5 ans, cinq écrans ouverts et une écriture toutes les quelques secondes en heure de pointe représentent 0,2 à 0,5 s de calcul synchrone par écriture, pendant lesquelles l'instance ne répond à personne d'autre.
- Les commandes aussi le paient : `bookOnline` appelle `riskDeposit` → `clientStats` (`server/domain/risk.js:16`) et parcourt tous les rendez-vous pour compter ceux à venir (`server/commands/agenda.js:115`). Une réservation en ligne recalcule donc les statistiques de toute la clientèle.

### 4.3 Parcours complets et motifs N+1 relevés

| Endroit | Motif | Coût |
|---|---|---|
| `server/http/views.js:62` (`clientCard`) | Parcourt tous les carnets (`s.packs`) **par fiche** : 45 fois pour un agenda, 60 fois pour une page Clients. | Faible aujourd'hui, croît avec les carnets vendus |
| `server/http/routes-staff.js:438-441` (détail d'un RDV) | Trois parcours complets : `s.appts`, `s.messages`, `s.payments`. | 40 000 + 18 700 éléments à 5 ans par ouverture de fiche |
| `server/http/routes-staff.js:539-544` (fiche client) | Idem : `s.appts`, `s.sales`, `s.messages`. | idem |
| `server/commands/system.js:23` (tick) | Parcourt **tous** les rendez-vous, paiements et messages chaque minute. | 0,75 ms (10 sem.) à 3,1 ms (5 ans) : négligeable |
| `server/http/scheduler.js:197` (`dispatch`) | Parcourt tous les messages à chaque tick. | Négligeable |
| `server/http/routes-staff.js:660` (`drawer`) | Trie tous les tiroirs deux fois par appel. | 0,7 ms → 2,5 ms |
| `server/core/engine.js:203` (`answer`) | Filtre tout le journal pour rejouer la réponse d'une requête répétée. | Rare ; quelques ms à 5 ans |
| `server/http/routes-payments.js:186` (dossier de litige) | Parcourt tout le journal. | Rare |

Aucun de ces parcours n'est un problème à l'échelle actuelle. Ils deviennent visibles à partir de 3 ans, et un index par client (`apptsByClient`, `salesByClient`, `messagesByClient`) dans `evolve` les supprime tous.

## 5. Magasins sur Vercel : allers-retours, contention, snapshots

### 5.1 Postgres (production)

| Opération | Allers-retours | Détail | Endroit |
|---|---|---|---|
| Synchronisation à vide (au plus toutes les 1,5 s) | **2** | `select v from lx_meta` puis `select … from lx_events where v > $2` | `postgres.js:69` et `:79` |
| `append` | **6** | `connect`, `begin`, `select epoch`, `select max(v)`, `insert`, `commit` | `postgres.js:86-116` |
| Démarrage à froid, 1 an | 10 | 3 pour le schéma, 1 époque, 6 pages de 5 000 | `postgres.js:59-66`, `:79` |
| `redact` (effacement RGPD, photo remplacée) | 2 | Lit **toutes** les lignes ayant des données personnelles (4 807 à 1 an) pour les filtrer en JavaScript | `postgres.js:118-123` |
| Synchronisation à vide, mesurée en local | 0,25 à 0,49 ms | | |

Conséquences :

- Un salon a peu de trafic : les requêtes arrivent presque toujours à plus de 1,5 s d'intervalle. **Presque chaque requête paie donc 2 allers-retours avant de commencer** (`syncOrStale`, `server/http/app.js:137`). Avec une base dans une autre région que `cdg1` (Neon Francfort : quelques millisecondes par aller-retour), c'est l'essentiel de la latence d'un `pulse`.
- Une tablette ouverte = 15 `pulse` par minute = 30 requêtes SQL par minute, 43 000 par jour. Une base « serverless » ne s'endort jamais tant qu'un Comptoir est ouvert.
- Une écriture coûte 6 allers-retours. Les deux `select` de garde sont redondants avec la clé primaire `(epoch, v)`, qui refuse déjà une version prise ; seul le contrôle d'époque doit rester.
- `max: 4` connexions par instance (`postgres.js:51`) : correct. En mode Fluid, plusieurs instances partagent la limite de connexions du fournisseur ; utiliser l'URL « pooled » (pgbouncer) de Neon.

### 5.2 Blob (petite production)

Mesures sur le SDK simulé, historique d'un an écrit par petits `append`.

| Opération | Appels | Octets |
|---|---|---|
| Synchronisation à vide | 1 GET conditionnel (304) | 0 |
| `append` d'un événement | 1 PUT de `head.json` | **46 Ko en médiane**, 454 Ko au basculement de segment |
| Basculement de segment | 2 PUT + 1 DEL | |
| Démarrage à froid, 1 an | 29 GET (28 segments + tête), par 8 en parallèle | 21 Mo |
| Taille de `head.json` | | 205 Ko (28 segments référencés, 249 événements de queue) |
| Écrire un an d'historique | 9 293 PUT | **1,2 Go** envoyés au total |

Lecture :

- Chaque écriture réécrit toute la queue (jusqu'à 300 événements, `TAIL_MAX`, `server/store/blob.js:12`). C'est le prix du compare-and-swap par ETag sur un seul fichier ; il est correct mais coûteux en octets et en opérations facturées.
- Une tablette ouverte fait un GET conditionnel par `pulse` : 21 600 par jour.
- Pour un usage réel, Postgres reste le bon choix, comme le dit `docs/architecture.md`.

### 5.3 Contention d'écriture

Le compare-and-swap est correct entre instances : `tests/unit/agenda.test.js` le couvre. Ici, 20 holds simultanés sur le **même** créneau donnent 2 réussites et 18 × 409 `taken`, sans erreur 5xx (les perdants redécident sur l'état à jour et sont refusés par la règle, pas par le plafond d'essais).

Le défaut est **à l'intérieur d'une instance** : voir section 6.

### 5.4 Snapshots et points de reprise

`docs/architecture.md` annonce le snapshot comme « prochaine étape ». Les mesures situent le moment : confortable jusqu'à 1 an (0,5 s), gênant à 3 ans (1,7 s), à traiter avant 5 ans (4 s, environ 10 s à la cible).

Conception sûre proposée (chantier structurant, pas une retouche) :

1. Sérialiser la projection (les `Map` et `Set` de `emptyState`, `server/core/state.js:14`) avec trois scellés : `epoch`, `version`, `head` (le hachage `h` de l'événement à cette version).
2. L'écrire à côté du journal : ligne `lx_meta` ou fichier Blob privé, depuis le tick, après la sauvegarde nocturne. Jamais dans le chemin d'une écriture.
3. Au démarrage : charger le snapshot, vérifier que l'événement `version` du magasin porte bien `h = head`, puis ne lire que `v > version`.
4. **Invalider par version de réducteur.** Un snapshot produit par un autre code que le `evolve` courant est faux en silence. Y inscrire une empreinte du réducteur (version logicielle `server/version.js`, ou hachage de `state.js` et `projections/*.js`) ; en cas d'écart, rejeu complet.
5. Garder `verifyChain` sur le journal du magasin, à la demande : le snapshot ne prouve rien, il accélère.

Gain attendu : démarrage à froid indépendant de l'historique (lecture d'un objet de 40 à 100 Mo au lieu de 130 à 320 Mo de lignes, puis quelques centaines d'événements).
Risques : divergence snapshot/journal si l'étape 3 ou 4 est omise ; effacement RGPD (un snapshot contient des données personnelles : `redact` doit le supprimer ou le régénérer).

### 5.5 Sortir le journal de la mémoire

C'est le vrai levier mémoire (90 % du tas). `engine.journal` sert à :

- rejouer la réponse d'une requête idempotente venue d'une autre instance (`engine.js:203`) ;
- `verifyChain` (`routes-admin.js:339`, `routes-health.js:61`), l'export, la sauvegarde ;
- le fil : Z automatiques des 5 000 derniers événements (`routes-staff.js:169`) ;
- quelques lectures ponctuelles (`routes-giftshop.js:50`, `routes-payments.js:186`, `commands/team.js:433`).

Une queue en mémoire (les 5 000 à 10 000 derniers événements) couvre le fil et presque tous les rejeux ; le reste se lit dans le magasin à la demande (Postgres a déjà l'index `(epoch, id)`).
Risque moyen : l'idempotence entre instances repose sur ce rejeu, il faut un test pour une clé plus ancienne que la queue. À planifier avec le snapshot, pas avant.

## 6. Constat critique : écritures concurrentes sur une même instance

### 6.1 Ce qui se passe

`run()` (`server/core/engine.js:231-265`) fait : `sync` → décider → sceller → `await store.append` → `apply`. Rien n'empêche deux `run()` de la même instance de décider sur la même version. Trois effets, tous mesurés.

**a. Tempête de conflits.** N écritures concurrentes : une seule gagne par tour, les autres recommencent (`continue`, ligne 255) après un `sync(true)`. Total : N(N+1)/2 `append`.

**b. Plafond à 8.** La boucle abandonne au 8ᵉ essai (ligne 233) avec un 503 `busy`. La 9ᵉ écriture simultanée échoue toujours.

| Écritures simultanées (holds sur des créneaux **différents**) | 1 | 2 | 3 | 5 | 8 | 9 | 12 | 20 |
|---|---|---|---|---|---|---|---|---|
| Réussies | 1 | 2 | 3 | 5 | 8 | 8 | 8 | **8** |
| 503 `busy` | 0 | 0 | 0 | 0 | 0 | 1 | 4 | **12** |
| `append` envoyés au magasin | 1 | 3 | 6 | 15 | 36 | 44 | 68 | **132** |
| Durée totale, latence injectée (12 ms par écriture) | 16 ms | 31 ms | 47 ms | 81 ms | 126 ms | 128 ms | 134 ms | 131 ms |

Résultat identique pour `POST /api/public/bookings`, sur magasin mémoire comme avec latence.

**c. Écriture enregistrée mais répondue en erreur, et relecture complète du journal.**

- Pendant qu'une écriture A attend son `append`, une écriture B en nouvel essai lance `pull()` (ligne 146), qui lit les événements de A dans le magasin et les applique.
- Quand A reprend, `apply(sealed, true)` (ligne 256) trouve la version déjà avancée et lève `journal gap` (ligne 124). L'erreur n'est pas une `DomainError` : **HTTP 500**, alors que l'événement est dans le magasin.
- Dans l'autre sens, un `pull()` qui revient après un `apply` local lève la même erreur ; `sync` la rattrape (ligne 166) par `rebuild()` puis une **relecture complète** du journal. Pendant cette relecture, `state` est vide : un handler qui lit `r.s` après un `await` (par exemple `routes-public.js:213`, `r.s.appts.get(res.id)`) lit une projection vide.

Parcours « hold puis réservation » lancés en même temps sur des créneaux différents :

| Magasin | Parcours | Réservations dans le journal | Répondues 201 | **Enregistrées mais répondues 500** | Holds en 503 | Durée |
|---|---|---|---|---|---|---|
| Mémoire, sans latence | 20 | 5 | 5 | 0 | 15 | |
| Latence injectée avec gigue (2 à 8 ms par étape) | 6 | 6 | 1 | **5** | 0 | |
| idem | 12 | 8 | 2 | **6** | 4 | |
| idem | 20 | 7 | 3 | **4** | 13 | |
| Postgres réel, 10 semaines | 12 | 6 | 6 | 0 | 6 | 0,46 s |
| Postgres réel, 1 an | 12 | 5 | 4 | **1** | 7 | 0,84 s |
| Postgres réel, 3 ans | 5 | 5 | 5 | 0 | 0 | **3,2 s** |
| Postgres réel, 3 ans | 20 | 7 | 5 | **2** | 13 | 6,8 s |
| Postgres réel, 5 ans | 12 | 6 | 4 | **2** | 6 | **12,0 s** |
| Postgres réel, 5 ans | 20 | 6 | 3 | **3** | 14 | 12,1 s |

La durée explose avec l'historique parce que chaque `journal gap` déclenche une relecture complète (3,7 s à 5 ans).

### 6.2 Pourquoi c'est une question d'exactitude

- Une réservation répondue 500 **existe** : le client a son créneau, son SMS de confirmation est en file, mais le site lui affiche une erreur. Les routes publiques n'ont pas de clé d'idempotence (`CLIENT(r)`, `routes-public.js:36`, ne passe pas de `requestId`) : s'il recommence, il obtient « créneau pris » sur son propre rendez-vous, ou un second rendez-vous ailleurs.
- Côté Comptoir, l'`x-request-id` rattrape le cas : le nouvel essai retrouve la réponse (`recall`, ligne 196). Mais `results.set` (ligne 259) et `afterAppend` (ligne 257) ont été sautés.
- **Effacement RGPD.** Si l'événement en cause est un `client.erased`, `afterAppend` n'est pas appelé et le `pull` concurrent l'applique avec `own = false` : la mémoire est nettoyée, mais `redactLater` n'est alimenté que si les événements fraîchement lus portaient eux-mêmes des données personnelles (ligne 131). Le magasin peut donc **garder les données personnelles** d'un client effacé. Cas étroit, non reproduit ici, mais lisible dans le code.

### 6.3 Portée réelle

- Le défaut est dans le code, pas dans le banc : il est reproduit sur un vrai Postgres.
- Sa fréquence dépend de la concurrence par instance. Un salon voit rarement 9 écritures dans la même fenêtre de 10 à 50 ms. Les moments à risque : un envoi « bons plans » à 200 clients qui cliquent ensemble, l'ouverture des réservations d'une journée exceptionnelle, le tick qui écrit pendant qu'un webhook Stripe et une caisse écrivent.
- Deux écritures qui se chevauchent suffisent pour la tempête (3 `append` au lieu de 2) ; trois à cinq suffisent pour le 500 et la relecture complète, plus probables quand la réponse du magasin est lente.

### 6.4 Correction proposée (sûre)

Dans `server/core/engine.js` uniquement :

1. **File d'écriture par instance.** Une chaîne de promesses (mutex) autour du corps de `run()`, et la même pour `batch()`, `adopt()` et `reset()`. Les écritures d'une instance passent l'une après l'autre ; le compare-and-swap du magasin reste la seule garde entre instances.
2. **`apply` tolérant pour les lectures.** Dans `pull()`, ignorer un événement dont `e.v <= state.version` **après avoir vérifié** `journal[e.v - 1].h === e.h` ; si le hachage diffère, c'est une vraie divergence : `rebuild()` comme aujourd'hui.
3. **Après un `append` réussi**, si la version est déjà appliquée par un `pull` concurrent (même contrôle de hachage), ne pas rappeler `apply`, mais exécuter quand même `afterAppend` et `results.set`.
4. **Clé d'idempotence sur les écritures publiques** : le site envoie un `x-request-id` par tentative de réservation, `CLIENT(r)` le transmet. Le mécanisme existe déjà (`keyOf`, ligne 186).

Ce que cela ne touche pas : `seal`, la chaîne de hachage, le contrat des magasins, la sémantique du compare-and-swap, les tests de `tests/unit/stores.test.js`.
Gain attendu : 20 écritures simultanées = 20 `append` (au lieu de 132), 0 × 503, 0 réponse 500, plus aucune relecture complète.
Risque : faible. Une écriture lente retarde les suivantes de la même instance (`statement_timeout` de 10 s borne l'attente) ; prévoir un test qui lance 20 `run()` concurrents et vérifie 20 réussites et une chaîne valide.

## 7. En-têtes de cache et fraîcheur des créneaux

### 7.1 État

| Route | En-tête | Endroit |
|---|---|---|
| `GET /api/public/salon` | `public, max-age=0, s-maxage=20, stale-while-revalidate=60` | `routes-public.js:159` |
| `GET /api/public/live` | `public, max-age=0, s-maxage=15` | `routes-public.js:167` |
| `GET /api/public/availability` | `public, max-age=0, s-maxage=5, stale-while-revalidate=10` ; `no-store` avec `hold=` ou `move=` | `routes-public.js:193` |
| `GET /api/public/memberships`, boutique cartes cadeaux | `s-maxage=20, stale-while-revalidate=60` | `routes-membership.js`, `routes-giftshop.js:140` |
| Tout `/api/v1/*` | `no-store`, sans ETag | `kit.js:14` |
| `/assets/*`, `/img/*` | `max-age=31536000, immutable` | `vercel.json` |
| `/support.js`, `/guide.js`, `/guide.css` | `max-age=3600` | `vercel.json` |
| `/fonts/*` (polices du site) | **aucune règle** : valeur par défaut des fichiers statiques | `vercel.json` |
| Lecture servie depuis la mémoire, base en panne | `no-store` forcé | `app.js:121` (correct) |

### 7.2 Le créneau « libre » qui ne l'est plus

Un créneau pris peut rester affiché libre pendant, en cumulé :

| Couche | Retard maximal | Source |
|---|---|---|
| Cache CDN : frais 5 s, puis servi périmé pendant la revalidation jusqu'à 15 s | 15 s | `s-maxage=5, stale-while-revalidate=10` |
| Instance en retard sur le magasin | 1,5 s | `syncEveryMs`, `runtime.js:109` |
| Cache du site : 20 s feuille fermée, 8 s + 6 s de sondage feuille ouverte | 14 à 20 s | `site.html:1790`, `:1818`, `:3042` |
| **Total** | **environ 30 à 36 s** | |

Un salon a peu de trafic : la fenêtre `stale-while-revalidate` est presque toujours celle qui sert (le visiteur suivant arrive entre 5 et 15 s après le précédent et reçoit la copie périmée).

**Ce n'est pas un risque de double réservation.** `POST /api/public/holds` et `POST /api/public/bookings` revalident le créneau sur l'état courant et ne sont jamais cachés ; un créneau pris répond 409 `taken`. Le coût est une mauvaise expérience (« Ce créneau vient d'être pris ») et, plus gênant, **le rafraîchissement qui suit redemande la même URL cachable** (`invalidate()`, `site.html:1815`) : le CDN peut resservir la copie où le créneau est encore libre.

À vérifier sur le déploiement : le site appelle avec `cache: 'no-store'` (`site.html:1703`), ce qui contourne le cache du navigateur ; le cache CDN de Vercel n'obéit en principe pas aux en-têtes de requête. L'en-tête de réponse `x-vercel-cache` le confirmera.

### 7.3 Approche sûre proposée

1. **Supprimer `stale-while-revalidate` sur `availability`** et garder un `s-maxage` court (2 à 5 s) : le retard CDN est borné à cette valeur. Une ligne, `routes-public.js:193`.
2. **Contournement explicite après une écriture ou un 409** : le site ajoute `&fresh=<horodatage>` à la requête qui suit un hold, une réservation, une annulation ou un conflit ; le serveur répond `no-store` dès que `fresh` est présent, comme il le fait déjà pour `hold=` et `move=`. Le visiteur qui vient d'être refusé voit l'état réel.
3. Variante plus ambitieuse, à ne faire que si le trafic le justifie : clé de version. `GET /api/public/live` renvoie `version` et une tranche de minute ; `availability?…&v=<version>.<minute>` devient immuable et cachable longtemps. La tranche de minute est nécessaire car la disponibilité change aussi **sans écriture** : un hold qui expire (`exp > now`), le préavis minimal qui avance.
4. Ne jamais cacher une réponse qui dépend de `hold=`, `move=` ou d'un cookie : c'est déjà le cas, à conserver.

Risque : nul pour l'exactitude (les écritures restent l'autorité). Coût : quelques invocations de plus ; le calcul de disponibilité prend 0,8 ms.

### 7.4 Autres remarques de cache

- `/api/v1/agenda` renvoie 46 à 50 Ko à chaque changement de version, à chaque tablette. Un `ETag` faible composé de `version`, du jour, de la minute et des permissions, avec `If-None-Match` → 304, éviterait le transfert et le `JSON.parse` quand rien n'a changé pour ce jour. `Cache-Control: private, no-cache` suffit ; rien n'est partagé.
- `/fonts/*` : ajouter la règle `immutable` (les noms de fichier viennent de `@fontsource`, ils sont stables par version).
- `support.js` (188 Ko, 60 Ko compressé) n'a qu'une heure de cache et pas d'empreinte dans son nom : revalidation horaire pour chaque visiteur.

## 8. Tick, sauvegarde et tâches de fond

| Tâche | 10 sem. | 1 an | 3 ans | 5 ans | Remarque |
|---|---|---|---|---|---|
| Tick (`tick.run` seul, puis `engine.run(tick)` sur magasin mémoire) | 1,2 et 0,75 ms | 1,8 et 1,1 ms | 3,4 et 1,8 ms | 5,7 et 3,1 ms | Parcours complets, coût négligeable |
| `demoTick` (démo seulement) | 12 ms | 78 ms | 170 ms | 295 ms | Ne concerne pas la production |
| **Sauvegarde** (`sealBackup` : JSON + gzip + AES + base64) | 113 ms | 462 ms | 1 363 ms | **2 394 ms** | Synchrone, bloque l'instance |
| Sauvegarde : pic de mémoire | +28 Mo | +74 Mo | +270 Mo | **+443 Mo** | S'ajoute au tas |
| Sauvegarde : taille du fichier | 1,2 Mo | 4,6 Mo | 12,9 Mo | 21,8 Mo | |
| `verifyChain` | 129 ms | 383 ms | 1 051 ms | 1 950 ms | Synchrone |
| Sérialisation JSON du journal sans données personnelles (ce que fait l'export `kind=journal`) | 24 ms, 5 Mo | 118 ms, 18 Mo | 306 ms, 50 Mo | 560 ms, 85 Mo | Une seule chaîne en mémoire (`routes-admin.js:414`) ; à vérifier contre la taille maximale de réponse d'une fonction Vercel |

Lecture :

- Le tick est bon marché et bien borné (`cap = 60`, une fois par minute, `scheduler.js:23`). Rien à faire.
- La sauvegarde est le point dur : à la cible (5 ans, 80 RDV/j), environ 6 s bloquantes et **plus de 1 Go de pic** par-dessus un tas d'environ 1 Go. C'est le premier endroit où l'instance manquera de mémoire. Elle tourne dans `waitUntil`, après la réponse, mais bloque la boucle d'événements pour les requêtes concurrentes de l'instance.
- `gzipSync` et `JSON.stringify` d'un seul bloc (`server/core/backup.js:75`) : passer à un flux (`createGzip`, événements écrits par tranches, `await` entre les tranches) supprime le blocage et le pic.
- `verifyChain` : même traitement, par tranches de quelques milliers d'événements avec un `setImmediate` entre deux.

## 9. Front-end

### 9.1 Bundles Vite (`vite build`, 226 modules, 3,1 s)

| Entrée | JS initial brut | gzip | brotli | Contenu |
|---|---|---|---|---|
| `/comptoir` | 362 Ko | **119 Ko** | 104 Ko | `comptoir` (38 Ko gz) + morceau partagé `members-*.js` (74,5 Ko gz : React, react-dom et le code commun) + `Tour` (9 Ko gz) |
| `/r/…`, `/recu/…`, `/cadeau/…`, `/abo/…` (`client`) | 267 Ko | **85 Ko** | 74 Ko | `client` (6 Ko) + morceau partagé (74,5 Ko) + `Member` (6,3 Ko) |
| `/moi` | 346 Ko | **112 Ko** | 98 Ko | `moi` (22 Ko) + partagé + `Tour` + `Member` + `StampCard` |

Pages du Comptoir chargées à la demande (en plus de l'entrée) :

| Page | Brut | gzip | Dépendances tirées |
|---|---|---|---|
| Agenda | 45 Ko | 15 Ko | |
| Caisse | 127 Ko | 41 Ko | `qr`, `Receipt`, `StampCard` |
| Clients | 102 Ko | 36 Ko | `Members`, `qr`, `StampCard` |
| Réglages | 85 Ko | 29 Ko | **`Equipe` entier** (44 Ko) |
| Équipe | 64 Ko | 22 Ko | `qr` |
| Catalogue | 52 Ko | 15 Ko | `Receipt` |
| Rapports | 37 Ko | 11 Ko | |
| Pilotage | 33 Ko | 12 Ko | `Members` |
| Relances | 26 Ko | 10 Ko | |
| Mon espace | 23 Ko | 8 Ko | |
| Reprendre WordPress (sous Réglages) | 97 Ko | 34 Ko | chargé à part : bien |

CSS : 176 Ko brut au total, 35 Ko (8,3 Ko gz) pour l'entrée du Comptoir. Polices : 6 fichiers `woff2` de 17 à 22 Ko, plus leurs doublons `woff` que seuls de vieux navigateurs demandent.

Lecture :

- Le découpage par page existe et fonctionne (`lazy`, `web/src/comptoir/App.tsx:19-28`). `docs/architecture.md` annonce « React ≈ 70 Ko gzip, chaque page 5 à 25 Ko » : le premier chiffre est juste, Caisse (41 Ko), Clients (36 Ko) et Réglages (29 Ko) dépassent le second.
- **Pas de `manualChunks`** (`web/vite.config.ts`) : React est fondu avec le code commun dans `members-*.js`. Toute modification du code partagé change l'empreinte du fichier et fait retélécharger 74,5 Ko à chaque déploiement.
- **La visite guidée est dans le chargement initial** du Comptoir et de `/moi` (`App.tsx:17`, `moi/main.tsx:14`, imports statiques) : 9 Ko gz de JS et 2 Ko de CSS pour une fonction utilisée une fois.
- **La page d'un lien SMS (`/r/…`) charge la page Abonnement** (`web/src/client/main.tsx:11`, import statique de `Member`) : 6,3 Ko gz de JS et 3,7 Ko de CSS inutiles pour un rendez-vous.

### 9.2 Site public : chiffres de type Lighthouse

Téléphone moyen (CPU ×4), réponses compressées en brotli.

| Page | Réseau | FCP | LCP (élément) | TBT | Tâche la plus longue | CLS | Requêtes | Transfert |
|---|---|---|---|---|---|---|---|---|
| `/` (site) | slow 4G | 2,10 s | 2,10 s (`fade.jpg`) | 232 ms | 358 ms | 0 | 22 | 529 Ko |
| `/` 2ᵉ visite | slow 4G | 0,99 s | 0,99 s | 178 ms | 179 ms | 0,001 | 24 | 487 Ko |
| `/` | 4G | 0,91 s | 0,91 s | 286 ms | 331 ms | 0 | 22 | 529 Ko |
| `/?reserver` | slow 4G | 2,20 s | 2,20 s | **385 ms** | 399 ms | 0 | 22 | 529 Ko |
| `/carte-cadeau` | slow 4G | 0,58 s | 0,58 s | 0 | 53 ms | 0 | 11 | 114 Ko |
| `/mon-rendez-vous` | slow 4G | 0,61 s | 0,61 s | 0 | 86 ms | 0 | 11 | 112 Ko |
| `/moi` | slow 4G | 1,44 s | 1,44 s | 0 | 69 ms | 0,011 | 19 | 222 Ko |
| `/r/…` (lien SMS) | slow 4G | 0,98 s | 1,20 s | 0 | 76 ms | 0,004 | 10 | 144 Ko |
| `/comptoir` (connexion) | 4G | 0,62 s | 0,62 s | 0 | 79 ms | 0 | 10 | 183 Ko |
| `/comptoir` (connexion) | tablette, Wi-Fi, CPU ×2 | 0,31 s | 0,31 s | 0 | 0 | 0 | 10 | 183 Ko |

Sans TLS ni résolution DNS : ajouter environ 0,3 à 0,5 s en conditions réelles sur slow 4G.

Poids du site (`/`), première visite :

| Ressource | Brut | Transféré | Remarque |
|---|---|---|---|
| `site.html` | 242 Ko | 61 Ko | CSS, gabarits et moteur de réservation en ligne dans la page |
| `support.js` | 188 Ko | 60 Ko | React + react-dom + moteur de gabarits, **`<script>` bloquant dans le `<head>`** (`site.html:328`) |
| `guide.js` | 20 Ko | 7 Ko | `defer` |
| Polices | 111 Ko | 111 Ko | 6 fichiers, 2 préchargés |
| Images | 473 Ko au total | 218 Ko vus au chargement | 4 JPEG de 94 à 132 Ko, 1 100 px de large, pas de WebP/AVIF ni de `srcset` |
| API | | 70 Ko, 10 appels | dont **un second téléchargement de la page** (voir ci-dessous) |
| `public/img/comptoir/` | 3,0 Mo | | Captures pour `/demo` seulement |

Lecture :

- Les chiffres sont corrects : FCP et LCP sous 2,5 s en slow 4G, CLS nul. Le site est rendu côté client (`<x-dc>`), donc rien ne s'affiche avant l'exécution de `support.js` ; c'est ce qui fixe le FCP à 2,1 s.
- Le TBT (232 à 385 ms) dépasse le seuil « bon » de 200 ms : c'est le rendu React initial de toute la page sur un CPU lent.
- `support.js` relit la page : `fetch(location.href)` (dans le moteur de gabarits). En local, c'est 61 Ko téléchargés deux fois ; sur Vercel, l'ETag du fichier statique devrait réduire le second appel à un 304. À vérifier.
- Les images sont raisonnables. WebP ou AVIF gagneraient environ 30 à 50 % (150 à 230 Ko sur 473).

### 9.3 Site public : sondage

Requêtes observées sur `/`, sans ouvrir la réservation :

| Moment | Requêtes |
|---|---|
| Chargement | `salon`, `live`, `memberships`, `account`, puis **5 × `availability`** (14 jours : « au choix » et chacun des 4 barbiers) |
| Toutes les 30 s, tant que l'onglet est ouvert | `live` + **5 × `availability`** (19 Ko) |
| Feuille de réservation ouverte | sondage toutes les 6 s des clés utilisées depuis moins de 90 s (`site.html:3042`), suspendu quand l'onglet est caché |

Cause : le minuteur `_tick` (`site.html:2301`) re-rend la page toutes les 30 s ; le rendu de la section équipe appelle `earliest()` → `entry()`, qui relance un `fetch` dès qu'une entrée a plus de 20 s (`site.html:1790`). Ce chemin ne teste pas `document.visibilityState`.

Coût : 12 invocations par minute et par onglet resté ouvert sur l'accueil. Le CDN n'absorbe que les visiteurs simultanés (5 s).

### 9.4 Comptoir : re-rendus et sondage

Mesures sur `/comptoir/agenda`, gérant connecté, CPU ×4.

| Fenêtre | Requêtes | Transfert | Fil principal (tâches) | dont script | dont style | Mutations DOM |
|---|---|---|---|---|---|---|
| Agenda au repos, 60 s | 15 `pulse` + 1 `feed` + 1 `agenda` | 16 Ko | **12 564 ms** | 290 ms | 407 ms | 72 |
| Agenda + 1 hold posé sur le site, 12 s | 3 `pulse` + 1 `feed` + 1 `agenda` | 9 Ko | 2 526 ms | 63 ms | 75 ms | 19 |
| Caisse au repos, 30 s | 8 `pulse` | 5 Ko | 200 ms | 93 ms | 0 ms | 0 |

Lecture :

- **21 % d'un cœur (limité ×4) consommé par l'agenda au repos**, contre 0,7 % pour la Caisse. Le script n'explique que 290 ms : le reste est du rendu. Cause : des animations infinies sur `box-shadow` (`@keyframes pulse` et `pulseOk`, `web/src/ui/base.css:73-74`), utilisées par l'agenda (`Agenda.tsx:103`, `:134`, `agenda.css:75`, `:117`). `box-shadow` ne s'anime pas sur le compositeur : le navigateur repeint à chaque image. Sur une tablette allumée dix heures, c'est de la batterie et de la chaleur.
- **Chaque `pulse` re-rend tout ce qui lit le contexte.** `setPulse(p)` et `setPulseAt` (`state.tsx:89-90`) changent l'état du fournisseur toutes les 4 s ; `value` est un objet neuf à chaque rendu, avec deux `Map` reconstruites (`state.tsx:127-131`). Tout composant qui appelle `useApp()` re-rend, dont `Agenda` et, sans `React.memo`, `Board` et ses 45 rendez-vous (`web/src/comptoir/pages/agenda/Board.tsx:28`). Ici le coût en script reste modeste (290 ms par minute, CPU ×4) ; il croît avec la taille de la journée.
- **Chaque changement de version recharge toutes les requêtes à l'écran** (`refreshAll`, `web/src/lib/query.ts:31`), quel que soit l'événement : un hold sur le site, un SMS mis en file, un clic sur un lien d'avis rechargent l'agenda (46 à 50 Ko de JSON, 6 Ko compressé) sur chaque tablette. C'est simple et sûr, et c'est ce qui multiplie le coût serveur de la section 4.

### 9.5 Sondage ou poussée

Le `pulse` toutes les 4 s est le bon choix **sur Vercel** : une fonction ne tient pas une connexion SSE ou WebSocket ouverte sans la facturer en continu, et le `pulse` porte aussi le tick. À garder.

Ce qui peut baisser sans changer d'architecture :

- allonger l'intervalle quand rien ne bouge (4 s en journée, 10 à 15 s après deux minutes sans changement de version, retour à 4 s au premier changement ou au premier geste) ;
- rendre le `pulse` moins cher côté serveur (sections 4 et 5.1) ;
- ne recharger que ce qui a changé (ETag, section 7.4).

## 10. Classement des optimisations

Gain : estimation à partir des mesures ci-dessus. Risque : pour l'exactitude du système (chaîne de hachage, concurrence optimiste, idempotence).

| Rang | Optimisation | Mesure avant | Gain attendu | Risque | Où |
|---|---|---|---|---|---|
| 1 | File d'écriture par instance, `apply` tolérant, idempotence des écritures publiques | 20 écritures : 132 `append`, 12 × 503 ; réservations en base répondues 500 ; 12 s à 5 ans | 20 `append`, 0 × 503, 0 × 500, plus de relecture complète | Faible. **Touche le cœur** : test de concurrence obligatoire ; contrôle de hachage avant d'ignorer un événement | `server/core/engine.js:121-136`, `:146-158`, `:231-265`, `:284-311` ; `routes-public.js:36` ; `site.html` (`hold`, `book`) |
| 2 | Invalidation sélective des mémos | `pulse` après écriture : 42 ms à 5 ans (0,46 à chaud) ; agenda 59 ms ; Pilotage 170 ms | Retour au coût à chaud pour 25 à 40 % des écritures (holds, messages, signatures, clics d'avis) | Faible si l'on procède par **liste des types qui n'invalident pas** : un type oublié recalcule, il ne ment pas | `server/core/state.js` (`evolve` : compteur `dataVersion`) ; `insights.js:11-17` et les 6 autres `memo` |
| 3 | Postgres : lecture en 1 aller-retour, `append` en 2 | 2 requêtes par synchronisation, 6 par écriture | −1 aller-retour sur presque chaque requête ; −4 par écriture | Faible : la clé primaire `(epoch, v)` reste la garde ; garder le contrôle d'époque dans la même instruction | `server/store/postgres.js:69`, `:73-85`, `:86-116` |
| 4 | `availability` : retirer `stale-while-revalidate`, paramètre `fresh` après écriture ou 409 | Créneau pris visible libre jusqu'à 15 s au CDN, 30 à 36 s au total | Retard CDN borné à 2-5 s ; état réel après un refus | Nul (les écritures restent l'autorité) | `routes-public.js:193` ; `site.html:1779`, `:1815` |
| 5 | Site : ne plus sonder 5 disponibilités toutes les 30 s sur l'accueil | 12 invocations/min par onglet | Environ 2/min (`live` seul) ; sondage seulement feuille ouverte ou section équipe visible, jamais onglet caché | Nul | `site.html:1786-1791`, `:2301` |
| 6 | Comptoir : contexte mémorisé, `Board` en `React.memo`, `pulse` sans re-rendu quand rien ne change | 15 re-rendus complets par minute | Re-rendu seulement au changement de version ou de minute | Nul côté serveur ; vérifier l'horloge de l'agenda (`nowMin`) | `web/src/comptoir/state.tsx:89-90`, `:127-138` ; `pages/agenda/Board.tsx:28` |
| 7 | Animations sur le compositeur (`transform` + `opacity` sur un pseudo-élément) | 12,6 s de fil principal par minute (CPU ×4), agenda au repos | Environ 0,5 s (niveau de la Caisse) | Nul | `web/src/ui/base.css:73-74` ; `agenda.css:75`, `:117` |
| 8 | Sauvegarde et `verifyChain` par flux et par tranches | 2,4 s bloquantes et +443 Mo à 5 ans ; `integrity` 2 s bloquantes | Plus de blocage ; pic mémoire de quelques Mo | Faible : le fichier produit doit rester lisible par `openBackup` (test de restauration existant) | `server/core/backup.js:69-77` ; `server/core/journal.js:65-76` ; `routes-admin.js:336` ; `routes-health.js:61` |
| 9 | ETag et 304 sur `agenda` et `feed` ; règle de cache `/fonts/*` | 46 à 50 Ko par changement de version et par tablette | 304 sans corps quand le jour affiché n'a pas changé | Faible : l'ETag doit inclure version, jour, minute et permissions | `server/http/kit.js:22` ; `routes-staff.js:381` ; `web/src/lib/api.ts` ; `vercel.json` |
| 10 | Bundles : `manualChunks` pour React, visite guidée et page Abonnement en `lazy` | Comptoir 119 Ko gz ; lien SMS 85 Ko gz ; 74,5 Ko retéléchargés à chaque déploiement | React en cache entre déploiements ; −9 Ko (Comptoir), −10 Ko (lien SMS) | Nul | `web/vite.config.ts` ; `comptoir/App.tsx:17` ; `client/main.tsx:11` ; `moi/main.tsx:14` |
| 11 | Index par client dans la projection | 3 parcours complets par fiche ; `clientCard` parcourt les carnets par fiche | Fiches et agenda indépendants de l'historique | Faible : index dérivés, à maintenir dans `client.merged` et `client.erased` | `server/core/state.js` ; `views.js:62` ; `routes-staff.js:438-441`, `:539-544` |
| 12 | Blob : queue plus courte ou tête séparée | 46 Ko réécrits par événement | Quelques Ko | Moyen (le compare-and-swap par ETag doit rester sur un seul fichier) ; faible priorité, Postgres est la cible | `server/store/blob.js:12`, `:117-139` |
| 13 | **Snapshot de la projection** | Démarrage à froid 4 s à 5 ans, environ 10 s à la cible | Démarrage indépendant de l'historique | **Moyen** : scellés `epoch`/`version`/`head`, empreinte du réducteur, effacement RGPD (section 5.4) | `server/core/engine.js` (`pull`), magasins, tick |
| 14 | **Journal hors mémoire** (queue seule) | 416 Mo de tas à 5 ans, environ 1 Go à la cible | Tas ramené à la projection (42 à 105 Mo) plus la queue | **Moyen** : rejeu d'idempotence entre instances, export, sauvegarde (section 5.5) | `server/core/engine.js:97`, `:203` et les lecteurs de `engine.journal` |
| 15 | Site : `support.js` en `defer`, images WebP/AVIF, empreinte dans le nom | FCP 2,1 s, TBT 232 à 385 ms, 473 Ko d'images | FCP un peu plus tôt, −150 à −230 Ko d'images | Faible ; `site.html` est « gardé tel que conçu », à voir avec le prestataire | `public/site.html:328` ; `public/img/` |

## 11. Plan priorisé : 10 optimisations sûres

Ordre proposé. Les rangs 13 et 14 (snapshot, journal hors mémoire) sont des chantiers à part, à lancer avant la troisième année d'exploitation.

| Étape | Action | Pourquoi maintenant | Vérification |
|---|---|---|---|
| 1 | File d'écriture par instance et `apply` tolérant (rang 1) | Seul point qui produit des erreurs et des écritures « fantômes » aujourd'hui | Nouveau test : 20 `run()` concurrents → 20 réussites, `verifyChain` valide, 20 `append` ; le script `ghost.mjs` ne montre plus d'écart |
| 2 | Clé d'idempotence sur `POST /api/public/holds` et `/bookings` (rang 1, point 4) | Un nouvel essai du visiteur ne doit jamais créer un second rendez-vous | Test API : même `x-request-id` deux fois → même réponse, un seul `appt.booked` |
| 3 | `availability` sans `stale-while-revalidate`, paramètre `fresh` (rang 4) | Une ligne côté serveur, quelques-unes côté site | En-tête de réponse ; scénario « créneau pris puis rafraîchi » |
| 4 | Site : fin du sondage sur l'accueil (rang 5) | Réduit les invocations de fonction sans rien changer pour le visiteur | `reqs.cjs` : plus de salve à 30 s et 60 s |
| 5 | Postgres : `read` en une requête, `append` sans les deux `select` (rang 3) | Gain sur chaque requête dès aujourd'hui | `npm run test:pg` (contrat des magasins) ; compteur de requêtes de `stores.mjs` |
| 6 | Invalidation sélective des mémos (rang 2) | Le coût double chaque année | Tests existants de `insights` ; `mixed.mjs` : `pulse` après un hold au coût à chaud |
| 7 | Comptoir : contexte mémorisé et `Board` mémorisé (rang 6) | Tablette allumée toute la journée | `idle.cjs` : mutations DOM et script en baisse |
| 8 | Animations sur le compositeur (rang 7) | Quatre lignes de CSS | `idle.cjs` : fil principal de l'agenda au niveau de la Caisse |
| 9 | Sauvegarde et `verifyChain` par flux (rang 8) | Avant que la mémoire ne manque (3 à 5 ans) | Test de restauration existant ; `mixed.mjs` : pic mémoire |
| 10 | Bundles : React à part, visite guidée et page Abonnement en `lazy` (rang 10) | Gratuit, améliore le cache entre déploiements | `npm run build` : tailles par entrée ; `npm run test:e2e` |

## 12. Points d'attention pour l'exactitude

À relire avant toute modification de performance.

| Sujet | Règle à respecter |
|---|---|
| Chaîne de hachage | Ne jamais ignorer un événement relu sans comparer son `h` à celui déjà en mémoire. Un écart est une divergence réelle : rejeu complet, pas de saut silencieux. |
| Concurrence optimiste | La file par instance **s'ajoute** au compare-and-swap du magasin, elle ne le remplace pas : plusieurs instances Vercel écrivent en même temps. Garder `primary key (epoch, v)` et le contrôle d'époque. |
| Idempotence | `results` et `state.eventIds` doivent être alimentés après chaque `append` réussi, même quand un `pull` concurrent a déjà appliqué l'événement. Si le journal sort de la mémoire, le rejeu d'une clé ancienne doit lire le magasin. |
| Effacement RGPD | `afterAppend` doit s'exécuter pour tout `client.erased` et `staff.photo` écrit par l'instance, sinon le magasin garde les données personnelles. Un snapshot en contient : le supprimer à chaque `redact`. |
| Mémos | Un mémo qui survit à une écriture doit être invalidé par tout événement qui change son résultat. Procéder par liste d'exclusion explicite, jamais par liste d'inclusion. Les mémos dépendent aussi de l'horloge (`today`, tranches de 5 minutes) : garder ces clés. |
| Cache CDN | Ne jamais rendre cachable une réponse dépendant d'un cookie, de `hold=` ou de `move=`. Les écritures (`holds`, `bookings`) restent `no-store` et revalident toujours le créneau. |
| Snapshot | Lié à `epoch`, `version`, `head` **et** à une empreinte du réducteur. Un snapshot d'un autre code est faux sans erreur visible. |
| Lecture pendant un `rebuild()` | Tant que le rejeu complet existe, un handler ne doit pas lire `r.s` après un `await` sans repasser par `sync()` : la projection peut être vide (`engine.js:118`). |
| Fiscal | Les Z portent le hachage du journal à la clôture et un grand total perpétuel : aucune optimisation ne doit réordonner, regrouper ou réécrire des événements. |

## 13. Ce qui est déjà bien fait

- Rejeu à plus de 200 000 événements par seconde ; disponibilité indexée par jour, indépendante de l'historique (0,8 ms).
- Mémos par version sur tous les rapports : un tableau de bord rafraîchi ne coûte rien tant que rien ne change.
- Synchronisation limitée à une lecture toutes les 1,5 s, dédupliquée (`syncing`), avec repli en lecture seule pendant 10 minutes quand le magasin tombe.
- Tick borné (60 actions, une fois par minute), identifiants de messages déterministes : deux instances n'envoient jamais deux fois.
- `availability` déjà `no-store` avec `hold=` ou `move=` ; lecture périmée jamais cachée.
- Découpage par page côté Comptoir ; polices auto-hébergées ; `immutable` sur `/assets` et `/img` ; CLS nul sur toutes les pages mesurées.
- Sondage du Comptoir suspendu quand l'onglet est caché (`state.tsx:84`).
