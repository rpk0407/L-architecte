// The cut notes of one client, on his file: who wrote them and when, the latest visit first. They are written from Mon
// espace (in the chair or within two weeks of the cut), not here; the free-text fiche technique next to it is unchanged.
import { useQuery } from '../../../lib/query';
import { Icon } from '../../../ui/Icon';
import type { CutNoteView } from '../../types';
import { shortDay } from './shared';
import './cutnotes.css';

export default function CutNotes({ clientId }: { clientId: string }) {
  const { data, error } = useQuery<{ items: CutNoteView[] }>('/api/v1/clients/' + clientId + '/cut-notes');
  // a file the person may not read, or a salon without the notes: nothing to say
  if (error || !data) return null;
  return (
    <section className="card" data-guide="clients.notes-coupe">
      <div className="card-h"><h2><Icon name="edit" size={16} />Notes de coupe</h2></div>
      {data.items.length ? (
        <ul className="cn-list" aria-label="Notes de coupe">
          {data.items.map((n) => (
            <li key={n.id}><span className="muted tnum">{shortDay(n.day)} · {n.staff}{n.by ? ' (écrit par ' + n.by + ')' : ''}{n.edited ? ' · corrigée' : ''}</span><span>{n.text}</span></li>
          ))}
        </ul>
      ) : <p className="muted" style={{ fontSize: 13.5 }}>Aucune note pour l’instant. Le barbier en écrit une au fauteuil, depuis Mon espace : elle s’affiche ici et à sa prochaine visite.</p>}
    </section>
  );
}
