// AC-02 · The small parts of /moi › Profil shared by its cards (Profile.tsx, Session.tsx). Not a card: it lives outside
// web/src/moi/cards/, which the folder registry reads. Styles: web/src/moi/cards/profile.css.
import type { ReactNode } from 'react';
import { dates } from '../../lib/format';

/** « 28 oct. » already ends in a point when the month is shortened: the sentence around it must not add another. */
export const short = (ms: number) => { const p = dates.localParts(ms); return (p.d + ' ' + dates.MONTHS_SH[p.m - 1]).replace(/\.$/, ''); };

/** One card of the Profil tab: a small caps title, then its parts; `guide` is its data-guide (web/src/moi/guide/steps/AC-02.ts). */
export function Section({ k, guide, children }: { k: string; guide: string; children: ReactNode }) {
  const id = 'mp-h-' + guide;
  return <section className="c-card mp-sec" data-guide={guide} aria-labelledby={id}><h2 id={id} className="c-k">{k}</h2>{children}</section>;
}
