// Les ventes du jour: every ticket, reprintable, refundable by credit note.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { setQuery, useRoute } from '../../../lib/router';
import { cap, clock, dates, dayWord, eur, METHOD, money } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Chip, Empty, Field, Kpi, Modal, Money, Note, Sheet, Skeleton, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Sale } from '../../types';
import { Receipt, printNow } from './Receipt';

export function Sales() {
  const { boot, can, staffById } = useApp();
  const route = useRoute();
  const day = route.query.get('jour') || boot.today;
  const open = route.query.get('ticket');
  const { data, loading } = useQuery<{ day: string; items: Sale[]; totals: any; closed: boolean }>('/api/v1/sales?day=' + day);
  const t = data?.totals;
  // by method net of refunds, as on the Z
  const pm = t ? (Object.entries(t.paymentsNet || t.byMethod) as [string, number][]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]) : [];
  return (
    <>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <Button icon="chevL" aria-label="Jour précédent" onClick={() => setQuery({ jour: dates.addDays(day, -1) })} />
          <b className="serif" style={{ fontSize: 26 }}>{cap(dayWord(day, boot.today))}</b>
          <Button icon="chevR" aria-label="Jour suivant" disabled={day >= boot.today} onClick={() => setQuery({ jour: dates.addDays(day, 1) === boot.today ? null : dates.addDays(day, 1) })} />
        </div>
        {data?.closed ? <span className="badge badge-ok"><Icon name="lock" />Journée clôturée</span> : null}
      </div>
      {t ? (
        <section className="kpis">
          {/* the Z's own figures: net TTC with net HT, and the gross only when refunds made them differ */}
          <Kpi k="Chiffre du jour" v={<Money cents={t.netTtc} />} s={'TTC net · HT ' + eur(t.htNet) + (t.refundsTotal ? ' · brut ' + eur(t.grossTtc) + ', remboursé ' + eur(t.refundsTotal) : '')} icon="euro" />
          <Kpi k="Tickets" v={t.tickets} s={t.tickets ? 'panier moyen ' + eur(Math.round(t.revenue / t.tickets)) : ''} icon="ticket" />
          <Kpi k="Encaissements" v={<span className="kpi-v sm">{pm.slice(0, 2).map(([m, v]) => METHOD[m] + ' ' + eur(v)).join(' · ') || '—'}</span>} s={[pm.slice(2).map(([m, v]) => METHOD[m] + ' ' + eur(v)).join(' · '), t.refundsTotal ? 'net des remboursements' : ''].filter(Boolean).join(' · ')} icon="card" />
          <Kpi k="Pourboires" v={<Money cents={t.tips} />} s={t.liability ? 'cartes cadeaux vendues ' + eur(t.liability) : 'hors chiffre d’affaires'} icon="heart" />
        </section>
      ) : null}
      <section className="card">
        {loading ? <Skeleton h={240} /> : !data?.items.length ? <Empty icon="ticket" title="Aucun ticket">Les encaissements de la journée apparaissent ici.</Empty> : (
          <ul className="list">
            {data.items.map((x) => (
              <li key={x.id}><button type="button" className="li sale-row" onClick={() => setQuery({ ticket: x.id })}>
                <span className="li-main"><b>{x.client || 'Client de passage'}{x.refunded ? <span className="badge badge-warn" style={{ marginLeft: 8 }}>remboursé {eur(x.refunded)}</span> : null}</b><small>{x.ref} · {clock(x.at)} · {x.lines.map((l) => l.name).join(', ')}{x.lines[0]?.staffId ? ' · ' + (staffById.get(x.lines[0].staffId)?.name || '') : ''}</small></span>
                <span className="li-end"><b className="money tnum">{eur(x.totals.due, { decimals: x.totals.due % 100 !== 0 })}</b><small className="faint">{[...new Set(x.payments.map((p) => METHOD[p.method]))].join(' + ')}</small></span>
              </button></li>
            ))}
          </ul>
        )}
      </section>
      <TicketSheet id={open} onClose={() => setQuery({ ticket: null })} canRefund={can('sale.refund') && !data?.closed} />
    </>
  );
}

function TicketSheet({ id, onClose, canRefund }: { id: string | null; onClose: () => void; canRefund: boolean }) {
  const { staffById } = useApp();
  const { data: x } = useQuery<Sale>(id ? '/api/v1/sales/' + id : null);
  const [refund, setRefund] = useState(false);
  return (
    <Sheet open={!!id} onClose={onClose} title={x ? x.ref : 'Ticket'} kicker={x ? cap(dates.dayLong(x.day)) + ' · ' + clock(x.at) + ' · ' + x.cashier : ''}
      footer={x ? <><Button variant="ghost" icon="print" onClick={printNow}>Imprimer</Button>{canRefund && x.refunded < x.totals.revenue ? <Button variant="danger" icon="refund" onClick={() => setRefund(true)}>Rembourser</Button> : null}<span className="grow" /><b className="serif money" style={{ fontSize: 30 }}>{eur(x.totals.due, { decimals: true })}</b></> : null}>
      {!x ? <Skeleton h={200} /> : (
        <>
          {x.client ? <Note icon="user"><b>{x.client}</b></Note> : null}
          <div className="card card-tight">
            {x.lines.map((l, i) => <div key={i} className="kv"><span>{l.qty > 1 ? l.qty + ' × ' : ''}{l.name}{l.staffId ? ' · ' + staffById.get(l.staffId)?.name : ''}</span><b className="money">{eur(l.net, { decimals: true })}</b></div>)}
            {x.totals.discount ? <div className="kv"><span>Remise · {x.discount?.reason}</span><b className="money">−{eur(x.totals.discount, { decimals: true })}</b></div> : null}
            {x.totals.vat.map((v) => <div key={v.rate} className="kv"><span>TVA {v.rate / 100} % sur {eur(v.base, { decimals: true })}</span><span className="money">{eur(v.tax, { decimals: true })}</span></div>)}
            {x.tip ? <div className="kv"><span>Pourboire · {staffById.get(x.tip.staffId)?.name}</span><b className="money">{eur(x.tip.amount, { decimals: true })}</b></div> : null}
          </div>
          <div className="card card-tight">
            {x.payments.map((p, i) => <div key={i} className="kv"><span>{METHOD[p.method]}{p.last4 ? ' •••• ' + p.last4 : ''}{p.given ? ' · reçu ' + eur(p.given, { decimals: true }) + ', rendu ' + eur(p.change || 0, { decimals: true }) : ''}</span><b className="money">{eur(p.amount, { decimals: true })}</b></div>)}
          </div>
          {x.refunds.length ? <div className="card card-tight">{x.refunds.map((r) => <div key={r.id} className="kv"><span>{r.ref} · {r.reason} · {METHOD[r.method]}</span><b className="money" style={{ color: 'var(--warn)' }}>−{eur(r.amount, { decimals: true })}</b></div>)}</div> : null}
          <p className="faint" style={{ fontSize: 12.5 }}>Un ticket ne se modifie jamais : une erreur se corrige par un avoir, numéroté et tracé.</p>
          <Receipt sale={x} />
          <RefundModal open={refund} sale={x} onClose={() => setRefund(false)} />
        </>
      )}
    </Sheet>
  );
}

function RefundModal({ open, sale, onClose }: { open: boolean; sale: Sale; onClose: () => void }) {
  const left = sale.totals.revenue - sale.refunded;
  const online = sale.payments.some((p) => p.method === 'online' || p.method === 'deposit');
  const [amount, setAmount] = useState(left);
  const [method, setMethod] = useState<'card' | 'cash' | 'online'>(online ? 'online' : sale.payments[0]?.method === 'cash' ? 'cash' : 'card');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAmount(left); setReason(''); } }, [open]);
  const go = async () => {
    setBusy(true);
    try { await api.post('/api/v1/sales/' + sale.id + '/refund', { amount, method, reason }); toast({ title: 'Avoir de ' + eur(amount) + ' enregistré', icon: 'refund' }); refreshAll(); onClose(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} label="Remboursement">
      <h2>Rembourser</h2>
      <p>Jusqu’à {eur(left, { decimals: true })}. Le ticket reste intact ; un avoir numéroté est créé.</p>
      <Field label="Montant" htmlFor="rf-a"><input id="rf-a" className="input input-money" inputMode="decimal" defaultValue={(left / 100).toFixed(2).replace('.', ',')} onChange={(e) => setAmount(Math.min(left, money.parseEur(e.target.value) || 0))} /></Field>
      <div className="chips">{online ? <Chip on={method === 'online'} onClick={() => setMethod('online')}>Sur la carte (en ligne)</Chip> : null}<Chip on={method === 'card'} onClick={() => setMethod('card')}>Carte (terminal)</Chip><Chip on={method === 'cash'} onClick={() => setMethod('cash')}>Espèces</Chip></div>
      <div className="chips">{['Prestation ratée', 'Geste commercial', 'Erreur de caisse', 'Produit retourné'].map((r) => <Chip key={r} small on={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Raison (obligatoire)" />
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="danger" busy={busy} disabled={!amount || reason.trim().length < 3} onClick={go}>Rembourser {eur(amount, { decimals: amount % 100 !== 0 })}</Button></div>
    </Modal>
  );
}
