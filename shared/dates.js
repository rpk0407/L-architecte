// @ts-check
// Calendar arithmetic on shop-local days. A day is 'YYYY-MM-DD', a time is minutes after local midnight.
// Shared by the server and the browser apps so both read the same calendar.

export const TZ = 'Europe/Paris';

const fmtCache = new Map();
function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local wall-clock parts of an instant. */
export function localParts(ms, tz = TZ) {
  /** @type {Record<string,string>} */
  const o = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  const h = +o.hour % 24;
  return { y: +o.year, m: +o.month, d: +o.day, wd: WD[/** @type {keyof typeof WD} */ (o.weekday)], min: h * 60 + +o.minute, sec: +o.second, day: keyOf(+o.year, +o.month, +o.day) };
}

export function pad2(n) { return n < 10 ? '0' + n : '' + n; }
export function keyOf(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
export function isDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')); }

export function dayParts(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() };
}
export function weekday(key) { return dayParts(key).wd; }
export function addDays(key, n) {
  const { y, m, d } = dayParts(key);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
/** b − a in days. */
export function diffDays(a, b) {
  const A = dayParts(a), B = dayParts(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}
/** Monday of the week containing `key`. */
export function weekStart(key) { return addDays(key, -((weekday(key) + 6) % 7)); }
export function monthStart(key) { return key.slice(0, 8) + '01'; }
export function monthEnd(key) {
  const { y, m } = dayParts(key);
  return keyOf(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
}
export function dayRange(from, to) {
  const out = [];
  for (let k = from, i = 0; k <= to && i < 800; k = addDays(k, 1), i++) out.push(k);
  return out;
}

/** UTC instant of a local wall-clock time (handles DST by probing the offset). */
export function instantOf(day, min, tz = TZ) {
  const { y, m, d } = dayParts(day);
  const guess = Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60);
  const p = localParts(guess, tz);
  const seen = Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.min / 60), p.min % 60);
  return guess - (seen - guess);
}

export const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const DAYS_SH = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
export const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SH = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const NB = ' ';

/** 540 → "9 h", 570 → "9 h 30" */
export function fmtTime(min) {
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  return h + NB + 'h' + (m ? NB + pad2(m) : '');
}
/** 570 → "09:30" */
export function hhmm(min) { min = Math.round(min); return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60); }
export function parseHhmm(s) {
  const m = /^(\d{1,2})[:h](\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return v >= 0 && v <= 1440 ? v : null;
}
/** "mardi 27 octobre" */
export function dayLong(key) { const p = dayParts(key); return DAYS_FR[p.wd] + ' ' + p.d + ' ' + MONTHS_FR[p.m - 1]; }
/** "mar. 27 oct." */
export function dayShort(key) { const p = dayParts(key); return DAYS_SH[p.wd] + ' ' + p.d + ' ' + MONTHS_SH[p.m - 1]; }
export function fmtDur(d) {
  if (d < 60) return d + NB + 'min';
  const h = Math.floor(d / 60), m = d % 60;
  return h + NB + 'h' + (m ? NB + pad2(m) : '');
}
