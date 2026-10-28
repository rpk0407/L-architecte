// The monthly membership in words, the same everywhere in the Comptoir (the till, the file, the board): a status is always a
// word and a tone, never a colour alone. Tones are the badges' (badge-ok, badge-warn, badge-info, badge-danger).
import type { MemberCard, MemberRow, MemberStatus } from '../comptoir/types';
import { dates } from './format';

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

/** « 1/2 ce mois-ci », « 3 ce mois-ci » for an Illimité plan (no ceiling to show) */
export const cutsWords = (used: number, of: number) => (of ? used + '/' + of : used + ' (illimité)');

/** The memberships of a file that count today: paid once and not over. */
export const liveMembers = (ms: MemberCard[] | undefined) => (ms || []).filter((m) => m.status !== 'pending' && m.status !== 'ended');
