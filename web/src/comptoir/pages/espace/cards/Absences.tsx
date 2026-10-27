// « Mes absences »: his next absence, the request still waiting for the owner, and the button to ask for one.
import { lazy, Suspense, useState } from 'react';
import { refreshAll } from '../../../../lib/query';
import { Button } from '../../../../ui/kit';
import { useApp } from '../../../state';
import type { EspaceCardMeta, EspaceCardProps } from '../../../types';
import { EsCard, spanWords } from '../shared';

export const meta: EspaceCardMeta = { id: 'absences', title: 'Mes absences', chairOnly: true };

// the sheet of Équipe (the same one « Mes absences » in Mon compte opens), loaded when it is asked for
const TimeOffSheet = lazy(() => import('../../Equipe').then((m) => ({ default: m.TimeOffSheet })));

export default function Absences({ data, reload }: EspaceCardProps) {
  const { boot, offline } = useApp();
  const [open, setOpen] = useState(false);
  const a = data.absences;
  const me = boot.staff.find((s) => s.id === boot.me.id) || boot.me;
  return (
    <EsCard guide="espace.absences" title="Mes absences" icon="calendar">
      {a.next ? <p className="es-line"><b>Prochaine absence</b> {spanWords(a.next.from, a.next.to)}</p> : <p className="es-line muted">Aucune absence prévue.</p>}
      {a.pending.map((p) => <p key={p.id} className="es-line"><span className="badge badge-warn">En attente</span> {spanWords(p.from, p.to)} · le gérant doit valider</p>)}
      <div className="es-acts"><Button variant="ghost" icon="plus" disabled={offline} onClick={() => setOpen(true)}>Demander une absence</Button></div>
      {open ? <Suspense fallback={null}><TimeOffSheet open onClose={() => { setOpen(false); refreshAll(); reload(); }} staff={[me]} fixed={me.id} /></Suspense> : null}
    </EsCard>
  );
}
