// What the parts of Pilotage have in common: the tile frame (the Kpi look of the rest of the Comptoir), the change against
// the period before, and the thin bars.
import type { ReactNode } from 'react';
import { Icon } from '../../../ui/Icon';

/** The change from `prev` to `cur`, as a fraction; null when there is nothing to compare with. */
export const rel = (cur: number, prev: number): number | null => (prev ? (cur - prev) / Math.abs(prev) : null);

/**
 * « ↑ 12 % » against the period before. Said in words too (« contre mardi dernier »), so colour is never the only sign;
 * `inverse` for what is worse when it grows (no-shows, discounts). Nothing without a base to compare with.
 */
export function Dlt({ cur, prev, against, inverse }: { cur: number; prev: number; against: string; inverse?: boolean }) {
  const d = rel(cur, prev);
  if (d == null || !Number.isFinite(d)) return null;
  const flat = Math.abs(d) < 0.005;
  const up = d > 0;
  const good = flat ? 'flat' : up !== !!inverse ? 'good' : 'bad';
  return (
    <span className={'pl-d ' + good}>
      <span aria-hidden>{flat ? '=' : (up ? '↑ ' : '↓ ') + Math.abs(Math.round(d * 100)) + ' %'}</span>
      <span className="vh">{flat ? 'comme' : (up ? 'en hausse de ' : 'en baisse de ') + Math.abs(Math.round(d * 100)) + ' % par rapport à'} {against}</span>
    </span>
  );
}

/** A tile of the page: the Kpi's look, `wide` over two columns, `guide` the mark the tour points at. */
export function Tile({ guide, k, icon, v, s, delta, wide, hot, children }: { guide?: string; k: ReactNode; icon: string; v: ReactNode; s?: ReactNode; delta?: ReactNode; wide?: boolean; hot?: boolean; children?: ReactNode }) {
  return (
    <div className={'kpi pl-tile' + (wide ? ' wide' : '') + (hot ? ' hot' : '')} data-guide={guide} role="group" aria-label={typeof k === 'string' ? k : undefined}>
      <span className="kpi-k"><Icon name={icon} size={15} />{k}{delta}</span>
      <span className="kpi-v">{v}</span>
      {s ? <span className="kpi-s">{s}</span> : null}
      {children}
    </div>
  );
}

/** A thin bar, `ratio` 0..1 (more is fine: it stops at the end); `mark` a tick, 0..1, where the bar should be by now. */
export function Bar({ ratio, color, label, mark }: { ratio: number; color?: string; label: string; mark?: number }) {
  return (
    <span className="pl-bar" role="img" aria-label={label}>
      <i style={{ width: Math.round(Math.min(1, Math.max(0, ratio)) * 100) + '%', background: color || undefined }} />
      {mark != null ? <s style={{ left: Math.round(Math.min(1, Math.max(0, mark)) * 100) + '%' }} /> : null}
    </span>
  );
}

/** « 6 h », « 6 h 30 » for a count of minutes. */
export const hoursOf = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : ''); };
