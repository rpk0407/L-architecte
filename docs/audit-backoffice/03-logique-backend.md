# Audit 03 · Logique et exactitude du backend

Périmètre : `server/core`, `server/store`, `server/commands`, `server/domain`, `server/http`, `server/payments`, `scripts/replay-diff.mjs`. Audit en lecture seule : aucun fichier du dépôt modifié en dehors de ce rapport, aucune commande git.

## Résumé

- **Aucun P0 trouvé.** Le cœur tient : sur un magasin partagé, réservation en ligne, caisse, déplacement et hold lancés en parallèle sur le même fauteuil et la même minute donnent un seul gagnant, chaîne intacte (`r09-double.mjs`).
- **4 P1 de concurrence ou de robustesse**, tous reproduits : une écriture validée qui répond 500 (F1), une chaîne SHA-256 cassable de façon irréversible (F2), une panne Stripe qui laisse une réservation fantôme (F3), des holds illimités par visiteur (F4).
- **Le test rouge sur `main` est un défaut de test, pas un défaut produit en production** (F6). La cause est tout de même dans le code produit : les fournisseurs de paiement lisent `Date.now()` au lieu de l'horloge du moteur, ce qui casse aussi l'acompte de la démo quand l'horloge est avancée.
- Le reste est du P2 : règles d'agenda incomplètes, SMS en double, effacement RGPD partiel, outil de rejeu aveugle sur la fidélité.

Suite complète lancée une fois (`npm test`, 4 min 15 s) : **849 tests, 846 réussis, 1 échec, 2 ignorés**. Le seul échec est celui de F6.

### Ce que « CONFIRMÉ » veut dire ici

Chaque constat CONFIRMÉ a un script qui le reproduit avec les helpers du dépôt. Deux limites à garder en tête :

- F1 et F2 sont reproduits avec un magasin mémoire auquel j'ajoute une latence réseau (20 à 30 ms). L'enchaînement fautif est donc prouvé ; sa **fréquence en production n'est pas mesurée**, je donne seulement un ordre de grandeur raisonné.
- F7 : pour passer l'étape « le SMS d'annulation part d'abord », le script marque le message comme envoyé directement en mémoire. L'effacement lui-même passe par la commande réelle.

Scripts de reproduction (hors dépôt) :

| Script | Constats |
|---|---|
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/r01-stripe-clock.mjs` | F6 |
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/preload-date.mjs` | F6 (horloge réelle reculée) |
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/r02-agenda.test.mjs` | F8, F9, F10, F11, F12 |
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/r03-concurrency.test.mjs` | F1, F5 |
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/r05-replay.mjs` | F13 |
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/r06-chain.test.mjs` | F2 |
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/r07-misc.test.mjs` | F3, F6 (démo), F7 |
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/r08-holds.mjs` | F4 |
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/r09-double.mjs` | contrôle : pas de double réservation |
| `/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/repro/r04-perm-probe.mjs` | contrôle : sonde des permissions |

Lancement : `node --test <script>.test.mjs` depuis `/home/user/L-architecte`, ou `node <script>.mjs`.

---

## Le test rouge de `prod-safety.test.js` : défaut de test, cause dans le code produit

Test : « with Stripe, a deposit paid after the hold ended is refunded if the slot went to someone else… », `tests/unit/prod-safety.test.js:167`, `200 !== 409`.

**Verdict : le test dépend de la date réelle. Il passe tant que la date du jour est antérieure au 3 novembre 2026 (le jour simulé du test) et échoue depuis.** En production le comportement attendu (409 `late`) est correct, parce qu'il n'y a qu'une seule horloge.

Mécanisme :

1. Le test fixe l'horloge du moteur au mardi 3 novembre 2026, 10 h.
2. `stripeProvider.createCheckout` calcule l'expiration de la page avec `Date.now()` (`server/payments/stripe.js:120`), et `startPayment` l'enregistre telle quelle (`server/http/routes-public.js:94`, `exp: co.exp`).
3. La route `POST /api/public/bookings/:token/pay` cherche d'abord une page encore ouverte : `p.exp > r.now + 120000` (`routes-public.js:242`). Aujourd'hui (10 novembre), `p.exp` vaut « date réelle + 32 min », soit une semaine après l'horloge simulée. La page est donc jugée ouverte et la route répond 200 avec son URL, avant d'atteindre le contrôle `late`.

Preuves :

- `r01-stripe-clock.mjs` : `checkout exp 2026-11-10T10:40:10Z` alors que l'horloge du test est au 3 novembre.
- Même test, horloge réelle reculée au 1er novembre par `node --import preload-date.mjs --test --test-name-pattern="deposit paid after the hold ended" tests/unit/prod-safety.test.js` : **1 réussi, 0 échec**. Sans le préchargement : échec ligne 167.

Le code sait déjà faire la conversion pour les abonnements : `const lapse = (r, co) => r.now + Math.max(0, co.exp - Date.now())` (`server/http/routes-membership.js:84`). Les acomptes ne l'utilisent pas.

Conséquence produit réelle, hors production : en démo avec `LX_FAKE_NOW` dans le futur (l'exemple du README), l'acompte expire au premier passage du planificateur et la page de test répond « Ce paiement n'est plus en attente » (reproduit, test H de `r07-misc.test.mjs`). `LX_FAKE_NOW` est ignoré en production.

Correctif : voir F6.

---

## Constats

### F1 · P1 · CONFIRMÉ · Une écriture validée répond 500 quand une lecture du magasin s'intercale

**Où** : `server/core/engine.js:124` (`apply` exige `e.v === state.version + 1`), `:256` (`apply(sealed, true)` après l'`append`), `:146-158` (`pull`).

**Mécanisme** : `run()` écrit dans le magasin puis applique ses événements en mémoire. Entre le commit et son accusé de réception, une autre requête de la même instance peut lancer un `pull` (le pulse du Comptoir, un GET, le planificateur). Le `pull` lit l'événement déjà validé et l'applique. Quand l'accusé arrive, `apply(sealed)` trouve la version déjà atteinte et lève `journal gap`. Ce n'est pas une `DomainError` : la requête répond 500 « Une erreur est survenue » alors que l'écriture est dans le journal.

Dans l'ordre inverse (l'accusé d'abord, la lecture ensuite), c'est le `pull` qui lève : `sync` vide alors la projection et relit tout le journal. Pendant cette relecture, `engine.state` est vide pour les requêtes déjà engagées.

**Preuve** : test F de `r03-concurrency.test.mjs`. Sortie : `the write rejects with: journal gap at 12 | DomainError? false | in the store: [ 'appt.booked', 'message.queued' ]`.

**Conséquences** :
- Comptoir : l'écriture porte un `x-request-id`, un nouvel essai avec le même identifiant récupère la réponse (vérifié dans le même test). Sans nouvel essai, le caissier voit une erreur sur un ticket enregistré.
- Site public : pas d'identifiant de requête. Le client voit une erreur, sa réservation existe, et si elle demandait un acompte la page de paiement n'a jamais été créée (même effet que F3).

**Fréquence** : non mesurée. Il faut qu'une lecture tombe dans la fenêtre commit → accusé (quelques millisecondes sur Postgres), et la synchronisation est limitée à une toutes les 1,5 s par instance. Ordre de grandeur : rare par écriture, mais plausible plusieurs fois par mois sur un salon actif.

**Correctif** : sérialiser `pull`, `run` et `batch` par instance (une file de promesses), ou rendre `apply` tolérant : ignorer les événements dont `v <= state.version` quand l'identifiant correspond. **Effort** : 0,5 à 1 jour avec tests. **Risque** : moyen (cœur du moteur) ; le test de reproduction sert de garde-fou.

---

### F2 · P1 · CONFIRMÉ · Les magasins vérifient la version, pas le hash précédent : la chaîne peut casser définitivement

**Où** : `server/store/postgres.js:97`, `server/store/memory.js:34`, `server/store/file.js:26`, `server/store/blob.js:120` (seul `list[0].v` est comparé) ; `server/core/engine.js:288-296` (`batch` applique ses événements en mémoire avant de les écrire) ; `:299-308` (annulation après coup).

**Mécanisme** : pendant qu'un `batch` attend son `append`, la projection de l'instance contient des événements qui ne sont pas dans le magasin. Si une autre instance gagne la course avec **le même nombre d'événements**, et qu'un `run()` de la première instance scelle une écriture dans l'intervalle, cette écriture porte le bon numéro de version mais un `p` qui pointe vers un événement jamais stocké. Le magasin l'accepte. `verifyChain` répond ensuite « Lien rompu avec l'entrée précédente » pour toujours : le journal est immuable.

**Preuve** : `r06-chain.test.mjs`. Deux instances réclament le même SMS (le cas de F5), un client pose un hold sur la perdante. Sortie : `B.batch → -1 | B.run(hold) → ok | stored events: 15 | verifyChain: {"ok":false,"brokenAt":15,"reason":"Lien rompu avec l’entrée précédente"}`. Une troisième instance charge ce journal sans rien signaler ; seul Réglages › Données le voit.

**Fréquence** : très faible. Il faut la collision de F5 **et** une écriture concurrente sur l'instance perdante dans la même fenêtre de quelques millisecondes. L'impact, lui, est irréversible sur un journal à valeur fiscale (les Z stockent le hash du journal comme sceau).

**Correctif** : dans chaque `append`, refuser si `list[0].p` diffère du `h` du dernier événement stocké (Postgres : lire `h` avec `max(v)` dans la même transaction). Dix lignes par magasin, plus un cas dans `tests/unit/stores.test.js`. En complément, ne pas exposer l'état « sale » d'un `batch` aux `run()` concurrents (la file de F1 règle les deux). **Effort** : 0,5 jour. **Risque** : faible ; un refus se traduit par un nouvel essai, déjà géré.

---

### F3 · P1 · CONFIRMÉ · Stripe en panne pendant une réservation : erreur 502 et créneau bloqué 31 minutes par une réservation fantôme

**Où** : `server/http/routes-public.js:209-214`. `bookOnline` est écrit, puis `startPayment` appelle Stripe ; si l'appel échoue, rien ne compense.

**Preuve** : test J de `r07-misc.test.mjs`. Premier essai : `502 provider`, journal : `[ 'pending@600' ]`. Second essai du même client : `409 taken « Ce créneau vient d’être pris »`. Le créneau disparaît des disponibilités pour tout le monde jusqu'à l'expiration.

**Conséquence** : le client n'a ni lien ni SMS (une réservation `pending` n'envoie rien), il est bloqué par sa propre réservation, et le salon perd le créneau une demi-heure. Même effet si la requête répond 500 pour une autre raison après le commit (F1).

**Correctif** : en cas d'échec de `startPayment`, répondre quand même 201 avec `payment: null` et le lien `/r/<token>` (la route `/pay` sait créer la page plus tard), ou annuler la réservation dans le `catch` (`expirePending` existe). **Effort** : 2 à 3 h avec test. **Risque** : faible.

---

### F4 · P1 · CONFIRMÉ · Holds illimités par visiteur : une journée entière vidée en 24 requêtes, et le journal grossit sans limite

**Où** : `server/http/routes-public.js:197` (`guard('hold|' + r.ip, 30, 60000)`, par IP et par instance) ; `server/commands/agenda.js:62-77` (`holdSlot` ne plafonne rien).

**Preuve** : `r08-holds.mjs` sur le salon de démo. Sortie : `one visitor, no booking, no name: 24 holds accepted (0 refused) | starts offered to everyone else tomorrow: 14 → 0 for 5 min, renewable`.

**Conséquences** :
- N'importe qui, sans nom ni numéro, rend le salon « complet » en ligne, et peut renouveler toutes les 5 minutes sous la limite de 30 par minute.
- Chaque hold est un événement `appt.held` définitif. À 30 par minute et par IP, cela fait jusqu'à 43 000 événements par jour dans un journal qui ne se purge pas et que chaque démarrage à froid relit en entier.

**Correctif** : un seul hold actif par visiteur (le paramètre `replace` existe déjà : le rendre systématique par cookie ou par IP), plafond global de holds actifs par jour et par fauteuil, limite horaire en plus de la limite par minute. À plus long terme, sortir les holds du journal (ils n'ont aucune valeur d'audit). **Effort** : 0,5 jour pour les plafonds. **Risque** : faible ; vérifier le parcours « liste d'attente → offre » qui pose ses propres holds.

---

### F5 · P1 · CONFIRMÉ · SMS envoyés en double : le résultat de `batch` est ignoré par l'envoi

**Où** : `server/http/scheduler.js:215` (réclamation) et `:241` (résultats) ; `server/core/engine.js:308` (`batch` renvoie `-1` sur conflit, sans relancer) ; `server/commands/system.js:77` (une réclamation de plus de 5 minutes est remise en file).

Deux chemins, tous deux reproduits dans `r03-concurrency.test.mjs` :

- **Test D, deux instances envoient en même temps.** Les deux réclament localement, une seule écriture gagne. La perdante annule, relit, voit le message `claimed` (par l'autre) et l'envoie quand même, parce que sa liste `claimed` a été remplie avant l'échec. Sortie : `SMS sent: [ "A → +33611223344 …", "B → +33611223344 …" ]`.
- **Test D2, l'écriture des résultats perd une course.** Le fournisseur a pris le SMS, le journal ne le sait pas, le message reste `claimed`, puis repart 5 minutes plus tard. Sortie : `after the 1st dispatch: sent = 1 | message status in the journal = claimed` puis `6 minutes later: sent = 2`.

**Conséquence** : confirmations et rappels en double (coût, image). La doc affirme l'inverse (« two instances ticking at once never send the same reminder twice », `docs/architecture.md`) : c'est vrai pour la mise en file, pas pour l'envoi.

**Correctif** : dans `dispatch`, ne rien envoyer si le `batch` de réclamation renvoie `-1` ; pour les résultats, réessayer le `batch` (boucle de 3 à 5 essais comme `run`). Marquer la réclamation avec l'identifiant de l'instance pour ne jamais envoyer ce qu'une autre a réclamé. **Effort** : 2 à 3 h. **Risque** : faible.

---

### F6 · P1 (CI rouge) / P2 (produit) · CONFIRMÉ · Les fournisseurs de paiement utilisent l'horloge réelle

**Où** : `server/payments/stripe.js:120`, `server/payments/simulated.js:13`, `server/http/routes-public.js:94`.

Analyse et preuves dans la section dédiée ci-dessus. Deux effets : `npm run verify` échoue sur `main` depuis le 3 novembre 2026, et l'acompte de la démo est impayable quand `LX_FAKE_NOW` est dans le futur (test H : `payment expired | « Payer » → 409 Ce paiement n’est plus en attente`).

**Correctif** : dans `startPayment`, enregistrer `exp: r.now + Math.max(0, co.exp - Date.now())`, comme `lapse` le fait pour les abonnements. Une ligne. Le test repasse sans être modifié, quelle que soit la date. **Effort** : 15 min. **Risque** : nul en production (les deux horloges y sont identiques).

---

### F7 · P2 · CONFIRMÉ · Effacement RGPD à la demande : les données saisies avant l'existence de la fiche restent

**Où** : `server/core/engine.js:64` (`erasedMatch` ne retient que les événements portant le `cid` de la fiche) ; `server/commands/agenda.js:443` (une entrée de liste d'attente d'un numéro inconnu n'a pas de `cid`).

**Preuve** : test K de `r07-misc.test.mjs`. Un visiteur s'inscrit en liste d'attente, puis réserve (sa fiche naît), puis demande l'effacement. Sortie : `file erased: true | waiting list in memory: {"first":"Karim","phone":"+33699887766","clientId":null} | events still holding the number in the store: [ 'waitlist.added' ]`.

Même logique, non reproduite : un passage en file (`queue.added`) avec téléphone sans fiche, un prénom tapé sur un rendez-vous sans fiche. Ces données ne partent qu'à la purge de rétention (3 ans).

**Correctif** : à l'effacement, ajouter à `drop` les entrées sans fiche dont le numéro normalisé est celui de la fiche (liste d'attente, file, messages). **Effort** : 2 à 3 h. **Risque** : faible.

À noter aussi, SUSPECTÉ : dans le magasin Blob, la suppression de l'ancien segment après un effacement est `del(...).catch(() => {})` (`server/store/blob.js:137` et `:168`). Un échec laisse un segment orphelin avec les données personnelles, jamais retenté.

---

### F8 · P2 · CONFIRMÉ · Le préavis minimum ne s'applique qu'au jour même

**Où** : `server/domain/availability.js:136` (`if (ahead > 0) return 0`). Le réglage accepte jusqu'à 2 880 minutes (`server/settings/booking.js`).

**Preuve** : test A de `r02-agenda.test.mjs`. Préavis réglé à 24 h, il est 23 h : le créneau de 9 h le lendemain est proposé et réservable (10 h de préavis).

**Correctif** : comparer des instants : `instantOf(day, m) >= now + minNoticeMin`. **Effort** : 1 h. **Risque** : faible.

---

### F9 · P2 · CONFIRMÉ · Un rendez-vous futur peut être marqué « absent »

**Où** : `server/commands/agenda.js:289`. Le garde « pas encore commencé » ne teste que `a.day === ctx.local.day`.

**Preuve** : test B. Un barbier marque absent le rendez-vous du lendemain : accepté, le créneau repart en ligne, et l'absence compte dans l'historique du client (acompte au risque, `domain/risk.js`).

**Correctif** : refuser aussi quand `a.day > ctx.local.day`. **Effort** : 15 min. **Risque** : nul.

---

### F10 · P2 · CONFIRMÉ · Déplacer une réservation dont l'acompte n'est pas payé envoie un SMS « c'est noté »

**Où** : `server/commands/agenda.js:243` et `:44-57`. `confirmText` retient l'e-mail tant que le statut est `pending`, pas le SMS.

**Preuve** : test C. Sortie : `status after move: pending | confirmation texts queued: 1 | L'Architecte : c'est noté Paul ! Jeu. 5 nov. à 11 h avec Ali`. Seize minutes plus tard le planificateur annule cette réservation « confirmée ».

**Correctif** : dans `confirmText`, ne rien mettre en file si `a.status === 'pending'`. **Effort** : 15 min. **Risque** : nul.

---

### F11 · P2 · CONFIRMÉ · Réserver via un hold ne revérifie pas que le barbier fait la prestation

**Où** : `server/commands/agenda.js:102-104`. Le chemin « hold » compare jour, heure et durée, pas les prestations.

**Preuve** : test E. Hold posé pour une coupe chez Ali, réservation envoyée avec « Coupe + barbe » (même durée) qu'Ali ne fait pas : acceptée chez Ali. Sans hold, la même demande est refusée.

**Correctif** : comparer `hold.serviceIds` à `b.serviceIds`, ou appeler `canDo`. **Effort** : 30 min. **Risque** : nul.

---

### F12 · P2 · CONFIRMÉ · Un ticket payé par carte cadeau se rembourse en espèces

**Où** : `server/commands/sales.js:387` (moyens de remboursement : carte, espèces, en ligne) ; `:435` (`giftcardPaid` est calculé mais jamais contrôlé dans `checkRefund`).

**Preuve** : test G. Carte cadeau de 50 €, coupe à 20 € payée avec, avoir de 20 € en espèces accepté ; solde de la carte toujours à 30 €.

**Conséquence** : une carte cadeau se convertit en espèces à la caisse (droit `sale.refund`, donc gérant ou responsable). Lié : aucune commande ne recrédite une carte cadeau ni ne rend une coupe à un carnet ; l'événement `pack.returned` est lu par la projection (`server/core/state.js:330`) mais rien ne l'émet.

**Correctif** : plafonner un avoir en argent à ce qui a été payé en argent, et ajouter un remboursement « sur la carte cadeau ». **Effort** : 0,5 à 1 jour (touche les Z et la compta). **Risque** : moyen.

---

### F13 · P2 · CONFIRMÉ · `replay-diff.mjs` ne voit pas une dérive de la fidélité

**Où** : `scripts/replay-diff.mjs:75-80`. L'empreinte passe par `canonical`, qui rend `{}` pour une `Map` ou un `Set` ; `s.loyalty` est un objet de `Map`.

**Preuve** : `r05-replay.mjs`. `canonical(Map) = {}`. En retirant du journal de démo la moitié des tampons et toutes les récompenses utilisées (126 événements), l'empreinte fidélité est **identique** (`495c338643bf16c3`). L'outil promet « any difference is drift ».

Autre défaut du script : la ligne `mrr` lit `s.memberships`, qui n'existe pas (l'état s'appelle `s.members`) ; elle n'est jamais imprimée (`:81`).

**Correctif** : sérialiser récursivement `Map` et `Set` avant l'empreinte ; lire le MRR avec `mrr()` de `domain/membership.js`. **Effort** : 1 h. **Risque** : nul (script hors production).

---

### Constats par lecture seule (SUSPECTÉS, non reproduits)

| # | Sév. | Constat | Où |
|---|---|---|---|
| S1 | P2 | Annulation par un barbier avec `refundDeposit` : le rendez-vous est annulé, **puis** la route répond 403 « Seul le gérant rembourse un acompte ». Le contrôle vient après l'écriture. | `server/http/routes-staff.js:449-453` |
| S2 | P2 | Acompte payé en retard dont le remboursement échoue chez Stripe : jamais retenté (le second avis du webhook répond `already`). Il apparaît dans Caisse › En ligne, mais seulement 24 h après. | `server/http/routes-public.js` (`afterProviderPaid`), `routes-payments.js:123` |
| S3 | P2 | Après le passage du planificateur, un acompte payé en retard est toujours remboursé, même si le créneau est resté libre. La doc dit « kept if the slot is still free » ; ce n'est vrai que dans la minute avant le passage. | `server/commands/payments.js:107-124` |
| S4 | P2 | Le moyen `online` de la caisse accepte n'importe quel paiement réglé non utilisé, y compris l'acompte d'un autre rendez-vous ou une empreinte de carte (`guarantee`, sans argent). Aucune route ne crée d'empreinte aujourd'hui : latent. | `server/commands/sales.js:222-229` |
| S5 | P2 | `POST /api/public/waitlist` transmet le corps tel quel : un `clientId` fourni par le visiteur devient le `cid` de l'événement. Les identifiants internes ne sont pas publics, donc peu exploitable. | `routes-public.js`, `agenda.js:443` |
| S6 | P2 | Un déplacement par l'équipe ne revérifie pas que le nouveau barbier fait la prestation. | `server/commands/agenda.js:205-222` |

---

## Vérifié sans constat

- **Double réservation** : en ligne, caisse, déplacement et hold en parallèle sur deux instances : un seul gagnant (`r09-double.mjs`). Les seuls chevauchements possibles passent par `force`, réservé et voulu.
- **Changement d'heure** : `instantOf` se trompe d'une heure uniquement pour des heures locales entre 1 h et 3 h les nuits de bascule. Les derniers dimanches de mars et d'octobre le salon est fermé, et aucun calcul métier ne tombe dans cette plage. Les créneaux sont en minutes locales, les délais (hold, acompte, annulation 12 h avant) en instants.
- **Idempotence** : clé par acteur et par requête, dérivée par commande ; rejouée sur une autre instance depuis les événements. Conforme à la doc.
- **Numérotation des tickets, avoirs et Z** : sans trou grâce à la concurrence optimiste ; `recomputedMismatch` vide sur le journal de démo.
- **Abonnements** : périodes payées, tolérance du jour de renouvellement, grâce, semaine « perdue ». Rien d'anormal à la lecture ; la suite de tests est dense sur ce point. Je n'ai pas rejoué de scénario Stripe réel.
- **Fidélité** : le tampon repris après remboursement alors que la récompense reste est un choix documenté et testé.
- **Permissions** : sonde dynamique de toutes les routes `/api/v1` en tant que barbier sur la démo (`r04-perm-probe.mjs`) : aucun 5xx, chaque réponse 200 correspond à un droit du rôle, les tickets des autres sont filtrés. Ce n'est pas un audit de sécurité complet.
- **Import WordPress** : les chevauchements sont bien signalés et non bloqués (`commands/import.js:674`, `:733`, `:941`). Lu, pas rejoué au-delà de la suite existante.

---

## Top 10, par ordre de traitement conseillé

| Rang | Constat | Sév. | Statut | Effort | Pourquoi ce rang |
|---|---|---|---|---|---|
| 1 | F6 · horloge réelle dans les paiements | P1 CI | CONFIRMÉ | 15 min | Une ligne, remet `main` au vert |
| 2 | F1 · 500 sur une écriture validée | P1 | CONFIRMÉ | 0,5 à 1 j | Touche caisse et réservation en usage normal |
| 3 | F2 · chaîne cassable définitivement | P1 | CONFIRMÉ | 0,5 j | Rare mais irréversible ; garde-fou peu coûteux |
| 4 | F3 · réservation fantôme si Stripe tombe | P1 | CONFIRMÉ | 2 à 3 h | Client bloqué par sa propre réservation |
| 5 | F4 · holds illimités | P1 | CONFIRMÉ | 0,5 j | Salon « complet » à la demande, journal qui enfle |
| 6 | F5 · SMS en double | P1 | CONFIRMÉ | 2 à 3 h | Coût et image ; contredit la doc |
| 7 | F7 · effacement RGPD partiel | P2 | CONFIRMÉ | 2 à 3 h | Promesse légale non tenue pour un cas courant |
| 8 | F10 · SMS « c'est noté » sans acompte | P2 | CONFIRMÉ | 15 min | Message faux envoyé au client |
| 9 | F8 · préavis minimum après minuit | P2 | CONFIRMÉ | 1 h | Réglage qui ne fait pas ce qu'il dit |
| 10 | F9 · absent sur un rendez-vous futur | P2 | CONFIRMÉ | 15 min | Fausse l'historique et libère le créneau |

Suivent, sans urgence : F12 (carte cadeau en espèces), F11 (hold et prestation), F13 (outil de rejeu), puis S1 à S6.

Les rangs 2, 3 et 6 partagent une cause : `run`, `batch` et `pull` ne sont pas sérialisés dans une instance, et `batch` ne réessaie pas. Une file unique par moteur plus le contrôle du hash précédent dans les magasins les règle ensemble.
