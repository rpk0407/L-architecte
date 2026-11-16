// « Payer ma coupe » on the booking's own page (/r/…): once the client is at the salon, what he owes (the server's
// amount: the till's ticket, his deposit taken off, his carnet or membership applied), an optional tip, « Payer
// maintenant » to the provider's page (card, Apple Pay, Google Pay), then « Payé · merci » with his receipt.
import { useState } from 'react';
import { api, uuid } from '../lib/api';
import { eur, money } from '../lib/format';

export type PayLine = { name: string; qty: number; amount: number; was?: number };
export type PayGroup = { amount: number; n: number; names: string[]; lines: PayLine[]; deposit: number };
export type PayCutState = {
  state: 'due' | 'covered' | 'desk' | 'paid' | 'none';
  /** what is left to pay online, tip apart (cents) */
  amount?: number; lines?: PayLine[]; total?: number; discount?: number; deposit?: number; groupOf?: number;
  tips?: number[] | null; tipMax?: number; paying?: boolean; group?: PayGroup;
  online?: boolean; ticket?: string; receipt?: string | null;
  /** an online payment given back since (the salon had rung him up, or the amount had changed) */
  refunded?: number;
};

const e = (c: number) => eur(c, { decimals: c % 100 !== 0 });

function Lines({ lines, discount, deposit }: { lines: PayLine[]; discount?: number; deposit?: number }) {
  return (
    <div className="c-paylines">
      {lines.map((l, i) => <p key={i}><span>{l.qty > 1 ? l.qty + ' × ' : ''}{l.name}</span><b>{l.was != null && l.was !== l.amount ? <s>{e(l.was)}</s> : null}{e(l.amount)}</b></p>)}
      {discount ? <p className="sub"><span>dont remise</span><span>−{e(discount)}</span></p> : null}
      {deposit ? <p className="sub"><span>Acompte déjà payé</span><span>−{e(deposit)}</span></p> : null}
    </div>
  );
}

export function PayCut({ p, token, staff, onReload, onNote }: { p: PayCutState; token: string; staff: string; onReload: () => void; onNote: (n: { tone: string; text: string } | null) => void }) {
  const [tip, setTip] = useState(0);
  const [other, setOther] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const back = p.refunded ? <p className="c-note warn c-small" role="status">Ton paiement en ligne de {e(p.refunded)} a été remboursé sur ta carte (quelques jours selon ta banque) : le salon avait déjà encaissé, ou le montant avait changé.</p> : null;

  if (p.state === 'paid') {
    return (
      <section className="c-card c-center c-paycut" data-guide="r.paye" aria-live="polite">
        <span className="c-check" aria-hidden>✓</span>
        <h2 className="c-h">Payé · merci</h2>
        {p.total != null ? <p className="c-muted">{e(p.total)}{p.online ? ' réglés en ligne' : ' réglés au salon'}{p.ticket ? ' · ticket ' + p.ticket : ''}</p> : <p className="c-muted">C’est réglé avec le ticket de ton groupe.</p>}
        {p.receipt ? <a className="c-btn ghost" href={p.receipt}>Voir mon reçu</a> : null}
        {back}
      </section>
    );
  }
  if (p.state === 'none') return back;
  if (p.state === 'desk') return <section className="c-card c-paycut" data-guide="r.payer"><p className="c-k">À régler</p><p className="c-muted">Ce rendez-vous se règle au salon, auprès de ton barbier.</p>{back}</section>;
  if (p.state === 'covered') {
    return (
      <section className="c-card c-paycut" data-guide="r.payer">
        <p className="c-k">Rien à régler</p>
        <h2 className="c-h">C’est déjà couvert.</h2>
        <Lines lines={p.lines || []} discount={p.discount} deposit={p.deposit} />
        <p className="c-muted c-small">Ta formule, ton abonnement ou ton acompte couvre cette visite : aucun paiement n’est demandé.</p>
        {back}
      </section>
    );
  }

  const g = all && p.group ? p.group : null;
  const base = g ? g.amount : p.amount || 0;
  const max = p.tipMax || 5000;
  const typed = other != null ? money.parseEur(other) : null;
  const tipNow = other != null ? (typed != null && typed >= 0 && typed <= max ? typed : -1) : tip;
  const pay = async () => {
    if (busy || tipNow < 0) return;
    setBusy(true); onNote(null);
    try {
      const r = await api.post<{ url: string }>('/api/public/bookings/' + encodeURIComponent(token) + '/checkout', { expect: base, tip: tipNow, ...(g ? { group: true } : {}) }, uuid());
      location.href = r.url;
    } catch (err: any) {
      setBusy(false);
      if (err?.code === 'changed' || err?.code === 'paid' || err?.code === 'not_open') onReload();
      onNote({ tone: 'warn', text: err?.code === 'changed' ? 'Le montant a changé : vérifie le nouveau montant ci-dessous, puis paie.' : err.message });
    }
  };
  return (
    <section className="c-card c-paycut" data-guide="r.payer" id="payer">
      <p className="c-k">À régler · {e(base)}</p>
      <h2 className="c-amount">{e(base + Math.max(0, tipNow))}</h2>
      <Lines lines={g ? g.lines : p.lines || []} discount={g ? 0 : p.discount} deposit={g ? g.deposit : p.deposit} />
      {p.group ? (
        <div className="c-paychips" role="group" aria-label="Pour qui payes-tu ?">
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>Ma place · {e(p.amount || 0)}</button>
          <button type="button" aria-pressed={all} onClick={() => setAll(true)}>Tout le groupe ({p.group.n}) · {e(p.group.amount)}</button>
        </div>
      ) : p.groupOf ? <p className="c-muted c-small">Ce ticket réunit {p.groupOf} personnes de ton groupe.</p> : null}
      {p.tips ? (
        <div className="c-tip" data-guide="r.pourboire">
          <p className="c-k">Pourboire{staff ? ' pour ' + staff : ''} · facultatif</p>
          <div className="c-paychips" role="group" aria-label="Pourboire">
            <button type="button" aria-pressed={other == null && tip === 0} onClick={() => { setOther(null); setTip(0); }}>Aucun</button>
            {p.tips.map((t) => <button key={t} type="button" aria-pressed={other == null && tip === t} onClick={() => { setOther(null); setTip(t); }}>{e(t)}</button>)}
            <button type="button" aria-pressed={other != null} onClick={() => setOther(other == null ? '' : other)}>Autre</button>
          </div>
          {other != null ? <label className="c-tipother"><span>Montant du pourboire (€)</span><input inputMode="decimal" autoFocus value={other} onChange={(ev) => setOther(ev.target.value)} placeholder="3" aria-invalid={tipNow < 0} /></label> : null}
          {other != null && other !== '' && tipNow < 0 ? <p className="c-note warn c-small" role="alert">Indique un montant entre 0 et {e(max)}.</p> : null}
        </div>
      ) : null}
      <button type="button" className="c-btn" disabled={busy || tipNow < 0} onClick={pay}>{busy ? 'Un instant…' : 'Payer maintenant · ' + e(base + Math.max(0, tipNow))}</button>
      <p className="c-muted c-small">Carte, Apple Pay ou Google Pay, sur une page sécurisée. Tu peux aussi régler au salon, comme d’habitude.</p>
      {back}
    </section>
  );
}
