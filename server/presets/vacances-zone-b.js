// @ts-check
// The school holidays of zone B (académie d'Aix-Marseille, so Marseille), as the official calendar gives them. Used for
// Aland, the apprentice: at the CFA on school weeks, at the salon all week during the holidays (presets/architecte.js).
// Source: https://www.service-public.gouv.fr/particuliers/vosdroits/F31952 (Service-Public.fr, « vérifié le 2 septembre
// 2026 »), read on 16 November 2026; the same dates on https://www.service-public.gouv.fr/particuliers/actualites/a15047.
// 2026-2027: arrêté du 22 octobre 2025. 2027-2028: arrêté du 21 juillet 2026.
// The calendar's own rule: « Les vacances débutent les jours indiqués, après les cours. Les cours reprennent le matin
// des jours indiqués. » So `after` is the last day of class and `back` the first one: the days strictly between are
// holidays. `start`: the pupils' first day; `end`: the day the summer holidays begin, after class.
// Not a holiday in this file: the Ascension bridge (no class on Friday 7 May 2027, nor on 26 and 27 May 2028). A date
// nobody published is never guessed: a day after the last year here is `null` (schoolDay), and the plan says so.
// tests/unit/preset.test.js pins every date.

/** @typedef {{ name: string, after: string, back: string }} Holiday */
/** @typedef {{ id: string, start: string, end: string, holidays: Holiday[] }} SchoolYear */

export const ZONE_B = {
  zone: 'B',
  academie: 'Aix-Marseille',
  source: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F31952',
  read: '2026-11-16',
  /** @type {SchoolYear[]} */
  years: [
    {
      id: '2026-2027', start: '2026-09-01', end: '2027-07-03',
      holidays: [
        { name: 'Toussaint', after: '2026-10-17', back: '2026-11-02' },
        { name: 'Noël', after: '2026-12-19', back: '2027-01-04' },
        { name: 'Hiver', after: '2027-02-20', back: '2027-03-08' },
        { name: 'Printemps', after: '2027-04-17', back: '2027-05-03' }
      ]
    },
    {
      id: '2027-2028', start: '2027-09-02', end: '2028-07-04',
      holidays: [
        { name: 'Toussaint', after: '2027-10-23', back: '2027-11-08' },
        { name: 'Noël', after: '2027-12-18', back: '2028-01-03' },
        { name: 'Hiver', after: '2028-02-05', back: '2028-02-21' },
        { name: 'Printemps', after: '2028-04-08', back: '2028-04-24' }
      ]
    }
  ]
};

/**
 * The school year a day belongs to, the summer before it included (a day of July or August is next year's business);
 * null after the last year the calendar gives.
 * @param {string} day YYYY-MM-DD @param {{ years: SchoolYear[] }} [cal]
 */
export function schoolYearOf(day, cal = ZONE_B) {
  return cal.years.find((y) => day <= y.end) || null;
}

/**
 * 'school': a day of the school weeks; 'holiday': inside the holidays (the summer between two known years included);
 * null: not known (after the last year of the calendar).
 * @param {string} day YYYY-MM-DD @param {{ years: SchoolYear[] }} [cal]
 * @returns {'school' | 'holiday' | null}
 */
export function schoolDay(day, cal = ZONE_B) {
  const y = schoolYearOf(day, cal);
  if (!y) return null;
  if (day < y.start) return 'holiday';
  return y.holidays.some((h) => day > h.after && day < h.back) ? 'holiday' : 'school';
}
