// Formatting in French, shared with the server so the till and the ticket always agree.
// @ts-ignore — plain JS modules with JSDoc types
import * as D from '../../../shared/dates.js';
// @ts-ignore
import * as M from '../../../shared/money.js';

export const dates = D as {
  localParts(ms: number): { y: number; m: number; d: number; wd: number; min: number; day: string };
  addDays(key: string, n: number): string; diffDays(a: string, b: string): number; weekday(key: string): number;
  weekStart(key: string): string; monthStart(key: string): string; monthEnd(key: string): string; dayRange(a: string, b: string): string[];
  dayLong(key: string): string; dayShort(key: string): string; fmtTime(min: number): string; hhmm(min: number): string; fmtDur(min: number): string;
  parseHhmm(s: string): number | null; instantOf(day: string, min: number): number; dayParts(key: string): { y: number; m: number; d: number; wd: number };
  DAYS_FR: string[]; DAYS_SH: string[]; MONTHS_FR: string[]; MONTHS_SH: string[];
};
export const money = M as {
  ticketTotals(lines: any[], discount?: number, tip?: number): { gross: number; discount: number; total: number; tip: number; due: number; revenue: number; revenueHT: number; liability: number; vat: { rate: number; base: number; tax: number }[]; nets: number[] };
  fmtEur(c: number, o?: { decimals?: boolean }): string; parseEur(s: string): number | null; DENOMS: number[];
};

export const eur = (c: number | null | undefined, o?: { decimals?: boolean }) => (c == null ? '—' : money.fmtEur(c, o));
export const time = (m: number) => dates.fmtTime(m);
export const hhmm = (m: number) => dates.hhmm(m);
export const dur = (m: number) => dates.fmtDur(m);
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** "Aujourd’hui", "Demain", "Hier", or "Jeudi 29 octobre" */
export function dayWord(day: string, today: string) {
  const d = dates.diffDays(today, day);
  if (d === 0) return 'Aujourd’hui';
  if (d === 1) return 'Demain';
  if (d === -1) return 'Hier';
  return cap(dates.dayLong(day));
}
export function dayShortWord(day: string, today: string) {
  const d = dates.diffDays(today, day);
  if (d === 0) return 'auj.';
  if (d === 1) return 'demain';
  return dates.dayShort(day);
}
/** "à l’instant", "il y a 4 min", "il y a 2 h", "hier", "le 12 oct." */
export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return 'à l’instant';
  if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
  const p = dates.localParts(ms);
  const t = dates.localParts(now);
  const dd = dates.diffDays(p.day, t.day);
  if (dd === 1) return 'hier';
  if (dd < 7) return 'il y a ' + dd + ' j';
  return 'le ' + p.d + ' ' + dates.MONTHS_SH[p.m - 1];
}
export function clock(ms: number) { const p = dates.localParts(ms); return dates.hhmm(p.min); }
export function pct(x: number, digits = 0) { return (x * 100).toFixed(digits).replace('.', ',') + ' %'; }
export function plural(n: number, one: string, many?: string) { return n + ' ' + (n > 1 ? many || one + 's' : one); }
export function sinceWords(days: number | null) {
  if (days == null) return 'jamais venu';
  if (days === 0) return 'aujourd’hui';
  if (days === 1) return 'hier';
  if (days < 14) return 'il y a ' + days + ' j';
  if (days < 60) return 'il y a ' + Math.round(days / 7) + ' sem.';
  return 'il y a ' + Math.round(days / 30) + ' mois';
}
export function rhythmWords(days: number | null) {
  if (!days) return 'pas encore de rythme';
  if (days < 10) return 'chaque semaine';
  if (days <= 17) return 'toutes les 2 semaines';
  if (days <= 24) return 'toutes les 3 semaines';
  if (days <= 31) return 'chaque mois';
  return 'toutes les ' + Math.round(days / 7) + ' semaines';
}
export const METHOD: Record<string, string> = { card: 'Carte', cash: 'Espèces', online: 'En ligne', giftcard: 'Carte cadeau', deposit: 'Acompte' };
export const SOURCE: Record<string, string> = { site: 'Site', phone: 'Tél.', walkin: 'Passage', salon: 'Salon' };
export const STATUS: Record<string, string> = { pending: 'Acompte en attente', booked: 'À venir', arrived: 'Arrivé', in_chair: 'Au fauteuil', done: 'Terminé', no_show: 'Absent', cancelled: 'Annulé' };
