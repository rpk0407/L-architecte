# Audit back-office · 05 · Complétude et professionnalisme

Angle : ce qu'une équipe de barbiers et son gérant, en France, doivent pouvoir faire sans friction, comparé à Planity Pro, Fresha, Booksy, Treatwell, Square Appointments, Zenoti, et aux obligations françaises.

## 0. Méthode et limites

- Audit en lecture seule : `README.md`, `docs/*.md` (architecture, sécurité, opérations, roadmap, script de démo, réponse à Jessica), `server/settings/*`, `server/commands/*`, `server/domain/*`, `server/http/routes-*`, `web/src/comptoir/**`. Aucun fichier existant modifié, aucune commande git, application non lancée, tests non exécutés.
- Les états « existe / partiel / manquant » viennent de la lecture du code et de recherches par mots-clés. Un « manquant » signifie « rien trouvé dans le dépôt », pas une preuve formelle d'absence.
- Les points de droit (NF525, TVA, pourboires, durée du travail, URSSAF, e-reporting) sont des repères à **faire valider par le comptable ou un juriste**, pas un avis juridique. Je ne les ai pas vérifiés sur les textes pendant cet audit.
- La comparaison avec les concurrents repose sur ma connaissance générale de ces produits, non vérifiée ici ; leurs offres évoluent.
- Effort : **S** = moins de 2 jours, **M** = 3 à 8 jours, **L** = plus de 2 semaines. Risque : celui de la mise en œuvre (régression, juridique, données).

## 1. Synthèse

Le Comptoir est nettement au-dessus d'un outil « maison » habituel sur quatre terrains : l'intégrité des données (journal chaîné, clôtures signées), le RGPD (effacement réel, registre, export, consentement prouvé), la bascule depuis WordPress (gel, synchro, plan de retour) et la gouvernance d'équipe (qui voit quoi, téléphones personnels, traçabilité des changements de commission). Sur ces points il fait mieux que Planity ou Booksy.

Les trous qui comptent sont ailleurs, dans le quotidien :

1. **Rappels** : pas de rappel par e-mail, pas de rappel pour un rendez-vous pris la veille après 18 h (le rappel 2 h est éteint par défaut), rien pour un client qui a coupé les SMS ou dont le numéro est hors des pays autorisés.
2. **Absences** : la politique « no-show » est à moitié construite (réglage du montant, empreinte de carte côté Stripe prête, mais ni étape de réservation ni bouton « facturer l'absence »).
3. **Double saisie en caisse** : caisse de gestion + caisse certifiée + TPE séparé, sans rapprochement du total carte du TPE avec le Z.
4. **Mode dégradé** : pas de file hors ligne, pas d'agenda imprimable, pas d'alerte poussée au gérant quand les SMS, le cron ou la sauvegarde tombent en journée (le résumé du soir les mentionne, mais le soir seulement).
5. **Social et paie** : pas de pointage ni de feuille d'heures, pas de typologie d'absence (congé, maladie, formation), pas de location de fauteuil, pas d'export au format du logiciel de paie.

Un point de cohérence à traiter vite : **Réglages › Comptabilité propose un interrupteur « Lui envoyer le pack chaque mois » (activé par défaut) alors que je n'ai trouvé aucun code serveur qui lise `compta.autoSend` ou envoie quoi que ce soit au comptable**. Même chose pour `compta.ereporting` (réglage sans traitement). Un gérant qui croit que son comptable reçoit les fichiers seul, c'est un vrai risque de confiance.

## 2. Ce qui est déjà bien fait (à ne pas refaire)

| Sujet | Preuve | Pourquoi c'est bien |
|---|---|---|
| Journal inaltérable, tickets numérotés sans trou, avoirs au lieu de modifications | `server/core/journal.js`, `server/commands/sales.js`, `docs/security.md` § Fiscal note | Base saine pour une future certification, et preuve en cas de litige interne |
| Z quotidien scellé, clôtures mensuelles et annuelles signées Ed25519, journal technique | `server/commands/steps/fiscal.js`, `server/domain/fiscal.js`, `/api/v1/fiscal/log` | Trois des cinq briques NF525 listées par la doc sont déjà là |
| Honnêteté sur le statut « caisse de gestion » | Bandeau de la page Caisse en production, `docs/operations.md` | Évite au salon l'amende de 7 500 € par méconnaissance |
| Effacement RGPD réel sans casser la chaîne, hachages salés, export des données par e-mail, registre art. 30 | `server/commands/clients.js`, `docs/security.md` § Registre | Niveau rarement atteint par les concurrents |
| Conservation 3 ans avec badge et anonymisation | `POST /api/v1/clients/retention`, `Clients.tsx` (composant `Retention`) | Promesse de la page confidentialité tenue (à la main, voir 3.2) |
| Trois classes de messages (service, relation, marketing), heures calmes, STOP, pays autorisés contre le « SMS pumping » | `server/core/templates.js`, `server/settings/messages.js` | Conforme CNIL et protège la facture SMS |
| Avis Google sans filtrage ni récompense | `docs/operations.md` § Google reviews, `server/commands/reviews.js` | Conforme au droit de la consommation, contrairement à beaucoup d'outils |
| Absence d'un barbier : demande, validation, aperçu, réattribution des clients avec SMS dédié | `server/commands/team.js` (`timeoff.*`, modèles `reassign`, `reassignAt`), `/api/v1/timeoff/:id/reassign` | Le cas « malade ce matin » est traité de bout en bout |
| Paiement fractionné, pourboire attribué à un barbier, remise plafonnée par rôle | `server/commands/sales.js` (`payments` jusqu'à 6 lignes, `tip.staffId`) | Au niveau de Square |
| Rapprochement Stripe : virements, frais par paiement, litiges, remboursements faits hors caisse | `server/payments/handlers.js`, `docs/operations.md` § Stripe | Mieux que la plupart des outils de réservation |
| Écritures équilibrées au format FEC (fichier d'import), aide TVA, soldes de fin de mois | `server/domain/ledger.js`, `server/http/routes-compta.js`, `server/domain/balances.js` | Le comptable gagne du temps, et la doc dit bien que ce n'est pas le FEC légal |
| Abonnements conformes (rétractation 14 jours, résiliation en ligne sans compte) | `/resilier`, `/abo/:token`, `server/commands/memberships.js` | Sujet juridique lourd, traité sérieusement |
| Relevé mensuel par barbier (réalisé, commission TTC ou HT, pourboires carte et espèces, jours) | `server/domain/statement.js`, export `payroll` dans `routes-admin.js` | Bonne base pour la paie |
| Mise en route cochée en direct, page Santé, visites guidées par rôle | `server/http/routes-health.js`, `web/src/comptoir/guide/steps/*` | Onboarding supérieur à la moyenne |
| Sauvegarde nocturne chiffrée, restauration documentée avec exercice à J+7 | `server/core/backup.js`, `docs/operations.md` § Backups | Rare dans un outil de cette taille |
| Stock par mouvements, seuil bas, inventaire, marge, valeur du stock | `server/commands/catalog.js`, `Catalogue.tsx` | Suffisant pour une vitrine de produits |

## 3. Analyse par domaine

Légende État : ✅ existe · 🟡 partiel · ❌ manquant.

### 3.1 Légal et fiscal

| Sujet | État | Preuve | Valeur pour le salon | Recommandation | Effort | Risque | Où |
|---|---|---|---|---|---|---|---|
| Caisse certifiée (NF525 ou LNE) | 🟡 | `docs/security.md` § Fiscal note ; pas de compteur de duplicata (aucune occurrence de « duplicata » dans le code) ; signature des clôtures faite, pas celle de chaque ticket | Supprimer la double saisie caisse certifiée + Comptoir, qui est la plus grosse friction quotidienne | Décider d'abord : certifier (projet long et payant, renouvelé par version majeure) ou **s'interfacer avec la caisse certifiée existante**. En attendant, livrer les deux briques bon marché : compteur de duplicata et signature par ticket | L (certification) ; S+M (briques) | Juridique élevé si le salon abandonne sa caisse certifiée trop tôt | `server/commands/sales.js`, `server/domain/fiscal.js`, `Receipt.tsx` |
| Double saisie caisse de gestion / caisse légale | ❌ | `docs/operations.md` : « chaque vente passe aussi sur ta caisse certifiée » | 10 à 20 secondes par client, et deux Z à réconcilier | Écran de fin de journée « Z de la caisse certifiée » : le gérant saisit trois totaux (CA, espèces, carte), l'écart avec le Z du Comptoir s'affiche et est gardé | S | Faible | `caisse/Closing.tsx`, nouveau fait `day.reconciled` |
| TVA par ligne, taux par produit, TVA sur acompte | ✅ | `server/settings/payments.js` (`vat`), `server/settings/compta.js` (`depositVat`, `servicesVat`) | Déclarations justes | Rien, sinon faire valider le régime (le réglage est « à confirmer » par défaut) | – | – | – |
| Franchise en base de TVA | 🟡 | `compta.regime` accepte `franchise` ; je n'ai pas vérifié que le ticket porte alors la mention « TVA non applicable, art. 293 B du CGI » | Mention obligatoire pour un salon en franchise | Vérifier le ticket et l'avoir en régime `franchise` ; ajouter la mention si absente | S | Faible | `Receipt.tsx`, `server/domain/cash.js` |
| Clôtures Z, mensuelle, annuelle | ✅ | `period.closed`, `seal.signed`, Z automatique après minuit (`tick-steps.js`) | Rien à penser le soir | Rien | – | – | – |
| Facture nominative à la demande | ❌ | « facture » n'apparaît que pour les factures Stripe des abonnements | Un client professionnel (note de frais), un comité d'entreprise ou une formation vendue à une société demandent une facture avec nom, adresse et SIREN | Bouton « Facture » sur un ticket : numérotation propre, coordonnées du client saisies à la demande (stockées hors chaîne), PDF ou page imprimable. Indispensable pour `/formations` si elles sont vendues à des entreprises | M | Moyen (numérotation légale, mentions) | `caisse/Sales.tsx`, `server/commands/sales.js` |
| Note obligatoire pour une prestation | 🟡 | Ticket imprimable 80 mm et reçu par SMS (`Receipt.tsx`, modèle `receipt`) | Obligation de remettre une note au-delà d'un seuil (25 € TTC à ma connaissance, à confirmer) | Tant que la caisse certifiée imprime le ticket, rien. Sinon vérifier les mentions (date, nom et adresse du salon, détail, total HT et TTC) | S | Faible | `Receipt.tsx` |
| Avoirs | ✅ | `sale.refunded`, numérotation `refundNo`, remise en stock contrôlée | Corrections propres | Rien | – | – | – |
| Pourboires : suivi et reversement | 🟡 | Attribués par barbier, séparés carte / espèces dans le relevé (`insights.js` l. 269, `statement.js`) ; aucun fait « pourboires carte reversés » trouvé | Les pourboires par carte passent par le compte du salon : il faut prouver qu'ils sont reversés, et à quelle date. Le régime social et fiscal des pourboires change souvent : à valider avec le comptable | « Reverser les pourboires » dans le relevé : montant dû par barbier, date et mode du reversement, ligne dans l'export paie | S | Faible | `Rapports.tsx` (relevé), `server/domain/statement.js` |
| Livre de caisse (espèces) | 🟡 | `drawer.opened / moved / closed`, comptage par coupure, raison libre (défaut « Dépôt en banque ») ; `ledger.js` l. 418 annonce « CPT-04 adds its cash book here » : non livré | Justifier chaque sortie d'espèces (dépôt en banque, achat de fournitures, prélèvement du gérant) | Livrer CPT-04 : motifs fixes (dépôt banque, achat, prélèvement gérant, apport), justificatif photo optionnel, export mensuel du livre de caisse | M | Faible | `server/domain/ledger.js`, `caisse/Closing.tsx` |
| Export comptable | ✅ | Ventes, TVA, clôtures, commissions, paie, clients (`/api/v1/export?kind=`), écritures FEC, Excel | Comptable autonome | Voir la ligne suivante | – | – | – |
| Envoi automatique du pack au comptable | ❌ **promis par l'écran** | `Compta.tsx` l. 136 : « Le mois clôturé, ses fichiers partent seuls » ; `autoSend` n'est lu nulle part hors `server/settings/compta.js` | Confiance : le gérant croit que c'est envoyé | Soit livrer l'envoi (étape du tick après `period.closed`, e-mail avec pièces jointes, ligne dans le fil), soit masquer l'interrupteur d'ici là | S (masquer) ; M (livrer) | Moyen (pièces jointes, pas de nom de client dedans) | `server/commands/steps/`, `Compta.tsx` |
| E-reporting B2C (calendrier 2026-2027) | ❌ | `compta.ereporting { from, cadence }` sans traitement | Obligation à venir de transmettre les ventes aux particuliers via une plateforme agréée | Ne rien construire avant que le comptable ait choisi sa plateforme ; préparer un export journalier agrégé par taux de TVA. Masquer le réglage tant qu'il ne fait rien | M | Juridique (calendrier mouvant) | `server/domain/ledger.js` |
| Affichage des prix, CGV, mentions légales, médiateur | ✅ | `public/cgv.html`, `mentions-legales.html`, version des CGV datée par le serveur (`server/settings/shop.js`) | Conformité du site | Clause de rétractation à trancher par le juriste (déjà noté dans `security.md`) | S | Juridique | `public/cgv.html` |
| Location de fauteuil / indépendants | ❌ | Roadmap seulement | Si un barbier est indépendant, mélanger ses ventes dans la caisse du salon, lui fixer ses prix et ses horaires dans l'outil sont des indices de salariat déguisé (risque URSSAF) | Si le cas existe au salon : statut « indépendant » sur la fiche, ses encaissements hors CA du salon, loyer périodique facturé, export séparé. Sinon ne pas construire | L | Juridique élevé | `server/commands/team.js`, `insights.js` |
| Titres-cadeaux : validité, solde perdu | ✅ | 365 jours, écriture OD de « breakage », réémission (`giftcards/:id/reissue`) | Dette suivie | Prévenir le porteur 30 jours avant l'expiration (voir 3.5) | S | Faible | `server/commands/system.js` |

### 3.2 RGPD

| Sujet | État | Preuve | Valeur | Recommandation | Effort | Risque | Où |
|---|---|---|---|---|---|---|---|
| Consentement marketing prouvé (source, date) | ✅ | `marketingSrc`, `marketingAt` (`clients.js` l. 83, `agenda.js` l. 110-113) | Preuve en cas de plainte | Rien | – | – | – |
| Désinscription (STOP, espace client, salon) | ✅ | `server/commands/sms-inbound.js`, `PATCH /api/me/consent` | Conformité | Ajouter le lien de désinscription en un clic pour l'e-mail de demande d'avis (FID-04, annoncé) | S | Faible | `server/domain/mails.js` |
| Accès et portabilité | ✅ | `clients/:id/export`, `POST /api/me/export` | Réponse à une demande en un clic | Rien | – | – | – |
| Effacement | ✅ | `client.erased`, garde sur ce qui est ouvert | Conformité réelle | Suivre le délai d'un mois : la demande venant de l'espace client devrait compter les jours et passer en rouge à J+21 | S | Faible | `Clients.tsx`, `server/domain/cockpit.js` |
| Durée de conservation | 🟡 | Anonymisation à 3 ans **manuelle** (badge), `security.md` le reconnaît | Promesse de la page confidentialité tenue sans y penser | Étape nocturne avec garde-fou (plafond par nuit, ligne dans le résumé du soir), ou rappel mensuel dans le résumé | S | Moyen (effacement irréversible : plafonner et journaliser) | `server/commands/tick-steps.js` |
| Paiements abandonnés | 🟡 | `security.md` : une commande de carte cadeau jamais payée garde ses données | Minimisation | Purge à 30 jours des `payment.created` expirés | S | Faible | `tick-steps.js` |
| Données sensibles (allergies, peau) | ✅ par choix | Le champ note de coupe dit de ne pas écrire d'information de santé | Évite l'article 9 | Garder ce choix. Si le salon veut noter « peau réactive, pas de lame », le faire en choix fermés non médicaux (« pas de rasoir », « sans parfum ») plutôt qu'en texte libre | S | Moyen si mal cadré | `clients.js` (`tech`) |
| Sauvegardes et effacement | 🟡 | Une sauvegarde d'avant l'effacement garde le client jusqu'à un an ; la restauration demande de refaire les effacements à la main | Cohérence | Garder la liste des effacements (identifiants hachés déjà présents) et la rejouer automatiquement après une restauration | M | Moyen | `server/core/backup.js` |
| Registre, sous-traitants | ✅ | Tableau complet dans `security.md` | Document à montrer à la CNIL | L'exposer dans Réglages › Données en PDF imprimable, daté | S | Faible | `reglages/System.tsx` |
| Données de l'équipe | 🟡 | Photo et téléphones traités ; rien sur la consultation par un salarié de ses propres données, ni sur l'information des salariés | Le salarié a les mêmes droits que le client | Une page « Mes données » dans Mon compte et une notice d'information de l'équipe (texte) | S | Faible | `reglages/Account.tsx` |
| Violation de données | ❌ | `security.md` § Reporting : « contacter l'exploitant » | Notification CNIL sous 72 h | Fiche de procédure d'une page (qui prévenir, quoi noter, modèle de notification) dans `docs/` et dans l'aide | S | Faible | `docs/` |

### 3.3 Équipe

| Sujet | État | Preuve | Valeur | Recommandation | Effort | Risque | Où |
|---|---|---|---|---|---|---|---|
| Horaires hebdomadaires par barbier, pauses | ✅ | `schedule: week()` en intervalles (`team.js` l. 19), blocs de créneau (`block.added`) | Agenda juste | Rien | – | – | – |
| Planning variable (roulement une semaine sur deux, samedi alterné) | 🟡 | Une seule semaine type par barbier ; les exceptions passent par absences et ouvertures exceptionnelles | Les salons à roulement saisissent des absences à répétition | Semaines A/B, ou « horaires de la semaine du… » qui remplacent la semaine type | M | Moyen (disponibilités) | `server/domain/availability.js` |
| Absences avec validation | ✅ | `timeoff.requested / added / refused / withdrawn`, `team.timeoffApproval` | Clair pour tous | Voir ligne suivante | – | – | – |
| Type d'absence et soldes | ❌ | `reason` en texte libre de 60 caractères (`team.js` l. 146-148) | Le gérant ne sait pas combien de congés payés restent, ni combien de jours de maladie dans le mois pour la paie | Types fixes (congé payé, maladie, sans solde, formation, récupération), compteur de jours par type dans le relevé et l'export paie | M | Faible | `server/commands/team.js`, `statement.js` |
| Réattribution en cas d'absence | ✅ | `/api/v1/timeoff/:id/reassign`, `/timeoff/preview` | Journée sauvée | Ajouter un bouton unique « Absent aujourd'hui » depuis l'agenda, qui ouvre l'aperçu | S | Faible | `agenda/Sheets.tsx` |
| Pointage / feuille d'heures | ❌ | Aucune occurrence | L'employeur doit pouvoir justifier la durée du travail ; heures supplémentaires du samedi ; litige prud'homal | Pointage au PIN sur le poste du salon (arrivée, pause, départ), feuille mensuelle signée par le salarié, écart avec le planning. À valider avec le comptable selon les contrats | M | Moyen (social) | nouveau `server/commands/timeclock.js`, `Espace.tsx` |
| Modèles de commission | 🟡 | Taux service et produit par personne, base TTC ou HT, règles carnet / abonné / récompense (`settings/team.js`) | Couvre le cas courant | Manquent : paliers (40 % jusqu'à 4 000 €, 45 % au-delà), fixe + variable, commission par prestation, prime de revente. À construire seulement si le salon s'en sert | M | Moyen (rejeu des chiffres : `scripts/replay-diff.mjs`) | `server/domain/insights.js` |
| Relevé de paie et export | 🟡 | Relevé imprimable, CSV `payroll` ; format Silae / PayFit sur la roadmap | Le cabinet de paie ressaisit | Demander au cabinet son gabarit d'import et produire ce fichier précis, plutôt qu'un format générique | S à M | Faible | `routes-admin.js` (`kind === 'payroll'`) |
| Objectifs | ✅ | Par salon et par barbier, automatiques ou fixés (`settings/goals.js`) | Motivation | Ajouter des objectifs non financiers : taux de re-réservation, vente de produits, avis | S | Faible | `insights.js` |
| Rôles et droits | ✅ | Quatre rôles, 30 capacités environ, matrice calculée par le serveur (`permissions.js`) | Sécurité | Suffisant. Un rôle « apprenti » (agenda propre, pas d'encaissement, pas de numéros) peut servir | S | Faible | `permissions.js` |
| Apprentis et prix par niveau | ❌ | Un prix par prestation, pas par barbier (non trouvé) | Tarif « junior » courant en barbershop, affiché sur le site | Prix par niveau ou par barbier, optionnel | M | Moyen (réservation, ticket, commission) | `catalog.js`, `availability.js` |
| Notification du barbier | 🟡 | Flux iCal par barbier (`/api/cal/team/…`), fil d'activité ; notifications poussées sur la roadmap | Savoir qu'un client vient de réserver ou d'annuler | Web Push sur le téléphone lié (l'appli est installable : `comptoir.webmanifest`) | M | Moyen (iOS exige l'installation sur l'écran d'accueil) | nouveau service worker |
| Départ d'un salarié | 🟡 | Archivage, téléphones retirés, flux agenda coupé | Sécurité | Liste de sortie : rendez-vous futurs à réattribuer, pourboires et commissions dus, clients « habitués » à prévenir | S | Faible | `Equipe.tsx` |
| Documents RH | ❌ | Rien | Contrats, diplômes (le CAP ou BP est requis pour exercer), visites médicales, fin de période d'essai | Hors périmètre raisonnable ; au plus des dates d'échéance avec rappel | S | Faible | `Equipe.tsx` |

### 3.4 Clients

| Sujet | État | Preuve | Valeur | Recommandation | Effort | Risque | Où |
|---|---|---|---|---|---|---|---|
| Historique, rythme, dépense | ✅ | `insights.js`, `rhythm.js`, fiche client | Connaître le client | Rien | – | – | – |
| Notes, fiche technique, notes de coupe | ✅ | `notes`, `tech`, `cut.noted` (3 dernières, 280 caractères) | Refaire la coupe qu'il aime | Raccourcis de saisie (sabot 0,5 / 1 / 1,5, dégradé bas / mi / haut, ciseaux) pour écrire en deux touches | S | Faible | `espace/CutNoteSheet.tsx` |
| Photos de coupe | ❌ | Roadmap ; aucun stockage d'image client | Le différenciateur n°1 de Booksy et Fresha ; le client montre « comme la dernière fois » | Photo après coupe avec consentement explicite sur la fiche, stockage Blob privé, redimensionnement navigateur (le code de la photo d'équipe existe : `staff.photo`), effacement avec la fiche | M | Moyen (image = donnée personnelle, sauvegardes) | `server/commands/cutnotes.js`, `store/blob.js` |
| Anniversaires | 🟡 | Champ `birthday` jour-mois, segment et carte « Anniversaires » (`espace/cards/Anniversaires.tsx`) ; pas de message automatique | Attention personnelle | Message d'anniversaire en classe marketing (consentement requis), avec ou sans cadeau | S | Faible | `server/commands/system.js`, `templates.js` |
| Parrainage | ✅ | `loyalty.referred`, lien signé `/?parrain=` | Acquisition | Rien | – | – | – |
| Fidélité | ✅ | Carte à tampons, départ à mi-carte, récompense plafonnée | Rétention | Rien | – | – | – |
| Clients à risque, acompte selon l'historique | ✅ | `server/domain/risk.js`, étiquette « de confiance » | Moins d'absences | Voir ligne suivante | – | – | – |
| Blocage de la réservation en ligne | ❌ | Aucun blocage de client trouvé (les « blocs » sont des créneaux) | Le client qui a manqué quatre fois ou a été agressif | Étiquette « réservation au salon seulement » : le site répond « appelle le salon » sans dire pourquoi. Durée limitée et raison notée (RGPD : pas de liste noire sans motif ni durée) | S | Moyen (juridique : motif légitime, pas de discrimination) | `server/domain/policy.js`, `routes-public.js` |
| Frais d'absence, empreinte de carte | 🟡 | `deposits.noShowFeeCents`, `stripe.js` (mode `setup`, `offSession`) ; étape de réservation et action « facturer » absentes (roadmap) | Le levier le plus efficace contre les absences sans faire payer d'acompte aux habitués | Finir : empreinte à la réservation, bouton sur un rendez-vous « absent », clause CGV qui s'active seule (déjà prévu) | M | Moyen (litiges bancaires, CGV) | `routes-public.js`, `server/commands/payments.js`, `public/cgv.html` |
| Comptes famille (père et fils) | ❌ | Un numéro = une fiche ; `clients.js` l. 171 traite l'e-mail partagé, pas le numéro | Très courant en barbershop : le père réserve pour ses deux fils avec son numéro | « Réserver pour un proche » : fiches rattachées à un numéro payeur, prénom distinct, historique séparé, SMS au parent | M | Moyen (fusions, import, espace client) | `server/commands/clients.js`, `agenda.js` |
| Réservation groupée (deux coupes à la suite ou en parallèle) | ❌ | Non trouvé | Mariages, père + fils, groupe d'amis | Deux créneaux liés dans une seule réservation, annulables ensemble | M | Moyen | `availability.js`, `web/src/client/booking.tsx` |
| Liste d'attente | 🟡 | Par jour, avec plage horaire (`waitlist.added` : `from`, `to`), offre 30 minutes | Remplir les annulations | Fenêtre sur plusieurs jours (roadmap) ; liste d'attente « dès que possible avec mon barbier » | S | Faible | `server/commands/agenda.js` |
| File sans rendez-vous | ✅ | `queue.added`, SMS « c'est presque ton tour » | Atout face à Planity | Rien | – | – | – |
| Doublons et fusion | ✅ | `/clients/duplicates`, `client.merged` | Fichier propre | Rien | – | – | – |
| Préférences de service | 🟡 | Barbier préféré dans l'espace client | Accueil | Choix fermés : boisson, conversation ou silence, musique. Petit, mais mémorable | S | Faible | `clients.js` (`tags`) |
| Réclamation et geste commercial | ❌ | Remise avec raison ; pas de suivi « client mécontent » | Rattraper un client avant l'avis négatif | Étiquette « à rappeler » avec échéance dans Relances › Demandes | S | Faible | `server/commands/inquiries.js` |

### 3.5 Communication

| Sujet | État | Preuve | Valeur | Recommandation | Effort | Risque | Où |
|---|---|---|---|---|---|---|---|
| Confirmation SMS et e-mail avec fichier agenda | ✅ | `mails.js`, `server/lib/ics.js` | Standard du marché | Rien | – | – | – |
| **Rappel par e-mail** | ❌ | `system.js` l. 33-39 : rappel seulement si `a.sms` ; `mails.js` ne connaît que réservation et annulation ; noté dans `docs/reponse-jessica.md` | Client sans SMS (refus, numéro étranger hors `countries`, panne du fournisseur) : aucun rappel. L'e-mail est gratuit | Rappel e-mail la veille pour toute fiche avec e-mail, en plus du SMS ou à sa place ; secours automatique par e-mail quand le SMS échoue | S | Faible | `server/commands/system.js`, `server/domain/mails.js` |
| Trou du rappel pour les réservations tardives | 🟡 | `createdToday` (l. 34) saute le rappel d'un rendez-vous pris après l'heure du rappel ; `reminder2h` est à `false` par défaut | Les réservations de dernière minute sont celles qui manquent le plus | Activer `reminder2h` par défaut pour les rendez-vous qui n'ont pas eu le rappel de la veille | S | Faible | `server/settings/messages.js`, `system.js` |
| Horaires de rappel réglables | 🟡 | Veille à heure fixe (8-21 h) et 2 h avant | Suffisant | Option « 48 h avant » pour les prestations longues ou avec acompte ; rappel demandant une confirmation (« réponds OUI ») quand le téléphone du salon est la route d'envoi | S | Faible | `system.js`, `sms-inbound.js` |
| Modèles modifiables, compteur d'un SMS | ✅ | `settings.messages.templates`, alphabet GSM | Coût maîtrisé | Rien | – | – | – |
| WhatsApp | 🟡 | Via Brevo, messages de service seulement, SMS en secours (`server/messaging/whatsapp.js`) | Canal préféré d'une partie de la clientèle | Correct et prudent. Collecter l'accord WhatsApp à part (case dans l'espace client) ouvrirait les relances par ce canal | M | Juridique moyen | `settings/messages.js`, `me.js` |
| Réponses des clients | 🟡 | Seulement avec le téléphone du salon (Relances › Demandes) ; avec Brevo, l'expéditeur nommé n'accepte pas de réponse | Conversation à deux sens | Le dire clairement dans Canal d'envoi ; envisager un numéro long Brevo si le salon veut les réponses sans téléphone dédié | S | Faible | `reglages/sections/Messages.tsx` |
| Demande d'avis | ✅ | Une par trimestre, lien suivi, sans filtrage | Réputation Google | Rien | – | – | – |
| Relances manuelles au rythme du client | ✅ | `/api/v1/relances`, statistiques de retour | Remplissage | Rien | – | – | – |
| Relances automatiques | ❌ | Roadmap (« Smarter follow-ups ») | Le gérant n'y pense pas chaque semaine | Envoi hebdomadaire plafonné, avec aperçu dans le résumé du lundi et accord du gérant une fois pour toutes | M | Moyen (coût SMS, lassitude) | `tick-steps.js`, `commands/messages.js` |
| E-mail marketing | ❌ par choix | `templates.js` : marketing « never by e-mail » | Canal gratuit pour annoncer une fermeture, un nouveau barbier | Une lettre d'information simple (texte, lien de désinscription) pour les fiches consentantes avec e-mail | M | Juridique faible | `server/messaging/email.js` |
| Annonce à tous (fermeture exceptionnelle, déménagement) | ❌ | Non trouvé | Message de service à tous les clients ayant un rendez-vous dans la période | Bouton sur une fermeture : « prévenir les clients concernés » (existe pour l'absence d'un barbier, pas pour le salon) | S | Faible | `server/commands/shop.js` (`addClosure`) |
| Alertes avant expiration (carte cadeau, carnet, récompense) | ❌ | Non trouvé dans `system.js` | Évite la déception à la caisse et relance une visite | Message de service 30 jours avant | S | Faible | `system.js` |
| Heures calmes, dimanche, jours fériés | ✅ | `messages.quiet`, `shared/sms.js` (`frHoliday`) | Respect du client | Rien | – | – | – |
| Langues | ❌ | Tout en français, tutoiement | Marseille : clientèle touristique et anglophone | Modèles en anglais selon l'indicatif ou la langue du navigateur à la réservation | M | Faible | `templates.js` |
| Choix du ton (tu / vous) | ❌ | Tutoiement dans les modèles par défaut | Certains clients plus âgés | Les modèles sont modifiables : suffisant | – | – | – |

### 3.6 Argent

| Sujet | État | Preuve | Valeur | Recommandation | Effort | Risque | Où |
|---|---|---|---|---|---|---|---|
| Acomptes (seuil, pourcentage, selon le risque) | ✅ | `settings/deposits.js`, `policy.js` | Moins d'absences | Rien | – | – | – |
| Acompte gardé ou remboursé après annulation | ✅ | Caisse › À traiter (`payments/:id/keep` ou `refund`) | Décision tracée | Règle automatique selon le délai d'annulation, avec la main laissée au gérant | S | Faible | `commands/payments.js` |
| Remboursements | ✅ | Par le fournisseur d'origine, clé d'idempotence | Pas de double remboursement | Rien | – | – | – |
| Cartes cadeaux (caisse et en ligne) | ✅ | `giftcard.issued / redeemed / voided`, `/carte-cadeau` | Trésorerie en fin d'année | Carte au montant d'une prestation (« une coupe + barbe »), modèle imprimable soigné | S | Faible | `routes-giftshop.js` |
| Carnets | ✅ | `pack.sold / used`, expiration | Fidélisation | Vente en ligne (roadmap) | M | Faible | `routes-public.js` |
| Abonnements | ✅ | Stripe Billing, règles hebdomadaires, présence | Revenu récurrent | Pause (vacances, blessure) : absente en v1, demande classique | M | Moyen (contrat) | `commands/memberships.js` |
| Paiement fractionné | ✅ | Jusqu'à 6 moyens par ticket | Courant | Rien | – | – | – |
| Terminal de carte intégré | ❌ | `caps.terminal: false` (`stripe.js` l. 113) ; méthode « Carte (TPE) » déclarative | Supprime une saisie et les erreurs de montant | Stripe Terminal ou SumUp (roadmap) | M à L | Moyen (matériel, certification du parcours) | `server/payments/` |
| Rapprochement du TPE | ❌ | Rien dans `Closing.tsx` ni `cash.js` | Aujourd'hui, un ticket marqué « carte » alors que le client a payé en espèces n'est vu par personne | À la clôture, saisir le total de télécollecte du TPE ; écart affiché et gardé avec le Z | S | Faible | `caisse/Closing.tsx`, `commands/sales.js` (`closeDay`) |
| Rapprochement Stripe | ✅ | `payout.recorded`, frais par paiement | Banque = compta | Rien | – | – | – |
| Rapprochement bancaire global | ❌ | Non trouvé | Vérifier que les dépôts d'espèces et les remises carte arrivent en banque | Hors périmètre : c'est le rôle du logiciel comptable. Fournir seulement les totaux attendus par jour | S | Faible | export |
| Tiroir-caisse, fond de caisse, écart | ✅ | Comptage par coupure, écart et note | Discipline | Seuil d'alerte sur l'écart et suivi des écarts par personne ayant clôturé | S | Faible | `Pilotage` (`pilotage/Cash.tsx`) |
| Dépenses du salon | ❌ | Seules les sorties d'espèces existent | Marge réelle dans Pilotage | Hors périmètre ; au plus loyer et charges fixes saisis une fois pour afficher un seuil de rentabilité (voir idées) | S | Faible | `Pilotage.tsx` |
| Prix à durée variable, suppléments | 🟡 | Remise et lignes libres non vérifiées | « Supplément cheveux longs » | Vérifier qu'une ligne de supplément existe au catalogue ; sinon l'ajouter | S | Faible | `Catalogue.tsx` |
| Vente à distance de formations | 🟡 | `settings/trainings.js`, demandes reçues (`inquiries`) | Second métier du salon | Acompte ou paiement en ligne de la formation, facture (voir 3.1) | M | Faible | `routes-inquiries.js` |

### 3.7 Opérations

| Sujet | État | Preuve | Valeur | Recommandation | Effort | Risque | Où |
|---|---|---|---|---|---|---|---|
| Produits et stock | ✅ | Mouvements, seuil, inventaire, marge, valeur | Pas de rupture | Lecture du code-barres à la caméra (le champ « Référence / code-barres » existe, `Catalogue.tsx` l. 430) | S | Faible | `Catalogue.tsx`, `Checkout.tsx` |
| Consommables de cabine (lames, serviettes, produits techniques) | ❌ | Le stock ne suit que la vente | Ce sont eux qui manquent un samedi | Produits « usage interne » non vendus, décrémentés à l'inventaire, mêmes alertes | S | Faible | `commands/catalog.js` |
| Commandes fournisseurs | ❌ | Roadmap | Réassort en deux minutes | Fiche fournisseur (nom, e-mail, délai), bon de commande généré depuis « À commander », réception en un geste | M | Faible | `Catalogue.tsx` |
| Horaires, fermetures, ouvertures exceptionnelles, jours fériés | ✅ | `settings/hours.js` (`closures`, `Opening`), fériés en un geste | Site toujours juste | Synchroniser les horaires vers la fiche Google (voir idées) | M | Moyen (API Google) | – |
| Multi-appareils | ✅ | Postes enrôlés, téléphones personnels, verrouillage à 4 minutes | Sécurité sans friction | Rien | – | – | – |
| Hors ligne | 🟡 | Indicateur « à jour de 10 h 32 » (`ui/kit.tsx`), écritures idempotentes, 10 minutes de lecture si la base tombe ; aucun service worker, pas de file locale (roadmap) | Le Wi-Fi d'un salon tombe plusieurs fois par an | Étape 1 : service worker qui garde l'agenda du jour en lecture. Étape 2 : file locale des tickets. Voir aussi « agenda de secours » en 3.8 | M puis L | Moyen (caisse : ordre et numérotation) | `web/src/comptoir/state.tsx` |
| Impression de l'agenda du jour | ❌ | Aucune impression dans `Agenda.tsx` | Filet de sécurité le plus simple | Page imprimable « journée » par fauteuil | S | Faible | `Agenda.tsx` |
| Sauvegardes et exercice de restauration | 🟡 | Nocturne, chiffrée, 30 jours + 12 mois ; exercice prévu une fois à J+7 | Un exercice unique vieillit | Rappel trimestriel dans Santé (« dernier exercice de restauration : il y a 5 mois ») avec une case à cocher journalisée | S | Faible | `routes-health.js`, journal technique |
| Clés hors de Vercel | 🟡 | `BACKUP_KEY` et `LX_SIGN_KEY` à garder « dans le gestionnaire de mots de passe » | Sans la clé, aucune sauvegarde ne s'ouvre | Question trimestrielle au gérant : « sais-tu où est ta clé de sauvegarde ? » ; nommer une deuxième personne dépositaire | S | Faible | `MiseEnRoute.tsx` |
| Journal d'audit | ✅ | Réglages › Journal, filtres par type et acteur | Qui a fait quoi | Rien | – | – | – |
| Dépendance au prestataire | 🟡 | Tout changement de variable passe par Vercel et un redéploiement | Si le prestataire est indisponible, le gérant est bloqué | Document « reprise par un tiers » d'une page, accès de secours au compte Vercel, contact de remplacement | S | Faible | `docs/` |
| Liste de mise en route | ✅ | Mise en route, Nouveautés, Jour J | Démarrage guidé | Rien | – | – | – |
| Aide dans l'application | 🟡 | Visites guidées par page et par rôle (`guide/steps/*`) | Formation initiale | Manquent : recherche dans l'aide (« comment faire un avoir »), fiches « que faire si… », bouton « signaler un problème » qui joint la version et l'heure | M | Faible | `Palette.tsx` (la recherche ⌘K peut héberger l'aide) |
| Routines d'ouverture et de fermeture | ❌ | La doc décrit matin / soir, l'écran non | Rien oublié quand le gérant est absent | Liste d'ouverture et de fermeture cochable (fond de caisse, comptage, Z, lumière, alarme), personnalisable | S | Faible | `Pilotage.tsx` ou `Espace.tsx` |
| Plusieurs salons | ❌ | Roadmap | Seulement si un second salon ouvre | Ne pas construire avant | L | – | – |
| Matériel (tondeuses, entretien, hygiène) | ❌ | Rien | Affûtage, désinfection, contrôle | Rappels récurrents simples ; faible priorité | S | Faible | – |

### 3.8 Fiabilité

| Sujet | État | Preuve | Valeur | Recommandation | Effort | Risque | Où |
|---|---|---|---|---|---|---|---|
| Page Santé | ✅ | Planificateur, webhook Stripe, messages en échec, sauvegarde, intégrité, adresse (`routes-health.js`) | Diagnostic en un écran | Rien | – | – | – |
| Surveillance externe | 🟡 | UptimeRobot et cron-job.org décrits dans la doc, à configurer à la main ; Sentry sur la roadmap | Savoir avant les clients | Rendre l'état de la surveillance visible dans Santé (case « UptimeRobot configuré » et dernière alerte) ; brancher un rapport d'erreurs | S | Faible | `routes-health.js` |
| **Alerte au gérant en journée** | 🟡 | Le résumé du soir cite les textes en échec et la sauvegarde (`steps/digest.js`) ; rien de poussé avant | Un fournisseur SMS en panne à 9 h n'est su qu'à 20 h : une journée de rappels perdue | Alerte immédiate (e-mail, et SMS par l'autre route quand il y en a une) quand : 5 SMS de suite échouent, le cron est muet 30 minutes en heures d'ouverture, la sauvegarde a plus de 36 h, un webhook Stripe est refusé, un litige arrive | S | Faible (anti-rafale : une alerte par cause et par jour) | `server/http/scheduler.js`, `server/domain/notices.js` |
| Panne du fournisseur SMS | 🟡 | Téléphone du salon → Brevo en secours pour les messages de service ; pas l'inverse ; pas de secours e-mail | Rappels qui partent quand même | Secours e-mail pour confirmation et rappel quand le SMS échoue ou expire (« trop tard ») ; liste « à appeler » du matin pour les clients sans rappel | S | Faible | `scheduler.js`, `Relances.tsx` |
| Crédit SMS épuisé | ❌ | La doc dit « vérifie le crédit du fournisseur » | Panne la plus fréquente avec Brevo en prépayé | Lire le solde Brevo par l'API et alerter sous un seuil | S | Faible | `server/messaging/sms.js`, `routes-channels.js` |
| Internet coupé au salon | 🟡 | « Pas de connexion », réessai sûr ; le script de démo promet « rien n'est perdu » | Continuer à travailler | Voir 3.7 : agenda du jour en cache et impression. Et un e-mail quotidien à 7 h avec l'agenda du jour en pièce jointe : lisible sur n'importe quel téléphone en 4G | S | Faible | `steps/digest.js` |
| Base de données coupée | ✅ | Lecture seule 10 minutes, bandeau, consignes papier (`operations.md` § Incidents) | Bien pensé | Fournir le « ticket papier » imprimable à garder sous le comptoir | S | Faible | `public/` |
| Limites de débit par instance | 🟡 | En mémoire, par instance (`security.md`) | Sécurité | Roadmap : partagées. Priorité basse à cette échelle | M | Faible | – |
| Démarrage à froid avec un long journal | 🟡 | Instantanés d'état prévus au-delà de 500 000 événements | Rapidité dans 2 à 3 ans | Suivre la durée de démarrage dans Santé pour voir venir | S | Faible | `routes-health.js` |
| Procédure d'incident | 🟡 | Tableau dans `operations.md`, en anglais, pour le prestataire | L'équipe ne lit pas ce document | Une fiche plastifiée en français « Si ça ne marche pas » (5 cas), reprise dans l'aide | S | Faible | `docs/`, aide |
| Tests | ✅ | 83 fichiers de tests unitaires, flux API, bout en bout démo et production | Confiance dans les versions | Non exécutés pendant cet audit | – | – | – |

## 4. Position face aux concurrents

Comparaison de mémoire, à revérifier avant de s'en servir dans un argumentaire.

| Capacité | Le Comptoir | Planity Pro | Fresha | Booksy | Square Appointments | Zenoti |
|---|---|---|---|---|---|---|
| Place de marché qui amène des clients | Non (site propre, Google à brancher) | Oui | Oui | Oui | Non | Non |
| Caisse certifiée en France | Non (caisse de gestion) | Oui | À vérifier | À vérifier | À vérifier | À vérifier |
| Terminal de carte intégré | Non | Oui | Oui | Oui | Oui | Oui |
| Empreinte de carte et frais d'absence | À moitié | Oui | Oui | Oui | Oui | Oui |
| Photos sur la fiche client | Non | Limité | Oui | Oui | Limité | Oui |
| Pointage et paie | Non | Limité | Oui | Limité | Oui | Oui |
| Commandes fournisseurs | Non | Oui | Oui | Limité | Oui | Oui |
| Rappel e-mail | Non | Oui | Oui | Oui | Oui | Oui |
| Abonnement mensuel conforme au droit français | Oui | Non ou limité | Générique | Générique | Générique | Générique |
| File sans rendez-vous avec attente en direct | Oui | Non | Limité | Limité | Non | Oui |
| Journal vérifiable, données exportables et effaçables | Oui, très fort | Non | Non | Non | Non | Non |
| Commission prélevée sur les nouveaux clients | Aucune | Selon l'offre | Oui | Selon l'offre | Non | Non |
| SMS depuis le numéro du salon, réponses lues | Oui | Non | Non | Non | Non | Non |

Lecture : Le Comptoir gagne sur la propriété des données, le droit français des abonnements et la relation directe. Il perd sur le matériel (terminal, caisse certifiée), la visibilité (place de marché) et le social. Le rappel e-mail et l'empreinte de carte sont les deux écarts les moins chers à combler.

## 5. Idées hors cadre

Huit idées réalistes, qui s'appuient sur ce que le dépôt sait déjà faire.

1. **Le fauteuil qui se remplit tout seul.** Quand une annulation libère un créneau dans les 24 h et que la liste d'attente est vide, proposer le créneau par SMS aux trois clients consentants dont le rythme tombe cette semaine et qui ont ce barbier comme habituel. Le premier qui clique l'a (le mécanisme d'offre à 30 minutes existe : modèle `waitlist`). Effort M. Où : `server/commands/agenda.js`, `server/domain/rhythm.js`.

2. **Le brief du matin dans la poche.** À 7 h, chaque barbier reçoit sur son téléphone lié sa journée : premiers clients, ceux qui viennent pour la première fois, la note de coupe de chacun, l'anniversaire du jour, les trous à remplir. Le gérant reçoit la version salon, avec l'agenda complet en pièce jointe, qui sert aussi de secours si internet tombe. Effort S. Où : `server/commands/steps/digest.js`, `server/domain/espace.js`.

3. **Le prix du fauteuil vide.** Dans Pilotage, traduire le taux de remplissage en euros : « mardi 14 h-16 h a coûté 310 € ce mois-ci », avec une action directe (relance ciblée sur ce créneau, ou prix réduit en heure creuse affiché sur le site). Aucun concurrent grand public ne chiffre le vide. Effort M. Où : `server/domain/cockpit.js`, `server/domain/insights.js`.

4. **« Comme la dernière fois ».** À la réservation, un client connu voit un bouton unique : même prestation, même barbier, au rythme habituel, trois créneaux. À la caisse, l'écran de confirmation le propose déjà ; le porter sur le site et dans le SMS de relance réduit la réservation à un geste. Effort S à M. Où : `web/src/client/booking.tsx`, `routes-public.js`.

5. **Le miroir de la caisse certifiée.** Plutôt que viser NF525 tout de suite, photographier le Z papier de la caisse certifiée le soir : le gérant saisit trois chiffres, la photo est gardée avec le Z du Comptoir, l'écart est suivi dans le temps. Cela rend la double saisie contrôlable, donne au comptable une pièce propre, et documente la bonne foi en cas de contrôle. Effort S. Où : `caisse/Closing.tsx`, `store/blob.js`.

6. **La carte du client vue par le barbier, en 5 secondes.** Quand un client passe « arrivé », le poste affiche plein écran, 5 secondes : prénom, nombre de visites, dernière coupe, note de coupe, boisson préférée, « carte 8/9 : la prochaine est offerte ». Le barbier accueille par le prénom avec la bonne phrase. C'est du luxe hôtelier avec des données déjà présentes. Effort S. Où : `web/src/comptoir/pages/Espace.tsx`, `espace/cards/Prochain.tsx`.

7. **Le rétroviseur des clients perdus.** Chaque mois, la liste des habitués (5 visites ou plus) qui ont dépassé deux fois leur rythme, par barbier, avec la dernière note et le dernier ticket. Pas un SMS de masse : un appel ou un message personnel du barbier, depuis le numéro du salon, et un suivi « revenu / pas revenu » à 30 jours. La perte d'un habitué coûte plus cher que n'importe quelle campagne. Effort S. Où : `server/domain/insights.js`, `Relances.tsx`.

8. **Le salon qui s'explique tout seul.** Un mode « remplaçant » : un barbier en extra ou un apprenti qui arrive un samedi reçoit un QR, se lie en deux minutes, suit une visite guidée de 3 minutes limitée à son rôle (les visites par rôle existent) et dispose d'un accès qui expire seul le soir. Zéro mot de passe à donner, zéro oubli de révocation. Effort S à M. Où : `server/commands/team.js` (lien téléphone, expiration), `web/src/comptoir/guide/`.

Deux pistes de plus, moins mûres : synchroniser horaires et fermetures vers la fiche Google du salon (une seule source de vérité pour les horaires), et un seuil de rentabilité dans Pilotage (« le loyer et les salaires du mois sont couverts depuis le 19 »).

## 6. Top 15 classé

Classement par valeur pour le salon rapportée à l'effort, en tenant compte du risque.

| Rang | Chantier | Pourquoi maintenant | Effort | Risque | Où |
|---|---|---|---|---|---|
| 1 | Rappel par e-mail, secours e-mail quand le SMS échoue, rappel 2 h pour les réservations tardives | Trou identifié, gratuit à l'usage, réduit directement les absences | S | Faible | `server/commands/system.js`, `server/domain/mails.js` |
| 2 | Alertes immédiates au gérant (SMS en échec, cron muet, sauvegarde vieille, webhook refusé, crédit SMS bas) | Aujourd'hui une panne du matin se découvre le soir | S | Faible | `server/http/scheduler.js`, `server/domain/notices.js` |
| 3 | Corriger la promesse « pack envoyé au comptable » (livrer ou masquer), masquer l'e-reporting inactif | L'écran affirme quelque chose que le serveur ne fait pas | S (masquer) ou M | Moyen | `Compta.tsx`, `server/commands/steps/` |
| 4 | Finir l'empreinte de carte et les frais d'absence | La moitié est construite ; levier n°1 contre les absences sans pénaliser les habitués | M | Moyen | `routes-public.js`, `commands/payments.js`, `public/cgv.html` |
| 5 | Rapprochement de fin de journée : total du TPE et Z de la caisse certifiée | Rend la double saisie contrôlable, détecte les erreurs de moyen de paiement | S | Faible | `caisse/Closing.tsx` |
| 6 | Agenda de secours : impression de la journée, e-mail de 7 h, agenda du jour en cache | Réponse concrète à « et si internet tombe ? » | S | Faible | `Agenda.tsx`, `steps/digest.js` |
| 7 | Anonymisation à 3 ans automatique et plafonnée, purge des paiements abandonnés | Promesse de la page confidentialité tenue sans y penser | S | Moyen | `server/commands/tick-steps.js` |
| 8 | Types d'absence et compteurs (congé, maladie, formation) dans le relevé et l'export paie | Base de la paie et du suivi des congés | M | Faible | `server/commands/team.js`, `statement.js` |
| 9 | Livre de caisse (CPT-04) avec motifs fixes, et reversement des pourboires carte | Justifier chaque sortie d'espèces et chaque pourboire | M | Faible | `server/domain/ledger.js`, `Closing.tsx`, `Rapports.tsx` |
| 10 | Réserver pour un proche (père et fils) et réservation groupée | Cas quotidien en barbershop, mal servi par un numéro = une fiche | M | Moyen | `server/commands/clients.js`, `agenda.js`, `booking.tsx` |
| 11 | Photos de coupe avec consentement | Attendu par les clients, fort pour refaire la coupe | M | Moyen | `server/commands/cutnotes.js`, `store/blob.js` |
| 12 | Pointage au PIN et feuille d'heures mensuelle | Protection sociale de l'employeur ; à cadrer avec le comptable | M | Moyen | nouveau `server/commands/timeclock.js` |
| 13 | Facture nominative à la demande | Clients professionnels et formations | M | Moyen | `caisse/Sales.tsx`, `server/commands/sales.js` |
| 14 | Aide cherchable et fiches « que faire si… » en français, bouton « signaler un problème » | L'équipe ne lit pas `operations.md` | M | Faible | `Palette.tsx`, `web/src/comptoir/guide/` |
| 15 | Relances automatiques plafonnées, message d'anniversaire, alerte avant expiration (carte cadeau, carnet, récompense) | Remplissage sans effort du gérant | M | Moyen (coût SMS) | `tick-steps.js`, `system.js`, `templates.js` |

Hors classement, à décider plutôt qu'à construire : la certification de la caisse ou l'intégration d'un terminal (L, structurant), la location de fauteuil (seulement si le cas existe), les commandes fournisseurs (M, confort), plusieurs salons (attendre).

## 7. Points restés à vérifier

- `compta.autoSend` et `compta.ereporting` : aucune lecture trouvée côté serveur par recherche de texte. À confirmer par un test avant de corriger l'écran.
- Mention de franchise de TVA sur le ticket : non vérifiée.
- Ligne de supplément libre au ticket : non vérifiée.
- Contenu exact de l'export `payroll` et du relevé face au gabarit du cabinet de paie : à comparer avec un vrai fichier attendu.
- Tous les repères juridiques de ce document (seuil de la note, régime des pourboires, durée du travail, calendrier de l'e-reporting, fin de l'auto-attestation des caisses) : à valider par le comptable ou un juriste.
- Le tableau des concurrents : de mémoire.
