// A member's weeks of his billing month (PAY-07), one dot each: came (filled), missed (crossed out), this week not yet
// (ringed), to come (dashed). Always said in words too: the dots are an image with its name, never a colour alone.
import { ddmm } from '../../../lib/members';
import type { MemberWeekDot } from '../../types';

export type WeekState = 'came' | 'missed' | 'now' | 'future';

/** What a week is on a day: came, missed (over without a covered cut), this week still open, or still to come. */
export function weekState(w: MemberWeekDot, today: string): WeekState {
  if (w.came && !w.future) return 'came';
  if (w.future) return 'future';
  return w.end < today ? 'missed' : 'now';
}
const WORDS: Record<WeekState, string> = { came: 'venu', missed: 'manquée', now: 'pas encore venu', future: 'à venir' };

/** « Semaines du mois : 03/11 venu, 10/11 manquée, 17/11 pas encore venu, 24/11 à venir » */
export const weeksLabel = (weeks: MemberWeekDot[], today: string) =>
  'Semaines du mois : ' + weeks.map((w) => 'semaine du ' + ddmm(w.start) + ' ' + WORDS[weekState(w, today)]).join(', ');

/** guide: this one is the part the guided tour points at (the first row of the board) */
export default function WeekDots({ weeks, today, guide }: { weeks: MemberWeekDot[]; today: string; guide?: boolean }) {
  if (!weeks.length) return null;
  return (
    <span className="wk-dots" role="img" aria-label={weeksLabel(weeks, today)} data-guide={guide ? 'members-weeks' : undefined}>
      {weeks.map((w) => <i key={w.start} className={'wk wk-' + weekState(w, today)} title={'Semaine du ' + ddmm(w.start) + ' : ' + WORDS[weekState(w, today)]} />)}
    </span>
  );
}
