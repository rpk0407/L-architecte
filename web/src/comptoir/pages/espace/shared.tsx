// What the cards of Mon espace have in common: the card frame, the French small words (1re visite, 12 oct.).
import type { ReactNode } from 'react';
import { dates } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';

/** « 1re », « 2e », « 6e » */
export const ordinal = (n: number) => (n === 1 ? '1re' : n + 'e');
/** « 12 oct. » */
export const shortDay = (day: string) => { const p = dates.dayParts(day); return p.d + ' ' + dates.MONTHS_SH[p.m - 1]; };
/** « du 12 au 14 nov. », « le 12 nov. » */
export function spanWords(from: string, to: string) {
  const a = dates.dayParts(from), b = dates.dayParts(to);
  if (from === to) return 'le ' + shortDay(from);
  return a.m === b.m ? 'du ' + a.d + ' au ' + b.d + ' ' + dates.MONTHS_SH[b.m - 1] : 'du ' + shortDay(from) + ' au ' + shortDay(to);
}

/** The frame of a card: its title with an icon, an optional word on the right, and the data-guide mark the tour points at. */
export function EsCard({ guide, title, icon, end, className = '', children }: { guide: string; title: ReactNode; icon: string; end?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={'card es-card ' + className} data-guide={guide}>
      <div className="card-h"><h2><Icon name={icon} size={16} />{title}</h2>{end ? <span className="muted">{end}</span> : null}</div>
      {children}
    </section>
  );
}
