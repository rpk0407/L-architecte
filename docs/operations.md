# Operations

## Environment variables

Set them in Vercel › Project › Settings › Environment Variables, for Production. Nothing secret is ever committed, and no secret needs a terminal: a secret is created in that screen (type **Sensitive**), its value drawn by a password manager's generator (1Password, Bitwarden: letters and digits, the length given below), never typed by hand. **A change takes effect only after a redeploy** (Vercel › Deployments › the latest › ⋯ › Redeploy): until then the running salon keeps the old value.

| Variable | Required | What |
|---|---|---|
| `LX_MODE` | production | `production` for the real salon. Anything else runs the **demo** (seeded salon, simulated SMS and payments, demo access shown on the login screen). |
| `SESSION_SECRET` | production | 64 random letters and digits. Signs cookies and client links. Changing it signs everyone out and invalidates links already sent. Without it, production answers every `/api` route with 503 « Configuration incomplète : SESSION_SECRET ». |
| `SETUP_TOKEN` | first start | One-time code asked by the setup screen (« Code d’installation ») to create the owner account, so nobody else can claim an empty installation. The provider gives it to the owner, then removes it (the Comptoir warns while it is still set). |
| `DATABASE_URL` (or `POSTGRES_URL`) | production | Postgres (Neon or Supabase from the Vercel marketplace, **EU region**). Set by the marketplace; tables are created on first start. |
| `BLOB_READ_WRITE_TOKEN` | alternative | Vercel Blob instead of Postgres. `LX_BLOB_PREFIX` (default `lx2`), `LX_BLOB_ACCESS` (`private` default). With Postgres too, a Blob store holds the nightly backups (`backups/`). |
| `BACKUP_KEY` | production | **Exactly 43** random letters and digits (that is 32 bytes in base64): encrypts the nightly backups. Keep a copy **outside Vercel** (the password manager): without it no backup can be opened. Never change it, or older backups stay locked to the old key. |
| `PUBLIC_URL` | at the switch | `https://barberlarchitecte.com`: used in SMS links and payment return URLs. Defaults to the Vercel production URL (the provisional address), which is right **until the domain points at Vercel**: set before that, links would open the old WordPress site. Set it on the switch day, right after the DNS change, in the same redeploy as `SMS_PROVIDER`, so no text ever leaves with a wrong link. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for online payments | Without them (or without the webhook secret), production asks no deposit online and the till's QR code is off; the demo uses the test checkout page. With Stripe, an unpaid booking holds its slot at least 31 minutes, the lifetime of a Stripe checkout. |
| `SMS_PROVIDER` | for real SMS | `brevo` (with `BREVO_API_KEY`, `SMS_SENDER` ≤ 11 characters, e.g. `LArchitecte`) or `twilio` (with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`). Without it, messages wait in the outbox (Relances › Messages envoyés, « attend un fournisseur »); once a provider is set, those more than 6 h late or whose appointment has started are marked « trop tard » instead of leaving. **Set it only on the switch day, after the DNS change**: from the first WordPress import, the new salon queues the evening-before reminders of the imported bookings, which WordPress still sends itself until then. |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | for e-mails | With `BREVO_API_KEY`, e-mails leave through Brevo: the client's confirmation with the calendar file (`.ics`) and cancellation (Réglages › Messages › E-mails aux clients), the owner's alerts, evening summary (with the Z and its seal) and Monday report (Réglages › Messages › Me prévenir). `EMAIL_FROM` is a sender verified in Brevo, with the domain's DKIM and SPF set (e.g. `Barber L’Architecte <rdv@barberlarchitecte.com>`); replies go to `EMAIL_REPLY_TO` (the salon's inbox). Without them, e-mails wait in the outbox like SMS (Relances › Messages envoyés, « attend un fournisseur »). A wrong key shows « Clé Brevo refusée » on each mail. The evening summary and the Monday report leave on a tick after their time: on Vercel without Pro crons, they need the external cron of step 10. Like `SMS_PROVIDER`, set on the switch day only. |
| `LX_INDEX` | at go-live | `1` lets search engines index the public site: the build removes its noindex and opens `robots.txt` (the Comptoir, client links, the API and `/demo` stay out). Unset, nothing is indexed. Takes effect on the next deploy. |
| `CRON_SECRET` | production | 64 random letters and digits. Enables `/api/cron/tick` for the external scheduler (**required**, see below) and derives the key of the SMS provider's STOP webhook. |
| `LX_DATA_FILE`, `LX_FAKE_NOW`, `LX_INSECURE_COOKIES` | development only | Local journal file; a fixed clock (ignored in production); cookies over plain http (ignored by a production deployment on Vercel). |

The Comptoir shows what is missing: Réglages › Mise en route ticks each step live, and Réglages › Données › Santé lists the scheduler, Stripe's last webhook, failed or waiting messages, the last backup, the journal's integrity, the public address and indexing (`GET /api/v1/health`, owner only).

## Going live (checklist)

The provider's technical reference. The owner's version, day by day, is the next section.

1. **Database**: add Neon Postgres from the Vercel marketplace (region Frankfurt or Paris). It sets `DATABASE_URL`.
2. **Secrets**: `LX_MODE=production`, `SESSION_SECRET`, `SETUP_TOKEN`, `BACKUP_KEY`, `CRON_SECRET`, created in Vercel's screen as above (`PUBLIC_URL` waits for the switch, item 11). Add a Vercel Blob store too, created with **Private** access (Vercel fixes it at creation; a public store refuses the backups), for the nightly backups: it sets `BLOB_READ_WRITE_TOKEN`. In production it is required: without it there is no automatic backup, the download is sealed in one response (Vercel caps those at 4.5 MB, about 30 000 operations, some 16 months of a busy salon) and a file over 2.5 MB cannot be uploaded for a restore.
3. **Deploy**, open `/comptoir`: the setup screen asks for the installation code (`SETUP_TOKEN`), the owner's name, e-mail, password and PIN. Then remove `SETUP_TOKEN` and redeploy.
4. **Salon**: Réglages › Le salon (legal name, SIRET, VAT number for the tickets), Horaires (weekly hours, public holidays in one tap), Réservation (notice, cancellation delay, deposits), Messages.
5. **Team**: Équipe › Ajouter, one per person, with their PIN; set each barber's hours, services and commission. Until the first chair exists, the Agenda says « Ajoute ton équipe pour ouvrir l’agenda ».
6. **Catalogue**: services (price, length, online or not, deposit), products with stock. « Reprendre la carte de l’ancien site » takes over the WordPress menu in one tap.
7. **Devices**: on the salon tablet, sign in as the owner, Réglages › Appareils › Enregistrer ce poste. The team signs in there with their PIN.
8. **Stripe** (deposits, QR payments): create the account, add `STRIPE_SECRET_KEY`; add a webhook endpoint `https://<domain>/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.expired`, copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Test with Stripe's test keys first, then switch to live keys **and a live webhook** (live mode has its own endpoint and its own signing secret) before opening bookings: with test keys (`sk_test_`) in production, a test card confirms a booking and the till deducts its deposit although no money moved (the Comptoir warns « Stripe en mode test »). The day Stripe goes live, the deposit rule appears in the CGV: save Réglages › Réservation once that day, which dates a new CGV version (`cgvVersionOf`, server/settings/shop.js). The no-show fee clause stays off the CGV: it shows only when `/api/public/salon` says `payments.cardOnFile === true`, and nothing keeps cards yet.
9. **SMS**: Brevo account (French, pay as you go), sender name approved. `BREVO_API_KEY` and `SMS_SENDER` may be stored early; `SMS_PROVIDER=brevo` is set **on the switch day, after the DNS change**, with `PUBLIC_URL` (item 11): between the first WordPress import and the switch the new salon must send no text (the imported clients would get a second reminder, with a link to the old site). Texts queued meanwhile wait, and those more than 6 h late are expired instead of sent. Réglages › Mise en route › SMS › « Envoie-moi un SMS test » then sends one text to the owner's French mobile through the real provider (three an hour at most). To confirm with Brevo before go-live: the STOP number used in the STOP mention (default ` STOP au 36173`, Réglages › Messages), the fields of its webhook's payload (STOP replies arrive at `POST /api/sms/webhook`, see [security](security.md#public-endpoints)), and the sender name. The owner decides the countries texts may go to (Réglages › Messages; Monaco +377 is not in the default list).
10. **Scheduler (required)**: a free cron (cron-job.org) calling `GET https://<domain>/api/cron/tick` every 5 minutes with the header `Authorization: Bearer <CRON_SECRET>`. Texts held by quiet hours leave at 8 h only if something dispatches them, and a text more than 6 h late is expired instead of sent: without the cron, the morning's reminders wait for the first visit to the Comptoir or the site. Every visit to the Comptoir or the site ticks too, so « a tick ran » proves nothing: Mise en route ⑪ and Santé read the calls of `/api/cron/tick` this server has seen, and above all the messages themselves (shared by every instance): red when a text due in the last 24 h waited more than 30 minutes with no dispatch at all (the 08:00 texts held by quiet hours, typically), when one is waiting like that now, and « à vérifier » (not red: the calls are counted per instance, and cron-job.org may reach another one) when this server saw no cron call for 30 minutes during opening hours. A long relance draining 10 texts a tick is not late. The owner's evening summary and Monday report (Réglages › Messages › Me prévenir) also leave on a tick after their time: without the cron, an evening when nobody opens the Comptoir or the site skips the summary.
11. **Domain and indexing**: point the domain at Vercel (DNS table below). `/` already serves the site (the demo page is at `/demo` and sends production visitors to `/`). Then, in one redeploy: `PUBLIC_URL=https://barberlarchitecte.com`, `SMS_PROVIDER` (item 9), the e-mail sender, Stripe's live keys, and `LX_INDEX=1` so Google indexes the site, with `sitemap.xml` and the canonical address. Check every old address on the live domain with `node scripts/check-redirects.mjs https://barberlarchitecte.com` (the list of the end-to-end test). The build lists in `sitemap.xml` only the pages it has: `/formations`, `/carte-cadeau` and the legal pages join it when their packages ship, and until then the old WordPress links to them land on the 404 page.
12. **Old WordPress**: Réglages › Reprendre WordPress takes the bookings export (Salon › Calendrier, one CSV per year), optionally the WXR export, the plugin's client CSV and hand-made CSVs of paper gift cards and running subscriptions: client files (merged by phone or e-mail, no promotional SMS), past visits (they count for each client's rhythm, not for the chairs' figures, and never wait at the till), upcoming bookings (no SMS at import; each old barber with upcoming bookings must be matched to an active chair). On the cut-over day, export and drop the files again: only new bookings and what changed on the old site since are taken (cancelled, moved, taken place), unless the booking was already handled in the Comptoir, which is then listed for a look. Keep WordPress read-only for a month at `ancien.barberlarchitecte.com`. Its indexed addresses already redirect to the matching place on the site (`vercel.json`), and the cancel, pay and account links in clients' old e-mails land on `/ancien-lien`, which never acts on them and opens the imported appointment or asks for the client's number.
13. **Monitoring**: UptimeRobot (free) on `https://<domain>/api/public/live` every 5 minutes, alerts to the owner's phone and to the provider.
14. **Fiscal**: until the till's certification or publisher's attestation is obtained (see [security](security.md#fiscal-note-france)), keep the current certified till as the legal one.

## Mise en ligne : la liste du gérant

Quatre moments, chacun en deux colonnes : ce que tu fais toi-même (dans le Comptoir, sur ton téléphone, dans tes comptes), et ce que ton prestataire fait (Vercel, DNS, clés). Le jour J est un **lundi** : le salon est fermé, rien ne se perd si la bascule prend une heure. Dans le Comptoir, **Réglages › Mise en route** coche chaque étape toute seule, dans le même ordre ; une ligne rouge se regarde tout de suite.

Rien ici ne demande de modifier le code : tout se règle dans le Comptoir et dans les écrans de Vercel, IONOS, Stripe et Brevo. Une variable changée dans Vercel ne compte qu’après un redéploiement.

**Entre le premier passage de Reprendre WordPress (J-7) et la bascule du domaine (jour J), le nouveau salon n’envoie aucun SMS ni e-mail** : WordPress envoie encore ses propres rappels, et les liens du nouveau salon ouvriraient l’ancien site. Le fournisseur SMS, l’expéditeur des e-mails et l’adresse définitive (`PUBLIC_URL`) se branchent le jour J, juste après les DNS. Jusque-là, Mise en route ⑦ et ⑧ restent « à faire » : c’est voulu. Les messages préparés entre-temps attendent ; ceux de plus de 6 h ne partiront jamais.

### J-7 (le lundi d’avant)

| Ce que tu fais | Ce que le prestataire fait |
|---|---|
| Ouvre le Comptoir avec le code d’installation qu’il te donne : ton prénom, ton e-mail, ton mot de passe, ton code. | Crée le projet Vercel (région Paris `cdg1`), la base Neon (UE) et le stockage Blob **privé**. |
| Mise en route ① à ⑤ : coordonnées et mentions, horaires et jours fériés des 12 mois à venir, la carte (« Reprendre la carte de l’ancien site »), l’équipe avec un code chacun, la tablette du comptoir enregistrée. | Crée les secrets dans l’écran de Vercel (type Sensitive), valeurs tirées par le générateur du gestionnaire de mots de passe : `SESSION_SECRET` et `CRON_SECRET` (64 lettres et chiffres), `BACKUP_KEY` (exactement 43), `SETUP_TOKEN`. Range `BACKUP_KEY` hors de Vercel. Puis `LX_MODE=production`, et redéploie. **Ni `PUBLIC_URL`, ni `SMS_PROVIDER`, ni `EMAIL_FROM`** : ils attendent le jour J. |
| Crée le compte Stripe au nom du salon et termine l’activation (IBAN, pièce d’identité). | Branche Stripe en **test** : clé `sk_test_`, webhook de test vers `https://<adresse provisoire>/api/stripe/webhook` (`checkout.session.completed`, `checkout.session.expired`) et son secret dans `STRIPE_WEBHOOK_SECRET`. Redéploie. |
| Crée le compte Brevo (SMS et e-mails) et demande le nom d’expéditeur `LArchitecte`. Décide dans quels pays les SMS peuvent partir (Réglages › Messages ; Monaco +377 n’y est pas par défaut). | Range `BREVO_API_KEY` et `SMS_SENDER` dans Vercel, **sans** `SMS_PROVIDER`. Confirme avec Brevo le numéro STOP de la mention des offres (« STOP au 36173 » par défaut), les champs que son webhook envoie, et le nom d’expéditeur validé. |
| Premier passage de Reprendre WordPress (Réglages › Reprendre WordPress) : clients, rendez-vous, cartes cadeaux et abonnements papier. | Crée la tâche cron-job.org : `GET https://<adresse provisoire>/api/cron/tick` toutes les 5 minutes, en-tête `Authorization: Bearer <CRON_SECRET>`. **Obligatoire** : sans elle, les SMS retenus la nuit ne partent pas à 8 h. Mise en route ⑪ passe au vert au premier appel vu par le serveur (il peut en avoir plusieurs : « à vérifier » quelques minutes n’est pas une panne, le rouge vient des SMS restés sans envoi). |
| | Supprime `SETUP_TOKEN` une fois ton compte créé, et redéploie. |

### J-2 (le samedi)

| Ce que tu fais | Ce que le prestataire fait |
|---|---|
| Donne-lui l’accès à ton compte IONOS (ou fais les DNS avec lui). | Chez IONOS, **baisse le TTL** des enregistrements `@` et `www` à 300 s (48 h avant la bascule). Note les valeurs actuelles (A, AAAA, CNAME) : c’est le plan de retour. |
| Mise en route ⑬, première fois : réserve un créneau sur le site provisoire comme un client, sur ton téléphone, vérifie qu’il arrive dans l’agenda, puis annule-le dans l’agenda (pas de SMS avant le jour J). | Ajoute `barberlarchitecte.com` et `www.barberlarchitecte.com` au projet Vercel. Crée chez IONOS le sous-domaine `ancien.barberlarchitecte.com` sur l’hébergement WordPress, avec son certificat, **sans toucher aux adresses de WordPress** : elles changent le jour J (avant, le vrai domaine renverrait tout le monde, et Google, vers `ancien`). |
| Relis `/mentions-legales`, `/confidentialite` et `/cgv`. Sur `/confidentialite`, vérifie la ligne d’hébergement : Vercel, région Paris `cdg1`, et la base de données (Neon, UE). | E-mails : authentifie le domaine dans Brevo. Ajoute chez IONOS ses enregistrements **DKIM** et ajoute `include:spf.brevo.com` à l’enregistrement **SPF** existant (un seul SPF, celui d’IONOS gardé). `EMAIL_FROM` attend le jour J. |
| Préviens l’équipe : lundi, nouvelle tablette, chacun son code. | Vérifie que les tests de bout en bout passent sur la version à mettre en ligne (`npm run test:e2e` : les anciennes adresses WordPress y sont toutes essayées). |

### Jour J (un lundi, salon fermé)

| Ce que tu fais | Ce que le prestataire fait |
|---|---|
| 1. Sur WordPress, **bloque les réservations** (Salon Booking › réglages : réservation en ligne désactivée) et **coupe ses rappels** SMS et e-mail : dès ce soir, c’est le nouveau salon qui les envoie. | 2. Chez IONOS, change les DNS (tableau ci-dessous). Vercel émet le certificat en quelques minutes. |
| | 3. Aussitôt après : dans WordPress (Réglages › Général), passe les deux adresses à `https://ancien.barberlarchitecte.com`, et coche dans Réglages › Lecture « Demander aux moteurs de recherche de ne pas indexer ce site ». |
| 4. Refais l’export WordPress (depuis `https://ancien.barberlarchitecte.com/wp-admin`) et dépose-le dans Réglages › Reprendre WordPress : c’est le **delta**, seul ce qui a changé depuis le premier passage est repris. Regarde la liste « à vérifier ». | 5. Vérifie les redirections sur le vrai domaine : `node scripts/check-redirects.mjs https://barberlarchitecte.com`. Chaque ancienne adresse doit répondre par sa redirection (par exemple `/rdv-en-ligne` vers `/?reserver`) ; la commande liste celles qui ne le font pas. |
| 6. Ouvre trois anciens liens depuis Google sur ton téléphone : chacun arrive au bon endroit. | 7. En un seul redéploiement : `PUBLIC_URL=https://barberlarchitecte.com`, `SMS_PROVIDER=brevo`, `EMAIL_FROM=rdv@barberlarchitecte.com` et `EMAIL_REPLY_TO`, Stripe en **réel** (clé `sk_live_`, un **webhook réel** vers `https://barberlarchitecte.com/api/stripe/webhook`, mêmes deux événements, et son propre secret dans `STRIPE_WEBHOOK_SECRET`), `LX_INDEX=1`. Change l’adresse de la tâche cron-job.org pour `https://barberlarchitecte.com/api/cron/tick`. Redéploie. |
| 8. Mise en route ⑦ : « Envoie-moi un SMS test ». Vérifie le nom d’expéditeur et que le lien ouvre bien barberlarchitecte.com. | 9. Soumet `https://barberlarchitecte.com/sitemap.xml` dans Google Search Console (Mise en route ⑫ est cochée). |
| 10. Le même jour, enregistre **Réglages › Réservation** : cela date une nouvelle version des CGV, qui annoncent désormais l’acompte. | 11. UptimeRobot sur `https://barberlarchitecte.com/api/public/live`, toutes les 5 minutes, alertes vers ton téléphone et le sien. |
| 12. Mise en route ⑬ pour de vrai : réserve sur `https://barberlarchitecte.com` depuis ton téléphone, reçois le SMS, annule depuis son lien. | 13. Vérifie avec toi que Mise en route est entièrement cochée. |
| 14. **Acompte réel de 1 €** : crée une prestation « Test acompte » à 1 € avec un acompte de 1 €, réserve-la sur le site avec ta carte, vérifie qu’elle arrive payée dans l’agenda, annule le rendez-vous (l’acompte est remboursé), vérifie le remboursement dans Stripe, puis retire la prestation. | |
| 15. **Google Business Profile** : lien de réservation `https://barberlarchitecte.com/?reserver&utm_source=gbp`. **Instagram** : le lien de la bio vers `https://barberlarchitecte.com/?reserver&utm_source=instagram`. | |

Les frais d’absence restent hors des CGV : la clause n’apparaît que lorsqu’une carte peut être gardée pour eux, ce qu’aucune version ne fait encore.

#### DNS chez IONOS

| Enregistrement | Avant | Après |
|---|---|---|
| TTL de `@` et `www` | 3600 s en général | **300 s, 48 h avant** la bascule |
| `A` `@` | l’adresse IONOS (à noter) | `76.76.21.21` |
| `AAAA` `@` | l’adresse IPv6 IONOS (à noter) | **supprimé** |
| `CNAME` `www` | IONOS | `cname.vercel-dns.com` |
| `ancien` (sous-domaine) | n’existe pas | l’ancien site WordPress chez IONOS, en lecture seule |
| `NS` | IONOS | **inchangé** |
| `MX` (boîte mail) | IONOS | **inchangé** |
| `TXT` SPF | celui d’IONOS | **gardé**, avec `include:spf.brevo.com` en plus |
| DKIM Brevo | aucun | ajouté (valeurs données par Brevo) |

#### Plan de retour

Si le site ne répond pas ou que les réservations échouent et que ce n’est pas réglé en une heure : le prestataire remet chez IONOS les valeurs notées à J-2 (`A` et `AAAA` de `@`, `CNAME` de `www`) ; avec le TTL à 300 s, l’ancien site revient en quelques minutes. Il remet aussi les deux adresses de WordPress à `https://barberlarchitecte.com` (et décoche la case d’indexation), puis retire `SMS_PROVIDER`, `EMAIL_FROM` et `PUBLIC_URL` du nouveau salon et redéploie : il n’envoie plus rien pendant que WordPress reprend la main. Tu rouvres les réservations et les rappels sur WordPress. Les rendez-vous pris entre-temps restent dans le Comptoir (Agenda) : saisis-les dans WordPress, puis on recommence la bascule un autre lundi.

### J+7 (le lundi d’après)

| Ce que tu fais | Ce que le prestataire fait |
|---|---|
| Réglages › Données › Santé : rien en rouge (planificateur, SMS échoués, sauvegarde de la nuit). | **Exercice de restauration** : un projet Vercel à part, avec une base vide et la même `BACKUP_KEY`, et **rien d’autre du salon** : ni `SMS_PROVIDER` ni clé Brevo, ni `EMAIL_FROM`, ni clés Stripe, ni `CRON_SECRET` (aucune tâche cron vers lui), ni `PUBLIC_URL` ni `LX_INDEX`, et jamais le stockage Blob du salon (une copie du salon qui enverrait les rappels de demain aux vrais clients, ou remplacerait ses sauvegardes). Il y installe la sauvegarde téléchargée (« Installer depuis une sauvegarde ») ; si le fichier dépasse 2,5 Mo, il faut au projet son propre stockage Blob privé, tout neuf. Vérifie l’agenda et les ventes, puis supprime ce projet le jour même. |
| Télécharge la sauvegarde chiffrée (Réglages › Données) et range-la hors de Vercel ; garde-en une par mois. | Vérifie dans Google Search Console que le site est indexé et que les anciennes adresses ne remontent plus en erreur. |
| Dans un mois : résilie les licences WordPress (thème, Salon Booking) et l’hébergement IONOS du site. Garde le domaine et la boîte mail chez IONOS. | Dans un mois : supprime le sous-domaine `ancien` une fois les licences résiliées. |

## Day to day

- Morning: the agenda is ready; walk-ins go in the queue (Agenda › Passage, key P), the site shows the live wait.
- At the till: open the drawer with the float, check out each client (the deposit and subscription are already on the ticket), propose the next appointment on the confirmation screen.
- Evening: Caisse & clôture › count the drawer by denomination, then close the day (Z). A closed day cannot change; mistakes are fixed the next day with a credit note.
- Weekly: Relances (clients past their rhythm), Rapports (heat map, team), stock alerts in the feed.
- Monthly: Rapports › Exports (sales, VAT and Z, commissions) for the accountant.

## Backups and archives

- **Nightly backup** (`server/core/backup.js`): after 03:00 Paris, the scheduler seals the whole journal, personal data and credentials included, gzips it and encrypts it with `BACKUP_KEY` (AES-256-GCM), then writes a private Blob file `backups/YYYY-MM-DD.json.gz.enc`. It keeps the last 30 days and the first backup of each of the last 12 months. It needs `BLOB_READ_WRITE_TOKEN` and `BACKUP_KEY`, and some traffic or the external cron after 03:00. Only a production salon writes backups (never the demo, nor a Vercel preview, even with the same Blob token), and each file carries its salon's identity (the hash of the journal's first event), so another deployment's files are never taken for this salon's. A backup taken before a client was erased still holds that client until it ages out (a year at most); one taken after holds none of their personal data.
- Réglages › Données › Sauvegardes: « Dernière sauvegarde : cette nuit 03:02 ✓ », in red when it is older than 36 h or when `BACKUP_KEY` or Blob is missing. « Télécharger la sauvegarde chiffrée » (keep one off Vercel each month), « Sauvegarder maintenant ».
- **Restore**: a new deployment with an empty database, the same `BACKUP_KEY`, a `SETUP_TOKEN` and the old Blob store (or the downloaded file). For a drill, never give the drill deployment the salon's Blob store: it would be a production salon with the same identity, and its nightly backups would replace the real ones. Use the downloaded file, and give the drill none of the salon's SMS, e-mail, Stripe, cron, `PUBLIC_URL` or `LX_INDEX` settings: a restored copy with a provider would text tomorrow's reminders to the real clients. A file over 2.5 MB needs a fresh private Blob store of the drill's own. On the setup screen, « Installer depuis une sauvegarde »: pick a backup from Blob or upload the file (in one request up to 2.5 MB; a larger file goes in 2.5 MB parts and then needs the Blob store). The chain is verified before anything is written, and the journal then records « Salon restauré » with the file it came from; the team signs in with their usual passwords and PINs. Refused once the salon has any data. Reuse the same `SESSION_SECRET` and `PUBLIC_URL`, or every link clients already received by SMS (manage links, receipts, offers) stops working. **Everything after the backup's time is lost** (bookings, tickets, Z closures): and a client erased since then comes back, so do those erasures again (Clients › the client › « Effacer (RGPD) »).
- The fiscal archive: Réglages › Données › "Archive complète du journal" (JSON, without personal data, so it cannot restore the salon), verifiable offline. Keep one per month, and one per year for 6 years (fiscal archiving).
- Postgres providers keep their own point-in-time history, short on free plans (Neon: hours, not days; check the plan): not a backup to count on.
- Client file export (CSV) from the same screen.

## Incidents

| Symptom | Where to look | What to do |
|---|---|---|
| "Pas de connexion" on the Comptoir | the network | Writes are idempotent: retrying never doubles a sale. |
| A client says the slot was free but booking failed | nothing wrong | Someone took it first; the site keeps their choices and shows the next slots. |
| SMS or e-mails not leaving | Relances › Messages envoyés (channel, status and error) | Check `SMS_PROVIDER` and the provider's credit, or `BREVO_API_KEY` and `EMAIL_FROM` (a sender validated in Brevo); failed messages show the provider's reason. |
| Deposits stay "Acompte en attente" | Stripe dashboard › webhooks | The webhook secret or URL is wrong; unpaid deposits free the slot anyway once the wait is over (31 minutes with Stripe). A deposit paid after that is kept only if the slot is still free; otherwise the booking is cancelled and the deposit refunded. |
| "Anomalie" in Réglages › Données | the activity log, the database | The journal no longer verifies: stop, export the archive, contact the operator. Nothing in the app can produce this; only a direct database edit can. |
| Backup line in red (Réglages › Données) | the message under it, Vercel logs (`[lx] backup`) | Missing `BACKUP_KEY` or Blob store: add it and redeploy. Blob down: it retries every 15 minutes; « Sauvegarder maintenant » once it is back. |
| Planificateur in red (Mise en route, Santé) | cron-job.org's history for `/api/cron/tick` | The task stopped or its `CRON_SECRET` header is wrong (it answers 401): fix it there. Morning texts more than 6 h late are expired, not sent. |
| The site is down (UptimeRobot alert) | Vercel › Deployments, the status page | Roll back to the previous deployment (Vercel › Deployments › ⋯ › Promote); a DNS problem: the plan de retour above. |
| A barber's phone is lost | Réglages › Appareils, Équipe › Déconnecter partout | Revoke the device and the sessions; change the PIN. |

Logs: Vercel › Project › Logs (`[lx]` prefix for the app's own messages).

## Demo

`LX_MODE` unset: the salon is seeded with ten weeks of history around today (520 clients, four barbers, closures, Z, gift cards, a past round of follow-ups) and keeps living: finished appointments are checked out, new days fill up, a client books online now and then. Réglages › Données › Remettre à zéro recreates it.
