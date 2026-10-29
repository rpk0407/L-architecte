// What the thermal printer prints (80 mm). Hidden on screen, the only thing visible when printing:
// the ticket, the gift card voucher, the credit note, the Z. Mount one at a time.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../../lib/api';
import { eur, METHOD, dates } from '../../../lib/format';
import { Button, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Sale } from '../../types';

export function printNow() { setTimeout(() => window.print(), 50); }

function Shop() {
  const { boot } = useApp();
  const sh = boot.settings.shop;
  return (
    <>
      <h1>{sh.name}</h1>
      <p className="c">{sh.legalName ? sh.legalName + ' · ' : ''}{sh.address}<br />{sh.zip} {sh.city}{sh.phone ? ' · ' + sh.phone : ''}</p>
      {sh.siret ? <p className="c">SIRET {sh.siret}{sh.vatNumber ? ' · TVA ' + sh.vatNumber : ''}</p> : null}
    </>
  );
}

export function Receipt({ sale }: { sale: Sale }) {
  const { boot } = useApp();
  const at = dates.localParts(sale.at);
  return createPortal(
    <div className="print-only receipt" aria-hidden>
      <Shop />
      <hr />
      <div className="r"><span>Ticket {sale.ref}</span><span>{sale.day.split('-').reverse().join('/')} {dates.hhmm(at.min)}</span></div>
      <hr />
      {sale.lines.map((l, i) => <div key={i} className="r"><span>{l.qty > 1 ? l.qty + ' x ' : ''}{l.name}</span><span>{eur(l.net, { decimals: true })}</span></div>)}
      {sale.totals.discount ? <div className="r"><span>dont remise</span><span>-{eur(sale.totals.discount, { decimals: true })}</span></div> : null}
      <hr />
      <div className="r"><b>TOTAL TTC</b><b>{eur(sale.totals.total, { decimals: true })}</b></div>
      {sale.totals.vat.map((v) => <div key={v.rate} className="r"><span>TVA {v.rate / 100} % sur {eur(v.base, { decimals: true })}</span><span>{eur(v.tax, { decimals: true })}</span></div>)}
      {sale.tip ? <div className="r"><span>Pourboire</span><span>{eur(sale.tip.amount, { decimals: true })}</span></div> : null}
      <hr />
      {sale.payments.map((p, i) => <div key={i} className="r"><span>{METHOD[p.method] || p.method}{p.given ? ' (reçu ' + eur(p.given, { decimals: true }) + ', rendu ' + eur(p.change || 0, { decimals: true }) + ')' : ''}</span><span>{eur(p.amount, { decimals: true })}</span></div>)}
      <hr />
      <p className="c">{boot.settings.payments.receiptFooter}</p>
    </div>,
    document.body
  );
}

/** A gift card as the till knows it right after selling (or reissuing, or taking over) it: the only time the full code exists. */
export type VoucherCard = { id: string; code: string; amount: number; expires: string; recipient?: string };

/**
 * The gift card itself, printed for the client to offer: the salon, the amount, the full code, until when.
 * Styled inline: it also prints from the Catalogue, which does not load the till's stylesheet.
 */
export function Voucher({ card }: { card: VoucherCard }) {
  const { boot } = useApp();
  const sh = boot.settings.shop;
  const big = { fontSize: 22, fontWeight: 700, textAlign: 'center', margin: '6px 0' } as const;
  return createPortal(
    <div className="print-only receipt voucher" aria-hidden style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: 16, margin: 0 }}>{sh.name}</h1>
      <p>{sh.address}<br />{sh.zip} {sh.city}{sh.phone ? ' · ' + sh.phone : ''}</p>
      <hr style={{ border: 0, borderTop: '1px dashed #000', margin: '8px 0' }} />
      <p style={{ letterSpacing: '.2em', fontWeight: 700 }}>CARTE CADEAU</p>
      {card.recipient ? <p style={{ fontStyle: 'italic', margin: '4px 0' }}>{card.recipient}</p> : null}
      <p style={big}>{eur(card.amount, { decimals: card.amount % 100 !== 0 })}</p>
      <p>Code</p>
      <p style={{ ...big, fontSize: 18, letterSpacing: '.08em' }}>{card.code}</p>
      <p>Valable jusqu’au {card.expires.split('-').reverse().join('/')}</p>
      <hr style={{ border: 0, borderTop: '1px dashed #000', margin: '8px 0' }} />
      <p>À présenter au salon, en une ou plusieurs fois.</p>
    </div>,
    document.body
  );
}

/**
 * The code on screen, once, with what to do with it: print the voucher, or text it to whoever receives the card.
 * The server checks the code against the card before sending (it only keeps a hash).
 */
export function GiftCode({ card, from, onPrint, note }: { card: VoucherCard; from?: string; onPrint: () => void; note?: string }) {
  const [phone, setPhone] = useState('');
  const [who, setWho] = useState(from || '');
  const [sent, setSent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api.post('/api/v1/giftcards/' + card.id + '/send', { code: card.code, phone, from: who.trim() || undefined }); setSent((x) => [...x, phone]); setPhone(''); toast({ title: 'Code envoyé par SMS', icon: 'sms' }); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="gift">
      <span className="section-k">Carte cadeau · {eur(card.amount, { decimals: card.amount % 100 !== 0 })}{card.recipient ? ' · ' + card.recipient : ''}</span>
      <code>{card.code}</code>
      <small className="muted">{note || 'Valable jusqu’au ' + card.expires.split('-').reverse().join('/') + '. À imprimer ou envoyer maintenant : ce code ne sera plus affiché.'}</small>
      <div className="gift-send"><Button size="sm" variant="solid" icon="print" onClick={onPrint}>Imprimer la carte cadeau</Button></div>
      <div className="gift-send">
        <input className="input" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Son numéro" aria-label="Numéro de la personne qui reçoit la carte" />
        <input className="input" value={who} onChange={(e) => setWho(e.target.value)} placeholder="De la part de" maxLength={40} aria-label="De la part de" />
        <Button size="sm" variant="ghost" icon="sms" busy={busy} disabled={phone.replace(/\D/g, '').length < 9} onClick={send}>Envoyer le code par SMS</Button>
      </div>
      {sent.length ? <small className="muted">Envoyé au {sent.join(', ')}.</small> : null}
    </div>
  );
}

/** A credit note as GET /api/v1/refunds/:id sends it. */
export type CreditNoteData = {
  id: string; ref: string; saleId: string; saleRef: string; day: string; at: number; amount: number; liability: number; method: string;
  parts: { method: string; amount: number }[]; reason: string; vat: { rate: number; base: number; tax: number }[];
  lines: { i: number; qty: number; name: string; kind: string; amount: number; vat: number }[]; by: string;
};

/** The printed credit note: which ticket it corrects, what was given back, the VAT given back, how. */
export function CreditNote({ note }: { note: CreditNoteData }) {
  const at = dates.localParts(note.at);
  const neg = (c: number) => '-' + eur(c, { decimals: true });
  const revenue = note.amount - note.liability;
  return createPortal(
    <div className="print-only receipt" aria-hidden>
      <Shop />
      <hr />
      <div className="r"><b>AVOIR {note.ref} · ticket {note.saleRef}</b></div>
      <div className="r"><span>{note.day.split('-').reverse().join('/')} {dates.hhmm(at.min)}</span><span>{note.by}</span></div>
      <hr />
      {note.lines.length ? note.lines.map((l, i) => <div key={i} className="r"><span>{l.qty > 1 ? l.qty + ' x ' : ''}{l.name}{l.kind === 'pack' ? ' (annulé)' : l.kind === 'giftcard' ? ' (annulée)' : ''}</span><span>{neg(l.amount)}</span></div>)
        : <div className="r"><span>Remboursement sur le ticket</span><span>{neg(note.amount)}</span></div>}
      {note.lines.length && note.lines.reduce((t, l) => t + l.amount, 0) !== note.amount ? <div className="r"><span>Montant consenti</span><span>{neg(note.amount)}</span></div> : null}
      <hr />
      <div className="r"><b>TOTAL AVOIR TTC</b><b>{neg(note.amount)}</b></div>
      {note.vat.map((v) => <div key={v.rate} className="r"><span>TVA {v.rate / 100} % sur {neg(v.base)}</span><span>{neg(v.tax)}</span></div>)}
      {note.liability ? <div className="r"><span>dont carte cadeau (hors TVA)</span><span>{neg(note.liability)}</span></div> : null}
      {revenue && note.liability ? <div className="r"><span>dont chiffre d’affaires</span><span>{neg(revenue)}</span></div> : null}
      <hr />
      {note.parts.map((p, i) => <div key={i} className="r"><span>Rendu {(METHOD[p.method] || p.method).toLowerCase()}</span><span>{eur(p.amount, { decimals: true })}</span></div>)}
      <p>Raison : {note.reason}</p>
      <hr />
      <p className="c">Le ticket {note.saleRef} reste inchangé : cet avoir le corrige.</p>
    </div>,
    document.body
  );
}

/** A Z as the server sends it (dayTotals, or a sealed closure read through zFigures). */
export type ZFigures = {
  tickets: number; first: number | null; last: number | null; grossTtc: number; refundsTotal: number; refundsByMethod: Record<string, number>;
  netTtc: number; htNet: number; vatNet: { rate: number; base: number; tax: number }[]; paymentsNet: Record<string, number>; paidTotal: number; takings: number; prepaid: number; tips: number; giftcardsSold: number; giftcardsRefunded?: number;
};
export type ZRow = { k: string; v?: number; t?: string; tone?: 'total' | 'sub' | 'head' };

const ORDER = ['card', 'cash', 'online', 'deposit', 'ancien', 'giftcard'];
const rate = (r: number) => String(r / 100).replace('.', ',') + ' %';
const tk = (n: number) => 'T' + String(n).padStart(6, '0');

/** The one Z layout: the screen, the printed Z and the CSV list the same lines in the same order. */
export function zRows(z: ZFigures): ZRow[] {
  const methods = (o: Record<string, number>) => Object.keys(o || {}).sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return [
    { k: 'Tickets', t: String(z.tickets) + (z.first ? ' (' + tk(z.first) + ' → ' + tk(z.last || z.first) + ')' : '') },
    { k: 'CA TTC brut', v: z.grossTtc },
    { k: 'Remboursements', v: -z.refundsTotal },
    ...methods(z.refundsByMethod).filter((m) => z.refundsByMethod[m]).map((m): ZRow => ({ k: METHOD[m] || m, v: -z.refundsByMethod[m], tone: 'sub' })),
    { k: 'CA TTC net', v: z.netTtc, tone: 'total' },
    { k: 'dont HT', v: z.htNet, tone: 'sub' },
    // a day with no sale has no rate to show: one plain line rather than a made-up "0 %"
    ...(z.vatNet.length ? z.vatNet.map((x): ZRow => ({ k: 'dont TVA ' + rate(x.rate), v: x.tax, tone: 'sub' })) : [{ k: 'dont TVA', v: 0, tone: 'sub' } as ZRow]),
    { k: 'Règlements, remboursements déduits', tone: 'head' },
    ...methods(z.paymentsNet).map((m): ZRow => ({ k: (m === 'ancien' ? 'Acomptes de l’ancien site' : METHOD[m]) || m, v: z.paymentsNet[m] })),
    { k: 'Total des règlements', v: z.paidTotal, tone: 'total' },
    // a gift card used or a deposit settles the ticket, but that money came in on another day
    ...(z.prepaid ? [{ k: 'dont carte cadeau et acompte', v: z.prepaid, tone: 'sub' } as ZRow] : []),
    { k: 'dont pourboires', v: z.tips, tone: 'sub' },
    // the cards sold, then those cancelled and paid back today (sold today or before), which never were revenue:
    // two plain parts, so neither reads as a further deduction nor as negative sales
    { k: 'dont cartes cadeaux vendues', v: z.giftcardsSold + (z.giftcardsRefunded || 0), tone: 'sub' },
    ...(z.giftcardsRefunded ? [{ k: 'dont cartes cadeaux annulées et remboursées', v: -z.giftcardsRefunded, tone: 'sub' } as ZRow] : [])
  ];
}
export const zValue = (r: ZRow) => (r.t != null ? r.t : r.v != null ? eur(r.v, { decimals: true }) : '');

export function ZReport({ z }: { z: ZFigures & { number: number; day: string; grandTotal: number; seal?: string; early?: boolean; late?: boolean; auto?: boolean } }) {
  return createPortal(
    <div className="print-only receipt" aria-hidden>
      <Shop />
      <hr />
      <div className="r"><b>CLÔTURE Z{String(z.number).padStart(4, '0')}</b><b>{z.day.split('-').reverse().join('/')}</b></div>
      {z.auto ? <p className="c">Faite automatiquement</p> : z.late ? <p className="c">Clôture de rattrapage</p> : z.early ? <p className="c">Clôturée en avance</p> : null}
      <hr />
      {zRows(z).map((r, i) => r.tone === 'head' ? <p key={i} style={{ marginTop: 6 }}><b>{r.k}</b></p> : (
        <div key={i} className="r" style={r.tone === 'sub' ? { paddingLeft: 8 } : undefined}>{r.tone === 'total' ? <><b>{r.k}</b><b>{zValue(r)}</b></> : <><span>{r.k}</span><span>{zValue(r)}</span></>}</div>
      ))}
      <hr />
      <div className="r"><b>Grand total perpétuel</b><b>{eur(z.grandTotal, { decimals: true })}</b></div>
      <p style={{ wordBreak: 'break-all', fontSize: 9, marginTop: 6 }}>Sceau : {z.seal || ''}</p>
    </div>,
    document.body
  );
}

type Span = { count: number; first: number | null; last: number | null };
/** A month or year closure as GET /api/v1/periods/:ref sends it (CPT-01a). */
export type PeriodRecord = {
  ref: string; kind: 'month' | 'year'; period: string; number: number; from: string; to: string; at: number; by: string;
  z?: Span; tickets?: Span; credits?: Span; months?: Span; seal: string; signatureLabel: string; kid: string | null;
  totals: Omit<ZFigures, 'tickets' | 'first' | 'last' | 'paidTotal'>;
  perpetual: { net: number; gross: number; refunds: number };
};

const fr = (day: string) => day.split('-').reverse().join('/');
const range = (sp: Span | undefined, no: (n: number) => string) => (sp && sp.count ? no(sp.first || 0) + ' → ' + no(sp.last || 0) + ' (' + sp.count + ')' : 'aucun');
const pad = (p: string, n: number) => p + String(n).padStart(4, '0');

/** The printed month (or year) closure: the Z layout of its totals, then the period's grand total and the perpetual totals. */
export function MonthReport({ p }: { p: PeriodRecord }) {
  const year = p.kind === 'year';
  const z: ZFigures = { ...p.totals, tickets: p.tickets?.count || 0, first: p.tickets?.first ?? null, last: p.tickets?.last ?? null, paidTotal: p.totals.takings + p.totals.prepaid };
  // a year sums its months: their tickets are on each month's closure
  const rows = zRows(z).filter((r) => !year || r.k !== 'Tickets');
  return createPortal(
    <div className="print-only receipt" aria-hidden>
      <Shop />
      <hr />
      <div className="r"><b>{year ? 'CLÔTURE ANNUELLE' : 'CLÔTURE MENSUELLE'} {p.ref}</b><b>{year ? 'Exercice ' + p.period : p.period.slice(5) + '/' + p.period.slice(0, 4)}</b></div>
      <p className="c">Du {fr(p.from)} au {fr(p.to)}</p>
      {year
        ? <div className="r"><span>Mois</span><span>{range(p.months, (n) => pad('M', n))}</span></div>
        : <>
          <div className="r"><span>Z</span><span>{range(p.z, (n) => pad('Z', n))}</span></div>
          <div className="r"><span>Avoirs</span><span>{range(p.credits, (n) => 'A' + String(n).padStart(6, '0'))}</span></div>
        </>}
      <hr />
      {rows.map((r, i) => r.tone === 'head' ? <p key={i} style={{ marginTop: 6 }}><b>{r.k}</b></p> : (
        <div key={i} className="r" style={r.tone === 'sub' ? { paddingLeft: 8 } : undefined}>{r.tone === 'total' ? <><b>{r.k}</b><b>{zValue(r)}</b></> : <><span>{r.k}</span><span>{zValue(r)}</span></>}</div>
      ))}
      <hr />
      <div className="r"><b>Grand total de la période</b><b>{eur(p.totals.netTtc, { decimals: true })}</b></div>
      <p style={{ marginTop: 6 }}><b>Total perpétuel</b></p>
      <div className="r" style={{ paddingLeft: 8 }}><span>Net</span><span>{eur(p.perpetual.net, { decimals: true })}</span></div>
      <div className="r" style={{ paddingLeft: 8 }}><span>Brut</span><span>{eur(p.perpetual.gross, { decimals: true })}</span></div>
      <div className="r" style={{ paddingLeft: 8 }}><span>Avoirs</span><span>{eur(-p.perpetual.refunds, { decimals: true })}</span></div>
      <p style={{ wordBreak: 'break-all', fontSize: 9, marginTop: 6 }}>Sceau : {p.seal}</p>
      <p style={{ fontSize: 9 }}>Signature : {p.signatureLabel}{p.kid ? ' · clé ' + p.kid : ''}</p>
    </div>,
    document.body
  );
}
