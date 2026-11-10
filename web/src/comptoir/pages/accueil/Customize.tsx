// WP5 · « Personnaliser » (the model of Mon espace's): the page's blocks (Prochain, Fauteuils, Aujourd’hui: this device),
// then each card with ↑ / ↓ and a switch (his prefs: homeCards, homeHidden; they follow him from one device to the next).
// Every change is saved at once; « Remettre par défaut » gives the salon's order back. The server orders cards by group
// first, so an arrow only moves a card among its own group. The phone's tabs are the phone shell's (WP4).
import { useState } from 'react';
import { api } from '../../../lib/api';
import { Icon } from '../../../ui/Icon';
import { Button, Sheet, Switch, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Home } from '../../types';
import { ALL_BLOCKS, BLOCK_NAME, GROUP_LABEL, hiddenAfter, moved, nameOf, type Blocks } from './actions';

export function Customize({ open, onClose, home, blocks, setBlocks, onSaved }: { open: boolean; onClose: () => void; home: Home; blocks: Blocks; setBlocks: (b: Blocks) => void; onSaved: () => Promise<unknown> }) {
  const { boot, reloadBoot, offline } = useApp();
  const [said, setSaid] = useState('');
  const cards = home.cards;
  const hidden = boot.me.prefs?.homeHidden || [];
  // hidden cards are not in the answer: they are listed after, by name, to be switched back on
  const off = hidden.filter((id) => !cards.some((c) => c.id === id));
  const save = async (patch: { homeCards?: string[]; homeHidden?: string[] }, words: string) => {
    try { await api.patch('/api/v1/prefs', patch); await Promise.all([reloadBoot(), onSaved()]); setSaid(words); }
    catch (e) { toastError(e); }
  };
  const move = async (i: number, by: -1 | 1) => {
    const order = moved(cards, i, by);
    if (!order) return;
    const id = cards[i].id;
    await save({ homeCards: order }, nameOf(id) + (by < 0 ? ' montée' : ' descendue'));
    requestAnimationFrame(() => {
      const pick = (d: string) => document.getElementById('hm-mv-' + id + '-' + d) as HTMLButtonElement | null;
      const same = pick(by < 0 ? 'up' : 'down');
      (same && !same.disabled ? same : pick(by < 0 ? 'down' : 'up'))?.focus();
    });
  };
  const show = (id: string, on: boolean) => save({ homeHidden: hiddenAfter(hidden, id, on) }, nameOf(id) + (on ? ' affichée' : ' masquée'));
  const reset = async () => { setBlocks(ALL_BLOCKS); await save({ homeCards: [], homeHidden: [] }, 'Ordre d’origine remis'); };
  return (
    <Sheet open={open} onClose={onClose} title="Personnaliser" kicker="Accueil"
      footer={<><Button variant="ghost" disabled={offline} onClick={() => void reset()}>Remettre par défaut</Button><span className="grow" /><Button variant="primary" onClick={onClose}>Terminé</Button></>}>
      <p className="section-k">La journée · sur cet appareil</p>
      <ul className="hm-custom">
        {(Object.keys(BLOCK_NAME) as (keyof Blocks)[]).map((k) => (
          <li key={k}><Switch on={blocks[k]} onChange={(on) => { setBlocks({ ...blocks, [k]: on }); setSaid(BLOCK_NAME[k] + (on ? ' affiché' : ' masqué')); }} title={BLOCK_NAME[k]} /></li>
        ))}
      </ul>
      <p className="section-k">À traiter · sur tous tes appareils</p>
      <p className="muted" style={{ fontSize: 13.5 }}>Choisis les cartes que tu veux voir et dans quel ordre. Une carte n’apparaît que lorsqu’il y a quelque chose à faire ; ce qui bloque reste toujours en premier.</p>
      {cards.length || off.length ? (
        <ul className="hm-custom">
          {cards.map((c, i) => (
            <li key={c.id} className="hm-custom-card">
              {i === 0 || cards[i - 1].group !== c.group ? <p className="hm-custom-g">{GROUP_LABEL[c.group]}</p> : null}
              <div className="hm-custom-r">
                <div className="hm-mv">
                  <button type="button" id={'hm-mv-' + c.id + '-up'} className="hm-arrow" aria-label={'Monter ' + nameOf(c.id)} disabled={offline || !moved(cards, i, -1)} onClick={() => void move(i, -1)}><Icon name="chevL" size={18} className="hm-up" /></button>
                  <button type="button" id={'hm-mv-' + c.id + '-down'} className="hm-arrow" aria-label={'Descendre ' + nameOf(c.id)} disabled={offline || !moved(cards, i, 1)} onClick={() => void move(i, 1)}><Icon name="chevL" size={18} className="hm-down" /></button>
                </div>
                <Switch on onChange={(on) => void show(c.id, on)} title={nameOf(c.id)} hint={c.canHide ? undefined : 'Toujours affichée : elle engage le salon'} disabled={offline || !c.canHide} />
              </div>
            </li>
          ))}
          {off.length ? <li className="hm-custom-card"><p className="hm-custom-g">Masquées</p></li> : null}
          {off.map((id) => <li key={id}><Switch on={false} onChange={(on) => void show(id, on)} title={nameOf(id)} disabled={offline} /></li>)}
        </ul>
      ) : <p className="muted" style={{ fontSize: 13.5 }}>Aucune carte en ce moment : rien à traiter.</p>}
      <p className="vh" role="status" aria-live="polite">{said}</p>
    </Sheet>
  );
}
