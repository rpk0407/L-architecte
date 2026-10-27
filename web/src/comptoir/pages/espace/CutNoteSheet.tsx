// The cut note: a few words about the cut, for whoever cuts this client next. Written in the chair or within two weeks.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { refreshAll } from '../../../lib/query';
import { Button, Field, Sheet, toast, toastError } from '../../../ui/kit';
import type { NoteTarget } from '../../types';

/** the longest note the server keeps (server/commands/cutnotes.js) */
export const NOTE_MAX = 280;
const SHORTCUTS = ['Comme d’habitude', 'Plus court', 'Dégradé'];

export function CutNoteSheet({ target, onClose, onSaved }: { target: NoteTarget | null; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) setText(target.text || ''); }, [target?.id]);
  const add = (w: string) => setText((t) => { const s = t.trim(); return (s ? s + ', ' + w.toLowerCase() : w).slice(0, NOTE_MAX); });
  const save = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.post('/api/v1/appointments/' + target.id + '/cut-note', { text: text.trim() });
      toast({ title: 'Note de coupe enregistrée', sub: 'Elle s’affichera à sa prochaine visite.', icon: 'check' });
      refreshAll(); onSaved(); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open={!!target} onClose={onClose} title={target ? 'Note de coupe · ' + target.name : ''} kicker="Pour la prochaine fois"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><span className="grow" /><Button variant="primary" busy={busy} disabled={!text.trim()} onClick={save}>Enregistrer</Button></>}>
      <Field label="Note de coupe" htmlFor="es-note-t" hint={text.length + ' / ' + NOTE_MAX + ' · Visible par toute l’équipe.'}>
        <textarea id="es-note-t" className="input textarea" rows={4} maxLength={NOTE_MAX} value={text} placeholder="Sabot, longueurs, produit… Pas d’infos de santé ici." onChange={(e) => setText(e.target.value)} data-autofocus />
      </Field>
      <div className="chips" role="group" aria-label="Phrases toutes faites">
        {SHORTCUTS.map((w) => <button key={w} type="button" className="chip" onClick={() => add(w)}>{w}</button>)}
      </div>
    </Sheet>
  );
}
