// Objectifs: the monthly revenue target, with targets suggested from last month, and each barber's (TEAM-03): automatic
// by default (the salon's target × his share of the month's chair hours, rounded to 10 €), or typed.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '../../../../lib/query';
import { dates, eur } from '../../../../lib/format';
import { Avatar, Chip, Skeleton, Switch } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';
import './objectifs.css';

type Goals = { monthCents: number; staff?: Record<string, number | null>; showBarbers?: boolean };
type Shares = { month: string; staff: { id: string; share: number; auto: number; typed: number | null }[] };
// the server's rounding (autoGoal): to 10 €
const auto = (monthCents: number, share: number) => Math.round((monthCents * share) / 1000) * 1000;

export default function Objectifs({ s }: SectionProps) {
  const { boot, staffById } = useApp();
  const g = useSection<Goals>(s.goals);
  const { busy, save } = useSave();
  const last = dates.addDays(dates.monthStart(boot.today), -1);
  const prev = useQuery<any>('/api/v1/reports?from=' + dates.monthStart(last) + '&to=' + last);
  const shares = useQuery<Shares>('/api/v1/goals');
  const [txt, setTxt] = useState(String(Math.round(s.goals.monthCents / 100)));
  useEffect(() => { setTxt(String(Math.round(g.v.monthCents / 100))); }, [g.v.monthCents]);
  const prevRev = prev.data?.revenue as number | undefined;
  const ideas = useMemo(() => prevRev ? [Math.round(prevRev * 1.05 / 10000) * 10000, Math.round(prevRev * 1.1 / 10000) * 10000, Math.round(prevRev * 1.2 / 10000) * 10000] : [], [prevRev]);
  const staff = g.v.staff || {};
  const setStaff = (id: string, cents: number | null) => g.setV({ ...g.v, staff: { ...staff, [id]: cents } });
  const month = dates.MONTHS_FR[dates.dayParts(boot.today).m - 1];
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Objectif de chiffre mensuel" guide="objectifs-mois" icon="target">
        <p className="muted" style={{ fontSize: 13.5 }}>Affiché dans Rapports avec la projection de fin de mois. Visible par le gérant et les responsables uniquement.</p>
        <div className="row" style={{ gap: 10 }}><input className="input input-money" inputMode="numeric" value={txt} onChange={(e) => { setTxt(e.target.value.replace(/\D/g, '')); g.setV({ ...g.v, monthCents: (Number(e.target.value.replace(/\D/g, '')) || 0) * 100 }); }} aria-label="Objectif en euros" style={{ maxWidth: 220 }} /><span className="serif" style={{ fontSize: 28 }}>€ / mois</span></div>
        {prevRev != null ? <p className="muted" style={{ fontSize: 13.5 }}>Le mois dernier : <b className="money">{eur(prevRev)}</b>. {ideas.length ? 'Quelques cibles réalistes :' : ''}</p> : <Skeleton h={18} w={260} />}
        {ideas.length ? <div className="chips">{ideas.map((v, i) => <Chip key={v} small on={g.v.monthCents === v} onClick={() => g.setV({ ...g.v, monthCents: v })}>{eur(v)} · {['+5 %', '+10 %', '+20 %'][i]}</Chip>)}</div> : null}
      </Card>
      <Card title="L’objectif de chaque barbier" guide="objectifs-barbiers" icon="equipe">
        <p className="muted" style={{ fontSize: 13.5 }}>Mesuré sur ce que chacun réalise (coupes de carnet et d’abonnement comprises, remboursements déduits). Laisse vide : il suit l’objectif du salon au prorata de ses heures au fauteuil en {month}.</p>
        {!shares.data ? <Skeleton h={120} /> : (
          <ul className="og-list">
            {shares.data.staff.map((x) => {
              const st = staffById.get(x.id);
              const typed = typeof staff[x.id] === 'number' ? (staff[x.id] as number) : null;
              const a = auto(g.v.monthCents, x.share);
              return (
                <li key={x.id} className="og-row">
                  <Avatar name={st?.name} initials={st?.initials} color={st?.color} />
                  <span className="grow og-who"><b>{st?.name || 'Barbier'}</b><small>{typed == null ? 'Auto · ' + eur(a) : 'Auto serait ' + eur(a)} · {Math.round(x.share * 100)} % des heures</small></span>
                  <input className="input input-money og-in" inputMode="numeric" placeholder={'Auto · ' + eur(a)} value={typed == null ? '' : String(Math.round(typed / 100))}
                    onChange={(e) => { const d = e.target.value.replace(/\D/g, ''); setStaff(x.id, d ? Number(d) * 100 : null); }} aria-label={'Objectif de ' + (st?.name || 'ce barbier') + ' en euros, vide pour automatique'} />
                </li>
              );
            })}
          </ul>
        )}
        <Switch on={g.v.showBarbers !== false} onChange={(v) => g.setV({ ...g.v, showBarbers: v })} title="Les barbiers voient leur objectif" hint="Dans Mes chiffres : le leur seulement, avec ce qu’il leur faut par jour ouvré. Jamais l’objectif du salon en euros." />
      </Card>
      <SaveBar dirty={g.dirty} busy={busy} onReset={g.reset} onSave={() => save({ goals: g.v }, 'Objectifs enregistrés')} />
    </div>
  );
}
