# Barber L'Architecte · démo

Démo privée du nouveau système de réservation de Barber L'Architecte.

- `/` : comment ça marche (le test, la simulation d'une réservation, les données)
- `/site` : le site client, avec la réservation
- `/comptoir` : le Comptoir, l'écran du salon

## Ce qui tourne

- `public/` : les pages, servies telles quelles.
- `api/lx.js` : le petit serveur qui partage les réservations entre le téléphone du client et le Comptoir. Il garde un créneau 5 minutes pendant que le client remplit son nom, et refuse une réservation si la place vient d'être prise.

## Données

Démo uniquement : prénom, initiale du nom, deux derniers chiffres du téléphone, note facultative. Les données appartiennent au salon. Aucun SMS n'est envoyé. Tout est effacé au bout de 7 jours, et les pages ne sont pas indexées par les moteurs de recherche.

## Remettre la démo à zéro

Comptoir › Réglages › Remettre la démo à zéro.
