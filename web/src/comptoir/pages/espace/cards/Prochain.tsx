// « Prochain client »: who sits down next, what is known of the cut, and the one gesture the moment asks for.
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { navigate } from '../../../../lib/router';
import { dates, time } from '../../../../lib/format';
import { Button, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';
import type { EspaceCardMeta, EspaceCardProps, EspaceNext } from '../../../types';
import { EsCard, ordinal, shortDay } from '../shared';

export const meta: EspaceCardMeta = { id: 'prochain', title: 'Prochain client', chairOnly: true };

/** « Anniversaire jeudi » */
function birthdayWords(b: { inDays: number; day: string }) {
  return 'Anniversaire ' + (b.inDays === 0 ? 'aujourd’hui' : b.inDays === 1 ? 'demain' : dates.DAYS_FR[dates.weekday(b.day)]);
}

/** What stands out about him, in words: the visit, the delay, the birthday, what he holds, who he prefers. */
function Chips({ n }: { n: EspaceNext }) {
  const c = n.client;
  const out: { t: string; tone?: string }[] = [];
  if (!c) out.push({ t: 'Pas de fiche client' });
  if (c) out.push({ t: c.firstVisit ? '1re visite' : ordinal(c.visits + 1) + ' visite' + (c.usual ? ' · d’habitude avec toi' : '') });
  if (n.status === 'in_chair') out.push({ t: 'Au fauteuil', tone: 'badge-accent' });
  else if (n.status === 'arrived') out.push({ t: 'Arrivé', tone: 'badge-ok' });
  else if (n.late > 0) out.push({ t: 'En retard · ' + n.late + ' min', tone: 'badge-warn' });
  if (n.lateNotice) out.push({ t: n.lateNotice.min ? 'A prévenu · +' + n.lateNotice.min + ' min' : 'A prévenu de son retard', tone: 'badge-info' });
  if (c && c.birthdaySoon) out.push({ t: birthdayWords(c.birthdaySoon), tone: 'badge-accent' });
  if (c && c.member) {
    const m = c.member;
    out.push({ t: m.kind === 'member' ? 'Abonné · ' + (m.of ? m.used + '/' + m.of : 'illimité') : 'Carnet · ' + (m.of - m.used) + ' restante' + (m.of - m.used > 1 ? 's' : ''), tone: 'badge-ok' });
  }
  if (c && c.prefersMe) out.push({ t: 'Te préfère', tone: 'badge-accent' });
  if (c && c.noShows) out.push({ t: c.noShows + ' absence' + (c.noShows > 1 ? 's' : ''), tone: 'badge-danger' });
  return <div className="es-chips">{out.map((x) => <span key={x.t} className={'badge ' + (x.tone || '')}>{x.t}</span>)}</div>;
}

export default function Prochain({ data, reload, note }: EspaceCardProps) {
  const { can, offline } = useApp();
  const [busy, setBusy] = useState('');
  const n = data.next;
  if (!n) {
    return (
      <EsCard guide="espace.prochain" title="Prochain client" icon="scissors" className="es-next">
        <p className="es-empty"><b>{data.list.length ? 'Plus personne à venir' : 'Aucun rendez-vous aujourd’hui'}</b><span>{data.gaps.length ? 'Ta place est libre : regarde « Mes trous » pour la proposer.' : 'Profite : ta journée est faite.'}</span></p>
      </EsCard>
    );
  }
  const c = n.client;
  const status = async (s: 'arrived' | 'in_chair') => {
    setBusy(s);
    try {
      await api.post('/api/v1/appointments/' + n.id + '/status', { status: s });
      toast({ title: s === 'arrived' ? n.name.split(' ')[0] + ' est arrivé' : 'Au fauteuil · ' + n.name, icon: 'check' });
      await reload();
    } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  const last = n.cutNotes[0];
  const more = n.cutNotes.slice(1);
  return (
    <EsCard guide="espace.prochain" title="Prochain client" icon="scissors" className="es-next" end={n.status === 'in_chair' ? 'au fauteuil' : n.late > 0 ? 'en retard' : undefined}>
      <div className="es-when"><span className="es-t tnum">{time(n.start)}</span><h3 className="es-who">{n.name}</h3></div>
      <p className="es-svc">{n.services.join(' + ')} · {n.dur} min</p>
      <Chips n={n} />
      {last ? (
        <p className="es-last"><b>La dernière fois</b> ({shortDay(last.day)}, {last.staff}) : {last.text}</p>
      ) : c && c.lastCut ? (
        <p className="es-last"><b>La dernière fois</b> ({shortDay(c.lastCut.day)}, {c.lastCut.staffName}) : rien de noté.</p>
      ) : null}
      {more.length ? (
        <details className="es-more"><summary>{more.length === 1 ? 'Une note avant' : more.length + ' notes avant'}</summary>
          {more.map((x) => <p key={x.id}>{shortDay(x.day)}, {x.staff} : {x.text}</p>)}
        </details>
      ) : null}
      {n.myNote ? <p className="es-tech"><b>Ta note du jour</b> · {n.myNote}</p> : null}
      {n.tech ? <p className="es-tech"><b>Fiche technique</b> · {n.tech}</p> : null}
      {n.note ? <p className="es-tech"><b>Note</b> · {n.note}</p> : null}
      <div className="es-acts">
        {n.status === 'booked' || n.status === 'pending' ? <Button variant="subtle" icon="check" busy={busy === 'arrived'} disabled={offline} onClick={() => status('arrived')}>Il est là</Button> : null}
        {n.status !== 'in_chair' ? <Button variant="primary" icon="chair" busy={busy === 'in_chair'} disabled={offline} onClick={() => status('in_chair')}>Au fauteuil</Button> : null}
        {n.status === 'in_chair' && can('sale.create') ? <Button variant="primary" icon="caisse" disabled={offline} onClick={() => navigate('/caisse?rdv=' + n.id)}>Encaisser</Button> : null}
        {n.canNote ? <Button variant="ghost" icon="edit" disabled={offline} onClick={() => note({ id: n.id, name: n.name, text: n.myNote })}>{n.myNote ? 'Corriger la note' : 'Note de coupe'}</Button> : null}
      </div>
      {n.status === 'in_chair' && !can('sale.create') ? <p className="es-tech faint">À encaisser à l’accueil.</p> : null}
    </EsCard>
  );
}
