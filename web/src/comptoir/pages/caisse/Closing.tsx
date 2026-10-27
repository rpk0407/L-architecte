// End of day: count the drawer, then seal the day (Z). Sealed means sealed: tickets of a closed day
// can no longer change, the site stops booking for that day, and the Z carries the journal's hash.
// A Z before closing time, or with clients still due, has to be asked for in so many words.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { ago, cap, clock, dates, eur, money, time } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Empty, Field, Modal, Note, Skeleton, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import { MonthReport, ZReport, printNow, zRows, zValue, type PeriodRecord, type ZFigures } from './Receipt';
import type { Agenda } from '../../types';

type Remaining = { name: string; start: number; staff: string };
type Closure = ZFigures & { number: number; day: string; at: number; grandTotal: number; seal: string; early?: boolean; late?: boolean; auto?: boolean };
type Drawer = {
  open: null | { id: string; day: string; openedAt: number; float: number; moves: { id: string; amount: number; reason: string; at: number }[]; expected: number; openedBy: string };
  last: null | { day: string; counted: number; expected: number; diff: number; closedAt: number; note: string };
  today: ZFigures; closure: Closure | null; unpaid: number; grandTotal: number;
  remaining: Remaining[]; closesAt: number; floatHint: number;
  missed: { day: string; words: string; tickets: number }[]; warnings: string[];
};
// open: still before closing time (an early Z); otherwise only clients left to pay hold the Z back
type Early = { remaining: Remaining[]; closesAt: number; open: boolean };
type Missed = Drawer['missed'][number];
// CPT-01a: the month and year closures, signed by the tick
type Signature = 'signed' | 'late' | 'pending' | 'unsigned';
type PeriodRow = { ref: string; kind: 'month' | 'year'; period: string; net: number; ticketCount: number | null; monthCount: number | null; signature: Signature; signatureLabel: string };
type Periods = { items: PeriodRow[]; closable: null | { month: string; label: string; waiting: null | { day: string; uncounted: boolean } }; key: null | { kid: string; source: string; sourceLabel: string } };
// one document at a time goes to the printer: a Z or a month (or year) closure, never both
type Printing = null | { z: Closure } | { p: PeriodRecord };

const zNo = (n: number) => 'Z' + String(n).padStart(4, '0');
// a day the shop does not open, with nothing at the till: a Z would only seal an empty day
const nothingToClose = (d: Drawer) => d.closesAt === 0 && !d.today.tickets && !d.today.refundsTotal;
const PENDING = ['booked', 'arrived', 'in_chair'];
const kindOf = (z: { early?: boolean; late?: boolean; auto?: boolean }) => (z.auto ? 'automatique' : z.late ? 'rattrapage' : z.early ? 'en avance' : '');

export function Closing() {
  const { boot, can, now } = useApp();
  const { data, loading } = useQuery<Drawer>('/api/v1/drawer');
  // the demo's automatic Z waits for its own appointments of that day to be checked out: it promises nothing while some are left
  const first = data?.missed[0]?.day;
  const past = useQuery<Agenda>(boot.mode === 'demo' && first && can('closure') ? '/api/v1/agenda?day=' + first : null);
  const stillDue = (past.data?.appts || []).filter((a) => a.demo && !a.saleId && PENDING.includes(a.status)).length;
  const z = useQuery<{ items: (Closure & { ref: string; by: string })[]; grandTotal: number }>(can('closure') ? '/api/v1/closures?limit=14' : null);
  const [count, setCount] = useState(false);
  const [mv, setMv] = useState(false);
  const [early, setEarly] = useState<Early | null>(null);
  const [busy, setBusy] = useState(false);
  const [reopen, setReopen] = useState(false);
  const [print, setPrint] = useState<Printing>(null);
  const periods = useQuery<Periods>(can('closure') ? '/api/v1/periods' : null);
  useEffect(() => { const off = () => setPrint(null); window.addEventListener('afterprint', off); return () => window.removeEventListener('afterprint', off); }, []);
  if (loading || !data) return <Skeleton h={300} r={22} />;
  const t = now();
  const { min: nowMin, day: today } = dates.localParts(t);

  const submit = async (body: { early?: boolean; day?: string }) => {
    setBusy(true);
    try {
      const r = await api.post('/api/v1/closures', body);
      setEarly(null);
      toast({ title: 'Journée clôturée · ' + zNo(r.number), icon: 'lock' });
      refreshAll();
    } catch (e) {
      // someone sat down since the screen loaded: the server says who is left
      if (e instanceof ApiError && e.code === 'too_early' && e.extra) setEarly(e.extra);
      // a past day the scheduler sealed a moment before: what was asked for is done
      else if (e instanceof ApiError && e.code === 'closed' && body.day) refreshAll();
      else { toastError(e); if (e instanceof ApiError && e.code === 'missed') refreshAll(); }
    } finally { setBusy(false); }
  };
  // Z numbers follow the calendar: a forgotten day is sealed before today, the oldest first
  const closeMissed = async (m: Missed) => {
    const yes = await confirm({ title: 'Clôturer la journée de ' + m.words + '\u202f?', body: 'Le chiffre de cette journée est scellé et ne pourra plus être modifié. Les remboursements éventuels se feront par avoir.', ok: 'Clôturer' });
    if (yes) submit({ day: m.day });
  };
  const ask = async (d: Drawer) => {
    if (d.missed.length) { closeMissed(d.missed[0]); return; }
    const open = nowMin < d.closesAt;
    if (d.remaining.length || open) { setEarly({ remaining: d.remaining, closesAt: d.closesAt, open }); return; }
    const yes = await confirm({ title: 'Clôturer la journée\u202f?', body: 'Le chiffre du jour est scellé et ne pourra plus être modifié. Les remboursements éventuels se feront demain, par avoir.', ok: 'Clôturer' });
    if (yes) submit({});
  };
  // the count is the last step of the evening: when it is time and nobody is left, the Z comes right after.
  // A forgotten drawer counted the next morning leads to its own day's Z, never to today's.
  const counted = async (day: string) => {
    if (!can('closure')) return;
    try {
      const d = await api.get<Drawer>('/api/v1/drawer');
      if (d.missed.length) closeMissed(d.missed[0]);
      else if (day === today && !d.closure && !d.remaining.length && nowMin >= d.closesAt && !nothingToClose(d)) ask(d);
    } catch { /* the screen refreshes anyway */ }
  };

  return (
    <div className="cs-grid closing">
      {periods.data?.closable ? <MonthNote c={periods.data.closable} /> : null}
      <section className="card col" style={{ gap: 14 }}>
        <div className="card-h"><h2><Icon name="cash" size={16} />Le tiroir</h2>{data.open ? <span className="badge badge-ok">Ouvert {ago(data.open.openedAt, t)}</span> : <span className="badge">Fermé</span>}</div>
        {data.warnings.map((w) => <Note key={w} tone="warn" icon="alert">{w}</Note>)}
        {data.open ? (
          <>
            <div><p className="muted">Espèces attendues dans la caisse</p><b className="serif money tnum cl-big">{eur(data.open.expected, { decimals: true })}</b></div>
            <div className="card card-tight" style={{ background: 'var(--panel2)' }}>
              <div className="kv"><span>Fond de caisse{data.open.openedBy ? ' · ' + data.open.openedBy : ''}</span><b className="money">{eur(data.open.float, { decimals: true })}</b></div>
              <div className="kv"><span>Espèces encaissées</span><b className="money">{eur(data.open.expected - data.open.float - data.open.moves.reduce((s, m) => s + m.amount, 0), { decimals: true })}</b></div>
              {data.open.moves.map((m) => <div key={m.id} className="kv"><span>{m.reason} · {clock(m.at)}</span><b className="money">{m.amount > 0 ? '+' : ''}{eur(m.amount, { decimals: true })}</b></div>)}
            </div>
            <div className="cl-acts"><Button variant="ghost" icon="move" onClick={() => setMv(true)}>Apport ou retrait</Button><Button variant="primary" icon="cash" onClick={() => setCount(true)}>Compter la caisse</Button></div>
          </>
        ) : data.closure ? (
          <div className="cl-rest"><Icon name="moon" size={20} /><div><b>Journée close · laisse {eur(data.floatHint, { decimals: true })} de fond pour demain</b><small>Le reste du tiroir part au coffre ou en banque.</small></div></div>
        ) : data.last && data.last.day === today && !reopen ? (
          // today's drawer counted: the next step is the Z, not a new drawer
          <div className="col" style={{ gap: 10 }}>
            <div className="cl-rest"><Icon name="check" size={20} /><div><b>Caisse comptée · {eur(data.last.counted, { decimals: true })}</b><small>Un encaissement en espèces avant la clôture{'\u202f'}? Rouvre le tiroir.</small></div></div>
            <Button variant="ghost" icon="cash" onClick={() => setReopen(true)}>Rouvrir la caisse</Button>
          </div>
        ) : <OpenDrawer float={data.last ? Math.min(data.last.counted, data.floatHint) : data.floatHint} />}
        {data.last ? <p className="faint" style={{ fontSize: 12.5 }}>Dernier comptage {ago(data.last.closedAt, t)} : {eur(data.last.counted, { decimals: true })}{data.last.diff ? ', écart ' + eur(data.last.diff, { decimals: true }) + (data.last.note ? ' (' + data.last.note + ')' : '') : ', juste'}.</p> : null}
      </section>

      <section className="card col" style={{ gap: 14 }}>
        <div className="card-h"><h2><Icon name="lock" size={16} />Clôture du jour</h2>{data.closure ? <span className="badge badge-ok">{zNo(data.closure.number)}</span> : null}</div>
        {can('closure') ? data.missed.map((m, i) => (
          <Note key={m.day} tone="warn" icon="alert">
            <b>La journée de {m.words} n’est pas clôturée</b> ({m.tickets} ticket{m.tickets > 1 ? 's' : ''}).{' '}
            {i === 0
              ? <>{stillDue ? <>{stillDue} rendez-vous de ce jour-là {stillDue > 1 ? 'ne sont pas encaissés' : 'n’est pas encaissé'}{'\u202f'}: la clôture automatique attend. Tu peux la clôturer tout de suite{'\u202f'}:</> : <>Elle va être clôturée automatiquement d’ici une minute, ou tout de suite{'\u202f'}:</>}<span className="cl-missed"><Button size="sm" variant="primary" icon="lock" busy={busy} onClick={() => closeMissed(m)}>Clôturer {m.words}</Button></span></>
              : <>Elle suivra, dans l’ordre des jours.</>}
          </Note>
        )) : null}
        <ZTable z={data.closure || data.today} />
        {data.closure ? (
          <>
            <Note tone="ok" icon="shieldOk"><b>Journée scellée</b> {ago(data.closure.at, t)}{data.closure.early ? ', en avance' : ''}. Plus aucun ticket ne peut s’ajouter ou changer aujourd’hui, et le site ne prend plus de rendez-vous pour aujourd’hui. Grand total perpétuel : {eur(data.closure.grandTotal, { decimals: true })}.</Note>
            <p className="seal">Sceau {data.closure.seal}</p>
            <Button variant="ghost" icon="print" onClick={() => { setPrint(data.closure ? { z: data.closure } : null); printNow(); }}>Imprimer le Z</Button>
          </>
        ) : can('closure') ? (
          <>
            {data.unpaid ? <Note tone="warn" icon="alert"><b>{data.unpaid} rendez-vous</b> terminé{data.unpaid > 1 ? 's' : ''} sans encaissement. Encaisse-les ou marque l’absence avant de clôturer.</Note> : null}
            {data.open ? <Note tone="warn" icon="cash">Compte d’abord la caisse.</Note> : null}
            {nothingToClose(data) && !data.open
              ? <p className="muted">Salon fermé aujourd’hui, aucun ticket{'\u202f'}: rien à clôturer.</p>
              : <Button variant="primary" size="lg" icon="lock" block busy={busy} disabled={!!data.open} onClick={() => ask(data)}>Clôturer la journée</Button>}
          </>
        ) : <p className="muted">La clôture est faite par le gérant.</p>}
      </section>

      {can('closure') ? (
        <section className="card cl-history">
          <div className="card-h"><h2>Les dernières clôtures</h2><span className="muted">Grand total perpétuel {z.data ? eur(z.data.grandTotal, { decimals: true }) : ''}</span></div>
          {z.data?.items.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Z</th><th>Jour</th><th className="num">Tickets</th><th className="num">CA TTC brut</th><th className="num">Remb.</th><th className="num">CA TTC net</th><th className="num">dont TVA</th><th>Par</th><th /></tr></thead>
              <tbody>{z.data.items.map((x) => (
                <tr key={x.number}>
                  <td><b>{x.ref}</b></td>
                  <td>{cap(dates.dayShort(x.day))}{kindOf(x) ? <small className="badge cl-kind">{kindOf(x)}</small> : null}</td>
                  <td className="num">{x.tickets}</td>
                  <td className="num money">{eur(x.grossTtc, { decimals: true })}</td>
                  <td className="num money">{x.refundsTotal ? eur(-x.refundsTotal, { decimals: true }) : eur(0, { decimals: true })}</td>
                  <td className="num money"><b>{eur(x.netTtc, { decimals: true })}</b></td>
                  <td className="num money">{eur(x.vatNet.reduce((s, v) => s + v.tax, 0), { decimals: true })}</td>
                  <td className="muted">{x.by}</td>
                  <td><Button size="sm" icon="print" aria-label={'Imprimer ' + x.ref} onClick={() => { setPrint({ z: x }); printNow(); }} /></td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty icon="lock" title="Pas encore de clôture" />}
        </section>
      ) : null}
      {can('closure') && periods.data ? <MonthClosures data={periods.data} onPrint={(p) => { setPrint({ p }); printNow(); }} /> : null}
      <CountModal open={count} expected={data.open?.expected || 0} onClose={() => setCount(false)} onCounted={() => counted(data.open?.day || today)} />
      <MoveModal open={mv} onClose={() => setMv(false)} />
      <EarlyModal ask={early} busy={busy} onWait={() => setEarly(null)} onClose={() => submit({ early: true })} />
      {print && 'z' in print ? <ZReport z={print.z} /> : print ? <MonthReport p={print.p} /> : null}
    </div>
  );
}

const SIGN_TONE: Record<Signature, string> = { signed: 'badge-ok', late: 'badge-warn', pending: '', unsigned: 'badge-danger' };
const periodName = (p: { kind: string; period: string }) => (p.kind === 'year' ? 'Exercice ' + p.period : cap(dates.MONTHS_FR[+p.period.slice(5, 7) - 1]) + ' ' + p.period.slice(0, 4));

/** « mercredi 30 », as the server's warnings say a day (dayShort ends with its own period). */
const dayWord = (day: string) => dates.DAYS_FR[dates.weekday(day)] + ' ' + Number(day.slice(8));

/**
 * The month the tick closes next, at the top of the tab: over and closable now (with « Clôturer octobre »), or waiting on a
 * day without its Z. A month ends, the tick closes it after 05:00 the next morning; the owner may do it sooner, in order.
 */
function MonthNote({ c }: { c: NonNullable<Periods['closable']> }) {
  const { now } = useApp();
  const [busy, setBusy] = useState(false);
  const close = async () => {
    const yes = await confirm({ title: 'Clôturer ' + c.label + '\u202f?', body: 'Le total du mois est scellé, puis signé. Une erreur se corrige ensuite par un avoir, sur le mois en cours.', ok: 'Clôturer' });
    if (!yes) return;
    setBusy(true);
    try { const r = await api.post('/api/v1/periods/close', { month: c.month }); toast({ title: cap(c.label) + ' clôturé · ' + r.ref, icon: 'lock' }); refreshAll(); }
    // the tick closed it a moment before: what was asked for is done
    catch (e) { if (!(e instanceof ApiError && e.code === 'closed')) toastError(e); refreshAll(); } finally { setBusy(false); }
  };
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      {c.waiting ? (
        <Note tone="warn" icon="alert"><b>{cap(c.label)} attend le Z du {dayWord(c.waiting.day)}.</b> {c.waiting.uncounted ? 'Compte la caisse de ce jour-là, puis clôture la journée\u202f: le mois se clôturera ensuite.' : 'Clôture d’abord cette journée\u202f: le mois se clôturera ensuite.'}</Note>
      ) : (
        <Note icon="lock">
          <b>{cap(c.label)} est fini.</b> Il sera clôturé automatiquement {dates.localParts(now()).min < 300 ? 'à 5\u00a0h' : 'd’ici une minute'}, ou tout de suite{'\u202f'}:
          <span className="cl-missed"><Button variant="primary" icon="lock" busy={busy} onClick={close}>Clôturer {c.label}</Button></span>
        </Note>
      )}
    </div>
  );
}

/** The month and year closures under the Z (CPT-01a): each one the sum of its Z, signed by the next tick. */
export function MonthClosures({ data, onPrint }: { data: Periods; onPrint: (p: PeriodRecord) => void }) {
  const printOne = async (ref: string) => {
    try { onPrint(await api.get<PeriodRecord>('/api/v1/periods/' + ref)); } catch (e) { toastError(e); }
  };
  return (
    <section className="card cl-history" aria-labelledby="cl-months-h">
      <div className="card-h"><h2 id="cl-months-h">Clôtures mensuelles</h2>{data.key ? <span className="muted">Clé {data.key.kid.slice(0, 8)} · {data.key.sourceLabel}</span> : null}</div>
      {data.items.length ? (
        <div className="table-wrap"><table className="table cl-months">
          <thead><tr><th>Mois</th><th className="cl-ref-col">Réf</th><th className="num">CA TTC net</th><th>Signature</th><th><span className="vh">Imprimer</span></th></tr></thead>
          <tbody>{data.items.map((p) => (
            <tr key={p.ref}>
              <td><b>{periodName(p)}</b><small className="muted" style={{ display: 'block' }}><span className="cl-ref-in">{p.ref} · </span>{p.ticketCount != null ? p.ticketCount + ' tickets' : p.monthCount != null ? p.monthCount + ' mois' : ''}</small></td>
              <td className="cl-ref-col"><b>{p.ref}</b></td>
              <td className="num money"><b>{eur(p.net, { decimals: true })}</b></td>
              <td><span className={'badge ' + SIGN_TONE[p.signature]}>{p.signatureLabel}</span></td>
              <td><Button icon="print" aria-label={'Imprimer ' + p.ref} onClick={() => printOne(p.ref)} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty icon="lock" title="Pas encore de clôture mensuelle">{data.closable ? null : 'La première se fait le 1er du mois qui suit le premier Z.'}</Empty>}
    </section>
  );
}

/** The figures of the day, in the same order as the printed Z and the CSV. */
function ZTable({ z }: { z: ZFigures }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <div><p className="muted">CA TTC net, remboursements déduits</p><b className="serif money tnum cl-big">{eur(z.netTtc, { decimals: true })}</b></div>
      <div className="cl-z">
        {zRows(z).map((r, i) => r.tone === 'head'
          ? <p key={i} className="cl-z-h">{r.k}</p>
          : <div key={i} className={'kv' + (r.tone ? ' ' + r.tone : '')}><span>{r.k}</span><b className="money tnum">{zValue(r)}</b></div>)}
      </div>
    </div>
  );
}

function EarlyModal({ ask, busy, onWait, onClose }: { ask: Early | null; busy: boolean; onWait: () => void; onClose: () => void }) {
  const n = ask ? ask.remaining.length : 0;
  const last = ask && n ? ask.remaining[n - 1] : null;
  // before closing time it is an early closure; after it, only clients still to pay hold the Z back
  const open = ask ? ask.open !== false : true;
  const clients = n + ' client' + (n > 1 ? 's' : '');
  return (
    <Modal open={!!ask} onClose={onWait} label={open ? 'Clôturer plus tôt' : 'Clients à encaisser'}>
      <h2>{open ? 'Pas encore l’heure' : 'Encore ' + clients + ' à encaisser'}</h2>
      <p>
        {!open ? null
          : last ? <>Il reste <b style={{ color: 'var(--tx)' }}>{n} rendez-vous</b> aujourd’hui (le dernier à {time(last.start)}).{' '}</> : <>Le salon est ouvert jusqu’à {time(ask?.closesAt || 0)}.{' '}</>}
        Après la clôture, plus aucun encaissement aujourd’hui, et le site ne prend plus de rendez-vous pour aujourd’hui.
      </p>
      {n ? (
        <ul className="cl-left">
          {ask!.remaining.slice(0, 5).map((a, i) => <li key={i}><b className="tnum">{dates.hhmm(a.start)}</b><span>{a.name}</span><small>{a.staff}</small></li>)}
          {n > 5 ? <li className="more muted">et {n - 5} autre{n - 5 > 1 ? 's' : ''}</li> : null}
        </ul>
      ) : null}
      <div className="acts">
        <Button variant="ghost" busy={busy} onClick={onClose}>{open ? 'Je ferme plus tôt aujourd’hui' : 'Clôturer quand même'}</Button>
        <Button variant="primary" onClick={onWait} data-autofocus>Attendre</Button>
      </div>
    </Modal>
  );
}

function OpenDrawer({ float: initial }: { float: number }) {
  const [float, setFloat] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <div className="col" style={{ gap: 12 }}>
      <p className="muted">Compte le fond de caisse du matin, puis ouvre le tiroir : chaque paiement en espèces y sera rattaché.</p>
      <Field label="Fond de caisse" htmlFor="od-f"><input id="od-f" className="input input-money" inputMode="decimal" defaultValue={(initial / 100).toFixed(2).replace('.', ',')} onChange={(e) => setFloat(money.parseEur(e.target.value) || 0)} /></Field>
      <Button variant="primary" icon="cash" block busy={busy} onClick={async () => { setBusy(true); try { await api.post('/api/v1/drawer/open', { float }); refreshAll(); toast('Caisse ouverte avec ' + eur(float, { decimals: true })); } catch (e) { toastError(e); } finally { setBusy(false); } }}>Ouvrir la caisse</Button>
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

// 500 € and 200 € notes almost never sit in a barbershop drawer: folded away unless asked for
const BIG = 20000;

function CountModal({ open, expected, onClose, onCounted }: { open: boolean; expected: number; onClose: () => void; onCounted: () => void }) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState(false);
  useEffect(() => { if (open) { setCounts({}); setNote(''); setBig(false); } }, [open]);
  const total = Object.entries(counts).reduce((t, [d, n]) => t + +d * n, 0);
  const diff = total - expected;
  const set = (d: number, n: number) => setCounts({ ...counts, [d]: Math.max(0, n) });
  const label = (d: number) => (d >= 100 ? d / 100 + ' €' : d + ' c');
  const shown = money.DENOMS.filter((d) => d >= 1 && (big || d < BIG || counts[d]));
  return (
    <Modal open={open} onClose={onClose} label="Comptage de la caisse">
      <h2>Compter la caisse</h2>
      <p>Billet par billet, pièce par pièce. Attendu : <b style={{ color: 'var(--tx)' }}>{eur(expected, { decimals: true })}</b>.</p>
      {!big ? <button type="button" className="chip cl-bignotes" aria-expanded="false" onClick={() => setBig(true)}><Icon name="plus" size={14} />Gros billets (200 € et 500 €)</button> : null}
      <div className="denoms">{shown.map((d) => (
        <label key={d} className="denom"><b>{label(d)}</b><span className="row" style={{ gap: 4 }}><Button size="sm" icon="minus" aria-label={'Moins de ' + label(d)} onClick={() => set(d, (counts[d] || 0) - 1)} /><input inputMode="numeric" value={counts[d] || ''} placeholder="0" onChange={(e) => set(d, parseInt(e.target.value || '0', 10) || 0)} aria-label={'Nombre de ' + label(d)} /><Button size="sm" icon="plus" aria-label={'Plus de ' + label(d)} onClick={() => set(d, (counts[d] || 0) + 1)} /></span></label>
      ))}</div>
      <div className="z"><div><small>Compté</small><b className="tnum">{eur(total, { decimals: true })}</b></div><div><small>Attendu</small><b className="tnum">{eur(expected, { decimals: true })}</b></div><div style={{ background: diff === 0 ? 'var(--ok-bg)' : Math.abs(diff) >= 500 ? 'var(--danger-bg)' : 'var(--warn-bg)' }}><small>Écart</small><b className="tnum">{diff > 0 ? '+' : ''}{eur(diff, { decimals: true })}</b></div></div>
      {Math.abs(diff) >= 500 ? <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explique l’écart (obligatoire au-delà de 5 €)" /> : null}
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={Math.abs(diff) >= 500 && note.trim().length < 3} onClick={async () => {
        setBusy(true);
        try { const r = await api.post('/api/v1/drawer/close', { counts: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)), note: note || undefined }); toast({ title: r.diff ? 'Caisse comptée · écart ' + eur(r.diff, { decimals: true }) : 'Caisse juste au centime', icon: 'check' }); refreshAll(); onClose(); onCounted(); }
        catch (e) { toastError(e); } finally { setBusy(false); }
      }}>Valider le comptage</Button></div>
    </Modal>
  );
}
