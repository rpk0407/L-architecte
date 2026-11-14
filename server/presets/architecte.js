// @ts-check
// The real salon, as the old WordPress site (Salon Booking) had it on 13 November 2026: the four barbers and their week,
// the twelve services, the salon's hours and its booking rules. Read from the site's export (sln_attendant, sln_service)
// and the plugin's settings screen; nothing here names a client. Applied by commands/setup.js (applyPreset), through
// the normal commands, after the owner has read what it will do (Réglages › Mise en route).
// Since 14 November 2026, from the owner himself: Frank is the gérant (his chair goes to the owner's own account), Aland
// joined (not on the old site, hours unknown), and each one has his portrait, an illustration made for the salon that
// the owner allowed on the site and in the Comptoir (./equipe, 320 px WebP: setPhoto takes 24 KB at most).
//
// What was left out on purpose:
// - the barbers' e-mails and phone: personal, and not needed (a barber signs in with his code);
// - commissions: the old site knows none, so each barber starts at 0 % and the owner sets his rate;
// - the one-day rules of the old site (a Monday opened on 31 August, a half day in April): they are past;
// - the « prix par barbier » of the old services: they contradict the titles and were never charged (see NOTES).

const lunch = /** @type {[number, number][]} */ ([[570, 780], [840, 1080]]); // 9 h 30 – 13 h, 14 h – 18 h
const span = (a, b) => /** @type {[number, number][]} */ ([[a, b]]);

/** weekday (0 = Sunday) → working hours in minutes; a day without hours is his weekly day off */
const week = (days) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, days[d] || []]));

/** @typedef {{ slug: string, name: string, short?: string, category: string, price: number, dur: number, from?: boolean, online?: boolean, tag?: string, description?: string, includes?: string[], pack?: { credits: number, days: number, covers?: string[], weekly?: boolean, missed?: 'lost' | 'once' }, alias?: string, wp: string, wpStatus: 'publish' | 'draft' }} PresetService */
/**
 * owner: the gérant, whose account exists since the setup screen (whatever first name he typed): he gets this chair, never a
 * second account. wp: his name on the old site ('' for someone who was never on it). online: false, not bookable on the
 * site yet. photo: his portrait (a file beside this one), set only on a person who has no photo yet.
 * @typedef {{ name: string, color: string, initials: string, schedule: Record<string, [number, number][]>, wp: string, owner?: boolean, online?: boolean, photo?: URL }} PresetStaff
 */

export const ARCHITECTE = {
  id: 'architecte',
  name: 'L’Architecte',
  source: 'Relevé sur l’ancien site le 13 novembre 2026',

  // the plugin's « horaires d’ouverture »: Tuesday to Saturday, one shift
  hours: week({ 2: span(510, 1110), 3: span(510, 1110), 4: span(510, 1110), 5: span(510, 1110), 6: span(510, 1110) }),

  // its booking rules: a slot every 30 min, bookable from 5 min to 3 months ahead, cancelled online until 24 h before
  booking: { stepMin: 30, minNoticeMin: 5, maxDaysAhead: 90, cancelUntilHours: 24 },

  /**
   * The twelve services of the old site, in the site's order. `wp`: the old title, which the WordPress import matches
   * by its words (web/src/lib/wpimport.ts, bestMatch on name, short and slug): each name here keeps the words of its
   * old title, so eleven map without a choice, and the twelfth (the carnet) through its `alias`. The slugs are those
   * the Comptoir already knows (Catalogue › « Reprendre la carte de l’ancien site » creates the same eleven; « cl » is
   * the usual cut of the Accueil).
   * @type {PresetService[]}
   */
  services: [
    { slug: 'cl', name: 'Coupe classique', short: 'Coupe', category: 'Coupes', price: 2000, dur: 30, includes: ['Coupe', 'Shampooing', 'Coiffage'], description: 'Ne comprend pas la barbe.', wp: 'Formule Coupe Classique 20€', wpStatus: 'publish' },
    { slug: 'cc', name: 'Coupe + contour de barbe', short: 'Coupe + contour', category: 'Coupes', price: 2500, dur: 30, includes: ['Coupe', 'Contour de la barbe', 'Shampooing', 'Coiffage'], wp: 'Formule Coupe + Contour Barbe 25€', wpStatus: 'publish' },
    { slug: 'ct', name: 'Coupe + taille de barbe', short: 'Coupe + taille', category: 'Coupes', price: 3000, dur: 30, tag: 'La plus complète', includes: ['Coupe', 'Taille de barbe', 'Shampooing', 'Coiffage', 'Soin cheveux', 'Soin barbe'], wp: 'Formule Coupe + Taille de Barbe 30€', wpStatus: 'publish' },
    { slug: 'tb', name: 'Taille de barbe', category: 'Barbe', price: 1800, dur: 30, includes: ['Taille', 'Mise en forme', 'Huile'], wp: 'Formule Taille de Barbe 18€', wpStatus: 'publish' },
    { slug: 'eb', name: 'Entretien barbe', category: 'Barbe', price: 1500, dur: 30, includes: ['Contour de la barbe', 'Huile'], wp: 'Formule Entretien Barbe 15€', wpStatus: 'publish' },
    { slug: 'cb', name: 'Cover barbe', category: 'Barbe', price: 1500, dur: 30, includes: ['Couleur de la barbe', 'Soin'], wp: 'Formule Cover Barbe 15€', wpStatus: 'publish' },
    { slug: 'tr', name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60, tag: 'Changement de look', includes: ['Diagnostic', 'Étude de faisabilité', 'Coupe', 'Coiffage et soin'], wp: 'Formule Transformation  50€', wpStatus: 'publish' },
    { slug: 'de', name: 'Décoloration', category: 'Changer de tête', price: 6000, from: true, dur: 60, includes: ['Décoloration', 'Shampooing et soin', 'Sans coupe'], description: 'Sous condition de faisabilité. À partir de 60 € sur cheveux courts.', wp: 'Formule Décoloration  60€', wpStatus: 'publish' },
    { slug: 'co', name: 'Coloration', category: 'Changer de tête', price: 3000, from: true, dur: 60, includes: ['Coloration', 'Shampooing et soin', 'Sans coupe'], description: 'À partir de 30 € sur cheveux courts.', wp: 'Formule Coloration 30€', wpStatus: 'publish' },
    { slug: 'si', name: 'Silver', category: 'Changer de tête', price: 10000, dur: 60, tag: 'Blanc ou gris', includes: ['Décoloration jusqu’au blanc', 'Coloration grise', 'Soin', 'Produit d’entretien offert'], description: 'Ne pas laver la tête pendant 4 jours minimum.', wp: 'Formule Silver 100€', wpStatus: 'publish' },
    // the old « Abonnement 80 € » is a prepaid pack: here it is the Carnet (« Abonnement » is the monthly plan), sold on the
    // site and at the salon: five cuts, one a week from the first date (weekly), a week without a cut lost (missed).
    // An appointment is never a carnet (the import's wizard keeps carnets out of its list), so the old title cannot
    // map to it by name: `alias` says where its bookings go instead, the visit itself, a coupe classique.
    { slug: 'ab', alias: 'cl', name: 'Carnet 5 coupes', short: 'Carnet', category: 'Carnet', price: 8000, dur: 30, tag: '16 € la coupe', includes: ['5 coupes, une par semaine', 'Shampooing et coiffage', 'Sans la barbe'], description: '16 € la coupe. Tu choisis tes 5 rendez-vous en réservant, un par semaine.', pack: { credits: 5, days: 35, covers: ['cl'], weekly: true, missed: 'lost' }, wp: 'Formule Abonnement  80€ 5 rdv sur 5 semaines d’affilées', wpStatus: 'publish' },
    // a draft on the old site, yet still booked from its back office: kept, at the salon only (never offered on the site)
    { slug: 'cco', name: 'Coupe + coloration', short: 'Coupe + couleur', category: 'Changer de tête', price: 3500, dur: 30, online: false, includes: ['Coupe d’entretien', 'Coloration', 'Soin de la barbe'], wp: 'Formule Coupe et coloration 35€', wpStatus: 'draft' }
  ],

  /**
   * The four barbers of the old site, in its order, each with his usual week (the rules marked « toujours » there), then
   * Aland. Monday and Sunday off for everyone; Frank also stops at 13 h on Wednesday. Frank is the gérant: his chair, week,
   * colour and initials go to the owner's account. Aland is new: no week is known, so he is created without one and kept
   * off the site until the owner enters his hours (see notes). The portraits' paths are literal so the deployment's file
   * tracing finds them (vercel.json includes the folder too).
   * @type {PresetStaff[]}
   */
  staff: [
    { name: 'JKut', color: '#EB4639', initials: 'JK', schedule: week({ 2: lunch, 3: lunch, 4: lunch, 5: lunch, 6: lunch }), wp: 'JKut', photo: new URL('./equipe/jkut.webp', import.meta.url) },
    { name: 'Le Soldat', color: '#60A5FA', initials: 'LS', schedule: week({ 2: span(570, 930), 3: span(570, 1080), 4: span(570, 930), 5: span(570, 930), 6: span(540, 1080) }), wp: 'Soldat', photo: new URL('./equipe/le-soldat.webp', import.meta.url) },
    { name: 'Frank', owner: true, color: '#F5B544', initials: 'FR', schedule: week({ 2: span(540, 990), 3: span(540, 780), 4: span(540, 990), 5: span(540, 990), 6: span(540, 990) }), wp: 'Frank', photo: new URL('./equipe/frank.webp', import.meta.url) },
    { name: 'Esteban', color: '#4ADE80', initials: 'ES', schedule: week({ 2: lunch, 3: lunch, 4: lunch, 5: lunch, 6: lunch }), wp: 'Esteban', photo: new URL('./equipe/esteban.webp', import.meta.url) },
    { name: 'Aland', color: '#C084FC', initials: 'AL', schedule: week({}), wp: '', online: false, photo: new URL('./equipe/aland.webp', import.meta.url) }
  ],

  /** The whole days off already posted on the old site for the weeks to come (those past on the day it is applied are skipped). */
  absences: [
    { staff: 'Esteban', from: '2026-11-13', to: '2026-11-14', reason: 'Absence' },
    { staff: 'Esteban', from: '2026-11-17', to: '2026-11-18', reason: 'Absence' },
    { staff: 'Esteban', from: '2026-12-08', to: '2026-12-12', reason: 'Absence' }
  ],

  /** What the owner should know before he confirms: what looks wrong on the old site, and what the Comptoir cannot guess. */
  notes: [
    'Le salon est ouvert de 8 h 30 à 18 h 30 sur l’ancien site, mais aucun barbier ne commence avant 9 h ni ne finit après 18 h : le site ne proposera rien en dehors de leurs horaires.',
    'Six prestations ont sur l’ancien site un « prix par barbier » qui contredit leur titre (Cover barbe et Entretien barbe : 20 € au lieu de 15 € ; Transformation, Décoloration, Coloration et Silver : 25 €). Les réservations ont toujours été au prix du titre : c’est lui qui est repris.',
    '« Coupe et coloration 35 € » est en brouillon sur l’ancien site mais a encore un rendez-vous à venir : elle est reprise « au salon seulement », jamais proposée sur le site.',
    'L’« Abonnement 80 € » de l’ancien site devient le Carnet 5 coupes, vendu sur le site (avec un compte client) et au salon : 5 coupes, une par semaine. Un rendez-vous déjà pris sous ce nom est une coupe classique : à la caisse, vends le carnet et paie la coupe avec.',
    'Les commissions ne sont pas connues de l’ancien site : chaque barbier commence à 0 %, règle la sienne dans Équipe.',
    'Aland n’est pas sur l’ancien site et ses horaires ne sont pas connus : il est créé sans horaires et n’est pas proposé en ligne. Entre sa semaine dans Équipe (sa fiche), puis active « Réservable en ligne ».',
    'Chacun reçoit son portrait, s’il n’a pas encore de photo : dans le Comptoir et sur le site. Le tien et ceux de l’équipe se masquent du site dans Équipe ; chacun peut masquer le sien dans Mon espace.'
  ]
};

export const PRESETS = /** @type {Record<string, typeof ARCHITECTE>} */ ({ [ARCHITECTE.id]: ARCHITECTE });
