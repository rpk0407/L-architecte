// @ts-check
// Finding a client at the desk, fast: a first name or a number, typed as it comes. Accents and case do not count,
// words come in any order (« belkacem gab »), a number is read the same with « +33 6 », « 0033 6 » or « 06 », and a
// name that STARTS with what was typed comes before one that merely contains it (« kar »: Karim before Zakaria).

/** lower case, no accents */
export const fold = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** A number as the national digits: +33 6…, 0033 6… and 33 6… all read 06… */
export const nationalDigits = (v) => String(v || '').replace(/\D/g, '').replace(/^00/, '').replace(/^33(?=[1-9])/, '0');

/**
 * What was typed, split into name words and one run of digits.
 * @param {string} q
 * @returns {{ words: string[], digits: string, intl: boolean }}
 */
export function parseSearch(q) {
  const raw = fold(q).trim();
  const words = [];
  let digits = '';
  for (const tok of raw.split(/\s+/).filter(Boolean)) {
    if (/[a-z]/.test(tok)) words.push(...tok.split(/[^a-z0-9]+/).filter(Boolean));
    else digits += tok.replace(/\D/g, '');
  }
  // « +33 », « 0033 »: an international prefix for sure; a bare « 33… » may also be the middle of a number
  const intl = /^\s*(\+|00)\s*33/.test(raw);
  return { words, digits, intl };
}

/**
 * How well a client answers a search: null when he does not, else a rank (0 is best).
 * Name words must all be found; each counts 0 at the start of the first name, 1 at the start of another word of the
 * name, 2 inside a word. Digits (2 at least) must be in the number: 0 at its start, 1 inside.
 * @param {{ first?: string, last?: string, phone?: string }} c
 * @param {{ words: string[], digits: string, intl: boolean }} s
 * @returns {number | null}
 */
export function searchRank(c, s) {
  if (!s.words.length && s.digits.length < 2) return null;
  let rank = 0;
  if (s.words.length) {
    const first = fold(c.first), name = (first + ' ' + fold(c.last)).trim();
    const parts = name.split(/[^a-z0-9]+/).filter(Boolean);
    for (const w of s.words) {
      if (first.startsWith(w)) continue;
      if (parts.some((p) => p.startsWith(w))) rank += 1;
      else if (name.includes(w)) rank += 2;
      else return null;
    }
  }
  if (s.digits.length >= 2) {
    const phone = nationalDigits(c.phone);
    const nat = nationalDigits(s.digits);
    const at = phone.indexOf(nat);
    // a bare « 33 12 » is tried both ways: the country code, or digits from the middle of the number
    const alt = !s.intl && nat !== s.digits ? phone.indexOf(s.digits) : -1;
    if (at < 0 && alt < 0) return null;
    rank += at === 0 ? 0 : 1;
  } else if (s.digits.length && !s.words.length) return null;
  return rank;
}

/**
 * The clients a search keeps, best first; `then` breaks ties (the list's own order, most recent visit by default).
 * @template {{ first?: string, last?: string, phone?: string }} T
 * @param {T[]} list
 * @param {string} q
 * @param {(a: T, b: T) => number} [then]
 * @returns {T[]}
 */
export function searchClients(list, q, then) {
  const s = parseSearch(q);
  const kept = [];
  for (const c of list) { const r = searchRank(c, s); if (r != null) kept.push({ c, r }); }
  kept.sort((a, b) => a.r - b.r || (then ? then(a.c, b.c) : 0));
  return kept.map((x) => x.c);
}
