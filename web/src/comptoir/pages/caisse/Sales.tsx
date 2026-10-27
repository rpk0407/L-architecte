// Les ventes du jour: every ticket, reprintable, refundable by credit note (line by line, printed as an avoir).
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { setQuery, useRoute } from '../../../lib/router';
import { cap, clock, dates, dayWord, eur, METHOD, money } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Chip, Empty, Field, Kpi, Modal, Money, Note, Sheet, Skeleton, Switch, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Sale } from '../../types';
import { CreditNote, Receipt, printNow, type CreditNoteData } from './Receipt';

/** Everything refunded on a ticket: revenue and gift cards cancelled (Sale.refunded is the revenue part only). */
const refundedAll = (x: Sale) => x.refunds.reduce((t, r) => t + r.amount, 0);
/** Something a refund can still take: a line, or an amount without one (the cuts already taken never count). */
const refundable = (p: Plan) => p.free > 0 || p.lines.some((l) => l.left > 0);

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
          <Kpi k="Pourboires" v={<Money cents={t.tips} />} s={t.giftcardsSold || t.giftcardsRefunded ? 'cartes cadeaux vendues ' + eur(t.giftcardsSold + (t.giftcardsRefunded || 0)) + (t.giftcardsRefunded ? ', annulées ' + eur(t.giftcardsRefunded) : '') : 'hors chiffre d’affaires'} icon="heart" />
        </section>
      ) : null}
      <section className="card">
        {loading ? <Skeleton h={240} /> : !data?.items.length ? <Empty icon="ticket" title="Aucun ticket">Les encaissements de la journée apparaissent ici.</Empty> : (
          <ul className="list">
            {data.items.map((x) => (
              <li key={x.id}><button type="button" className="li sale-row" onClick={() => setQuery({ ticket: x.id })}>
                <span className="li-main"><b>{x.client || 'Client de passage'}{refundedAll(x) ? <span className="badge badge-warn" style={{ marginLeft: 8 }}>remboursé {eur(refundedAll(x))}</span> : null}</b><small>{x.ref} · {clock(x.at)} · {x.lines.map((l) => l.name).join(', ')}{x.lines[0]?.staffId ? ' · ' + (staffById.get(x.lines[0].staffId)?.name || '') : ''}</small></span>
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
  // the refund plan says whether anything is left (a pack cancelled with cuts taken leaves only those)
  const { data: plan } = useQuery<Plan>(id && canRefund ? '/api/v1/sales/' + id + '/refund-plan' : null);
  const [refund, setRefund] = useState(false);
  // what the printer gets: the ticket, or one of its credit notes (both print-only, so only one is mounted)
  const [note, setNote] = useState<CreditNoteData | null>(null);
  useEffect(() => { const off = () => setNote(null); window.addEventListener('afterprint', off); return () => window.removeEventListener('afterprint', off); }, []);
  useEffect(() => setNote(null), [id]);
  const printNote = async (rid: string) => {
    try { setNote(await api.get<CreditNoteData>('/api/v1/refunds/' + rid)); printNow(); } catch (e) { toastError(e); }
  };
  const open = !x ? false : plan && plan.saleId === x.id ? refundable(plan) : refundedAll(x) < x.totals.revenue + (x.totals.liability || 0);
  return (
    <Sheet open={!!id} onClose={onClose} title={x ? x.ref : 'Ticket'} kicker={x ? cap(dates.dayLong(x.day)) + ' · ' + clock(x.at) + ' · ' + x.cashier : ''}
      footer={x ? <><Button variant="ghost" icon="print" onClick={() => { setNote(null); printNow(); }}>Imprimer</Button>{canRefund && open ? <Button variant="danger" icon="refund" onClick={() => setRefund(true)}>Rembourser</Button> : null}<span className="grow" /><b className="serif money" style={{ fontSize: 30 }}>{eur(x.totals.due, { decimals: true })}</b></> : null}>
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
          {x.refunds.length ? <div className="card card-tight">{x.refunds.map((r) => (
            <div key={r.id} className="kv rf-kv"><span>{r.ref} · {r.reason} · {METHOD[r.method]}</span><b className="money" style={{ color: 'var(--warn)' }}>−{eur(r.amount, { decimals: true })}</b><Button size="sm" variant="ghost" icon="print" aria-label={'Imprimer l’avoir ' + r.ref} onClick={() => printNote(r.id)} /></div>
          ))}</div> : null}
          <p className="faint" style={{ fontSize: 12.5 }}>Un ticket ne se modifie jamais : une erreur se corrige par un avoir, numéroté et tracé.</p>
          {note ? <CreditNote note={note} /> : <Receipt sale={x} />}
          <RefundModal open={refund} sale={x} onClose={() => setRefund(false)} onPrint={printNote} />
        </>
      )}
    </Sheet>
  );
}

type PlanLine = {
  i: number; kind: string; ref: string | null; name: string; qty: number; net: number; vat: number; left: number; value: number;
  pack?: { id: string; name: string; total: number; used: number; left: number; unit: number; voided: boolean; suggested: number };
  giftcard?: { id: string; last4: string; status: string; balance: number; unused: boolean; replaced?: boolean } | null;
};
type Plan = {
  saleId: string; ref: string; lines: PlanLine[]; revenueLeft: number; liabilityLeft: number; consumed: number; split: { method: string; share: number }[]; online: boolean;
  /** what a refund without lines may take: a pack's value goes back only through its line */
  free: number; giftcardPaid?: number;
};
type How = 'split' | 'card' | 'cash' | 'online';

const REASONS = ['Prestation ratée', 'Geste commercial', 'Erreur de caisse', 'Produit retourné'];
const fmt = (c: number) => (c / 100).toFixed(2).replace('.', ',');

/** Refund by line (the server's refundPlan says what each line is still worth), as the payment was made. */
function RefundModal({ open, sale, onClose, onPrint }: { open: boolean; sale: Sale; onClose: () => void; onPrint: (id: string) => void }) {
  const { boot } = useApp();
  const owner = boot.me.role === 'owner';
  const { data: plan } = useQuery<Plan>(open ? '/api/v1/sales/' + sale.id + '/refund-plan' : null);
  const [pick, setPick] = useState<Record<number, number>>({});
  const [full, setFull] = useState(false);
  const [restock, setRestock] = useState(true);
  const [txt, setTxt] = useState<string | null>(null);
  const [how, setHow] = useState<How>('card');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; ref: string; amount: number } | null>(null);

  // card and cash in the payment's proportion; online money goes back online, one refund at a time
  const shares = (plan?.split || []).filter((x) => x.method === 'card' || x.method === 'cash');
  const canSplit = shares.length === 2;
  useEffect(() => { if (open) { setPick({}); setFull(false); setRestock(true); setTxt(null); setReason(''); setDone(null); } }, [open]);
  // the suggested method, once per opening: the plan refetches with every journal move, and must not undo a pick
  const suggested = useRef(false);
  useEffect(() => {
    if (!open) { suggested.current = false; return; }
    if (plan && !suggested.current) { suggested.current = true; setHow(canSplit ? 'split' : ((plan.split[0]?.method as How) || 'card')); }
  }, [plan, open]);

  const worth = (l: PlanLine, n: number) => (l.pack ? (full && owner ? l.value : l.pack.suggested) : n === l.left ? l.value : Math.round((l.net * n) / l.qty));
  const chosen = (plan?.lines || []).filter((l) => pick[l.i]);
  const byLine = chosen.length > 0;
  const computed = chosen.reduce((t, l) => t + worth(l, pick[l.i]), 0);
  const liability = chosen.filter((l) => l.kind === 'giftcard').reduce((t, l) => t + worth(l, 1), 0);
  // without a line: an amount on the ticket, a pack's value kept out (it goes back through its line, which cancels it)
  const cap = byLine ? computed : plan?.free || 0;
  const hasPack = (plan?.lines || []).some((l) => l.pack && !l.pack.voided);
  const typed = txt == null ? null : money.parseEur(txt);
  const amount = typed == null ? (txt == null ? cap : 0) : Math.min(cap, typed);
  const products = chosen.filter((l) => l.kind === 'product' && l.ref);
  const cardShare = canSplit ? shares.find((x) => x.method === 'card')!.share / (shares[0].share + shares[1].share) : 0;
  const parts = how === 'split' ? [{ method: 'card', amount: Math.round(amount * cardShare) }, { method: 'cash', amount: amount - Math.round(amount * cardShare) }] : null;
  const short = liability > amount;

  const toggle = (l: PlanLine) => { setTxt(null); setPick((p) => { const n = { ...p }; if (n[l.i]) delete n[l.i]; else n[l.i] = l.left; return n; }); };
  const setQty = (l: PlanLine, n: number) => { setTxt(null); setPick((p) => ({ ...p, [l.i]: Math.max(1, Math.min(l.left, n)) })); };
  const go = async (outside = false) => {
    setBusy(true);
    try {
      // the larger part names the credit note's method; a part of 0 € is no split at all
      const pay = parts ? parts.filter((p) => p.amount > 0).sort((x, y) => y.amount - x.amount) : null;
      const body = {
        amount, reason, method: pay ? pay[0]?.method || 'card' : how, ...(pay && pay.length === 2 ? { split: pay } : {}),
        ...(byLine ? { lines: chosen.map((l) => ({ i: l.i, qty: pick[l.i] })) } : {}),
        ...(restock && products.length ? { restock: products.map((l) => ({ productId: l.ref!, qty: pick[l.i] })) } : {}),
        ...(full && owner ? { override: true } : {}), ...(outside ? { outside: true } : {})
      };
      const r = await api.post<{ id: string; ref: string; amount: number }>('/api/v1/sales/' + sale.id + '/refund', body);
      toast({ title: 'Avoir ' + r.ref + ' · ' + eur(r.amount, { decimals: r.amount % 100 !== 0 }), icon: 'refund' });
      setDone(r); refreshAll();
    } catch (e) {
      // paid through a provider no longer plugged in: refunded from its dashboard, the credit note only records it
      if (e instanceof ApiError && e.code === 'provider_gone' && !outside) {
        setBusy(false);
        if (await confirm({ title: 'Déjà remboursé depuis le tableau de bord ?', body: e.message, ok: 'Faire l’avoir (remboursé hors caisse)', cancel: 'Pas encore' })) return go(true);
        return;
      }
      toastError(e);
    } finally { setBusy(false); }
  };
  const lineNote = (l: PlanLine) => {
    if (l.pack) return l.pack.voided ? 'Abonnement déjà annulé' : l.pack.used ? eur(l.net) + ' − ' + l.pack.used + ' coupe' + (l.pack.used > 1 ? 's' : '') + ' faite' + (l.pack.used > 1 ? 's' : '') + ' × ' + eur(l.pack.unit) + ' = ' + eur(l.pack.suggested) : 'Aucune coupe faite';
    if (l.kind === 'giftcard') return !l.giftcard ? 'Carte introuvable' : l.giftcard.unused ? 'Carte •••• ' + l.giftcard.last4 + (l.giftcard.replaced ? ' (réémise)' : '') + ' jamais utilisée · hors chiffre d’affaires' : l.giftcard.status !== 'active' ? 'Carte annulée' : 'Carte déjà utilisée : elle ne se rembourse plus';
    if (l.net <= 0) return /carnet/i.test(l.name) ? 'Couverte par le carnet' : /abonnement/i.test(l.name) ? 'Couverte par l’abonnement' : 'Rien à rembourser';
    if (!l.left) return 'Déjà remboursé';
    const unit = Math.round(l.net / l.qty);
    return (l.qty > 1 ? l.qty + ' × ' + eur(unit, { decimals: unit % 100 !== 0 }) + ' = ' : '') + eur(l.net, { decimals: l.net % 100 !== 0 }) + (l.left < l.qty ? ' · ' + l.left + ' à rembourser' : '');
  };
  const label = (l: PlanLine) => (l.pack ? l.pack.name + ' · ' + l.pack.left + ' restante' + (l.pack.left > 1 ? 's' : '') : l.name);
  const action = (l: PlanLine) => (l.pack ? 'Annuler l’abonnement' : l.kind === 'giftcard' ? 'Annuler la carte et rembourser' : '');

  return (
    <Modal open={open} onClose={onClose} label="Remboursement">
      {done ? (
        <>
          <h2>Avoir {done.ref}</h2>
          <p>{eur(done.amount, { decimals: true })} remboursés sur le ticket {sale.ref}, qui reste intact.</p>
          <div className="acts"><Button variant="ghost" onClick={onClose}>Fermer</Button><Button variant="primary" icon="print" onClick={() => onPrint(done.id)}>Imprimer l’avoir</Button></div>
        </>
      ) : (
        <>
          <h2>Rembourser</h2>
          <p>Coche ce qui est rendu. Le ticket reste intact ; un avoir numéroté est créé.</p>
          {!plan ? <Skeleton h={120} /> : (
            <ul className="rf-lines">
              {plan.lines.map((l) => {
                const on = !!pick[l.i];
                const off = !l.left;
                return (
                  <li key={l.i} className={'rf-line' + (on ? ' on' : '')}>
                    <button type="button" role="checkbox" aria-checked={on} disabled={off} className="rf-check" onClick={() => toggle(l)}>
                      <span className="rf-box" aria-hidden><Icon name="check" size={14} /></span>
                      <span className="li-main"><b>{label(l)}</b>{action(l) && !off ? <span className="rf-act">{action(l)}</span> : null}<small>{lineNote(l)}</small></span>
                      <b className="money tnum">{off ? '' : eur(on ? worth(l, pick[l.i]) : l.pack ? l.pack.suggested : l.value, { decimals: true })}</b>
                    </button>
                    {on && l.left > 1 ? <div className="rf-sub"><span className="muted grow">Quantité rendue</span><span className="qty"><Button size="sm" icon="minus" aria-label="Moins" onClick={() => setQty(l, pick[l.i] - 1)} /><b>{pick[l.i]}</b><Button size="sm" icon="plus" aria-label="Plus" onClick={() => setQty(l, pick[l.i] + 1)} /></span></div> : null}
                    {on && l.pack && l.pack.used && owner ? <div className="rf-sub"><Chip small className="rf-wrap" on={full} onClick={() => { setTxt(null); setFull(!full); }}>Rembourser en entier ({eur(l.value)}) malgré les coupes faites</Chip></div> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {plan && !refundable(plan) ? <Note icon="info">Plus rien à rembourser : ce qui reste sur ce ticket, ce sont les coupes d’abonnement déjà faites.</Note> : null}
          {products.length ? <Switch on={restock} onChange={setRestock} title="Remettre en stock" hint={products.map((l) => pick[l.i] + ' × ' + l.name).join(', ')} /> : null}
          <Field label={byLine ? 'Montant (calculé, modifiable à la baisse)' : 'Montant'} htmlFor="rf-a" hint={byLine ? undefined : hasPack && !cap ? 'L’abonnement se rembourse en cochant sa ligne (\u00ab\u00a0Annuler l’abonnement\u00a0\u00bb).' : 'Sans ligne cochée, jusqu’à ' + eur(cap, { decimals: true }) + (hasPack ? ', hors abonnement (coche sa ligne)' : plan?.consumed ? ', hors coupes d’abonnement déjà faites' : '')}>
            <input id="rf-a" className="input input-money" inputMode="decimal" value={txt ?? fmt(cap)} onChange={(e) => setTxt(e.target.value)} onBlur={() => { if (typed != null) setTxt(fmt(amount)); }} />
          </Field>
          {plan?.giftcardPaid ? <Note icon="alert">Payé en partie par carte cadeau ({eur(plan.giftcardPaid, { decimals: true })}) : ce remboursement sort en argent.</Note> : null}
          {short ? <Note tone="warn" icon="alert">Une carte cadeau annulée se rembourse en entier ({eur(liability, { decimals: true })}).</Note> : null}
          <div className="chips">
            {canSplit ? <Chip className="rf-wrap" on={how === 'split'} onClick={() => setHow('split')}>Comme le paiement · {eur(parts?.[0].amount ?? Math.round(amount * cardShare), { decimals: true })} carte + {eur(parts?.[1].amount ?? amount - Math.round(amount * cardShare), { decimals: true })} espèces</Chip> : null}
            {plan?.online ? <Chip on={how === 'online'} onClick={() => setHow('online')}>Sur la carte (en ligne)</Chip> : null}
            <Chip on={how === 'card'} onClick={() => setHow('card')}>Carte (terminal)</Chip><Chip on={how === 'cash'} onClick={() => setHow('cash')}>Espèces</Chip>
          </div>
          <div className="chips">{REASONS.map((r) => <Chip key={r} small on={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Raison (obligatoire)" aria-label="Raison du remboursement" />
          <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="danger" busy={busy} disabled={!plan || !amount || short || reason.trim().length < 3} onClick={() => go()}>Rembourser {eur(amount, { decimals: amount % 100 !== 0 })}</Button></div>
        </>
      )}
    </Modal>
  );
}
