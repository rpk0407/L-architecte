// End of day: count the drawer, then seal the day (Z). Sealed means sealed: tickets of a closed day
// can no longer change, and the Z carries the journal's hash at that moment.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { ago, cap, clock, dates, eur, METHOD, money } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Empty, Field, Modal, Note, Skeleton, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import { ZReport, printNow } from './Receipt';

type Drawer = { open: null | { id: string; openedAt: number; float: number; moves: { id: string; amount: number; reason: string; at: number }[]; expected: number; openedBy: string }; last: any; today: any; closure: any; unpaid: number; grandTotal: number };

export function Closing() {
  const { can } = useApp();
  const { data, loading } = useQuery<Drawer>('/api/v1/drawer');
  const z = useQuery<{ items: any[]; grandTotal: number }>(can('closure') ? '/api/v1/closures?limit=14' : null);
  const [count, setCount] = useState(false);
  const [mv, setMv] = useState(false);
  const [print, setPrint] = useState<any>(null);
  if (loading || !data) return <Skeleton h={300} r={22} />;
  return (
    <div className="cs-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <section className="card col" style={{ gap: 14 }}>
        <div className="card-h"><h2><Icon name="cash" size={16} />Le tiroir</h2>{data.open ? <span className="badge badge-ok">Ouvert {ago(data.open.openedAt)}</span> : <span className="badge">Fermé</span>}</div>
        {data.open ? (
          <>
            <div><p className="muted">Espèces attendues dans la caisse</p><b className="serif money tnum" style={{ fontSize: 56, lineHeight: 1 }}>{eur(data.open.expected, { decimals: true })}</b></div>
            <div className="card card-tight" style={{ background: 'var(--panel2)' }}>
              <div className="kv"><span>Fond de caisse · {data.open.openedBy}</span><b className="money">{eur(data.open.float, { decimals: true })}</b></div>
              <div className="kv"><span>Espèces encaissées</span><b className="money">{eur(data.open.expected - data.open.float - data.open.moves.reduce((t, m) => t + m.amount, 0), { decimals: true })}</b></div>
              {data.open.moves.map((m) => <div key={m.id} className="kv"><span>{m.reason} · {clock(m.at)}</span><b className="money">{m.amount > 0 ? '+' : ''}{eur(m.amount, { decimals: true })}</b></div>)}
            </div>
            <div className="row wrap"><Button variant="ghost" icon="move" onClick={() => setMv(true)}>Apport ou retrait</Button><span className="grow" /><Button variant="primary" icon="cash" onClick={() => setCount(true)}>Compter la caisse</Button></div>
          </>
        ) : <OpenDrawer last={data.last} />}
        {data.last ? <p className="faint" style={{ fontSize: 12.5 }}>Dernier comptage {ago(data.last.closedAt)} : {eur(data.last.counted, { decimals: true })}{data.last.diff ? ', écart ' + eur(data.last.diff, { decimals: true }) + (data.last.note ? ' (' + data.last.note + ')' : '') : ', juste'}.</p> : null}
      </section>

      <section className="card col" style={{ gap: 14 }}>
        <div className="card-h"><h2><Icon name="lock" size={16} />Clôture du jour</h2>{data.closure ? <span className="badge badge-ok">Z{String(data.closure.number).padStart(4, '0')}</span> : null}</div>
        <div className="z">
          <div><small>Tickets</small><b>{data.today.tickets}</b></div>
          <div><small>Chiffre TTC</small><b className="money">{eur(data.today.net)}</b></div>
          <div><small>dont TVA</small><b className="money">{eur(data.today.vat.reduce((t: number, v: any) => t + v.tax, 0))}</b></div>
          {Object.entries(data.today.byMethod).map(([m, v]) => <div key={m}><small>{METHOD[m] || m}</small><b className="money">{eur(v as number)}</b></div>)}
          <div><small>Pourboires</small><b className="money">{eur(data.today.tips)}</b></div>
        </div>
        {data.closure ? (
          <>
            <Note tone="ok" icon="shieldOk"><b>Journée scellée</b> {ago(data.closure.at)}. Plus aucun ticket ne peut s’ajouter ou changer aujourd’hui. Grand total perpétuel : {eur(data.closure.grandTotal)}.</Note>
            <p className="seal">Sceau {data.closure.seal}</p>
            <Button variant="ghost" icon="print" onClick={() => { setPrint(data.closure); printNow(); }}>Imprimer le Z</Button>
          </>
        ) : can('closure') ? (
          <>
            {data.unpaid ? <Note tone="warn" icon="alert"><b>{data.unpaid} rendez-vous</b> terminé{data.unpaid > 1 ? 's' : ''} sans encaissement. Encaisse-les ou marque l’absence avant de clôturer.</Note> : null}
            {data.open ? <Note tone="warn" icon="cash">Compte d’abord la caisse.</Note> : null}
            <Button variant="primary" size="lg" icon="lock" disabled={!!data.open} onClick={async () => {
              const yes = await confirm({ title: 'Clôturer la journée ?', body: 'Le chiffre du jour est scellé et ne pourra plus être modifié. Les remboursements éventuels se feront demain, par avoir.', ok: 'Clôturer' });
              if (!yes) return;
              try { const r = await api.post('/api/v1/closures'); toast({ title: 'Journée clôturée · Z' + String(r.number).padStart(4, '0'), icon: 'lock' }); refreshAll(); } catch (e) { toastError(e); }
            }}>Clôturer la journée</Button>
          </>
        ) : <p className="muted">La clôture est faite par le gérant.</p>}
      </section>

      {can('closure') ? (
        <section className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-h"><h2>Les dernières clôtures</h2><span className="muted">Grand total perpétuel {z.data ? eur(z.data.grandTotal) : ''}</span></div>
          {z.data?.items.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Z</th><th>Jour</th><th className="num">Tickets</th><th className="num">CA TTC</th><th className="num">TVA</th><th className="num">Net</th><th>Par</th><th /></tr></thead>
              <tbody>{z.data.items.map((x) => <tr key={x.number}><td><b>{x.ref}</b></td><td>{cap(dates.dayShort(x.day))}</td><td className="num">{x.tickets}</td><td className="num money">{eur(x.revenue)}</td><td className="num money">{eur(x.vat.reduce((t: number, v: any) => t + v.tax, 0), { decimals: true })}</td><td className="num money"><b>{eur(x.net)}</b></td><td className="muted">{x.by}</td><td><Button size="sm" icon="print" aria-label={'Imprimer ' + x.ref} onClick={() => { setPrint(x); printNow(); }} /></td></tr>)}</tbody>
            </table></div>
          ) : <Empty icon="lock" title="Pas encore de clôture" />}
        </section>
      ) : null}
      <CountModal open={count} expected={data.open?.expected || 0} onClose={() => setCount(false)} />
      <MoveModal open={mv} onClose={() => setMv(false)} />
      {print ? <ZReport z={print} /> : null}
    </div>
  );
}

function OpenDrawer({ last }: { last: any }) {
  const [float, setFloat] = useState(last ? Math.min(last.counted, 20000) : 15000);
  const [busy, setBusy] = useState(false);
  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="muted">Compte le fond de caisse du matin, puis ouvre le tiroir : chaque paiement en espèces y sera rattaché.</p>
      <Field label="Fond de caisse" htmlFor="od-f"><input id="od-f" className="input input-money" inputMode="decimal" defaultValue={(float / 100).toFixed(2).replace('.', ',')} onChange={(e) => setFloat(money.parseEur(e.target.value) || 0)} /></Field>
      <Button variant="primary" icon="cash" busy={busy} onClick={async () => { setBusy(true); try { await api.post('/api/v1/drawer/open', { float }); refreshAll(); toast('Caisse ouverte avec ' + eur(float)); } catch (e) { toastError(e); } finally { setBusy(false); } }}>Ouvrir la caisse</Button>
    </div>
  );
}

function MoveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sign, setSign] = useState<1 | -1>(-1);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('Dépôt en banque');
  return (
    <Modal open={open} onClose={onClose} label="Mouvement de caisse">
      <h2>Apport ou retrait</h2>
      <div className="chips"><button type="button" className="chip" aria-pressed={sign === -1} onClick={() => { setSign(-1); setReason('Dépôt en banque'); }}>Retrait</button><button type="button" className="chip" aria-pressed={sign === 1} onClick={() => { setSign(1); setReason('Apport de monnaie'); }}>Apport</button></div>
      <input className="input input-money" inputMode="decimal" placeholder="0,00" onChange={(e) => setAmount(money.parseEur(e.target.value) || 0)} />
      <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Raison" />
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!amount || reason.length < 2} onClick={async () => { try { await api.post('/api/v1/drawer/move', { amount: sign * amount, reason }); refreshAll(); onClose(); toast('Mouvement enregistré'); } catch (e) { toastError(e); } }}>Enregistrer</Button></div>
    </Modal>
  );
}

function CountModal({ open, expected, onClose }: { open: boolean; expected: number; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCounts({}); setNote(''); } }, [open]);
  const total = Object.entries(counts).reduce((t, [d, n]) => t + +d * n, 0);
  const diff = total - expected;
  const set = (d: number, n: number) => setCounts({ ...counts, [d]: Math.max(0, n) });
  const label = (d: number) => (d >= 100 ? d / 100 + ' €' : d + ' c');
  return (
    <Modal open={open} onClose={onClose} label="Comptage de la caisse">
      <h2>Compter la caisse</h2>
      <p>Billet par billet, pièce par pièce. Attendu : <b style={{ color: 'var(--tx)' }}>{eur(expected, { decimals: true })}</b>.</p>
      <div className="denoms">{money.DENOMS.filter((d) => d >= 1).map((d) => (
        <label key={d} className="denom"><b>{label(d)}</b><span className="row" style={{ gap: 4 }}><Button size="sm" icon="minus" aria-label={'Moins de ' + label(d)} onClick={() => set(d, (counts[d] || 0) - 1)} /><input inputMode="numeric" value={counts[d] || ''} placeholder="0" onChange={(e) => set(d, parseInt(e.target.value || '0', 10) || 0)} aria-label={'Nombre de ' + label(d)} /><Button size="sm" icon="plus" aria-label={'Plus de ' + label(d)} onClick={() => set(d, (counts[d] || 0) + 1)} /></span></label>
      ))}</div>
      <div className="z"><div><small>Compté</small><b className="tnum">{eur(total, { decimals: true })}</b></div><div><small>Attendu</small><b className="tnum">{eur(expected, { decimals: true })}</b></div><div style={{ background: diff === 0 ? 'var(--ok-bg)' : Math.abs(diff) >= 500 ? 'var(--danger-bg)' : 'var(--warn-bg)' }}><small>Écart</small><b className="tnum">{diff > 0 ? '+' : ''}{eur(diff, { decimals: true })}</b></div></div>
      {Math.abs(diff) >= 500 ? <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explique l’écart (obligatoire au-delà de 5 €)" /> : null}
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={Math.abs(diff) >= 500 && note.trim().length < 3} onClick={async () => {
        setBusy(true);
        try { const r = await api.post('/api/v1/drawer/close', { counts: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)), note: note || undefined }); toast({ title: r.diff ? 'Caisse comptée · écart ' + eur(r.diff, { decimals: true }) : 'Caisse juste au centime', icon: 'check' }); refreshAll(); onClose(); }
        catch (e) { toastError(e); } finally { setBusy(false); }
      }}>Valider le comptage</Button></div>
    </Modal>
  );
}
