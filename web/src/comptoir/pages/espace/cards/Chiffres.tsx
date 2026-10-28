// « Mes chiffres »: what he performed, his commission and tips, his average ticket, and where the month's goal stands.
import { Link } from '../../../../lib/router';
import { useLocal } from '../../../../lib/hooks';
import { pct, plural } from '../../../../lib/format';
import { Money, Seg } from '../../../../ui/kit';
import type { EspaceCardMeta, EspaceCardProps, GoalView } from '../../../types';
import { EsCard } from '../shared';

export const meta: EspaceCardMeta = { id: 'chiffres', title: 'Mes chiffres', chairOnly: true };

type Period = 'day' | 'week' | 'month';
const PERIODS: { v: Period; t: string }[] = [{ v: 'day', t: 'Jour' }, { v: 'week', t: 'Semaine' }, { v: 'month', t: 'Mois' }];
/** a goal reads to the euro */
const whole = (c: number) => Math.round(c / 100) * 100;

/** The month's goal as a ring: the share reached, in words for whoever cannot see the arc. */
function Ring({ ratio }: { ratio: number }) {
  const R = 30, C = 2 * Math.PI * R, p = Math.min(1, Math.max(0, ratio));
  return (
    <svg className="es-ring" width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={pct(ratio) + ' de ton objectif du mois'}>
      <circle cx="38" cy="38" r={R} fill="none" stroke="var(--line2)" strokeWidth="7" />
      <circle cx="38" cy="38" r={R} fill="none" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(C * p).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 38 38)" />
      <text x="38" y="43" textAnchor="middle" className="es-ring-t">{Math.round(ratio * 100)} %</text>
    </svg>
  );
}

function Goal({ g }: { g: GoalView }) {
  const left = Math.max(0, g.target - g.done);
  const ratio = g.target ? g.done / g.target : 0;
  return (
    <div className="es-goal">
      <Ring ratio={ratio} />
      <p>
        <b>Objectif du mois</b>
        <span><Money cents={whole(g.done)} /> sur <Money cents={whole(g.target)} /></span>
        <span className="muted">{!left ? 'Atteint, bravo.' : g.openDaysLeft ? <>Il te faut <b><Money cents={whole(g.perDay)} /></b> par jour ({plural(g.openDaysLeft, 'jour')} à travailler).</> : 'Le mois est fini.'}</span>
      </p>
    </div>
  );
}

export default function Chiffres({ data }: EspaceCardProps) {
  const [period, setPeriod] = useLocal<Period>('lx-espace-periode', 'day');
  const f = data.figures;
  if (!f) return null;
  const x = f[period];
  return (
    <EsCard guide="espace.chiffres" title="Mes chiffres" icon="rapports" end={<Link to="/rapports" className="link">Tout voir</Link>}>
      <Seg value={period} onChange={setPeriod} options={PERIODS} label="Période" />
      {f.goal && f.goal.target ? <Goal g={f.goal} /> : null}
      <dl className="es-figs">
        <div><dt>Chiffre</dt><dd><Money cents={x.performed} /></dd></div>
        <div><dt>Commission</dt><dd><Money cents={x.commission} /></dd></div>
        <div><dt>Pourboires</dt><dd><Money cents={x.tips} /></dd></div>
        <div><dt>Panier</dt><dd><Money cents={x.avgTicket} /></dd></div>
      </dl>
      <p className="es-note-f">{plural(x.done, 'coupe')} faite{x.done > 1 ? 's' : ''} · remplissage {pct(x.fill)}{x.done ? ' · ' + pct(x.rebookRate) + ' reprennent rendez-vous' : ''}</p>
    </EsCard>
  );
}
