# Mise en ligne : la page de demain

Ce que tu peux ouvrir **demain matin** au salon, dans l’ordre, avec qui fait quoi et comment le vérifier. Le détail technique reste dans [operations](operations.md) ; la bascule du site public (domaine, SMS, WordPress) suit sa liste « Jour J », **un lundi, salon fermé**, jamais un samedi.

**À retenir avant tout.** Le Comptoir est une **caisse de gestion** : chaque vente passe aussi sur ta caisse certifiée, qui imprime le ticket légal et dont le Z est le Z fiscal ([note fiscale](security.md#fiscal-note-france)). En production, la page Caisse, les tickets, les avoirs, les Z imprimés, les exports de Rapports et le mail au comptable le disent. Si le Comptoir tombe, tu continues sur ta caisse certifiée : rien de légal ne dépend de lui.

## Ce qui marche demain sans aucun compte externe

« Sans compte externe » : ni Stripe, ni Brevo, ni cron-job.org, ni changement de domaine. Seulement le projet Vercel, sa base (Neon, UE) et son stockage Blob privé, en mode `production`.

| Marche dès demain | Ne marche pas encore, et ce que tu vois à la place |
|---|---|
| Le Comptoir : agenda, passages, fiches clients, équipe et codes, catalogue, chiffres. | **Messages aux clients** : en mode téléphone, ils arrivent sur l’écran Messages, un geste chacun depuis le WhatsApp du salon (Relances › Messages envoyés : « à envoyer depuis l’écran Messages »). **E-mails** : tant que la boîte IONOS n’est pas branchée, ils attendent (« attend un fournisseur ») ; ceux de plus de 6 h ne partiront jamais. |
| La caisse : espèces (tiroir, monnaie rendue), carte sur **ton** terminal, paiement mixte, pourboire, remise, carte cadeau vendue puis utilisée, carnet, avoir (par ligne, par montant, réparti), comptage, clôture Z. | **Acompte en ligne et QR** : aucun acompte n’est demandé, le bouton QR de la caisse est grisé (« Branche Stripe pour le QR »), Réglages › Paiements dit « simulé ». Carte cadeau et abonnement en ligne : éteints. |
| Le site de réservation sur l’adresse provisoire de Vercel, sans acompte : le rendez-vous est confirmé tout de suite. | **Ton vrai domaine** : il montre encore WordPress. Google n’indexe pas la nouvelle adresse (`LX_INDEX` éteint). |
| Les clôtures mensuelles, la TVA du mois, les exports CSV et le fichier d’écritures du comptable. | **Rappels à l’heure** sans personne devant le Comptoir : ils ne partent qu’à la première visite tant que la tâche cron n’existe pas (Mise en route ⑪ « à faire »). |
| La sauvegarde chiffrée de la nuit (Blob et `BACKUP_KEY` sont dans Vercel, pas des comptes externes). | **Clôture signée hors des données** : sans `LX_SIGN_KEY`, la clé est gardée avec les données et le Comptoir le signale. |

Un réglage à moitié fait est dit en toutes lettres, jamais par une erreur : Réglages › Données › Système (et `GET /api/v1/health`, gérant seulement) listent « Stripe n’est pas connecté », « STRIPE_SECRET_KEY est posée sans STRIPE_WEBHOOK_SECRET », « Stripe en mode test », « Aucun fournisseur SMS », « PUBLIC_URL doit être l’adresse complète du site, en https », « Aucun stockage durable », « SETUP_TOKEN est toujours défini ».

## La liste, dans l’ordre

| # | Quoi | Qui | Où | Durée | Vérifier |
|---|---|---|---|---|---|
| 1 | Projet en région Paris (`cdg1`), base Neon (UE), stockage Blob **privé**. | prestataire | Vercel › Storage | 10 min | Les deux sont reliés à « Production » ; `DATABASE_URL` et `BLOB_READ_WRITE_TOKEN` existent. |
| 2 | Secrets : `LX_MODE=production`, `SESSION_SECRET`, `SETUP_TOKEN`, `BACKUP_KEY`, `LX_SIGN_KEY`, `CRON_SECRET`. `BACKUP_KEY` et `LX_SIGN_KEY` rangées **hors de Vercel**. | prestataire | Vercel › Settings › Environment Variables (type Sensitive) | 10 min | Voir le tableau des variables ci-dessous. |
| 3 | Déployer. | prestataire | Vercel › Deployments | 5 min | `https://<adresse>/api/public/live` répond `200` ; `/comptoir` affiche « Bienvenue. Crée le compte du gérant ». Un `503 Configuration incomplète : SESSION_SECRET` = étape 2 à refaire. |
| 4 | Créer ton compte avec le code d’installation : prénom, e-mail, mot de passe (10 caractères), code à 4 chiffres. | gérant | `/comptoir` | 3 min | Tu arrives sur l’Accueil. |
| 5 | Supprimer `SETUP_TOKEN`, redéployer. | prestataire | Vercel | 3 min | Réglages › Données › Système ne dit plus « SETUP_TOKEN est toujours défini ». |
| 6 | « Le salon L’Architecte, en un geste » : l’équipe et ses horaires, la carte et ses prix, les horaires du salon. | gérant | Réglages › Mise en route | 5 min | L’Agenda montre une colonne par barbier ; Mise en route coche « Horaires », « Carte » et « Équipe » (sauf les codes, étape 8). |
| 7 | Mentions : nom légal, SIRET, numéro de TVA, adresse. TVA par défaut 20 %. | gérant | Réglages › Le salon, Réglages › Paiements | 5 min | Elles sont en tête du ticket (Caisse › Ventes du jour › un ticket › Imprimer). |
| 8 | Un code par personne ; la tablette du comptoir enregistrée. | gérant | Équipe ; Réglages › Appareils › Enregistrer ce poste | 10 min | Chacun ouvre le Comptoir sur la tablette avec son code. |
| 9 | Tâche cron : `GET https://<adresse>/api/cron/tick` toutes les 5 min, en-tête `Authorization: Bearer <CRON_SECRET>`. | prestataire | cron-job.org | 5 min | Son historique affiche `200` (un `401` : l’en-tête est faux) ; Mise en route ⑪ passe au vert. |
| 10 | Première sauvegarde, téléchargée et rangée hors de Vercel. | gérant | Réglages › Données › Sauvegardes › Sauvegarder maintenant | 3 min | « Dernière sauvegarde : à l’instant ✓ » ; Santé n’a rien en rouge. |
| 11 | Répétition : une vente libre de 1 € par carte, puis son avoir de 1 €. Ils restent au journal (T000001, A000001) et s’annulent. | gérant | Caisse › Vente libre ; Ventes du jour › le ticket › Rembourser | 5 min | Chiffre du jour 0 €, « remboursé 1 € » sur le ticket. |
| 12 | **Demain matin** : ouvrir la caisse avec le fond de caisse. Chaque vente passe aussi sur la caisse certifiée. | gérant, équipe | Caisse & clôture, ou le bouton Espèces du premier ticket | 2 min | « Espèces attendues dans la caisse » = ton fond de caisse. |
| 13 | **Demain soir** : compter la caisse, clôturer la journée. | gérant | Caisse & clôture | 5 min | Écart 0,00 € ; « Z0001 » scellé ; son CA TTC net est celui du Z de la caisse certifiée. |
| 14 | Surveillance : `https://<adresse>/api/public/live` toutes les 5 min, alertes sur vos deux téléphones. | prestataire | UptimeRobot | 5 min | Une alerte d’essai arrive. |

**Pas demain, et pourquoi.** Stripe attend l’activation du compte (pièce d’identité, IBAN : un à trois jours). Les SMS attendent le nom d’expéditeur validé par Brevo. Le domaine attend un TTL baissé 48 h avant et un lundi (Réglages › Connexion IONOS › Nom de domaine). Les rendez-vous déjà pris sur WordPress n’arrivent dans l’agenda qu’avec Réglages › Reprendre WordPress (premier passage : 15 min, aucun SMS ne part). Tant que WordPress prend les réservations, **coupe la réservation en ligne du nouveau site** (Réglages › Réservation › « Réservation en ligne ouverte ») : deux sites qui réservent le même fauteuil, c’est un doublon assuré.

## Les variables, et ce qui casse sans elles

Une variable changée ne compte qu’après un redéploiement.

| Variable | Sans elle |
|---|---|
| `LX_MODE=production` | Le serveur lance la **démo** : salon fictif, rien de réel. Bloquant. |
| `SESSION_SECRET` (64 caractères) | Toute l’API répond `503 Configuration incomplète : SESSION_SECRET`. La changer déconnecte tout le monde et casse les liens déjà envoyés. Bloquant. |
| `DATABASE_URL` (ou `POSTGRES_URL`), sinon `BLOB_READ_WRITE_TOKEN` | Aucun stockage durable : tout disparaît au redémarrage ; le Comptoir l’écrit dans ses avertissements. Bloquant. |
| `SETUP_TOKEN` | Impossible de créer le compte du gérant (« Code d’installation incorrect »). À retirer ensuite. |
| `BACKUP_KEY` (exactement 43) et `BLOB_READ_WRITE_TOKEN` | Pas de sauvegarde de nuit ; ligne rouge dans Réglages › Données. Sans la clé, aucune sauvegarde ne s’ouvre : garde-la hors de Vercel, ne la change jamais. |
| `LX_SIGN_KEY` (exactement 43) | Les clôtures sont signées avec une clé gardée à côté des données ; avertissement permanent. |
| `CRON_SECRET` (64) | `/api/cron/tick` répond 401 : pas de tâche cron, les SMS retenus la nuit ne partent qu’à la première visite, le résumé du soir peut sauter. |
| `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` | Aucun acompte en ligne, QR éteint, cartes cadeaux et abonnements en ligne éteints. La clé sans le secret : Stripe reste coupé, et c’est écrit. La caisse marche sans. |
| `SMS_PROVIDER` (`brevo`, `gateway` ou `twilio`) et ses identifiants (`BREVO_API_KEY`, `SMS_SENDER` ; `SMSGATE_USERNAME`, `SMSGATE_PASSWORD` ; `TWILIO_*`) | Aucun SMS ne part : confirmation, rappel, code de connexion client. À poser **le jour de la bascule seulement**. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (`EMAIL_REPLY_TO`) : la boîte IONOS, valeurs ci-dessous | Aucun e-mail : confirmations, alertes de panne, résumé du soir, pack du comptable restent dans la boîte d’envoi. |
| `WHATSAPP_TOKEN` et `WHATSAPP_PHONE_ID` (`WHATSAPP_SENDER`) | Pas de WhatsApp automatique : tout part par SMS. |
| `PUBLIC_URL=https://barberlarchitecte.com` | Les liens des SMS et le retour du paiement pointent sur l’adresse provisoire de Vercel. Sans `https://` ou avec un chemin : avertissement, liens faux. À poser à la bascule. |
| `LX_INDEX=1` | Google n’indexe pas le site. À poser à la bascule. |

## IONOS : la boîte mail et le domaine

Tout est dans **Réglages › Connexion IONOS**, avec un bouton « Copier » par valeur. Vérifié sur les pages d’IONOS et de Vercel le 14 novembre 2026 (liens dans [messages-whatsapp](messages-whatsapp.md#sources-lues-le-13-novembre-2026--ionos-et-vercel-relues-le-14-novembre-2026)).

- **E-mail, dès maintenant** (le gérant, 10 min) : `SMTP_HOST=smtp.ionos.fr`, `SMTP_PORT=465` (587 si le test dit que le serveur ne répond pas), `SMTP_USER` = l’adresse complète de la boîte, `SMTP_PASS` = son mot de passe (Sensitive ; IONOS ne le montre pas, il se change dans le compte IONOS › E-mail), `EMAIL_FROM=Barber L'Architecte <rdv@barberlarchitecte.com>` (même domaine que la boîte). Redéploie, puis « Envoyer un e-mail test ». Avant la bascule, les e-mails aux clients attendent ; le test et tes alertes partent. SPF et DKIM : IONOS les met lui-même tant que les DNS restent chez lui ; « Vérifier SPF et DKIM » le confirme.
- **Domaine, le lundi de la bascule seulement** (le prestataire) : 48 h avant, TTL de `@` et `www` à 300 s et les valeurs actuelles notées. Le jour J, chez IONOS : `A @` = l’adresse que Vercel affiche pour le projet (Settings › Domains ; souvent `76.76.21.21`, `216.198.79.1` pour un projet récent), `CNAME www` = la cible que Vercel affiche pour www (du type `xxxx.vercel-dns-017.com`), les autres A et AAAA de `@` supprimés. **Les MX ne bougent jamais** (la boîte mail), ni les serveurs de noms : Vercel n’en a pas besoin. « Vérifier » dit si le domaine pointe vers le nouveau site, encore vers l’ancien, ou à moitié.

## Stripe : la liste exacte

1. **Compte** (gérant, stripe.com, 20 min puis l’attente de l’activation) : au nom légal du salon, SIRET, IBAN, pièce d’identité du gérant. Réglages › Virements : **automatiques, quotidiens**.
2. **Clé** (prestataire, Stripe › Développeurs › Clés API) : la clé secrète `sk_live_…` dans `STRIPE_SECRET_KEY` (Vercel, Sensitive, Production). Pour répéter : `sk_test_…`, que le Comptoir signale « Stripe en mode test ».
3. **Webhook** (prestataire, Stripe › Développeurs › Webhooks › Ajouter un endpoint) : adresse `https://barberlarchitecte.com/api/pay/stripe/webhook` (l’adresse provisoire avant la bascule ; le mode test a son propre endpoint). Événements, les mêmes que le bloc à copier de Réglages › Paiements : `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `payout.paid`, `payout.reconciliation_completed`, et pour les abonnements `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. **Secret du webhook** : son `whsec_…` dans `STRIPE_WEBHOOK_SECRET` (plusieurs secrets séparés par des virgules pendant un changement). Redéployer.
5. **Vérifier** (gérant, 10 min) : Réglages › Paiements dit « réel » ; une prestation « Test acompte » à 1 € avec 1 € d’acompte, réservée sur le site avec ta carte, arrive payée dans l’agenda ; annulée, elle est remboursée chez Stripe ; Santé affiche le dernier retour de Stripe. Puis enregistre Réglages › Réservation : les CGV datées de ce jour annoncent l’acompte.

Ce que le serveur garantit, vérifié par les tests : le montant de l’acompte est calculé chez nous (ce que le navigateur envoie est ignoré), en centimes entiers et en euros (un acompte au pourcentage est arrondi à l’euro) ; un avis de Stripe mal signé, trop vieux ou d’un autre montant ne confirme rien ; le même avis reçu dix fois ne paie qu’une fois, même après un remboursement ; un acompte payé après l’expiration du créneau est remboursé une seule fois ; une annulation dans les délais rembourse en entier ; aucun test n’appelle Stripe.

## Ce que disent les chiffres

- **Le Z** : CA TTC brut − avoirs = CA TTC net = HT + TVA de chaque taux. Total des règlements (carte, espèces, en ligne, acompte, carte cadeau) = CA TTC net + pourboires + cartes cadeaux vendues. Le mois est la somme de ses Z.
- **La TVA** est sortie du prix TTC ticket par ticket et taux par taux, arrondie au centime : sur un mois, elle peut différer de quelques centimes d’un calcul fait sur le total.
- **Carte cadeau** : à la vente, une dette envers le client (0 % de TVA, hors chiffre d’affaires) ; la TVA et le chiffre comptent le jour où elle paie une prestation. Une carte annulée et remboursée sort de la dette, pas du chiffre.
- **Pourboire** : jamais dans le chiffre ni dans la TVA ; il est dû au barbier.
- **Acompte en ligne** : sa TVA est due le jour où il est payé ; le ticket du rendez-vous porte le prix entier et la reprend. Sur deux mois, il n’est déclaré qu’une fois. Un acompte gardé après une absence devient un ticket « Acompte conservé », au taux de TVA par défaut du salon.
- **Avoir** : daté du jour où il est fait. Un ticket d’une journée clôturée se corrige le lendemain ; l’ancien Z ne bouge jamais. Après le Z du jour, l’avoir se fait le lendemain.
- **Jours et mois** : ceux de Paris, heure d’été comprise ; un ticket de 23 h 59 le 31 est dans le mois, celui de 0 h 00 dans le suivant.
- **Fichiers** : CSV en UTF-8 avec BOM, point-virgule, virgule décimale (ils s’ouvrent dans Excel en français) ; le fichier d’écritures au format FEC est un fichier d’import, pas le FEC légal.

À faire valider une fois par ton comptable : le régime de TVA, la carte cadeau taxée à l’utilisation, la TVA de l’acompte conservé, l’autoliquidation des frais Stripe.

## Plan de retour

- **La caisse** : arrête d’encaisser dans le Comptoir, continue sur la caisse certifiée et sur papier. Rien n’est perdu : les tickets déjà enregistrés restent, ceux du papier se saisissent après.
- **Une version qui casse** (prestataire, 2 min) : Vercel › Deployments › la précédente › Promote. Les données ne sont pas touchées.
- **La base ne répond plus** : bande rouge « lecture seule » ; un ticket répondu « rien n’est enregistré » va sur papier. Elle part seule quand la base revient.
- **Les données** : nouvelle installation vide avec la même `BACKUP_KEY` et un `SETUP_TOKEN`, puis « Installer depuis une sauvegarde ». Sans `BACKUP_KEY`, aucune sauvegarde ne s’ouvre.
- **Stripe** : retire `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET`, redéploie : plus aucun acompte n’est demandé ; ceux déjà payés se remboursent depuis le tableau de bord de Stripe, puis un avoir « remboursé hors caisse ».
- **Le site public et les SMS** : tant que le domaine n’a pas basculé, il n’y a rien à défaire. Après : le « Plan de retour » d’[operations](operations.md#plan-de-retour) (DNS notés à J-2, envois refermés, liste des rendez-vous pris ici).
