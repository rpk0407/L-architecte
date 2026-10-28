// The monthly membership in words, the same everywhere in the Comptoir (the till, the file, the board): a status is always a
// word and a tone, never a colour alone. Tones are the badges' (badge-ok, badge-warn, badge-info, badge-danger).
// The plan and its use in words come from shared/membership-words.js (PAY-07), the file the server's texts, the site and
// the till use too: nothing here builds « coupe(s) par mois/semaine » itself.
import type { MemberCard, MemberRow, MemberStatus } from '../comptoir/types';
import { dates } from './format';
// @ts-ignore — plain JS module with JSDoc types
import * as MW from '../../../shared/membership-words.js';

/** A plan's or a member's rhythm (absent: monthly, as before PAY-07). */
export type Rhythm = { rhythm?: 'month' | 'week'; perWeek?: number; missed?: 'lost' | 'month' | 'free'; cuts?: number; minDays?: number };
export type Missed = 'lost' | 'month' | 'free';
type WeekUse = { used: number; of?: number } | null | undefined;
const W = MW as {
  rhythmOf(m: Rhythm | null | undefined): 'month' | 'week'; perWeekOf(m: Rhythm | null | undefined): number; missedOf(m: Rhythm | null | undefined): Missed | null;
  derivedCuts(p: Rhythm): { cuts: number; minDays: number };
  planWords(p: Rhythm, o?: { detail?: boolean }): string; missedWords(p: Rhythm): string; offerWords(p: Rhythm & { price: number }): string;
  useWords(m: Rhythm, u: { used: number; of: number; week?: WeekUse }): string; shortWords(m: Rhythm, u: { used: number; of: number; week?: WeekUse }): string;
  labelWords(m: Rhythm, used: number, period?: { start?: string; end?: string; week?: { start: string } | null }): string;
  PER_WEEK_MAX: number;
};
export const rhythmOf = W.rhythmOf;
export const perWeekOf = W.perWeekOf;
export const missedOf = W.missedOf;
/** a weekly plan's quota and gap, as the server stores them */
export const derivedCuts = W.derivedCuts;
/** « 1 coupe par semaine », « 4 coupes par mois », « coupes illimitées, une par jour au plus », « 2 coupes par mois » */
export const planWords = W.planWords;
/** « Semaine manquée : perdue » ('' for a monthly plan) */
export const missedWords = W.missedWords;
/** « 80 €/mois · 1 coupe par semaine · semaine manquée perdue » */
export const offerWords = W.offerWords;
/** « Cette semaine : prise » / « à prendre », « 1/2 ce mois-ci » */
export const useWords = W.useWords;
/** the same for a chip: « semaine prise », « 1/2 ce mois » */
export const shortWords = W.shortWords;
/** the till's line, « Abonnement · semaine du 03/11 (1/1) » */
export const labelWords = W.labelWords;
export const PER_WEEK_MAX = W.PER_WEEK_MAX;

export type Tone = '' | 'ok' | 'warn' | 'info' | 'danger';
/** « 30/11 » */
export const ddmm = (day: string) => { const p = dates.dayParts(day); return String(p.d).padStart(2, '0') + '/' + String(p.m).padStart(2, '0'); };

/** What a member's status says, with the end date when it ends: « Actif », « Fin le 30/11 », « Paiement à régulariser ». */
export function statusWords(m: Pick<MemberRow, 'status' | 'cancelAt' | 'disputed'> | Pick<MemberCard, 'status' | 'cancelAt'>): { text: string; tone: Tone } {
  if ('disputed' in m && m.disputed) return { text: 'Litige en cours', tone: 'danger' };
  const st: MemberStatus = m.status;
  switch (st) {
    case 'active': return { text: 'Actif', tone: 'ok' };
    case 'ending': return { text: m.cancelAt ? 'Fin le ' + ddmm(m.cancelAt) : 'Résilié', tone: 'info' };
    case 'grace': return { text: 'Paiement à régulariser', tone: 'warn' };
    case 'unpaid': return { text: 'Impayé', tone: 'danger' };
    case 'pending': return { text: 'Paiement en attente', tone: 'info' };
    case 'paused': return { text: 'En pause', tone: 'info' };
    default: return { text: 'Terminé', tone: '' };
  }
}
export const toneClass = (t: Tone) => (t ? ' badge-' + t : '');


/** The memberships of a file that count today: paid once and not over. */
export const liveMembers = (ms: MemberCard[] | undefined) => (ms || []).filter((m) => m.status !== 'pending' && m.status !== 'ended');
