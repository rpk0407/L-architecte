// What the salon says about itself, shared by every version of the site. Prices, barbers and hours come
// from the salon (salon.ts) once loaded; the values here only paint the first frame and feed search engines.
export const SHOP = {
  name: 'Barber L’Architecte',
  short: 'L’Architecte',
  address: '16, place Pélabon',
  city: '13013 Marseille',
  hoursText: 'Du mardi au samedi, 9 h – 18 h 30',
  rating: 5.0,
  reviews: 316,
  maps: 'https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
  reviewsUrl: 'https://search.google.com/local/reviews?placeid=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
  instagram: 'https://www.instagram.com/barbershoplarchitecte/',
  instagramHandle: '@barbershoplarchitecte',
  facebook: 'https://www.facebook.com/pg/barbershop.larchitecte/',
  youtube: 'https://www.youtube.com/channel/UCi2oLstkv0IIucLyd211G8A',
  video: 'https://www.youtube.com/watch?v=IP4PTgpZg-8',
  formations: 'https://barberlarchitecte.com/formations/',
  giftcard: 'https://barberlarchitecte.com/a-toutes-occasions-offrez-un-moment-privilegie-a-vos-proches-en-leur-offrant-une-carte-cadeau/',
  legal: 'https://barberlarchitecte.com/mentions-legales',
  email: 'larchitectebarber@gmail.com'
};

/** The four photos of the salon. w/h are the files' real sizes; focus is where the subject is (object-position). */
export const PHOTOS = {
  fade: { src: '/img/fade.jpg', w: 1100, h: 1077, focus: '62% 40%', alt: 'Client de profil : cheveux décolorés, dégradé à blanc net sur les côtés' },
  sidepart: { src: '/img/sidepart.jpg', w: 1100, h: 1355, focus: '50% 30%', alt: 'Raie marquée sur le côté, dégradé bas, nuque tatouée' },
  curls: { src: '/img/curls.jpg', w: 1100, h: 1315, focus: '45% 45%', alt: 'Boucles serrées sur le dessus, dégradé net et barbe taillée, face au miroir du salon' },
  salon: { src: '/img/salon.jpg', w: 1100, h: 812, focus: '50% 50%', alt: 'Le salon : long miroir bordé de LED rouge, canapés noir et rouge, fauteuils et bacs à shampooing' }
} as const;

/** Looks shown on the sites, each tied to the service that makes it. */
export const LOOKS = [
  { key: 'sidepart', photo: PHOTOS.sidepart, title: 'La raie marquée', line: 'Dégradé bas, raie tracée', slug: 'cl' },
  { key: 'curls', photo: PHOTOS.curls, title: 'Boucles et barbe', line: 'Contour net, barbe taillée', slug: 'ct' },
  { key: 'fade', photo: PHOTOS.fade, title: 'Décoloré, à blanc', line: 'Dégradé à blanc, décoloré', slug: 'cd' }
] as const;

export const REVIEWS = [
  { name: 'Maï', initial: 'M', date: 'févr. 2026', before: 'Ce n’est pas une simple coupe, c’est une réelle ', em: 'construction au millimètre', after: '.' },
  { name: 'Elias R.', initial: 'E', date: 'mars 2026', before: '…accueil chaleureux… très bonne ambiance ', em: 'amicale, convivial, et familiale', after: '… je suis vraiment très satisfait.' },
  { name: 'Un client', initial: 'C', date: 'mars 2026', before: 'Très sympa et ', em: 'très à l’écoute', after: '.' }
];
export const REVIEW_TAGS = ['L’accueil', 'Le professionnalisme', 'L’hygiène', 'Les produits', 'L’ambiance', 'Le suivi'];

export const FAQ = [
  { q: 'Combien coûte une coupe chez L’Architecte ?', a: 'La coupe classique est à 20 €. Avec le contour de barbe, 25 €. Avec la taille de barbe, 30 €. La transformation complète est à 50 €.' },
  { q: 'Quels sont les horaires du salon ?', a: 'Du mardi au samedi, de 9 h à 18 h 30. Le salon est fermé le dimanche et le lundi.' },
  { q: 'Où se trouve le salon ?', a: 'Au 16, place Pélabon, 13013 Marseille.' },
  { q: 'Comment réserver ?', a: 'En ligne, en moins d’une minute et sans créer de compte : tu choisis ta prestation, ton barbier et ton créneau. Tu reçois un SMS de confirmation avec un lien pour déplacer ou annuler.' },
  { q: 'Faites-vous les décolorations et le silver ?', a: 'Oui. Décoloration dès 60 €, coloration dès 30 €, silver (blanc ou gris) à 100 €, toujours après un avis sur la faisabilité.' },
  { q: 'Existe-t-il un abonnement ?', a: 'Oui : 5 coupes sur 5 semaines pour 80 €, soit 16 € la coupe, hors barbe. Tu réserves la première, le salon fixe les suivantes avec toi.' },
  { q: 'Et sans rendez-vous ?', a: 'Passe au salon : on t’installe dès qu’un fauteuil se libère. Le temps d’attente estimé est affiché en direct sur le site.' },
  { q: 'Le salon forme-t-il des barbiers ?', a: 'Oui. L’Architecte est titulaire d’un agrément de formateur en coiffure et propose des stages, de l’entretien de la barbe à la coupe homme complexe.' },
  { q: 'Peut-on payer par carte ?', a: 'Oui, la carte bancaire est acceptée au salon. Pour certaines prestations longues, un acompte est demandé en ligne et déduit du prix.' }
];

/** The catalogue as it was when the page was written: first paint only, replaced by the salon's live catalogue. */
export const FALLBACK_SERVICES = [
  { slug: 'cl', name: 'Coupe classique', short: 'Coupe', category: 'Coupes', price: 2000, from: false, dur: 30, includes: ['Coupe', 'Shampooing', 'Coiffage'] },
  { slug: 'cc', name: 'Coupe + contour de barbe', short: 'Coupe + contour', category: 'Coupes', price: 2500, from: false, dur: 30, includes: ['Coupe', 'Contour de la barbe'] },
  { slug: 'ct', name: 'Coupe + taille de barbe', short: 'Coupe + taille', category: 'Coupes', price: 3000, from: false, dur: 30, includes: ['Coupe', 'Taille de barbe', 'Shampooing', 'Coiffage', 'Soin cheveux', 'Soin barbe'] },
  { slug: 'tr', name: 'Transformation', short: 'Transformation', category: 'Changer de tête', price: 5000, from: false, dur: 60, includes: ['Diagnostic', 'Étude de faisabilité', 'Coupe', 'Coiffage et soin'] },
  { slug: 'cd', name: 'Coupe + décoloration', short: 'Coupe + déco', category: 'Changer de tête', price: 8000, from: true, dur: 90, includes: ['Coupe', 'Décoloration'] },
  { slug: 'de', name: 'Décoloration', short: 'Décoloration', category: 'Changer de tête', price: 6000, from: true, dur: 60, includes: ['Décoloration', 'Sans coupe'] },
  { slug: 'co', name: 'Coloration', short: 'Coloration', category: 'Changer de tête', price: 3000, from: true, dur: 60, includes: ['Coloration', 'Sans coupe'] },
  { slug: 'si', name: 'Silver', short: 'Silver', category: 'Changer de tête', price: 10000, from: false, dur: 60, includes: ['Décoloration jusqu’au blanc', 'Coloration grise', 'Soin'] },
  { slug: 'eb', name: 'Entretien barbe', short: 'Entretien barbe', category: 'Barbe', price: 1500, from: false, dur: 30, includes: ['Contour de la barbe', 'Huile'] },
  { slug: 'tb', name: 'Taille de barbe', short: 'Taille de barbe', category: 'Barbe', price: 1800, from: false, dur: 30, includes: ['Taille', 'Mise en forme', 'Huile'] },
  { slug: 'cb', name: 'Cover barbe', short: 'Cover barbe', category: 'Barbe', price: 1500, from: false, dur: 30, includes: ['Couleur de la barbe', 'Soin'] },
  { slug: 'ab', name: 'Abonnement 5 coupes', short: 'Abonnement', category: 'Abonnement', price: 8000, from: false, dur: 30, includes: ['5 coupes sur 5 semaines', 'Sans barbe'] }
];
export const FALLBACK_BARBERS = [
  { key: 'jkut', name: 'JKut', initials: 'JK', color: '#EB4639', bio: 'Dégradés à la précision chirurgicale. Le fondateur de la méthode « construction au millimètre ».', instagram: 'https://www.instagram.com/jkut.nw' },
  { key: 'frank', name: 'Frank', initials: 'F', color: '#F5B544', bio: 'Coupes classiques et barbes taillées à l’ancienne.', instagram: '' },
  { key: 'soldat', name: 'Le Soldat', initials: 'LS', color: '#60A5FA', bio: 'Skin fade, contours nets, couleur et silver.', instagram: '' },
  { key: 'esteban', name: 'Esteban', initials: 'E', color: '#4ADE80', bio: 'Textures, boucles et transformations.', instagram: '' }
];

/** The haircut ages: what the "on recoupe ?" moment says, week by week. */
export const AGING = ['J+0. Comme neuf.', 'Une semaine plus tard.', 'Le contour s’efface.', 'Le dégradé se brouille.', 'Ça se voit. On recoupe ?'];

/** Search engines: the salon as a business (same as the original site). */
export const JSON_LD = {
  '@context': 'https://schema.org', '@type': 'HairSalon', name: 'Barber L’Architecte', url: 'https://barberlarchitecte.com/', email: 'larchitectebarber@gmail.com',
  address: { '@type': 'PostalAddress', streetAddress: '16, place Pélabon', postalCode: '13013', addressLocality: 'Marseille', addressCountry: 'FR' },
  openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '09:00', closes: '18:30' }],
  aggregateRating: { '@type': 'AggregateRating', ratingValue: '5.0', reviewCount: '316' }, priceRange: '€€'
};
