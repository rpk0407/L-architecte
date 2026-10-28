// Loyalty at the till (FID-03): the reward of the client's card in one tap, « Quelqu’un t’a envoyé ? » for a first visit,
// and the card's line on the done screen. The discount is the server's own arithmetic (shared/loyalty.js rewardValue), so
// the ticket's total is the one the server checks; any cashier may apply a reward (the card is the system's, not a typed
// discount, so a barber's discount ceiling does not apply).
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { api, qs } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { dayWords, rewardValue, rewardWords, type CardLine, type CardReward, type ClientLoyalty } from '../../../lib/loyalty';
import { useDebounced } from '../../../lib/hooks';
import { Icon } from '../../../ui/Icon';
import { StampCard } from '../../../ui/StampCard';
import { Avatar, Modal, Note, Sheet, toast } from '../../../ui/kit';
import { eur } from '../../../lib/format';
import { useApp } from '../../state';
import type { ClientCard } from '../../types';
import './reward.css';

/** What the chip needs to know of a ticket line (Checkout's own Line carries more). rewardId: set once a reward is applied; discount then holds its value. */
export type TillLine = { key: string; kind: string; ref: string | null; qty: number; unit: number; packId: string | null; discount: number; rewardId?: string };
type Client = ClientCard & { loyalty?: CardLine };

const worth = (r: CardReward, l: TillLine) => rewardValue(r.reward, { kind: l.kind, ref: l.ref, unit: l.unit, qty: l.qty });
/** a line this reward can take off: a service or product, not covered by a carnet or a membership, with no reward yet */
const takes = (r: CardReward, l: TillLine) => !l.rewardId && !l.packId && worth(r, l) > 0;
/** « Une prestation offerte (jusqu’à 25 €) » → « Une prestation offerte »: the cap is on the card, not in the chip */
const short = (label: string) => label.replace(/ \(jusqu’à [^)]*\)/, '');

export function RewardChip<L extends TillLine>({ client, lines, setLines }: { client: Client | null; lines: L[]; setLines: Dispatch<SetStateAction<L[]>> }) {
  const on = !!client?.loyalty;
  const q = useQuery<ClientLoyalty>(on ? '/api/v1/loyalty/client/' + client!.id : null);
  const [more, setMore] = useState(false);
  const [who, setWho] = useState(false);
  const card = q.data;
  const applied = lines.find((l) => l.rewardId);

  // the reward follows the ticket: its value moves with the line's price, and it goes when the line can no longer take it
  // (another client, a carnet picked on that line, the card gone)
  useEffect(() => {
    if (!applied || !card || q.refreshing) return;
    const r = card.rewards.find((x) => x.id === applied.rewardId);
    const v = r && !applied.packId ? worth(r, applied) : 0;
    if (!v) {
      setLines((ls) => ls.map((l) => (l.rewardId ? { ...l, rewardId: undefined, discount: 0 } : l)));
      toast({ kind: 'info', title: 'Récompense retirée du ticket', sub: 'Elle ne s’applique plus à cette ligne.', icon: 'gift' });
    } else if (v !== applied.discount) setLines((ls) => ls.map((l) => (l.rewardId ? { ...l, discount: v } : l)));
  }, [card, q.refreshing, lines]);

  if (!client || !on) return null;
  if (!card) return null;
  if (card.off) return <p className="rw-note">Ne participe pas à la carte fidélité.</p>;

  const apply = (r: CardReward) => {
    const line = lines.find((l) => takes(r, l));
    if (!line) return;
    setLines((ls) => ls.map((l) => (l.rewardId ? { ...l, rewardId: undefined, discount: 0 } : l)).map((l) => (l.key === line.key ? { ...l, rewardId: r.id, discount: worth(r, l) } : l)));
    setMore(false);
  };
  const remove = () => setLines((ls) => ls.map((l) => (l.rewardId ? { ...l, rewardId: undefined, discount: 0 } : l)));

  const current = (applied && card.rewards.find((x) => x.id === applied.rewardId)) || card.rewards[0];
  const fits = !!current && lines.some((l) => takes(current, l));
  const others = card.rewards.filter((r) => r !== current);
  const firstVisit = card.referralOn && client.visits === 0 && !card.referral.by;

  return (
    <div className="rw" data-guide="caisse.reward">
      {current ? (
        <>
          <button type="button" className={'chip rw-chip' + (applied ? ' on' : '')} disabled={!applied && !fits} onClick={applied ? remove : () => apply(current)}>
            <Icon name="gift" />
            {applied ? <><b>{current.reward.kind === 'amount' ? '−' + eur(applied.discount) : 'Offerte'}</b><span className="rw-sep" aria-hidden>·</span>Retirer</> : <><b>{short(current.label)}</b><span className="rw-sep" aria-hidden>·</span>Appliquer</>}
          </button>
          {!applied && !fits ? <span className="rw-note">Ajoute la prestation pour l’offrir</span> : null}
          {applied ? null : <span className="rw-note">jusqu’au {dayWords(current.expires)}</span>}
          {others.length ? <button type="button" className="chip chip-sm" onClick={() => setMore(true)} aria-label={'Voir les ' + others.length + ' autres récompenses'}>+{others.length}</button> : null}
        </>
      ) : <span className="rw-note">Carte {Math.max(0, card.units)}/{card.goal}</span>}
      {firstVisit ? <button type="button" className="rw-link" onClick={() => setWho(true)}>Quelqu’un t’a envoyé ?</button> : null}
      <span className="vh" role="status">{applied ? 'Récompense appliquée au ticket' : ''}</span>

      <Modal open={more} onClose={() => setMore(false)} label="Récompenses du client">
        <h2>Ses récompenses</h2>
        <p>Une seule par ticket.</p>
        <div className="pick">
          {card.rewards.map((r) => (
            <button key={r.id} type="button" className="pick-r" disabled={!lines.some((l) => takes(r, l)) && applied?.rewardId !== r.id} aria-pressed={applied?.rewardId === r.id} onClick={() => (applied?.rewardId === r.id ? (remove(), setMore(false)) : apply(r))}>
              <span className="li-main"><b>{short(r.label)}</b><small>jusqu’au {dayWords(r.expires)}</small></span>
              <span className="badge badge-accent">{applied?.rewardId === r.id ? 'Retirer' : 'Appliquer'}</span>
            </button>
          ))}
        </div>
      </Modal>
      <Referrer open={who} onClose={() => setWho(false)} client={client} onDone={() => { q.refresh(); refreshAll(); }} />
    </div>
  );
}

/** « Quelqu’un t’a envoyé ? »: the friend who sent him, found by name; the server says in plain words when it cannot be. */
function Referrer({ open, onClose, client, onDone }: { open: boolean; onClose: () => void; client: Client; onDone: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(text, 180);
  const found = useQuery<{ items: ClientCard[] }>(open && dq.trim().length >= 2 ? '/api/v1/clients' + qs({ q: dq, limit: 8 }) : null);
  useEffect(() => { if (open) { setText(''); setErr(''); } }, [open]);
  const pick = async (c: ClientCard) => {
    setBusy(true); setErr('');
    try {
      await api.post('/api/v1/loyalty/referral', { clientId: client.id, referrerId: c.id });
      toast({ title: 'Parrainage noté', sub: c.first + ' l’a envoyé : son cadeau de bienvenue est sur sa carte.', icon: 'gift' });
      onDone(); onClose();
    } catch (e: any) { setErr(e?.message || 'Impossible de noter ce parrainage.'); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Qui t’a envoyé ?" kicker={client.first}>
      <div className="search"><Icon name="search" /><input className="input" aria-label="Chercher le parrain par prénom ou nom" placeholder="Prénom ou nom du parrain" value={text} onChange={(e) => setText(e.target.value)} data-autofocus /></div>
      <div aria-live="polite">{err ? <Note tone="err" icon="alert">{err}</Note> : null}</div>
      <div className="rw-who">
        {dq.trim().length < 2 ? <p className="rw-note">Tape au moins 2 lettres.</p> : found.data && !found.data.items.some((c) => c.id !== client.id) ? <p className="rw-note">Aucun client trouvé.</p> : null}
        <div className="pick">{found.data?.items.filter((c) => c.id !== client.id).map((c) => <button key={c.id} type="button" className="pick-r" disabled={busy} onClick={() => pick(c)}><Avatar name={c.name} size="sm" /><span className="li-main"><b>{c.first} {c.last}</b><small>{c.phone}</small></span></button>)}</div>
      </div>
    </Sheet>
  );
}

/** Why a ticket earned no stamp, in the words of the case (server/domain/loyalty.js saleLoyalty). */
const WHY: Record<string, (min: number) => string> = {
  covered: () => 'Pas de tampon : la coupe est payée par un carnet ou un abonnement.',
  today: () => 'Pas de tampon : il a déjà été tamponné aujourd’hui (un seul par jour).',
  min: (min) => 'Pas de tampon sur ce passage : il faut au moins ' + eur(min) + ' de prestations payées.',
  off: () => 'Ne participe pas à la carte fidélité.'
};
type SaleLoyalty = { units: number; rewards: { reward: CardReward['reward'] }[]; why: string | null };

/** The done screen's line about the card: the stamp just added, the card this ticket completed, or why there is none. */
export function LoyaltyDone({ client, saleId }: { client: Client | null; saleId: string }) {
  const { boot } = useApp();
  const live = !!client?.loyalty;
  const sale = useQuery<{ loyalty: SaleLoyalty | null }>(live ? '/api/v1/sales/' + saleId : null);
  const q = useQuery<ClientLoyalty>(live ? '/api/v1/loyalty/client/' + client!.id : null);
  // a ticket without a client is told so only while the programme runs (a barber's settings carry just that flag)
  if (!client) return boot.settings.loyalty?.enabled ? <div className="rw-done faint"><p>Pas de fiche client, pas de tampon.</p></div> : null;
  const card = q.data;
  if (!live || !card || !sale.data || q.refreshing || sale.refreshing) return null;
  if (card.off) return <div className="rw-done faint"><p>Ne participe pas à la carte fidélité.</p></div>;
  const units = Math.max(0, card.units);
  const did = sale.data.loyalty;
  // the card this very ticket completed: its reward was granted with the ticket
  const won = did && did.rewards[0];
  if (won) {
    const w = rewardWords(won.reward);
    return <div className="rw-done"><StampCard units={card.goal} goal={card.goal} size="sm" /><p>Carte complète : {w.charAt(0).toLowerCase() + w.slice(1)} à son prochain passage.</p></div>;
  }
  if (did && did.units > 0) return <div className="rw-done"><StampCard units={units} goal={card.goal} size="sm" /><p>Tampon ajouté · {units}/{card.goal}</p></div>;
  return <div className="rw-done faint"><p>{did && did.why && WHY[did.why] ? WHY[did.why](card.minNet) : 'Pas de tampon sur ce passage.'}</p></div>;
}
