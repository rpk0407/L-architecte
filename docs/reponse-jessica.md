# Réponse à Jessica

## Note pour toi (à ne pas envoyer)

**Vérifié dans le code et les docs**

- Doublons : la reprise WordPress reconnaît ce qu'elle a déjà pris (numéro WordPress du rendez-vous, téléphone, e-mail, code de carte). Redéposer les mêmes fichiers n'ajoute rien ; la synchro finale ne prend que ce qui a changé (`server/commands/import.js`, `docs/operations.md` § 12 et Jour J).
- Gel : « Ouvrir les envois » est refusé tant que WordPress n'est pas bloqué et qu'une synchro n'a pas été faite après ; un rendez-vous pris sur WordPress après le gel bloque aussi (`server/commands/bascule.js`). « Forcer » existe, avec une raison.
- Double réservation : créneau retenu 5 min côté serveur pendant que le client remplit (`holdMin: 5`, `server/commands/agenda.js`, `server/domain/availability.js`).
- Messages : confirmation par SMS, et par e-mail avec le fichier agenda si le client a donné une adresse (`server/domain/mails.js`). Rappel par SMS la veille à 18 h (`reminderHour: 18`, `server/commands/system.js`).
- Rien ne part vers les clients avant la bascule, même avec une variable posée trop tôt (`docs/security.md`, « The hold »). Il faut Brevo (clé, nom d'expéditeur), `EMAIL_FROM`, DKIM et SPF chez IONOS, et la tâche cron.
- IONOS : domaine et boîte mail gardés (NS et MX inchangés) ; licences WordPress (thème, Salon Booking) et hébergement du site résiliés à J+30, après la copie complète (`docs/operations.md`, J+30).

**Trois points où j'ai dû nuancer**

1. « Fonctionnel dès maintenant » : le logiciel est là, mais rien n'est en ligne pour les clients avant le jour J (comptes Stripe et Brevo, domaine, cron restent à faire, `docs/roadmap.md`). Je n'ai pas pu faire tourner la suite de tests jusqu'au bout ici (interrompue par la limite de temps) : relance `npm test` avant d'envoyer.
2. **Il n'existe pas de rappel par e-mail.** Les e-mails aux clients sont la confirmation et l'annulation. Autres limites du rappel SMS : pas de rappel pour un rendez-vous pris la veille après 18 h, ni pour un client qui a coupé ses SMS ; le rappel 2 h avant existe mais est éteint par défaut.
3. Les rendez-vous repris ne passent pas par les règles de disponibilité : deux rendez-vous qui se chevauchaient déjà sur WordPress arrivent tous les deux, signalés « Chevauche un autre rendez-vous ». Ce n'est pas un doublon créé par nous, mais ce n'est pas « zéro chevauchement garanti ».

**À compléter avant d'envoyer**

- Q2 : rappel par e-mail, tu l'ajoutes ou non.
- Q3 : coûts mensuels du nouveau système (Vercel, Neon, Brevo et prix du SMS, frais Stripe), et ce que coûte IONOS une fois réduit au domaine et à la boîte mail (dépend de son contrat, non vérifiable ici).
- Q4 : ta décision sur le règlement. **Attention** : en France, le paiement en espèces entre un professionnel et son fournisseur est plafonné par la loi (1 000 € par dette, à ma connaissance ; le fractionner n'y change rien), et la facture doit couvrir le montant total, espèces comprises. À vérifier avec le comptable avant de répondre.
- Q5 : « les trois maquettes » vient de ta consigne, je n'en ai trouvé aucune trace dans le dépôt. Le téléphone du salon est vide dans les réglages par défaut ; l'Instagram par défaut est `barbershoplarchitecte`.

---

## Message à envoyer

Bonjour Jessica,

Merci pour tes questions, tout avance bien.

**1. Le site et les doublons.** Le nouveau système est construit. Il n'est pas encore ouvert aux clients : jusqu'à la bascule, c'est le site actuel qui prend les rendez-vous, donc aucun conflit. Les rendez-vous existants sont repris dans le nouvel agenda, et reprendre deux fois le même rendez-vous n'ajoute rien : pas de doublon. Le jour de la bascule (un lundi, salon fermé), on bloque d'abord la réservation sur l'ancien site, puis on reprend ce qui a changé depuis. Ensuite, un seul agenda : un créneau en cours de réservation est gardé quelques minutes, impossible de le prendre à deux. Si deux rendez-vous se chevauchaient déjà sur l'ancien site, ils te sont signalés.

**2. Confirmation et rappel.** Confirmation : par SMS, et par e-mail si le client a donné son adresse. Rappel : par SMS la veille à 18 h (l'heure se règle). Pas de rappel par e-mail aujourd'hui. [À COMPLÉTER : « je peux l'ajouter si tu y tiens » ou « le SMS suffit, il est bien plus lu »]. Ces messages partiront à partir du jour de la bascule, une fois le compte d'envoi (Brevo) ouvert.

**3. L'abonnement.** Oui, il s'arrête : les licences WordPress (thème et module de réservation) et l'hébergement du site chez IONOS se résilient un mois après la bascule, le temps de garder l'ancien site en secours. Tu gardes chez IONOS le nom de domaine et la boîte mail, donc une facture réduite. Dis-moi la date de renouvellement de ta licence, pour caler la bascule au mieux. Côté nouveau système : [À COMPLÉTER : coûts mensuels, hébergement, SMS, frais de paiement en ligne].

**4. Le règlement.** [À COMPLÉTER, ta décision. Formulation neutre possible : « Je regarde ce qui est possible avec mon comptable et je te confirme, avec une facture pour la totalité. »]

**5. Ce qu'il reste à décider ensemble**, par ordre de priorité :

1. Le lundi de la bascule, et l'accès à ton compte IONOS quelques jours avant.
2. L'équipe : qui apparaît sur le site, avec quels horaires ; fermetures et jours fériés des mois à venir.
3. Acompte à la réservation : oui ou non, quel montant ? Paiement en ligne ou non ? Que fait-on en cas d'absence ?
4. Carnets et abonnement : vendus en ligne, ou seulement au salon ?
5. La caisse : ta caisse certifiée reste la caisse légale, le nouveau système sert à la gestion. À dire au comptable.
6. Les pages légales : à relire, idéalement par un juriste.
7. Le numéro de téléphone à afficher, et le compte Instagram à mettre en lien.
8. Laquelle des trois maquettes tu préfères.

À très vite,
[À COMPLÉTER : signature]
