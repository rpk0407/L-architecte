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

export function ZReport({ z }: { z: any }) {
  return createPortal(
    <div className="print-only receipt" aria-hidden>
      <Shop />
      <hr />
      <div className="r"><b>CLÔTURE Z{String(z.number).padStart(4, '0')}</b><b>{z.day.split('-').reverse().join('/')}</b></div>
      <hr />
      <div className="r"><span>Tickets</span><span>{z.tickets}{z.first ? ' (T' + String(z.first).padStart(6, '0') + ' → T' + String(z.last).padStart(6, '0') + ')' : ''}</span></div>
      <div className="r"><span>CA TTC</span><span>{eur(z.revenue, { decimals: true })}</span></div>
      <div className="r"><span>CA HT</span><span>{eur(z.revenueHT, { decimals: true })}</span></div>
      {z.vat.map((v: any) => <div key={v.rate} className="r"><span>TVA {v.rate / 100} %</span><span>{eur(v.tax, { decimals: true })}</span></div>)}
      <div className="r"><span>Remboursements</span><span>-{eur(z.refunded, { decimals: true })}</span></div>
      <div className="r"><b>Net</b><b>{eur(z.net, { decimals: true })}</b></div>
      <hr />
      {Object.entries(z.byMethod || {}).map(([m, v]) => <div key={m} className="r"><span>{METHOD[m] || m}</span><span>{eur(v as number, { decimals: true })}</span></div>)}
      <div className="r"><span>Pourboires</span><span>{eur(z.tips, { decimals: true })}</span></div>
      <div className="r"><span>Cartes cadeaux vendues</span><span>{eur(z.liability, { decimals: true })}</span></div>
      <hr />
      <div className="r"><b>Grand total perpétuel</b><b>{eur(z.grandTotal, { decimals: true })}</b></div>
      <p style={{ wordBreak: 'break-all', fontSize: 9, marginTop: 6 }}>Sceau : {z.seal || ''}</p>
    </div>,
    document.body
  );
}
