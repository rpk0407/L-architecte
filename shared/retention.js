// @ts-check
// How long a client file is kept: 3 years from the last contact (CNIL commercial referential, as /confidentialite
// promises). Shared so the retention purge (server/commands/clients.js) and the WordPress import's preview
// (web/src/lib/wpimport.ts) cut at the same day: nobody is collected only to be purged.

export const RETENTION_YEARS = 3;

/** The first day still kept: three years back to the day (a 29 February goes to the 28th). */
export function retentionCutoff(/** @type {string} */ today) {
  const md = today.slice(5) === '02-29' ? '02-28' : today.slice(5);
  return String(Number(today.slice(0, 4)) - RETENTION_YEARS) + '-' + md;
}
