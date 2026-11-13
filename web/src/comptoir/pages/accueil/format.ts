// WP5 · Accueil: how the page writes what the server sent. Words and formats only; no figure is worked out here
// (a count, an amount, a minute of the day all come from GET /api/v1/home and are shown as they are).
// @ts-ignore — plain JS modules with JSDoc types, shared with the server
import { fmtTime, fmtDur, localParts } from '../../../../../shared/dates.js';
// @ts-ignore
import { fmtEur } from '../../../../../shared/money.js';
import type { HomeAppt, HomeChair, HomeFact, HomeLine } from '../../types';

const NB = ' ';

/** 870 → « 14 h 30 » (the site's format). */
export const hm = (min: number): string => fmtTime(min);

/** « lu à 15 h 10 »: the salon's clock at the moment the server answered, never the phone's. */
export const readAt = (asOf: number): string => 'lu à ' + fmtTime(localParts(asOf).min);

/** The salon's day (YYYY-MM-DD) of an answer: « Plus tard » hides a card until that day is over. */
export const dayOf = (asOf: number): string => localParts(asOf).day;

/** One fact of the sentence: its value as written, and whether it is an amount (masked on a shared screen). */
export function factText(f: HomeFact): { value: string; label: string; money: boolean } {
  const value = f.unit === 'eur' ? fmtEur(f.v) : f.unit === 'min' ? fmtDur(f.v) : f.unit === 'pct' ? f.v + NB + '%' : String(f.v);
  return { value, label: f.label, money: f.unit === 'eur' };
}

/** « Mardi 10 novembre · ouverture à 9 h » → the day, and the moment after it (the server writes both in one line). */
export function splitLabel(line: Pick<HomeLine, 'label'>): { day: string; when: string } {
  const i = line.label.indexOf(' · ');
  return i < 0 ? { day: line.label, when: '' } : { day: line.label.slice(0, i), when: line.label.slice(i + 3) };
}

/** A chair in plain words: « Libre 30 min, jusqu’à 15 h 30 », « Occupé jusqu’à 15 h », « Absent », « Fermé ». */
export function chairText(c: Pick<HomeChair, 'state' | 'until' | 'freeMin'>): string {
  const until = c.until == null ? '' : fmtTime(c.until);
  if (c.state === 'libre') return 'Libre' + (c.freeMin > 0 ? ' ' + fmtDur(c.freeMin) : '') + (until ? ', jusqu’à ' + until : '');
  if (c.state === 'occupe') return 'Occupé' + (until ? ' jusqu’à ' + until : '');
  if (c.state === 'absent') return 'Absent' + (until ? ', retour à ' + until : '');
  return 'Fermé' + (until ? ', ouvre à ' + until : '');
}

/** Every chair shut the same way (before the doors open, after the Z, a closed day): one row says it for the salon. */
export function allShut(chairs: readonly Pick<HomeChair, 'state' | 'until'>[]): boolean {
  return chairs.length > 1 && chairs.every((c) => c.state === 'ferme' && c.until === chairs[0].until);
}

/** The barbers free right now (the walk-in sheet's « Installer chez … »). */
export const freeNow = (chairs: readonly Pick<HomeChair, 'staffId' | 'state'>[]): string[] => chairs.filter((c) => c.state === 'libre').map((c) => c.staffId);

/** The prestation the walk-in sheet starts on: the salon's usual one if this chair can take it now, else the first it can. */
export function firstTake(c: Pick<HomeChair, 'canTake'>, usual?: string): string | undefined {
  return c.canTake.some((t) => t.serviceId === usual) ? usual : c.canTake[0]?.serviceId;
}

const STATUS: Partial<Record<HomeAppt['status'], string>> = { pending: 'Acompte en attente', arrived: 'Arrivé', in_chair: 'Au fauteuil' };
/** What to say of an appointment beyond its hour (« À venir » goes without saying); a client expected and not there
 *  is « En retard de 10 min » (`late`: the minutes the server counted). */
export const statusWord = (a: Pick<HomeAppt, 'status'> & { late?: number }): string => (a.late ? 'En retard de ' + fmtDur(a.late) : STATUS[a.status] || '');

/** Who is on a busy chair: « avec Louis B. » (nothing for a pause or a blocked slot). */
export const chairWho = (c: { now?: { client: string } | null }): string => (c.now && c.now.client ? 'avec ' + c.now.client : '');
