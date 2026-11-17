// RETOURS-01 · What the owner asked for before the opening, on the client's pages (data only): the review link once the
// visit is done, the group booking shared with friends, the photo of the cut in the salon's frame.
import type { GuideStep } from '../../../lib/guide';

const steps: GuideStep[] = [
  { id: 'r.avis', page: '/r', target: 'r.avis', roles: ['client'], order: 910, title: 'Laisser un avis', body: 'Après ta visite, ce lien ouvre la page Google du salon. Rien n’est demandé avant la coupe, et rien n’est offert en échange.' },
  { id: 'site.groupe', page: '/', target: 'site-groupe', roles: ['client'], order: 905, title: 'Tu es l’organisateur', body: 'Une seule confirmation pour tout le groupe, avec le total. « Envoyer à mes amis » donne à chacun le lien de sa propre place.' },
  { id: 'r.groupe', page: '/r', target: 'r.groupe', roles: ['client'], order: 920, title: 'Ton groupe', body: 'Tu as réservé pour plusieurs : chaque personne, sa prestation, son prix et le total. « Gérer » ouvre la place de chacun.' },
  { id: 'r.partager', page: '/r', target: 'r.partager', roles: ['client'], order: 930, title: 'Envoyer à mes amis', body: 'Un message avec le jour, l’heure, l’adresse et, pour chaque ami, le lien de sa propre place. Il ne voit que la sienne.' },
  { id: 'r.photo', page: '/r', target: 'r.photo', roles: ['client'], order: 940, title: 'Ta coupe en photo', body: 'Ta photo dans le cadre du salon, en carré ou en story, à partager ou à enregistrer. Elle reste sur ton téléphone.' }
];
export default steps;
