// What the thermal printer prints (80 mm). Hidden on screen, the only thing visible when printing.
import { createPortal } from 'react-dom';
import { eur, METHOD, dates } from '../../../lib/format';
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

/** A Z as the server sends it (dayTotals, or a sealed closure read through zFigures). */
export type ZFigures = {
  tickets: number; first: number | null; last: number | null; grossTtc: number; refundsTotal: number; refundsByMethod: Record<string, number>;
  netTtc: number; htNet: number; vatNet: { rate: number; base: number; tax: number }[]; paymentsNet: Record<string, number>; paidTotal: number; takings: number; prepaid: number; tips: number; giftcardsSold: number;
};
export type ZRow = { k: string; v?: number; t?: string; tone?: 'total' | 'sub' | 'head' };

const ORDER = ['card', 'cash', 'online', 'deposit', 'giftcard'];
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
    ...methods(z.paymentsNet).map((m): ZRow => ({ k: METHOD[m] || m, v: z.paymentsNet[m] })),
    { k: 'Total des règlements', v: z.paidTotal, tone: 'total' },
    // a gift card used or a deposit settles the ticket, but that money came in on another day
    ...(z.prepaid ? [{ k: 'dont carte cadeau et acompte', v: z.prepaid, tone: 'sub' } as ZRow] : []),
    { k: 'dont pourboires', v: z.tips, tone: 'sub' },
    { k: 'dont cartes cadeaux vendues', v: z.giftcardsSold, tone: 'sub' }
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
