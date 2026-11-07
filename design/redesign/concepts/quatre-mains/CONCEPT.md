# Les quatre mains

**L’idée (≤ 4 mots) : Choisir sa main, c’est choisir son site.** Une seule coque (nom, adresse, prix, bouton, ticket) et cinq éclairages : la maison et les quatre barbiers, chacun avec sa *main*, une lettre, un trait, un angle, un mouvement, une couleur, tirés mot pour mot de sa bio. Toucher un nom rallume la page autour de lui.

## L’insight (pourquoi ce salon)

On est fidèle à un barbier, pas à une boutique : le Fidèle dit « mon barbier », le Passionné demande « c’est qui qui fait les dégradés à blanc ». Le salon lui-même a nommé ses quatre mains dans ses bios (« construction au millimètre », « à l’ancienne », « contours nets », « boucles et transformations ») et il n’a **pas de portraits**. Un site sans visages qui veut parler des personnes n’a qu’un moyen honnête : leur donner une écriture. La cinquième main est la pièce : sol noir, cuir noir piqué de rouge, un long liseré LED rouge au-dessus du miroir (c’est la photo du salon, pas une invention).

**Comment on tord la graine.** Pas quatre « moods » décoratifs ni quatre couleurs : une main est cinq choses (lettre, trait, angle, mouvement, couleur) et chacune dérive d’une phrase réelle. Et la graine demandait « l’inconnu choisit » : non. L’inconnu ne choisit rien, la maison est déjà la main choisie ; seul l’habitué arrive *chez* quelqu’un.

## Ce que ce n’est pas

- Pas un quiz, pas un diagnostic, pas un configurateur (L’Atelier l’a fait).
- Pas quatre pages ni quatre sites : la coque ne bouge jamais, les prix non plus.
- Pas des portraits, des mains, des outils : rien n’est dessiné qui n’existe pas.
- Pas un film ni une timeline (Le Film), pas de tableau des départs (En direct).

## Identité

### Palette (hex et raison)

| Main | Fond | Texte | Accent | Pourquoi |
|---|---|---|---|---|
| **La maison** (Sans préférence) | `#121212` | `#EFEBE3` os | `#E8392B` | La pièce : noir, cuir, le liseré LED rouge du miroir. Le rouge est une **ligne**, jamais un bouton (le bouton de la maison est os). |
| **JKut** · au millimètre | `#F4F3EE` papier | `#15161A` | `#F2C200` | Le papier du relevé et le jaune du mètre : la graduation. Jaune seulement en filet et en fond de bouton, jamais en texte. |
| **Frank** · à l’ancienne | `#F1EBDD` ivoire | `#1B2A22` | `#1E4B3B` vert bouteille | Le vieux tarif du salon de quartier. Ivoire + sérif est proche d’un cliché banni ; ici sans terracotta, avec un vert bouteille, et seulement **chez Frank**, dont la bio dit « à l’ancienne ». |
| **Le Soldat** · contours nets | `#000000` | `#FFFFFF` | `#C7CCD2` argent | Le skin fade : du noir à la peau par paliers nets. La seule main sans couleur, parce que sa bio dit « silver ». |
| **Esteban** · boucles | `#2A1030` prune | `#F7EDE6` | `#F4A871` abricot | Chaleur et rondeur ; la seule main aux grands rayons. |

Toutes les paires fond/texte sont ≥ 7:1. L’audit mesure 0 ligne sous AA sur la planche, aucun texte sur photo.

**Ce qu’on garde d’aujourd’hui et pourquoi :** le rouge, parce qu’il est dans la pièce (LED, cuir) ; le noir, idem. **Ce qu’on lâche :** la sérif Instrument et la trame demi-teinte sur le mot-titre (le Film), remplacées par cinq lettres qui disent chacune une personne.

### Type

- **Coque, partout : Familjen Grotesk** (400–700, italiques), un grotesque avec une vraie voix, pas Inter ni Space Grotesk. Il porte tout le texte courant, les prix, les boutons, la maison. Repli : Helvetica Neue, Arial.
- **JKut : Azeret Mono 300**, chiffres tabulaires, interlettrage serré ; la graduation en dessous. Repli : ui-monospace, Menlo.
- **Frank : Libre Caslon Text italique**, le double filet. Repli : Georgia.
- **Le Soldat : Big Shoulders Display 800**, capitales, la barre de dégradé par paliers. Repli : Arial Narrow, Impact.
- **Esteban : Fraunces 500**, axes SOFT 100 et WONK 1 (littéralement des boucles), la courbe. Repli : Georgia.

Un barbier n’apporte **qu’une** lettre de titre, chargée en un seul fichier woff2 (sous-ensemble latin, ≤ 40 Ko) et seulement quand on entre chez lui. La maison ne charge que Familjen (deux fichiers).

### Les photographies

Les quatre, et seulement elles. Jamais recadrées en portrait, jamais attribuées. La main ne change que le **traitement** CSS : JKut désature légèrement (`grayscale .25`), Frank réchauffe (`sepia .4`), Le Soldat passe en noir et blanc dur (`contrast 1.35`), Esteban sature et arrondit (rayon 24 px). Sur le premier écran téléphone la photo est une **bande de 120 px** (le dégradé, pas le visage) pour que les sept réponses tiennent au-dessus du pli ; sur ordinateur `sidepart.jpg` en grand à droite. Les trois coupes restent « Sorti du fauteuil » avec les légendes du site.

**Le salon doit confirmer** qui a fait `fade.jpg` (dégradé à blanc, décoloré), `sidepart.jpg` (raie, dégradé bas) et `curls.jpg` (boucles, barbe) avant toute attribution. Tant que ce n’est pas confirmé, la galerie dit « coupe du salon » ; une fois confirmé, chaque photo peut porter la main de son auteur et rejoindre sa porte.

### Langage de forme

Un rectangle, un trait, un bouton. L’angle est une variable de la main : 6 / 0 / 2 / 0 / 24 px. Le trait (« la marque ») est le seul ornement : LED, graduation, double filet, paliers, courbe. Rien d’autre n’est décoré.

## La home (la maison, pour l’inconnu)

1. **L’enseigne** (premier écran) : nom · place Pélabon, Marseille 13e · « Ouvert · jusqu’à 18 h 30 · sans rendez-vous, on te prend tout de suite » · « Choisis une main. Ou laisse faire la maison. » · bande photo · adresse · 5,0 · 316 avis · prochain créneau en direct · **Réserver · dès 15 €** · Itinéraire · **Appeler** · la bande des quatre noms, chacun dans sa main, « Sans préférence » déjà choisie. L’inconnu a ses sept réponses sans toucher un nom.
2. **Les quatre mains** : les cinq portes (bio réelle, prochain créneau de chacun, Instagram de JKut). Toucher = rallumer. « Sans préférence : le premier libre, et c’est très bien comme ça. »
3. **Sorti du fauteuil** : les trois coupes, légendes du site, « Je veux cette coupe » ouvre la feuille avec la prestation posée.
4. **Les prix, sans surprise** : la carte, trois onglets, la coupe à 20 € visible sans défiler.
5. **La preuve** : 5,0 · 316 avis Google, les six mots qui reviennent, « Lire les 316 avis ».
6. **Ta coupe, chaque mois** : Hebdo 80 €/mois, carnet 80 € ; court, jamais poussé à l’inconnu.
7. **Tu te demandes ?** : les huit réponses.
8. **16, place Pélabon** : horaires, téléphone en clair, mail, itinéraire, Instagram, YouTube, « Résilier » dans le pied.

**Pour l’habitué**, la même page s’ouvre *chez son barbier* (le téléphone se souvient, sans compte, comme le rebook aujourd’hui) : en 1, à la place du titre, « Comme la dernière fois ? · Coupe classique · 20 € · avec Frank · jeudi 18 h · Reprendre ». Les quatre noms restent en bas : il peut changer de main d’un geste.

## La réservation

**Forme.** Une feuille plein écran sur téléphone, un panneau à droite sur ordinateur, dans l’ordre réel de l’API : quoi → qui → quand → à ton nom. L’inconnu entre par « Réserver · dès 15 € » et voit les prix d’abord. L’habitué entre par « Réserver avec Frank » ou « Reprendre » : « Avec qui ? » est déjà répondue et la feuille s’ouvre chez Frank.

**L’interaction signature : le rallumage.** À « Avec qui ? », les cinq lignes sont déjà chacune dans leur main (nom dans sa lettre, sa marque dessous, son prochain créneau). Toucher un nom : un trait de sa couleur traverse la feuille de gauche à droite, comme le liseré LED du miroir, et derrière lui la lettre, le filet, l’angle des boutons et la durée des transitions changent. La feuille **reste dans cette main jusqu’au ticket**. Avec `prefers-reduced-motion`, pas de trait : le changement est immédiat et complet. La démo vivante est le téléphone de la planche.

**Protégé, tel quel :** le prix dans le bouton · « Sans préférence · Le plus tôt » en première ligne · « Créneau gardé pour toi · 4 min 32 » (jamais « vient d’être pris » tant que la tenue court) · « Comme la dernière fois ? » · l’acompte dit une fois en mots avant « Réserver et régler l’acompte · 15 € » · hors ligne, ce qui est tapé reste · la feuille reprend où elle était · Retour et Échap ferment, le focus revient · liens profonds lisibles `?reserver&barbier=frank&prestation=coupe-classique` (codes courts acceptés).

## La confirmation

Le ticket est dans la main du barbier, pas dans celle de la maison : « C’est réservé, Sofiane. » puis **jeudi 27 novembre · 18 h** en toutes lettres, Coupe classique · 20 € · 30 min, **avec Frank**, 16, place Pélabon · 13013 Marseille, Ajouter au calendrier, Itinéraire, le SMS mot pour mot, Déplacer, Annuler. Code visible. Dessous : « Quelqu’un vient avec toi ? Réserver pour une deuxième personne » (même jour, fauteuil d’à côté, même téléphone) ; puis « Garde tout au même endroit » (Mon espace, facultatif). Pour le Passionné : export du ticket en image carrée dans la main du barbier, avec son nom et son Instagram.

## Mouvement

- **Le rallumage** : un trait (3 px + halo) traverse en `--dur` avec `--ease` de la main d’arrivée : maison 400 ms fondu ; JKut 160 ms **par crans** (`steps(4)`) ; Frank 700 ms lent ; Le Soldat 120 ms coupe franche ; Esteban 600 ms élastique avec léger dépassement. Couleurs, rayon et lettre suivent en transition.
- **La feuille** : glisse en 300 ms ; les lignes de l’étape arrivent une par une (60 ms d’écart), dans l’ease de la main.
- **Le créneau gardé** : le temps en chiffres tabulaires, sans animation, sans rouge.
- **Mouvement réduit** : pas de trait, pas de glissement, pas d’échelonnement ; tout apparaît en place ; rien ne boucle ; rien n’est caché derrière un mouvement.

## Six lignes (tu)

1. « Choisis une main. Ou laisse faire la maison. »
2. « Chez JKut, on construit au millimètre. Le dégradé tient trois semaines, pas trois jours. »
3. « Sans préférence, c’est le premier libre. Et c’est très bien comme ça. »
4. « Le salon se rallume autour de ton barbier. Les prix, eux, ne bougent pas. »
5. « Créneau gardé pour toi, cinq minutes. Le temps de finir ton sandwich. »
6. « C’est réservé, Sofiane. Chez Frank, jeudi, 18 h. »

## R1–R10, une ligne honnête chacune

- **R1** — Tenu sur la planche à 390 : adresse, ouvert, dès 15 €, prochain créneau, 5,0 · 316, Appeler, Itinéraire sont au-dessus de la bande des noms ; la photo est réduite à 120 px pour ça. À 320 × 568 les sept réponses demandent un défilement d’un écran : à mesurer au build.
- **R2** — La feuille pousse un état d’historique ; Retour et Échap la ferment ; le focus revient au bouton ; `?barbier=frank&prestation=coupe-classique` lisible, codes courts acceptés.
- **R3** — Rien de fixe ; cibles ≥ 44 px (audit : 0 sous 44 aux trois tailles), 48 px sur Réserver et l’acompte ; la bande des noms passe à deux lignes à 320 px sans rien recouvrir.
- **R4** — « Appeler » (`tel:`) en haut à droite de chaque main et le numéro en clair dans « Venir ».
- **R5** — La coque est du HTML statique ; les mains sont des attributs CSS ; le serveur rend `?barbier=` dans la bonne main avant tout script.
- **R6** — « Réserver pour une deuxième personne » sur le ticket.
- **R7** — Neuf choses sur le ticket ; l’acompte en mots (montant, raison, remboursement) avant le bouton.
- **R8** — « Créneau gardé pour toi · 4 min 32 » tant que la tenue court ; « vient d’être pris » seulement sur un refus réel du serveur.
- **R9** — Aucun texte sur photo ; cinq paires ≥ 7:1 ; audit : 0 ligne sous AA, 1 % de caractères sous 14 px (exposants et `code`) ; en mouvement réduit rien ne boucle ni ne se cache.
- **R10** — **Le point faible.** Cinq familles : la maison ne charge que Familjen ; une lettre de barbier (un woff2 ≤ 40 Ko) ne se charge qu’en entrant chez lui, avec repli système en attendant. Zéro tiers, polices auto-hébergées au build. À prouver au premier rendu sur 4G lente ; si ça ne passe pas, on coupe la lettre de deux mains (voir risques).

## Ce qu’on protège

« Réserver · dès 15 € » · le prochain créneau en direct · « Sans préférence · Le plus tôt » · le créneau gardé et son temps · « Comme la dernière fois ? » · le ticket et ses neuf choses · la ligne d’acompte · le message hors ligne qui garde la saisie · la feuille qui reprend · « Les prix, sans surprise. » · pas de compte · zéro requête tierce · le tutoiement et le lexique.

## Qui est le mieux servi, qui l’est le moins

**Le mieux :** le Fidèle (il ouvre le site et il est chez son barbier, « Reprendre » en un geste) ; le Passionné (une main par barbier, une lettre, une marque, un ticket à partager : « ils savent ce qu’ils font ») ; le Nouveau (la maison répond aux sept questions sans lui demander de choisir, « Sans préférence » est une réponse normale).

**Le moins :** l’Ancien (cinq lettrages, c’est cinq choses à apprendre ; on le protège en gardant la maison sobre, grande, et « Appeler » toujours au même endroit, mais la Caslon italique de Frank à 15 px serait une faute : les italiques ne descendent jamais sous 28 px) ; le Pressé (le rallumage est une seconde qu’il n’a pas demandée : pour lui, « Réserver avec Frank » saute l’étape « Avec qui ? » et n’anime rien) ; le Cadeau et le Futur Barbier (la carte cadeau et les formations restent dans la main de la maison, correctes et sans plus).

## Risques et ce qu’on couperait

1. **La cacophonie.** Cinq lettres sur quatre fauteuils. Garde-fou : la coque immobile, une seule voix, et une règle dure : **jamais deux mains sur un même écran** hors de la bande des noms et de l’étape « Avec qui ? ». Si un test persona montre de la confusion, on réduit à deux mains (la maison + celle du barbier choisi) et on garde les marques comme seuls signes.
2. **Un barbier qui n’aime pas sa main.** On montre les cinq à l’équipe un soir ; une main refusée se replie sur la maison sans casser le site.
3. **Le poids des fontes (R10).** Mesuré au build ; repli système ; si ça ne tient pas, Frank et Esteban gardent Familjen et seulement leur trait.
4. **L’ordre barbier-premier sur la home** peut faire croire que choisir est obligatoire. Garde-fou : « Sans préférence » déjà choisie et la ligne 3.

**On coupe en premier :** l’export image du ticket, le survol des portes sur ordinateur, les filtres photo, l’échelonnement des lignes dans la feuille.

## Plan de construction (composants et jours)

À partir du kit de la PR #1 (feuille thémable, client API typé, mouvement) :

| Composant | Contenu | Jours |
|---|---|---|
| `hands.css` | cinq blocs de variables sur `html[data-main]`, les cinq marques, les traitements photo, mouvement réduit | 1 |
| `Relight` | changement d’attribut, trait lumineux, mémoire du barbier (localStorage, comme le rebook), lecture de `?barbier=` côté serveur | 1 |
| `Enseigne` (home, premier écran) | les sept réponses, la bande des noms, « Comme la dernière fois ? » | 1,5 |
| `Portes` | cinq portes avec prochain créneau par barbier (API `next` par staffId) | 1 |
| Feuille (thème « main ») | adapter la feuille du kit : variables, « Avec qui ? » en cinq mains, maintien de la main jusqu’au ticket, noms lisibles dans les liens | 2 |
| `Ticket` | neuf choses + deuxième personne, main héritée, export image (si temps) | 1 |
| Pages autour | carte cadeau, formations, membre, 404 dans la main de la maison | 1 |
| Polices | sous-ensembles woff2 auto-hébergés, chargement par main, mesure du premier rendu | 0,5 |
| Audit et personas | `npm run ux`, R1–R10, les treize | 1 |

**Dix jours** pour une première version testable sur l’API réelle.
