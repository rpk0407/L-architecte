// @ts-check
// The real salon, as the old WordPress site (Salon Booking) had it on 13 November 2026: the four barbers and their week,
// the twelve services, the salon's hours and its booking rules. Read from the site's export (sln_attendant, sln_service)
// and the plugin's settings screen; nothing here names a client. Applied by commands/setup.js (applyPreset), through
// the normal commands, after the owner has read what it will do (Réglages › Mise en route).
// Since 14 November 2026, from the owner himself: Frank is the gérant (his chair goes to the owner's own account), Aland
// joined (not on the old site), and each one has his portrait, an illustration made for the salon that the owner allowed
// on the site and in the Comptoir (./equipe, 320 px WebP: setPhoto takes 24 KB at most).
// Since 16 November 2026, the real hours, from the owner himself, with his rule: the end he gives is the START of the
// last cut (« 9 h 30 – 17 h 30 : la première coupe s’ouvre à 9 h 30 et la dernière à 17 h 30 »). A slot is offered when the
// whole service fits inside a working interval (domain/availability.js: start >= a && start + dur <= b), so each interval
// here ends one cut (30 min, the slot step) after the hour he gave: a 30-minute cut can start at 17 h 30, an hour-long
// service at 17 h at the latest. A lunch break is a real gap: nothing starts between 13 h and 14 h. Also from him: the
// salon's days of December and January (closures, openings) and Aland's alternance (school).
// What the preset held before is kept in `hoursWas` and each barber's `was`: a salon that applied it then is offered the
// new hours (« horaires à mettre à jour », before and after), and hours the owner changed by hand since are never touched.
//
// What was left out on purpose:
// - the barbers' e-mails and phone: personal, and not needed (a barber signs in with his code);
// - commissions: the old site knows none, so each barber starts at 0 % and the owner sets his rate;
// - the one-day rules of the old site (a Monday opened on 31 August, a half day in April): they are past;
// - the « prix par barbier » of the old services: they contradict the titles and were never charged (see NOTES).

import { ZONE_B } from './vacances-zone-b.js';

/** one cut: the slot step, and what a working interval adds after the last start the owner gave */
const CUT = 30;
const lunch = /** @type {[number, number][]} */ ([[570, 780], [840, 1050 + CUT]]); // 9 h 30 – 17 h 30 (last cut), lunch 13 h – 14 h
const span = (a, b) => /** @type {[number, number][]} */ ([[a, b]]);

/** weekday (0 = Sunday) → working hours in minutes; a day without hours is his weekly day off */
const week = (days) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, days[d] || []]));

/** @typedef {{ slug: string, name: string, short?: string, category: string, price: number, dur: number, from?: boolean, online?: boolean, tag?: string, description?: string, includes?: string[], pack?: { credits: number, days: number, covers?: string[], with?: string[], weekly?: boolean, missed?: 'lost' | 'once' }, was?: string[], alias?: string, wp: string, wpStatus: 'publish' | 'draft' }} PresetService */
/**
 * owner: the gérant, whose account exists since the setup screen (whatever first name he typed): he gets this chair, never a
 * second account. wp: his name on the old site ('' for someone who was never on it). online: false, not bookable on the
 * site yet. photo: his portrait (a file beside this one), set only on a person who has no photo yet. was: the weeks an
 * earlier version of this preset gave him (online: false when it kept him off the site): someone who still has one of
 * them is offered today's week, anyone whose week is another keeps it.
 * @typedef {{ name: string, color: string, initials: string, schedule: Record<string, [number, number][]>, wp: string, owner?: boolean, online?: boolean, photo?: URL, was?: { schedule: Record<string, [number, number][]>, online?: boolean }[] }} PresetStaff
 */

export const ARCHITECTE = {
  id: 'architecte',
  name: 'L’Architecte',
  source: 'Relevé sur l’ancien site le 13 novembre 2026, horaires donnés par le gérant le 16 novembre 2026',

  // what the team really works: Tuesday to Saturday, from Frank's first cut (9 h) to the end of the last one (18 h)
  hours: week({ 2: span(540, 1080), 3: span(540, 1080), 4: span(540, 1080), 5: span(540, 1080), 6: span(540, 1080) }),
  // before 16 November 2026: the old plugin's « horaires d’ouverture », 8 h 30 – 18 h 30
  hoursWas: [week({ 2: span(510, 1110), 3: span(510, 1110), 4: span(510, 1110), 5: span(510, 1110), 6: span(510, 1110) })],

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
    // the old « Abonnement 80 € » is a prepaid pack (« Abonnement » is the monthly plan), sold on the site and at the
    // salon. In the owner's words (16 November 2026): one visit every week on a half-hour slot, shampooing, coupe, coiffage,
    // entretien de barbe, five weeks of upkeep for 80 €, a week skipped is lost. So each credit pays the cut (`covers`: the
    // classic one, or the one with the beard contour) and the beard upkeep done in the same visit is included (`with`).
    // `was`: the names this line had before; a salon that still has one of them is offered the update (never a name the
    // owner typed himself).
    // An appointment is never a carnet (the import's wizard keeps carnets out of its list), so the old title cannot
    // map to it by name: `alias` says where its bookings go instead, the visit itself, a coupe classique.
    { slug: 'ab', alias: 'cl', was: ['Carnet 5 coupes', 'Abonnement 5 coupes'], name: 'Formule Entretien 5 semaines', short: 'Entretien 5 sem.', category: 'Formule', price: 8000, dur: 30, tag: '16 € la visite', includes: ['Shampooing', 'Coupe', 'Coiffage', 'Entretien de barbe'], description: '5 visites · 1 par semaine · 16 € la visite. Une visite par semaine, cinq semaines de suite. Une semaine sautée est perdue.', pack: { credits: 5, days: 35, covers: ['cl', 'cc'], with: ['eb'], weekly: true, missed: 'lost' }, wp: 'Formule Abonnement  80€ 5 rdv sur 5 semaines d’affilées', wpStatus: 'publish' },
    // a draft on the old site, yet still booked from its back office: kept, at the salon only (never offered on the site)
    { slug: 'cco', name: 'Coupe + coloration', short: 'Coupe + couleur', category: 'Changer de tête', price: 3500, dur: 30, online: false, includes: ['Coupe d’entretien', 'Coloration', 'Soin de la barbe'], wp: 'Formule Coupe et coloration 35€', wpStatus: 'draft' }
  ],

  /**
   * The team, in the old site's order, then Aland. Each week is the owner's own (16 November 2026), the last cut at the
   * hour he gave. Monday and Sunday off for everyone.
   * - JKut and Esteban: Tuesday to Saturday 9 h 30 – 17 h 30, lunch 13 h – 14 h.
   * - Le Soldat: Tuesday, Thursday, Friday 9 h 30 – 15 h; Wednesday and Saturday 9 h 30 – 17 h 30; no break.
   * - Frank, the gérant (his chair, week, colour and initials go to the owner's account): Tuesday, Thursday, Friday,
   *   Saturday 9 h – 16 h 30; Wednesday 9 h – 13 h; no break.
   * - Aland, the apprentice: this week is the one of the school holidays, Tuesday to Saturday 9 h 30 – 17 h 30 with an
   *   hour's break; his school weeks are `school` below.
   * The portraits' paths are literal so the deployment's file tracing finds them (vercel.json includes the folder too).
   * @type {PresetStaff[]}
   */
  staff: [
    { name: 'JKut', color: '#EB4639', initials: 'JK', schedule: week({ 2: lunch, 3: lunch, 4: lunch, 5: lunch, 6: lunch }), wp: 'JKut', photo: new URL('./equipe/jkut.webp', import.meta.url) },
    { name: 'Le Soldat', color: '#60A5FA', initials: 'LS', schedule: week({ 2: span(570, 900 + CUT), 3: span(570, 1050 + CUT), 4: span(570, 900 + CUT), 5: span(570, 900 + CUT), 6: span(570, 1050 + CUT) }), wp: 'Soldat', photo: new URL('./equipe/le-soldat.webp', import.meta.url),
      was: [{ schedule: week({ 2: span(570, 930), 3: span(570, 1080), 4: span(570, 930), 5: span(570, 930), 6: span(540, 1080) }) }] },
    { name: 'Frank', owner: true, color: '#F5B544', initials: 'FR', schedule: week({ 2: span(540, 990 + CUT), 3: span(540, 780 + CUT), 4: span(540, 990 + CUT), 5: span(540, 990 + CUT), 6: span(540, 990 + CUT) }), wp: 'Frank', photo: new URL('./equipe/frank.webp', import.meta.url),
      was: [{ schedule: week({ 2: span(540, 990), 3: span(540, 780), 4: span(540, 990), 5: span(540, 990), 6: span(540, 990) }) }] },
    { name: 'Esteban', color: '#4ADE80', initials: 'ES', schedule: week({ 2: lunch, 3: lunch, 4: lunch, 5: lunch, 6: lunch }), wp: 'Esteban', photo: new URL('./equipe/esteban.webp', import.meta.url) },
    { name: 'Aland', color: '#C084FC', initials: 'AL', schedule: week({ 2: lunch, 3: lunch, 4: lunch, 5: lunch, 6: lunch }), wp: '', photo: new URL('./equipe/aland.webp', import.meta.url),
      was: [{ schedule: week({}), online: false }] }
  ],

  /**
   * Aland's alternance. No alternate week exists in the model, so his base week is the holiday one (above) and each
   * school week takes its CFA days away as absences the owner sees in Équipe: Wednesday from 12 h (he cuts from 9 h 30,
   * last cut 11 h 30, then the CFA), Thursday all day. Posted from the day the preset is applied to the end of the
   * school year, outside the zone B holidays and the days the salon is closed; a run after the summer starts posts the
   * next year's. `days`: weekday → 'day' (whole day) or the hours he is away.
   */
  school: {
    staff: 'Aland', reason: 'CFA', calendar: ZONE_B,
    days: /** @type {Record<string, 'day' | { startMin: number, endMin: number }>} */ ({ 3: { startMin: 720, endMin: 1080 }, 4: 'day' })
  },

  /**
   * The days off already posted on the old site that are still to come on 16 November 2026 (those past on the day it
   * is applied are skipped).
   */
  absences: [
    { staff: 'Esteban', from: '2026-11-17', to: '2026-11-18', reason: 'Absence' },
    { staff: 'Esteban', from: '2026-12-08', to: '2026-12-12', reason: 'Absence' }
  ],

  /** The days the salon is closed, from the owner (16 November 2026): Christmas and the New Year. Back on Tuesday 5 January. */
  closures: [
    { from: '2026-12-25', to: '2026-12-26', label: 'Noël' },
    { from: '2027-01-01', to: '2027-01-02', label: 'Jour de l’An' }
  ],

  /**
   * The two Mondays of the holidays the salon opens. The owner gave neither the hours nor who works: an opening has one
   * set of hours for everyone it gives a day to (domain/availability.js), so these are a normal day's, 9 h 30 to the last
   * cut at 17 h 30, for the whole team, and the notes tell him what is his to set.
   */
  openings: [
    { day: '2026-12-21', intervals: span(570, 1050 + CUT), label: 'Ouverture exceptionnelle', staff: /** @type {'all'} */ ('all') },
    { day: '2026-12-28', intervals: span(570, 1050 + CUT), label: 'Ouverture exceptionnelle', staff: /** @type {'all'} */ ('all') }
  ],

  /** What the owner should know before he confirms: what looks wrong on the old site, and what the Comptoir cannot guess. */
  notes: [
    'Les heures que tu as données sont celles de la première et de la dernière coupe. « 9 h 30 – 17 h 30 » : la dernière coupe commence à 17 h 30 et finit à 18 h, c’est pourquoi les horaires ci-dessus s’arrêtent 30 minutes plus tard. Une prestation d’une heure commence au plus tard 30 minutes avant. Pendant la pause de 13 h à 14 h, rien ne commence.',
    'Frank : dernière coupe à 16 h 30, et à 13 h le mercredi, soit 30 minutes plus tard que sur l’ancien site. Si 16 h 30 et 13 h sont tes heures de départ, raccourcis ta semaine dans Équipe.',
    'Le salon ouvre du mardi au samedi de 9 h à 18 h, au lieu de 8 h 30 – 18 h 30 sur l’ancien site : ce sont les heures que l’équipe travaille vraiment.',
    'Aland est en alternance. Sa semaine est celle des vacances scolaires (mardi au samedi). Les semaines d’école, ses absences « CFA » sont posées une par une : le mercredi à partir de 12 h et le jeudi toute la journée, jusqu’à la fin de l’année scolaire, hors vacances de la zone B. Tu les vois dans Équipe, sur sa fiche. Un jeudi férié hors vacances (Ascension, 6 mai 2027) est posé comme les autres : retire l’absence s’il travaille ce jour-là. À la rentrée, reviens ici pour poser l’année suivante.',
    'Lundis 21 et 28 décembre : le salon ouvre de 9 h 30 à 18 h (dernière coupe à 17 h 30) et toute l’équipe est proposée toute la journée, sans pause. À régler par toi : qui travaille ces deux lundis (Réglages › Horaires, Ouvertures exceptionnelles : supprime l’ouverture et recrée-la avec les barbiers présents) et, pour chacun, sa pause ou son départ plus tôt (Équipe, sa fiche, une absence de quelques heures).',
    'Six prestations ont sur l’ancien site un « prix par barbier » qui contredit leur titre (Cover barbe et Entretien barbe : 20 € au lieu de 15 € ; Transformation, Décoloration, Coloration et Silver : 25 €). Les réservations ont toujours été au prix du titre : c’est lui qui est repris.',
    '« Coupe et coloration 35 € » est en brouillon sur l’ancien site mais a encore un rendez-vous à venir : elle est reprise « au salon seulement », jamais proposée sur le site.',
    'L’« Abonnement 80 € » de l’ancien site devient la Formule Entretien 5 semaines, vendue sur le site (avec un compte client) et au salon : 5 visites, une par semaine, avec l’entretien de la barbe. Un rendez-vous déjà pris sous ce nom est une coupe classique : à la caisse, vends la formule et paie la visite avec.',
    'Les commissions ne sont pas connues de l’ancien site : chaque barbier commence à 0 %, règle la sienne dans Équipe.',
    'Chacun reçoit son portrait, s’il n’a pas encore de photo : dans le Comptoir et sur le site. Le tien et ceux de l’équipe se masquent du site dans Équipe ; chacun peut masquer le sien dans Mon espace.'
  ]
};

export const PRESETS = /** @type {Record<string, typeof ARCHITECTE>} */ ({ [ARCHITECTE.id]: ARCHITECTE });
