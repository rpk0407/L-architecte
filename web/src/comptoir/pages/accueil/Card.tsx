// WP5 · One « À traiter » card: what the server says (title, at most three lines, the amount when it sent one), a single
// button, and the « ⋯ » menu (Plus tard · Masquer cette carte · Pourquoi je vois ça). `z` and `absence-demande` commit
// the salon: the server sends canHide false and the menu only explains them.
import { useState } from 'react';
import { Icon } from '../../../ui/Icon';
import { Button, Menu, Money } from '../../../ui/kit';
import type { HomeCard } from '../../types';
import { isEstimate, shownAmount } from './actions';

export function Card({ c, onRun, onLater, onHide }: { c: HomeCard; onRun: () => void; onLater: () => void; onHide: () => void }) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [why, setWhy] = useState(false);
  return (
    // the whole card answers the touch (a big target on a phone); its button stays the one named action
    <li className="hm-card" data-card={c.id} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, [role="menu"]')) onRun(); }}>
      <div className="hm-card-t">
        <h3>{c.title}{c.amount != null ? <span className="hm-amt"> · {isEstimate(c.id) ? 'env. ' : ''}<Money cents={shownAmount(c.id, c.amount)} /></span> : null}</h3>
        {c.preview.length ? <ul>{c.preview.slice(0, 3).map((p) => <li key={p.id}>{p.text}</li>)}</ul> : null}
        {why ? <p className="hm-why" role="note">{c.why}</p> : null}
      </div>
      <div className="hm-card-a">
        <Button variant={c.group === 'bloque' ? 'primary' : 'subtle'} onClick={onRun}>{c.action.label}</Button>
        <button type="button" className="hm-more" aria-label={'Options : ' + c.title} aria-haspopup="menu" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}><Icon name="dots" size={20} /></button>
      </div>
      <Menu anchor={menu} onClose={() => setMenu(null)}>
        {c.canHide ? <button type="button" onClick={onLater}><Icon name="clock" />Plus tard (jusqu’à demain)</button> : null}
        {c.canHide ? <button type="button" onClick={onHide}><Icon name="eyeOff" />Masquer cette carte</button> : null}
        <button type="button" onClick={() => setWhy(!why)}><Icon name="info" />{why ? 'Refermer l’explication' : 'Pourquoi je vois ça'}</button>
      </Menu>
    </li>
  );
}
