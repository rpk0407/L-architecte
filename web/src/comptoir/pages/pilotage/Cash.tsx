// « La caisse »: the till at a glance, always as of now whatever the period shown. The drawer, today's Z, what waits to be
// paid, and the warnings that stop tonight's closing.
import { dayWord, plural, time } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { Icon } from '../../../ui/Icon';
import { Money } from '../../../ui/kit';
import type { CockpitCash } from '../../types';

/** « Caisse ouverte · Z à faire après 19 h » / « Z fait · écart 0 € » / « Z d’hier manquant » */
export function cashWords(c: CockpitCash, today: string): { text: string; diff: number | null; tone: 'ok' | 'warn' | 'bad' | '' } {
  if (c.z === 'missed') {
    const w = c.missedDay ? dayWord(c.missedDay, today).toLowerCase() : '';
    return { text: 'Z ' + (w === 'hier' ? 'd’hier' : w ? 'de ' + w : 'passé') + ' manquant', diff: null, tone: 'bad' };
  }
  if (c.z === 'done') return { text: 'Z fait', diff: c.lastDiff, tone: 'ok' };
  if (c.z === 'due') return { text: (c.drawer === 'open' ? 'Caisse ouverte' : c.drawer === 'counted' ? 'Caisse comptée' : 'Caisse pas ouverte') + ' · Z à faire' + (c.closesAt ? ' après ' + time(c.closesAt) : ''), diff: null, tone: c.drawer === 'open' ? 'ok' : 'warn' };
  return { text: c.closesAt ? 'Caisse pas encore ouverte' : 'Salon fermé aujourd’hui', diff: null, tone: '' };
}

export function Cash({ cash, today }: { cash: CockpitCash; today: string }) {
  const w = cashWords(cash, today);
  const hot = w.tone === 'bad' || cash.warnings.length > 0;
  return (
    <section className={'pl-cash' + (hot ? ' hot' : '')} aria-label="La caisse" data-guide="pilotage.caisse">
      <span className={'pl-cash-st ' + w.tone} role="status"><i aria-hidden />{w.text}{w.diff != null ? <> · écart <Money cents={w.diff} /></> : null}</span>
      {cash.unpaid ? <Link to="/caisse" className="pl-cash-chip"><Icon name="ticket" size={15} />{plural(cash.unpaid, 'encaissement')} à faire</Link> : null}
      {cash.warnings.map((x) => <span key={x} className="pl-cash-warn"><Icon name="alert" size={15} />{x}</span>)}
      <Link to="/caisse/cloture" className="pl-cash-go link">Ouvrir la caisse<Icon name="chevR" size={14} /></Link>
    </section>
  );
}
