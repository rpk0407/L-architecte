// « Ma journée »: one row per appointment of his, in order. The ones already done fold away (all but the last),
// so the first rows on a phone are the ones that matter now.
import { useState } from 'react';
import { navigate } from '../../../../lib/router';
import { time } from '../../../../lib/format';
import { Button } from '../../../../ui/kit';
import { useApp } from '../../../state';
import type { EspaceCardMeta, EspaceCardProps, EspaceRow } from '../../../types';
import { EsCard } from '../shared';

export const meta: EspaceCardMeta = { id: 'journee', title: 'Ma journée', chairOnly: true };

const WORD: Record<string, string> = { pending: 'Acompte attendu', booked: '', arrived: 'Arrivé', in_chair: 'Au fauteuil', done: 'Terminé', no_show: 'Absent' };
const TONE: Record<string, string> = { arrived: 'badge-ok', in_chair: 'badge-accent', no_show: 'badge-danger', pending: 'badge-warn' };
const closed = (r: EspaceRow) => r.status === 'done' || r.status === 'no_show';

export default function Journee({ data, note }: EspaceCardProps) {
  const { offline } = useApp();
  const [all, setAll] = useState(false);
  const rows = data.list;
  // the closed rows before the first open one fold as soon as two are done: the last one stays for « + note », and the
  // open ones (the chair, what comes next) are the first thing on a phone
  const firstOpen = rows.findIndex((r) => !closed(r));
  const past = firstOpen < 0 ? rows.length : firstOpen;
  const fold = !all && past >= 2;
  const shown = fold ? rows.slice(past - 1) : rows;
  const hidden = fold ? past - 1 : 0;
  // « + note » on the latest finished row only, until the whole day is unfolded
  const noteOn = all ? null : rows[past - 1]?.id;
  return (
    <EsCard guide="espace.journee" title="Ma journée" icon="calendar"
      end={hidden ? <button type="button" className="es-fold" onClick={() => setAll(true)}>{hidden} déjà passé{hidden > 1 ? 's' : ''} · voir</button> : rows.length ? rows.filter(closed).length + ' / ' + rows.length + ' faits' : undefined}>
      {!rows.length ? <p className="es-empty"><b>Rien de prévu</b><span>Aucun rendez-vous dans ta colonne aujourd’hui.</span></p> : (
        <ul className="es-rows" aria-label="Mes rendez-vous du jour">
          {shown.map((r) => (
            <li key={r.id} className={'es-row' + (closed(r) ? ' past' : '') + (r.status === 'in_chair' ? ' live' : '')}>
              <button type="button" className="es-row-main" onClick={() => navigate('/agenda?rdv=' + r.id + (data.day === data.today ? '' : '&day=' + data.day))}>
                <span className="es-rt tnum">{time(r.start)}</span>
                <span className="es-rn"><b>{r.name}</b><small>{r.services.join(' + ')}</small></span>
                {r.late > 0 ? <span className="badge badge-warn">En retard · {r.late} min</span> : WORD[r.status] ? <span className={'badge ' + (TONE[r.status] || '')}>{WORD[r.status]}</span> : null}
              </button>
              {r.needsNote && (noteOn == null || r.id === noteOn) ? <Button className="es-note" size="sm" variant="ghost" icon="plus" disabled={offline} aria-label={'Ajouter une note de coupe pour ' + r.name} onClick={() => note({ id: r.id, name: r.name })}>note</Button> : null}
            </li>
          ))}
        </ul>
      )}
    </EsCard>
  );
}
