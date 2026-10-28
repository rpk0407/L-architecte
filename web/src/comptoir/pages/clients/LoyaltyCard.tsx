// The loyalty card on a client file (FID-03): the stamps, the rewards that wait, the last movements, who referred him, a
// stamp forgotten at the till (anyone who rings up), and, for the owner and managers, an adjustment with its reason and a
// reward offered. The file's own switch is the right not to take part.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { dates, eur, plural } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { dayWords, moveWords, type ClientLoyalty } from '../../../lib/loyalty';
import { Icon } from '../../../ui/Icon';
import { StampCard } from '../../../ui/StampCard';
import { Button, Chip, Field, Modal, Seg, Switch, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import './loyalty.css';

const FORGOTTEN = ['Tampon oublié', 'Passage sans ticket'];
const SOURCE: Record<string, string> = { card: 'carte complète', gift: 'offerte par le salon', referrer: 'parrainage', referee: 'bienvenue', birthday: 'anniversaire' };
/** « 12 oct. » */
const ddmm = (day: string) => { const p = dates.dayParts(day); return p.d + ' ' + dates.MONTHS_SH[p.m - 1]; };

export function LoyaltyCard({ c }: { c: { id: string; first: string; erased: boolean } }) {
  const { can } = useApp();
  const q = useQuery<ClientLoyalty>(c.erased ? null : '/api/v1/loyalty/client/' + c.id);
  const [modal, setModal] = useState<'' | 'stamp' | 'adjust' | 'gift'>('');
  const card = q.data;
  // the programme off (or a person who may not read it): no card at all
  if (c.erased || !card || !card.enabled) return null;
  const done = () => { setModal(''); refreshAll(); };
  const setOff = async (off: boolean) => { try { await api.post('/api/v1/loyalty/off', { clientId: c.id, off }); refreshAll(); } catch (e) { toastError(e); } };
  const by = card.referral.by;

  return (
    <div className="card col ly" data-guide="clients.loyalty">
      <div className="card-h"><h2><Icon name="gift" size={16} />Fidélité</h2>{card.off ? <span className="badge">ne participe pas</span> : card.rewards.length ? <span className="badge badge-accent">récompense</span> : null}</div>
      <div className="ly-top">
        <StampCard units={card.units} goal={card.goal} />
        <b>{Math.max(0, card.units)}/{card.goal}</b>
      </div>

      {card.rewards.map((r) => (
        <div key={r.id} className="ly-rw"><Icon name="gift" /><span className="li-main"><b>{r.label}</b><small>jusqu’au {dayWords(r.expires)} · {SOURCE[r.source] || r.source}</small></span></div>
      ))}

      {card.last.length ? (
        <ul className="ly-moves" aria-label="Derniers mouvements de la carte">
          {card.last.map((m, i) => <li key={i}><span className="d">{ddmm(m.day)}</span><span className="w">{moveWords(m.what)}</span>{m.units ? <span className={'u' + (m.units < 0 ? ' neg' : '')}>{m.units > 0 ? '+' : '−'}{Math.abs(m.units)}</span> : null}</li>)}
        </ul>
      ) : <p className="muted" style={{ fontSize: 14 }}>Pas encore de passage sur la carte.</p>}

      {by || card.referral.count ? (
        <p className="muted" style={{ fontSize: 14 }}>
          {by ? <>Parrainé par <Link to={'/clients/' + by.id} className="link">{by.name}</Link></> : null}{by && card.referral.count ? ' · ' : ''}{card.referral.count ? 'A parrainé ' + plural(card.referral.count, 'ami') : null}
        </p>
      ) : null}

      <div className="ly-acts">
        {can('sale.create') && !card.off ? <Button onClick={() => setModal('stamp')}>+ 1 tampon</Button> : null}
        {can('loyalty.manage') ? <Button icon="edit" onClick={() => setModal('adjust')}>Ajuster</Button> : null}
        {can('loyalty.manage') ? <Button icon="gift" onClick={() => setModal('gift')}>Offrir une récompense</Button> : null}
      </div>
      {can('client.edit') ? <Switch on={!card.off} onChange={(on) => setOff(!on)} title="Participe à la carte fidélité" hint={card.off ? 'Il ne cumule plus de tampons. Ses récompenses déjà gagnées restent valables.' : card.goal + ' passages payés, le ' + (card.goal + 1) + 'e offert.'} /> : null}

      <StampModal open={modal === 'stamp'} onClose={() => setModal('')} cid={c.id} first={c.first} onDone={done} oncePerDay={!can('loyalty.manage')} />
      <AdjustModal open={modal === 'adjust'} onClose={() => setModal('')} cid={c.id} first={c.first} onDone={done} />
      <GiftModal open={modal === 'gift'} onClose={() => setModal('')} cid={c.id} first={c.first} onDone={done} />
    </div>
  );
}

/** « + 1 tampon »: the two reasons anyone at the till may give, one stamp a day. */
function StampModal({ open, onClose, cid, first, onDone, oncePerDay }: { open: boolean; onClose: () => void; cid: string; first: string; onDone: () => void; oncePerDay: boolean }) {
  const [busy, setBusy] = useState('');
  const give = async (reason: string) => {
    setBusy(reason);
    try { await api.post('/api/v1/loyalty/adjust', { clientId: cid, units: 1, reason }); toast({ title: 'Tampon ajouté', sub: first, icon: 'check' }); onDone(); } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  return (
    <Modal open={open} onClose={onClose} label="Ajouter un tampon">
      <h2>Ajouter un tampon</h2>
      <p>Pour {first}{oncePerDay ? ', un seul par jour' : ''}. Pourquoi ?</p>
      <div className="chips">{FORGOTTEN.map((r) => <Chip key={r} disabled={!!busy} onClick={() => give(r)}>{r}</Chip>)}</div>
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button></div>
    </Modal>
  );
}

/** « Ajuster »: a few stamps more or less, with the reason (it stays with the file, not in the journal's chain). */
function AdjustModal({ open, onClose, cid, first, onDone }: { open: boolean; onClose: () => void; cid: string; first: string; onDone: () => void }) {
  const [units, setUnits] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setUnits(1); setReason(''); } }, [open]);
  const go = async () => {
    setBusy(true);
    try { await api.post('/api/v1/loyalty/adjust', { clientId: cid, units, reason: reason.trim() }); toast({ title: 'Carte ajustée', sub: first + ' · ' + (units > 0 ? '+' : '−') + Math.abs(units), icon: 'check' }); onDone(); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} label="Ajuster la carte">
      <h2>Ajuster la carte</h2>
      <div className="ly-form">
        <div><span className="label" id="ly-u">Tampons</span>
          <span className="ly-num" role="group" aria-labelledby="ly-u"><Button icon="minus" aria-label="Un tampon de moins" disabled={units <= -50} onClick={() => setUnits(units === 1 ? -1 : units - 1)} /><b aria-live="polite">{units > 0 ? '+' : '−'}{Math.abs(units)}</b><Button icon="plus" aria-label="Un tampon de plus" disabled={units >= 50} onClick={() => setUnits(units === -1 ? 1 : units + 1)} /></span></div>
        <Field label="Raison" htmlFor="ly-why" hint="Elle reste sur sa fiche, pas dans le journal de la caisse."><input id="ly-why" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={80} placeholder="Ex. : tampons de l’ancienne carte papier" data-autofocus /></Field>
      </div>
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={reason.trim().length < 2} onClick={go}>Appliquer {units > 0 ? '+' : '−'}{Math.abs(units)}</Button></div>
    </Modal>
  );
}

/** « Offrir une récompense »: a cut or an amount off, valid for a while, outside the card. */
function GiftModal({ open, onClose, cid, first, onDone }: { open: boolean; onClose: () => void; cid: string; first: string; onDone: () => void }) {
  const [kind, setKind] = useState<'service' | 'amount'>('service');
  const [euro, setEuro] = useState('25');
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const cents = (Number(euro.replace(/\D/g, '')) || 0) * 100;
  const go = async () => {
    setBusy(true);
    try {
      await api.post('/api/v1/loyalty/gift', { clientId: cid, days, reward: kind === 'amount' ? { kind, amount: cents } : { kind, refs: [], cap: cents } });
      toast({ title: 'Récompense offerte', sub: first, icon: 'gift' }); onDone();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} label="Offrir une récompense">
      <h2>Offrir une récompense</h2>
      <div className="ly-form">
        <Seg<'service' | 'amount'> label="Récompense" value={kind} onChange={(k) => { setKind(k); setEuro(k === 'amount' ? '5' : '25'); }} options={[{ v: 'service', t: 'Une prestation offerte' }, { v: 'amount', t: 'Une remise' }]} />
        <div className="ly-line"><label htmlFor="ly-eur">{kind === 'amount' ? 'Remise de' : 'Jusqu’à'}</label><input id="ly-eur" className="input" inputMode="numeric" value={euro} onChange={(e) => setEuro(e.target.value.replace(/\D/g, '').slice(0, 3))} /><span className="serif" style={{ fontSize: 24 }}>€</span>{kind === 'service' && !cents ? <span className="faint" style={{ fontSize: 12.5 }}>Le prix entier.</span> : null}</div>
        <div><span className="label" id="ly-d">Valable</span><div className="chips" role="group" aria-labelledby="ly-d">{[{ d: 30, t: '1 mois' }, { d: 90, t: '3 mois' }, { d: 180, t: '6 mois' }].map((x) => <Chip key={x.d} on={days === x.d} onClick={() => setDays(x.d)}>{x.t}</Chip>)}</div></div>
      </div>
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={kind === 'amount' ? cents < 100 : false} onClick={go}>Offrir {kind === 'amount' ? eur(cents) : cents ? 'jusqu’à ' + eur(cents) : 'la prestation'}</Button></div>
    </Modal>
  );
}
