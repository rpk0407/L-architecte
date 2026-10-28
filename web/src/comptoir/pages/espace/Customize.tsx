// « Personnaliser »: each card of Mon espace with ↑ / ↓ and a switch. Every change is saved at once (his prefs), and
// « Remettre par défaut » gives the salon's order back.
import { useState } from 'react';
import { api } from '../../../lib/api';
import { Icon } from '../../../ui/Icon';
import { Button, Sheet, Switch, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import { orderedCards } from './registry';

export function Customize({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { boot, reloadBoot, offline } = useApp();
  const [said, setSaid] = useState('');
  const cards = orderedCards(boot.me.prefs, boot.me.chair);
  const save = async (order: string[], hidden: string[], words: string) => {
    try { await api.patch('/api/v1/prefs', { cards: order, hidden }); await reloadBoot(); setSaid(words); }
    catch (e) { toastError(e); }
  };
  const ids = cards.map((c) => c.meta.id);
  const hiddenIds = cards.filter((c) => c.hidden).map((c) => c.meta.id);
  const move = async (i: number, by: -1 | 1) => {
    const order = [...ids];
    [order[i], order[i + by]] = [order[i + by], order[i]];
    await save(order, hiddenIds, cards[i].meta.title + ' en position ' + (i + by + 1));
    // the arrow that was pressed is disabled once the card reaches the first or the last place: the focus goes to the other one
    requestAnimationFrame(() => {
      const pick = (d: string) => document.getElementById('es-mv-' + cards[i].meta.id + '-' + d) as HTMLButtonElement | null;
      const same = pick(by < 0 ? 'up' : 'down');
      (same && !same.disabled ? same : pick(by < 0 ? 'down' : 'up'))?.focus();
    });
  };
  const show = (id: string, on: boolean) => save(ids, on ? hiddenIds.filter((x) => x !== id) : [...hiddenIds, id], cards.find((c) => c.meta.id === id)!.meta.title + (on ? ' affichée' : ' masquée'));
  return (
    <Sheet open={open} onClose={onClose} title="Personnaliser" kicker="Mon espace"
      footer={<><Button variant="ghost" disabled={offline} onClick={() => void save([], [], 'Ordre d’origine remis')}>Remettre par défaut</Button><span className="grow" /><Button variant="primary" onClick={onClose}>Terminé</Button></>}>
      <p className="muted" style={{ fontSize: 13.5 }}>Choisis les cartes que tu veux voir et dans quel ordre. C’est rien que pour toi, sur tous tes appareils.</p>
      <ul className="es-custom">
        {cards.map((c, i) => (
          <li key={c.meta.id}>
            <div className="es-mv">
              <button type="button" id={'es-mv-' + c.meta.id + '-up'} className="es-arrow" aria-label={'Monter ' + c.meta.title} disabled={offline || i === 0} onClick={() => void move(i, -1)}><Icon name="chevL" size={18} className="es-up" /></button>
              <button type="button" id={'es-mv-' + c.meta.id + '-down'} className="es-arrow" aria-label={'Descendre ' + c.meta.title} disabled={offline || i === cards.length - 1} onClick={() => void move(i, 1)}><Icon name="chevL" size={18} className="es-down" /></button>
            </div>
            <Switch on={!c.hidden} onChange={(on) => void show(c.meta.id, on)} title={c.meta.title} disabled={offline} />
          </li>
        ))}
      </ul>
      <p className="vh" role="status" aria-live="polite">{said}</p>
    </Sheet>
  );
}
