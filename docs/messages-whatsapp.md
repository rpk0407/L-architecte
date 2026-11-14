# Messages aux clients : WhatsApp et e-mail, sans intermédiaire

Guide pour le gérant. Les faits viennent des pages officielles de Meta, WhatsApp, IONOS et Vercel, lues le 13 novembre 2026 (liens en bas). Ce qui n'a pas pu être confirmé est dit comme tel.

Tout se choisit dans **Réglages › Messages › Messages aux clients**. Quel que soit le choix, **rien ne part vers les clients avant la bascule depuis l'ancien site** : les messages attendent, l'ancien site envoie encore les siens.

## 1. Ce qui marche dès demain : le mode téléphone

Aucun compte à créer, aucun abonnement, zéro euro.

1. Sur le téléphone du salon, installe **WhatsApp Business** (l'application gratuite) avec le numéro du salon.
2. Dans le Comptoir : Réglages › Messages › Messages aux clients, choisis **« WhatsApp, depuis le téléphone du salon »**, tape le **numéro WhatsApp du salon**, enregistre.
3. Ouvre l'écran **Messages** (dans le menu, avec le nombre de messages à envoyer).
4. Pour chaque message : **« Ouvrir WhatsApp »** ouvre la conversation du client avec le texte déjà écrit. Tu appuies sur Envoyer dans WhatsApp, tu reviens, tu touches **« Envoyé »**. Le bouton « Envoyé, message suivant » enchaîne directement sur le client d'après : 20 rappels, 20 allers-retours.

Ce que l'écran te montre : les confirmations dès qu'un client réserve, les rappels de demain à partir de l'heure du rappel (18 h par défaut), les déplacements et les annulations. Un barbier ne voit que ses propres clients ; l'accueil, un responsable et le gérant voient tout. Chaque envoi est noté au journal avec le nom de celui qui l'a fait.

Ce que l'écran ne montre jamais : un client qui a coupé les messages du salon, un client sans numéro de portable (un fixe n'a pas WhatsApp). Le bas de l'écran dit combien de clients d'aujourd'hui et de demain sont dans ce cas, pour les appeler si besoin.

**Côté client.** Dès que le numéro WhatsApp du salon est enregistré, la dernière étape de la réservation en ligne affiche **« Recevoir la confirmation sur WhatsApp »**. Le client touche le bouton, WhatsApp s'ouvre sur le salon avec un message prêt qui porte le code de sa réservation. C'est lui qui écrit le premier : tu peux lui répondre librement.

### Aller plus loin avec le seul téléphone

Ces réglages sont dans l'application WhatsApp Business (Outils professionnels). Ils sont gratuits.

- **Message d'accueil** : une réponse automatique à un client qui t'écrit pour la première fois. Avec le bouton du site, c'est une confirmation sans aucun geste de ta part. Exemple : « Merci ! Ton rendez-vous est bien noté. Pour le déplacer ou l'annuler, utilise le lien reçu par e-mail ou appelle-nous. »
- **Message d'absence** : la réponse automatique en dehors des horaires.
- **Réponses rapides** : tes phrases courantes derrière un raccourci (« /adresse », « /retard », « /horaires »).
- **Étiquettes** : « Confirmé », « À rappeler », pour t'y retrouver.
- **SMS depuis le forfait du téléphone**, sans WhatsApp et tout seul : c'est la ligne « Téléphone du salon (SMS) » du même réglage (l'appli SMS Gateway sur un Android, voir `docs/operations.md`). C'est aujourd'hui la seule façon 100 % automatique avec un simple téléphone.

### Ce qu'on ne fera pas

Piloter l'application WhatsApp ou WhatsApp Web par un robot (Baileys, whatsapp-web.js et autres) est interdit. WhatsApp écrit que ses produits « ne sont pas faits pour les envois en masse ou automatisés », que les deux seuls outils prévus pour une entreprise sont l'application WhatsApp Business et la plateforme WhatsApp Business, et qu'il bannit les comptes repérés. Le salon y perdrait son numéro. Le mode téléphone reste dans les règles parce qu'une personne envoie chaque message, un par un, à un client qui a réservé.

## 2. Le mode automatique : l'API officielle de Meta, en direct

Les messages partent tout seuls, par la « plateforme WhatsApp Business » (Cloud API) de Meta, sans revendeur entre Meta et le salon.

### Ce qu'il faut savoir avant

- **Le numéro.** Meta écrit qu'un numéro déjà utilisé sur WhatsApp ne peut pas être enregistré sur l'API sans être d'abord supprimé de l'application. Garder le même numéro dans l'application et sur l'API (la « coexistence ») n'est proposé qu'à travers un partenaire de Meta : la page officielle exige d'être « Solution Partner ou Tech Provider ». **En direct, il faut donc un deuxième numéro** pour l'API (une carte SIM à quelques euros, ou une ligne fixe qui reçoit un appel vocal), et le numéro actuel reste sur l'application du téléphone.
- **Sur ce deuxième numéro, pas d'application** : les réponses des clients n'arrivent pas sur le téléphone. Les modèles renvoient donc vers le lien du rendez-vous, et le bouton du site continue de pointer vers le numéro de l'application.
- **Les clients sans WhatsApp.** Meta répond « accepté » quand il prend le message, pas quand le téléphone le reçoit. Le retour « non remis » passe par un autre canal (un webhook) qui n'est pas encore branché ici : un client sans WhatsApp ne reçoit rien et le Comptoir ne le sait pas. L'e-mail de confirmation part en plus quand le client a donné son adresse.
- **L'accord du client.** La règle de WhatsApp (mise à jour le 23 septembre 2026) demande l'accord de la personne pour recevoir des messages, et laisse l'entreprise choisir comment le recueillir. Le formulaire de réservation doit donc dire que la confirmation et le rappel arrivent par WhatsApp. Aujourd'hui il parle de SMS : à corriger avant d'activer ce mode.
- **Le prix.** Depuis le 1er juillet 2025, Meta facture chaque message remis. Les modèles « Utilitaire » (confirmation, rappel) sont payants ; depuis le 1er octobre 2026 ils le sont aussi quand le client vient d'écrire. La France a son propre tarif. Le montant en euros n'a pas pu être lu sur la grille officielle ; des sites tiers donnent environ 0,03 dollar par message utilitaire. Pour 1 200 rendez-vous par mois avec confirmation et rappel, compte de l'ordre de 70 euros par mois, à vérifier sur la grille de Meta. Un moyen de paiement doit être enregistré dans le compte.
- **Les limites.** Un compte neuf peut écrire à 250 personnes différentes par 24 heures. La vérification de l'entreprise par Meta fait passer à 2 000. Pour quatre barbiers, 250 suffit.
- **Les délais.** Créer le compte et l'application : moins d'une heure. Meta ne publie pas le délai de validation des modèles ni celui de la vérification de l'entreprise : compte quelques jours, sans garantie.

### Les étapes

1. Sur business.facebook.com, crée (ou ouvre) le **portefeuille d'entreprise** du salon.
2. Sur developers.facebook.com, crée une **application** avec le cas d'usage « Connect with customers through WhatsApp » et relie-la au portefeuille.
3. Dans l'application, WhatsApp › API Setup : **ajoute le deuxième numéro**, valide-le par SMS ou appel vocal, choisis le nom affiché (« Barber L'Architecte »). Note l'**identifiant du numéro** (« Phone number ID », une suite de chiffres : ce n'est pas le numéro).
4. Dans Paramètres de l'entreprise › Utilisateurs système : crée un utilisateur système, donne-lui l'application et le compte WhatsApp, génère un **jeton permanent** avec les droits `whatsapp_business_messaging` et `whatsapp_business_management`.
5. Enregistre un **moyen de paiement** dans le compte WhatsApp Business.
6. Dans WhatsApp Manager › Modèles de message, crée les **quatre modèles** ci-dessous : catégorie « Utilitaire », langue « Français », variables **par nom**. Le nom et le texte doivent être exactement ceux-ci. Meta refuse un texte qui commence ou finit par une variable, d'où les derniers mots.
7. Dans Vercel, ajoute `WHATSAPP_TOKEN` (le jeton, type Sensitive) et `WHATSAPP_PHONE_ID` (l'identifiant du numéro), puis redéploie. Facultatif : `WHATSAPP_SENDER` (le numéro, pour l'afficher dans Réglages).
8. Dans Réglages › Messages › Messages aux clients : choisis **« WhatsApp automatique »**, enregistre, puis **« Tester WhatsApp automatique »** vers ton portable.

Tant que le jeton manque, ou si Meta refuse un message, rien n'est perdu : le message arrive sur l'écran Messages, à envoyer à la main (ou part par SMS si un fournisseur SMS est branché).

### Les quatre modèles à soumettre

| Nom du modèle | Sert à | Texte à coller |
|---|---|---|
| `rdv_confirmation` | Confirmation | `Bonjour {{prenom}}, ton rendez-vous chez L'Architecte est confirmé : {{date}} à {{heure}} avec {{barbier}}. Pour le déplacer ou l'annuler : {{lien}} À bientôt !` |
| `rdv_deplace` | Rendez-vous déplacé | `Bonjour {{prenom}}, ton rendez-vous chez L'Architecte est déplacé. Nouvel horaire : {{date}} à {{heure}} avec {{barbier}}. Pour le modifier ou l'annuler : {{lien}} À bientôt !` |
| `rdv_rappel` | Rappel la veille | `Rappel de L'Architecte : on t'attend demain à {{heure}} avec {{barbier}}. Un imprévu ? Déplace ou annule ici : {{lien}} À demain !` |
| `rdv_annule` | Annulation | `L'Architecte : ton rendez-vous du {{date}} à {{heure}} est annulé. Pour en reprendre un : {{lien}} À bientôt !` |

Exemples à donner à Meta pour les variables : prenom « Karim », date « Jeu 12 nov », heure « 14 h 30 », barbier « JKut », lien « https://barberlarchitecte.com/r/LA-7K2P ». N'ajoute ni promotion ni lien vers une offre : Meta reclasse alors le modèle en « Marketing », plus cher et soumis à d'autres règles. Si tu as créé les modèles avec des variables numérotées (`{{1}}`, `{{2}}`), ajoute `WHATSAPP_PARAMS=positional` dans Vercel.

Les autres messages (rappel du jour, place libérée, reçu) n'ont pas de modèle : ils partent par SMS si un fournisseur est branché, sinon ils arrivent sur l'écran Messages. Les demandes d'avis et les relances restent des SMS : WhatsApp les classe en marketing et demande un accord à part.

## 3. Les e-mails par la boîte IONOS du salon

Pas de nouveau fournisseur : le Comptoir envoie par la boîte e-mail que le salon paie déjà. Tout est dans **Réglages › Connexion IONOS › E-mail du salon** : ce qui est déjà posé dans Vercel (jamais le mot de passe), les valeurs à taper avec un bouton « Copier », l’e-mail test et la vérification SPF et DKIM.

Dans Vercel (Settings › Environment Variables, Production), puis Redeploy :

| Variable | Valeur |
|---|---|
| `SMTP_HOST` | `smtp.ionos.fr` (le nom que donne l’assistance IONOS France ; `smtp.ionos.com` est le même service sur le site anglais) |
| `SMTP_PORT` | `465` (chiffré dès le départ) ; `587` (STARTTLS) si le 465 est bloqué |
| `SMTP_USER` | l’adresse complète de la boîte, par exemple `rdv@barberlarchitecte.com` |
| `SMTP_PASS` | le mot de passe de cette boîte (type Sensitive). IONOS ne le montre jamais : compte IONOS › E-mail › les trois points de l’adresse › Modifier le mot de passe. Le changer oblige à le changer aussi sur les téléphones qui lisent cette boîte : une adresse rien que pour le Comptoir évite ça. |
| `EMAIL_FROM` | `Barber L'Architecte <rdv@barberlarchitecte.com>` : une adresse du même domaine que la boîte, IONOS refuse les autres depuis le 29 janvier 2024 |

- **Quand.** Tu peux la brancher avant la bascule : les e-mails aux clients attendent le jour J ; le test et tes propres alertes partent tout de suite.
- **L’e-mail test** dit ce qui ne va pas en clair : mot de passe refusé, serveur qui ne répond pas sur ce port (essaie 587), expéditeur hors du domaine, limite d’envoi atteinte.
- **Sécurité.** La connexion est toujours chiffrée et le certificat du serveur est vérifié. Le mot de passe n’est jamais envoyé en clair, ni écrit dans un journal, ni montré dans le Comptoir.
- **Vercel.** Seul le port 25 est fermé aux fonctions Vercel ; les ports 465 et 587 passent.
- **Arriver en boîte de réception.** Les DNS du domaine restent chez IONOS : IONOS y met lui-même le SPF et le DKIM, il n’y a rien à faire. « Vérifier SPF et DKIM » le contrôle sans rien bloquer. Si un jour les DNS partent ailleurs : TXT `v=spf1 include:_spf-eu.ionos.com ~all` (un seul SPF par domaine) et les CNAME `s1-ionos._domainkey` → `s1.dkim.ionos.com`, `s2-ionos._domainkey` → `s2.dkim.ionos.com`.
- **Limites d’envoi.** Une boîte IONOS envoie 50 e-mails par heure la première semaine, 100 jusqu’à 14 jours, 400 jusqu’à 30 jours, puis 500. Au-delà, le serveur répond « 450 Mail send limit exceeded » et l’e-mail reste en échec dans Relances › Messages envoyés. Le salon en envoie quelques dizaines par jour.

### En mode téléphone, le soir

L’Accueil affiche « N messages à envoyer » tant qu’il en reste ; le résumé du soir les compte (« à envoyer depuis l’écran Messages », avec le lien). Si à 21 h des messages attendent encore, les rappels de demain compris, tu reçois une seule alerte par e-mail et une ligne en haut du Comptoir, qui part dès qu’ils sont envoyés (Réglages › Messages › Me prévenir › Les pannes). Avec un rappel réglé après 19 h, l’alerte vient deux heures après lui.

## Sources (lues le 13 novembre 2026 ; IONOS et Vercel relues le 14 novembre 2026)

- Meta, démarrer avec la Cloud API : https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- Meta, numéros de téléphone : https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
- Meta, garder l'application WhatsApp Business (coexistence) : https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- Meta, modèles utilitaires et envoi d'un modèle : https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates
- Meta, limites d'envoi : https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- Meta, tarifs : https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- WhatsApp, règles de la messagerie professionnelle (accord du client) : https://whatsappbusiness.com/policy/
- WhatsApp, envois automatisés ou en masse : https://faq.whatsapp.com/5957850900902049
- WhatsApp, applications non officielles : https://faq.whatsapp.com/1217634902127718
- WhatsApp, lien « cliquer pour discuter » (wa.me) : https://faq.whatsapp.com/5913398998672934
- WhatsApp Business, outils de l'application (réponses rapides, message d'accueil, étiquettes) : https://whatsappbusiness.com/resources/resource-library/staying-organized-smb-using-lists-quick-replies/
- IONOS France, serveurs de messagerie (smtp.ionos.fr) : https://www.ionos.fr/assistance/email/depannage-mail-basicmail-business-basicmail/tester-laccessibilite-des-serveurs-de-messagerie-avec-ping/
- IONOS, serveurs e-mail (SMTP, ports 465 et 587, identifiant, adresse d'expéditeur) : https://www.ionos.com/help/email/general-topics/ionos-mail-server-details-for-imap-pop3-and-smtp/
- IONOS, limites d'envoi d'une boîte : https://www.ionos.com/help/email/general-topics/what-restrictions-apply-to-sending-bulk-emails/
- IONOS, changer le mot de passe d'une boîte : https://www.ionos.com/help/email/troubleshooting-mail-basic-mail-business/changing-an-ionos-email-account-password/
- IONOS, SPF (valeur européenne `_spf-eu`) : https://www.ionos.co.uk/help/domains/configuring-mail-servers-and-other-related-records/using-ionos-spf-to-improve-email-delivery/
- IONOS, DKIM : https://www.ionos.co.uk/help/domains/configuring-mail-servers-and-other-related-records/email-authentication-with-dkim/
- Vercel, SMTP depuis une fonction (mise à jour le 29 septembre 2026) : https://vercel.com/kb/guide/serverless-functions-and-smtp

Non confirmé sur une page officielle : le tarif en euros d'un message utilitaire en France, le délai de validation d'un modèle et de vérification de l'entreprise, les ports de smtp.ionos.fr sur une page en français (la page française nomme le serveur ; les ports viennent de la page anglaise du même service), le troisième CNAME DKIM (l'exemple d'IONOS en montre un numéroté, sans dire s'il est propre à chaque compte), la valeur SPF d'un contrat français (la page européenne donne `_spf-eu`, l'américaine `_spf-us` ; la vérification accepte les deux).
