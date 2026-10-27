// Objectifs: the monthly revenue target, with targets suggested from last month.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '../../../../lib/query';
import { dates, eur } from '../../../../lib/format';
import { Chip, Skeleton } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';

export default function Objectifs({ s }: SectionProps) {
  const { boot } = useApp();
  const g = useSection(s.goals);
  const { busy, save } = useSave();
  const last = dates.addDays(dates.monthStart(boot.today), -1);
  const prev = useQuery<any>('/api/v1/reports?from=' + dates.monthStart(last) + '&to=' + last);
  const [txt, setTxt] = useState(String(Math.round(s.goals.monthCents / 100)));
  useEffect(() => { setTxt(String(Math.round(g.v.monthCents / 100))); }, [g.v.monthCents]);
  const prevRev = prev.data?.revenue as number | undefined;
  const ideas = useMemo(() => prevRev ? [Math.round(prevRev * 1.05 / 10000) * 10000, Math.round(prevRev * 1.1 / 10000) * 10000, Math.round(prevRev * 1.2 / 10000) * 10000] : [], [prevRev]);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Objectif de chiffre mensuel" icon="target">
        <p className="muted" style={{ fontSize: 13.5 }}>Affiché dans Rapports avec la projection de fin de mois. Visible par le gérant et les responsables uniquement.</p>
        <div className="row" style={{ gap: 10 }}><input className="input input-money" inputMode="numeric" value={txt} onChange={(e) => { setTxt(e.target.value.replace(/\D/g, '')); g.setV({ monthCents: (Number(e.target.value.replace(/\D/g, '')) || 0) * 100 }); }} aria-label="Objectif en euros" style={{ maxWidth: 220 }} /><span className="serif" style={{ fontSize: 28 }}>€ / mois</span></div>
        {prevRev != null ? <p className="muted" style={{ fontSize: 13.5 }}>Le mois dernier : <b className="money">{eur(prevRev)}</b>. {ideas.length ? 'Quelques cibles réalistes :' : ''}</p> : <Skeleton h={18} w={260} />}
        {ideas.length ? <div className="chips">{ideas.map((v, i) => <Chip key={v} small on={g.v.monthCents === v} onClick={() => g.setV({ monthCents: v })}>{eur(v)} · {['+5 %', '+10 %', '+20 %'][i]}</Chip>)}</div> : null}
      </Card>
      <SaveBar dirty={g.dirty} busy={busy} onReset={g.reset} onSave={() => save({ goals: g.v }, 'Objectif enregistré')} />
    </div>
  );
}
