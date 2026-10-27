// @ts-check
// SMS rules the server applies and the Comptoir shows: the quiet hours and the STOP mention.
// One copy for both sides, so the "part à 8 h" the owner reads is the time the server picked.
import { localParts, instantOf, addDays, keyOf } from './dates.js';

/** Easter Sunday (Gregorian, anonymous algorithm), as 'YYYY-MM-DD'. */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return keyOf(y, Math.floor(n / 31), (n % 31) + 1);
}
const FIXED = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'];
/** A French public holiday (metropolitan list: no promotional text on those days either). */
export function frHoliday(day) {
  if (FIXED.includes(day.slice(5))) return true;
  const e = easter(+day.slice(0, 4));
  return day === addDays(e, 1) || day === addDays(e, 39) || day === addDays(e, 50);
}

/**
 * The first instant at or after `t` outside the quiet hours ({ from, to } in local minutes, the window may cross
 * midnight; sunday: the whole day is quiet; holidays: so are French public holidays). A quiet text queued at 00:38
 * leaves at 08:00, on Saturday at 21:00 on Monday at 08:00.
 * @param {{ from: number, to: number, sunday?: boolean, holidays?: boolean } | null | undefined} q
 * @param {number} t
 */
export function afterQuiet(q, t) {
  if (!q || (q.from === q.to && !q.sunday && !q.holidays)) return t;
  for (let i = 0; i < 12; i++) {
    const L = localParts(t);
    const night = q.from > q.to ? L.min >= q.from || L.min < q.to : L.min >= q.from && L.min < q.to;
    if ((q.sunday && L.wd === 0) || (q.holidays && frHoliday(L.day))) t = instantOf(addDays(L.day, 1), q.from > q.to ? q.to : 0);
    else if (night) t = instantOf(q.from > q.to && L.min >= q.from ? addDays(L.day, 1) : L.day, q.to);
    else return t;
  }
  return t;
}

/**
 * A marketing text always carries the opt-out mention. It is skipped only when the text already holds that exact
 * mention (any case): a "STOP" elsewhere ("STOP aux cheveux longs !") is not an opt-out.
 * @param {string} body
 * @param {string} suffix
 */
export function withStop(body, suffix) {
  const stop = String(suffix || '').trim();
  return !stop || String(body).toLowerCase().includes(stop.toLowerCase()) ? body : body + ' ' + stop;
}
