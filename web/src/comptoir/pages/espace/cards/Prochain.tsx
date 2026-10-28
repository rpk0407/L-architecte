// « Prochain client »: who sits down next, what is known of the cut, and the one gesture the moment asks for.
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { navigate } from '../../../../lib/router';
import { dates, time } from '../../../../lib/format';
import { shortWords } from '../../../../lib/members';
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
    out.push({ t: m.kind === 'member' ? 'Abonné · ' + shortWords(m, m) : 'Carnet · ' + (m.of - m.used) + ' restante' + (m.of - m.used > 1 ? 's' : ''), tone: 'badge-ok' });
  }
  if (c && c.prefersMe) out.push({ t: 'Te préfère', tone: 'badge-accent' });
  if (c && c.noShows) out.push({ t: c.noShows + ' absence' + (c.noShows > 1 ? 's' : ''), tone: 'badge-danger' });
  return <div className="es-chips">{out.map((x) => <span key={x.t} className={'badge ' + (x.tone || '')}>{x.t}</span>)}</div>;
}

/** a client this late can be marked absent from the card, so the page moves on to the next one */
const LATE_ABSENT = 30;
/** « Frank », or « Frank, écrit par Inès » when the desk or the owner wrote it for him */
const who = (x: { staff: string; by?: string }) => x.staff + (x.by ? ', écrit par ' + x.by : '');

export default function Prochain({ data, reload, note }: EspaceCardProps) {
  const { can, offline } = useApp();
  const [busy, setBusy] = useState('');
  const n = data.next;
  if (!n) {
    // worded by where he stands: not working, not started, over, or free with nobody booked
    const off = data.now && data.now.status === 'off' ? data.now : null;
    const [title, sub] = off && off.kind === 'none' ? ['Pas de journée', 'Tu ne travailles pas aujourd’hui.']
      : off && off.kind === 'before' && off.until != null ? ['Pas encore ouvert', 'Ta journée commence à ' + time(off.until) + '.']
      : off && off.kind === 'after' ? ['Journée finie', 'Profite : ta journée est faite.']
      : [data.list.length ? 'Plus personne à venir' : 'Aucun rendez-vous', data.gaps.length ? 'Ta place est libre : regarde « Mes trous » pour la proposer.' : 'Rien d’autre de prévu dans ta colonne.'];
    return (
      <EsCard guide="espace.prochain" title="Prochain client" icon="scissors" className="es-next">
        <p className="es-empty"><b>{title}</b><span>{sub}</span></p>
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
  // the newest note counts as « la dernière fois » only when it is about his last visit: an older one is a note, not the last cut
  const cut = c?.lastCut || null;
  const newest = n.cutNotes[0];
  const last = newest && (!cut || newest.day >= cut.day) ? newest : null;
  const older = last ? n.cutNotes.slice(1) : n.cutNotes;
  const first = last ? null : older[0];
  const more = last ? older : older.slice(1);
  // the seat gestures come up half an hour before the booking (or when he is there or late), not at nine for half past three
  const soon = n.status === 'arrived' || n.status === 'in_chair' || n.late > 0 || (data.now != null && n.start - data.now.min <= 30);
  const absent = async () => {
    setBusy('no_show');
    try {
      await api.post('/api/v1/appointments/' + n.id + '/status', { status: 'no_show' });
      toast({ title: n.name + ' marqué absent', icon: 'check' });
      await reload();
    } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  return (
    <EsCard guide="espace.prochain" title="Prochain client" icon="scissors" className="es-next" end={n.status === 'in_chair' ? 'au fauteuil' : n.late > 0 ? 'en retard' : undefined}>
      <div className="es-when"><span className="es-t tnum">{time(n.start)}</span><h3 className="es-who">{n.name}</h3></div>
      <p className="es-svc">{n.services.join(' + ')} · {n.dur} min</p>
      <Chips n={n} />
      {last ? (
        <p className="es-last"><b>La dernière fois</b> ({shortDay(last.day)}, {who(last)}) : {last.text}</p>
      ) : cut ? (
        <p className="es-last"><b>La dernière fois</b> ({shortDay(cut.day)}, {cut.staffName}) : rien de noté{cut.services.length ? ' · ' + cut.services.join(' + ') : ''}.</p>
      ) : null}
      {first ? <p className="es-last older"><b>Note du {shortDay(first.day)}</b> ({who(first)}) : {first.text}</p> : null}
      {more.length ? (
        <details className="es-more"><summary>{more.length === 1 ? 'Une note avant' : more.length + ' notes avant'}</summary>
          {more.map((x) => <p key={x.id}>{shortDay(x.day)}, {who(x)} : {x.text}</p>)}
        </details>
      ) : null}
      {n.myNote ? <p className="es-tech"><b>Ta note du jour</b> · {n.myNote}</p> : null}
      {n.tech ? <p className="es-tech"><b>Fiche technique</b> · {n.tech}</p> : null}
      {n.note ? <p className="es-tech"><b>Note</b> · {n.note}</p> : null}
      <div className="es-acts">
        {soon && (n.status === 'booked' || n.status === 'pending') ? <Button variant="subtle" icon="check" busy={busy === 'arrived'} disabled={offline} onClick={() => status('arrived')}>Il est là</Button> : null}
        {soon && n.status !== 'in_chair' ? <Button variant="primary" icon="chair" busy={busy === 'in_chair'} disabled={offline} onClick={() => status('in_chair')}>Au fauteuil</Button> : null}
        {n.status === 'in_chair' && can('sale.create') ? <Button variant="primary" icon="caisse" disabled={offline} onClick={() => navigate('/caisse?rdv=' + n.id)}>Encaisser</Button> : null}
        {n.late >= LATE_ABSENT && (n.status === 'booked' || n.status === 'pending') ? <Button variant="ghost" icon="x" busy={busy === 'no_show'} disabled={offline} onClick={absent}>Absent</Button> : null}
        {n.canNote ? <Button variant="ghost" icon="edit" disabled={offline} onClick={() => note({ id: n.id, name: n.name, text: n.myNote })}>{n.myNote ? 'Corriger la note' : 'Note de coupe'}</Button> : null}
      </div>
      {n.status === 'in_chair' && !can('sale.create') ? <p className="es-tech faint">À encaisser à l’accueil.</p> : null}
    </EsCard>
  );
}
