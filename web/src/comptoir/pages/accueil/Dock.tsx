// The gestures of a busy day, under the thumb: a new booking, a client without one, the till, and « Formule » when the
// salon sells one (the 5 cuts with their dates, sold to the client standing there). On a phone the bar stays above the
// tabs while the page scrolls (dock.css); on a wider screen it is a plain row of buttons. The Accueil and the phone
// Agenda show the same one, so the hand finds it in the same place.
import { Icon } from '../../../ui/Icon';
import './dock.css';

export function Dock({ onNew, onWalkin, onPay, onFormule, formule = '', toPay = 0, guide }: { onNew?: () => void; onWalkin?: () => void; onPay?: () => void; onFormule?: () => void; /** what the formule is, for the button's title: « Formule Entretien 5 semaines : 5 coupes, 80 € » */ formule?: string; toPay?: number; guide?: { new?: string; walkin?: string; formule?: string } }) {
  if (!onNew && !onWalkin && !onPay && !onFormule) return null;
  const n = [onNew, onWalkin, onPay, onFormule].filter(Boolean).length;
  return (
    <nav className={'dock' + (n > 3 ? ' dock-4' : '')} aria-label="Gestes rapides">
      {onNew ? <button type="button" className="dock-b dock-main" onClick={onNew} data-guide={guide?.new}><Icon name="plus" size={18} />Rendez-vous</button> : null}
      {onWalkin ? <button type="button" className="dock-b" onClick={onWalkin} data-guide={guide?.walkin} aria-label="Passage : un client sans rendez-vous"><Icon name="walk" size={18} />Passage</button> : null}
      {onFormule ? <button type="button" className="dock-b" onClick={onFormule} data-guide={guide?.formule} title={formule || undefined} aria-label={'Formule : vendre ' + (formule || 'la formule') + ', ses dates réservées'}><Icon name="ticket" size={18} />Formule</button> : null}
      {onPay ? <button type="button" className="dock-b" onClick={onPay} aria-label={toPay ? 'Encaisser : ' + toPay + ' en attente' : 'Encaisser'}><Icon name="caisse" size={18} />Encaisser{toPay ? <span className="dock-n tnum" aria-hidden>{toPay}</span> : null}</button> : null}
    </nav>
  );
}
