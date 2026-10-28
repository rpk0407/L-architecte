// What Pilotage says about itself (TEAM-05a): one step per part, in the order of the page. Data only; the tour reads it.
import type { GuideStep } from '../../../lib/guide';

const PAGE = '/comptoir/pilotage';
// the page is the owner's and the managers' (report.shop)
const SHOP: GuideStep['roles'] = ['owner', 'manager'];

const steps: GuideStep[] = [
  { id: 'pilotage.periode', page: PAGE, target: 'pilotage.periode', roles: SHOP, order: 10, title: 'Période', body: 'Choisis Aujourd’hui, Semaine ou Mois, puis les flèches pour revenir en arrière. Tous les chiffres de la page suivent, comparés à la période d’avant.' },
  { id: 'pilotage.montants', page: PAGE, target: 'pilotage.montants', roles: SHOP, order: 15, title: 'Montants', body: 'Sur un écran que d’autres voient, les montants sont floutés. Touche ce bouton pour les voir 30 secondes.' },
  { id: 'pilotage.caisse', page: PAGE, target: 'pilotage.caisse', roles: SHOP, order: 20, title: 'La caisse', body: 'Le tiroir, le Z du jour et les encaissements qui attendent, à l’instant. Un Z manquant ou une alerte passe en couleur : « Ouvrir la caisse » mène à la clôture.' },
  { id: 'pilotage.encaisse', page: PAGE, target: 'pilotage.encaisse', roles: SHOP, order: 30, title: 'Encaissé', body: 'L’argent entré sur la période, avec l’objectif du mois, ce qu’il reste à faire par jour ouvré et où tu arrives à ce rythme. La barre marque où tu devrais en être aujourd’hui.' },
  { id: 'pilotage.remplissage', page: PAGE, target: 'pilotage.remplissage', roles: SHOP, order: 40, title: 'Remplissage', body: 'La part des heures ouvertes qui est réservée, salon puis fauteuil par fauteuil. Une barre courte, c’est de la place à vendre.' },
  { id: 'pilotage.clients', page: PAGE, target: 'pilotage.clients', roles: SHOP, order: 50, title: 'Clients', body: 'Combien de clients sont passés, dont combien de nouveaux. Les nouveaux sont ceux dont c’est la première visite au salon.' },
  { id: 'pilotage.absences', page: PAGE, target: 'pilotage.absences', roles: SHOP, order: 60, title: 'Absences', body: 'Les clients qui ne sont pas venus, la part que ça représente et l’argent perdu quand ni acompte ni frais ne l’ont couvert.' },
  { id: 'pilotage.repris', page: PAGE, target: 'pilotage.repris', roles: SHOP, order: 70, title: 'Repris avant de partir', body: 'La part des clients qui reprennent rendez-vous à la caisse. C’est le geste qui fait revenir le plus.' },
  { id: 'pilotage.realise', page: PAGE, target: 'pilotage.realise', roles: SHOP, order: 80, title: 'Chiffre réalisé', body: 'Ce que l’équipe a coupé, y compris les coupes de carnet et d’abonnement déjà payées. Il peut différer d’Encaissé : l’argent d’un carnet est entré le jour de sa vente.' },
  { id: 'pilotage.encours', page: PAGE, target: 'pilotage.encours', roles: SHOP, order: 90, title: 'En cours', body: 'Ce que tu dois encore aux clients : le solde des cartes cadeaux et les coupes qui restent sur les carnets.' },
  { id: 'pilotage.equipe', page: PAGE, target: 'pilotage.equipe', roles: SHOP, order: 100, title: 'L’équipe', body: 'Un barbier par ligne, dans l’ordre des fauteuils et jamais classés : son chiffre, son objectif du mois, son remplissage. Touche une ligne pour tout voir de lui, son agenda et son relevé du mois.' },
  { id: 'pilotage.equite', page: PAGE, target: 'pilotage.equite', roles: SHOP, order: 110, title: 'Équité', body: 'Un repère quand les nouveaux clients, les passages ou les heures libres ne se répartissent pas comme les heures de chacun. Elle n’apparaît qu’avec assez de visites pour que ça compte.' },
  { id: 'pilotage.abonnes', page: PAGE, target: 'pilotage.abonnes', roles: SHOP, order: 120, title: 'Abonnés', body: 'Les abonnés en chiffres : présence de la semaine, revenu du mois et paiements à régulariser. « Voir le tableau » ouvre la liste des abonnés.' },
  { id: 'pilotage.espace-client', page: PAGE, target: 'pilotage.espace-client', roles: SHOP, order: 130, title: 'Espace client', body: 'Combien de clients ont ouvert leur espace sur le site et combien y sont revenus ce mois-ci. Elle n’apparaît que si l’espace client est ouvert.' },
  { id: 'pilotage.avis', page: PAGE, target: 'pilotage.avis', roles: SHOP, order: 140, title: 'Avis Google', body: 'Les demandes d’avis parties sur la période et la part dont le lien a été ouvert. Les avis eux-mêmes se lisent sur ta fiche Google.' }
];

export default steps;
