// The three gestures of a busy day, under the thumb: a new booking, a client without one, the till. On a phone the bar
// stays above the tabs while the page scrolls (dock.css); on a wider screen it is a plain row of buttons. The Accueil and
// the phone Agenda show the same one, so the hand finds it in the same place.
import { Icon } from '../../../ui/Icon';
import './dock.css';

export function Dock({ onNew, onWalkin, onPay, toPay = 0, guide }: { onNew?: () => void; onWalkin?: () => void; onPay?: () => void; toPay?: number; guide?: { new?: string; walkin?: string } }) {
  if (!onNew && !onWalkin && !onPay) return null;
  return (
    <nav className="dock" aria-label="Gestes rapides">
      {onNew ? <button type="button" className="dock-b dock-main" onClick={onNew} data-guide={guide?.new}><Icon name="plus" size={18} />Rendez-vous</button> : null}
      {onWalkin ? <button type="button" className="dock-b" onClick={onWalkin} data-guide={guide?.walkin} aria-label="Passage : un client sans rendez-vous"><Icon name="walk" size={18} />Passage</button> : null}
      {onPay ? <button type="button" className="dock-b" onClick={onPay} aria-label={toPay ? 'Encaisser : ' + toPay + ' en attente' : 'Encaisser'}><Icon name="caisse" size={18} />Encaisser{toPay ? <span className="dock-n tnum" aria-hidden>{toPay}</span> : null}</button> : null}
    </nav>
  );
}
