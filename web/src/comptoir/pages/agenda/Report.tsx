// « Reporter ses rendez-vous »: a barber is away, his booked clients are moved in one guided action.
// The server proposes (POST /api/v1/agenda/report/preview), the person unticks or changes a line, one tap applies it
// (POST /api/v1/agenda/report, one request id per gesture), and « Annuler » takes it back while the texts are still
// held (POST /api/v1/agenda/report/undo). Opened from the Agenda (a chair's header, the « À rappeler » card) and from
// an absence in Équipe. Nothing is decided here: the plan, the checks and the texts are the server's.
import { useEffect, useRef, useState } from 'react';
import { api, uuid } from '../../../lib/api';
import { refreshAll } from '../../../lib/query';
import { cap, dates, plural, time } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Note, Sheet, Skeleton, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import './report.css';

type Slot = { staffId: string; day: string; start: number };
type Row = { id: string; day: string; start: number; dur: number; staffId: string; name: string; services: string[]; price: number; deposit: number; textable: boolean; phone: string; kind: 'same' | 'nearest' | 'call'; to: Slot | null; options: Slot[] };
type Plan = { staffId: string; from: string; to: string; timeoffId: string | null; count: number; rows: Row[]; undoMs: number };
export type Moved = { apptId: string; from: Slot | null; to: Slot; texted: boolean };
type Refused = { apptId: string; code: string; message: string };
type Result = { moved: Moved[]; failed: Refused[]; texted: number; undoMs: number };
export type ReportAbout = { staffId: string; day: string } | { timeoffId: string };
/** What the Agenda keeps after the sheet closes, to offer « Annuler » until the texts leave. */
export type Reported = { moved: Moved[]; until: number; who: string };

/** Take a report back: each appointment returns to its slot if it is still free; the others are named. */
export async function undoReport(moved: Moved[]) {
  const back = moved.filter((m) => m.from);
  if (!back.length) return;
  try {
    const r = await api.post<{ restored: { apptId: string }[]; failed: Refused[] }>('/api/v1/agenda/report/undo', { moves: back.map((m) => ({ apptId: m.apptId, from: m.from, to: m.to })) });
    refreshAll();
    const n = r.restored.length;
    toast(r.failed.length
      ? { title: n ? plural(n, 'rendez-vous', 'rendez-vous') + ' remis, ' + r.failed.length + ' non' : 'Rien n’a pu être remis', sub: r.failed.map((f) => f.message).join(' '), icon: 'alert', ttl: 14000 }
      : { title: 'Report annulé', sub: plural(n, 'rendez-vous', 'rendez-vous') + ' remis à ' + (n > 1 ? 'leur' : 'sa') + ' place, aucun SMS envoyé', icon: 'undo' });
  } catch (e) { toastError(e); }
}

/** The seconds left to take a report back (0: the texts have left). */
export function useCountdown(until: number) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    if (until <= Date.now()) return;
    const t = window.setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

export function ReportSheet({ about, onClose, onDone }: { about: ReportAbout | null; onClose: () => void; onDone?: (r: Reported) => void }) {
  const { staffById, offline } = useApp();
  const key = about ? JSON.stringify(about) : '';
  const [plan, setPlan] = useState<{ key: string; data?: Plan; error?: string }>({ key: '' });
  // per row: the index of the option taken, or -1 (left where it is, à rappeler)
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Refused[]>([]);
  const [done, setDone] = useState<(Result & { until: number; called: Row[] }) | null>(null);
  const rid = useRef('');
  const load = (k: string) => {
    api.post<Plan>('/api/v1/agenda/report/preview', JSON.parse(k)).then((d) => setPlan({ key: k, data: d }), (e) => setPlan({ key: k, error: e?.message || 'Erreur' }));
  };
  useEffect(() => { setPicks({}); setRefused([]); setDone(null); rid.current = uuid(); if (key) load(key); }, [key]);
  const d = plan.key === key ? plan.data : undefined;
  const error = plan.key === key ? plan.error : undefined;
  const who = d ? staffById.get(d.staffId)?.name || 'ce barbier' : '';
  const pickOf = (r: Row) => (r.id in picks ? picks[r.id] : r.options.length ? 0 : -1);
  const target = (r: Row) => (pickOf(r) >= 0 ? r.options[pickOf(r)] : null);
  // an option on a chair another ticked line already takes is not offered (the server would refuse the second)
  const takenBy = (r: Row, to: Slot) => d?.rows.find((o) => { const x = o.id !== r.id ? target(o) : null; return !!x && x.staffId === to.staffId && x.day === to.day && x.start < to.start + r.dur && to.start < x.start + o.dur; });
  const where = (to: Slot) => time(to.start) + ' avec ' + (staffById.get(to.staffId)?.name || '?');
  const moving = d ? d.rows.filter((r) => target(r)) : [];
  const calling = d ? d.rows.filter((r) => !target(r)) : [];
  const days = d ? [...new Set(d.rows.map((r) => r.day))] : [];
  const left = useCountdown(done ? done.until : 0);

  const go = async () => {
    if (!d || !moving.length) return;
    setBusy(true);
    try {
      const res = await api.post<Result>('/api/v1/agenda/report', { staffId: d.staffId, moves: moving.map((r) => ({ apptId: r.id, staffId: target(r)!.staffId, start: target(r)!.start })) }, rid.current);
      rid.current = uuid();
      refreshAll();
      const until = Date.now() + (res.undoMs || 60000);
      if (res.moved.some((m) => m.from)) onDone?.({ moved: res.moved, until, who });
      if (res.failed.length) {
        // some slots were taken meanwhile: those lines stay with him; the plan is asked again for them
        setRefused(res.failed); setPicks({}); load(key);
        toast({ title: res.moved.length ? plural(res.moved.length, 'rendez-vous', 'rendez-vous') + (res.moved.length > 1 ? ' déplacés' : ' déplacé') + ', ' + res.failed.length + ' non' : 'Rien n’a été déplacé', sub: 'Un créneau a été pris entre-temps : regarde la nouvelle proposition.', icon: 'alert', ttl: 9000 });
      } else setDone({ ...res, until, called: calling });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const undo = async () => { if (!done) return; setBusy(true); await undoReport(done.moved); setBusy(false); onDone?.({ moved: [], until: 0, who }); onClose(); };

  const callList = (rows: Row[]) => (
    <ul className="list">
      {rows.map((r) => (
        <li key={r.id} className="li rp-row">
          <span className="rp-t tnum"><b>{time(r.start)}</b><small>{r.dur} min</small></span>
          <span className="li-main"><b>{r.name}</b><small>{r.services.join(' + ')}</small></span>
          {r.phone ? <a className="btn btn-sm btn-subtle rp-tel" href={'tel:' + r.phone.replace(/\s/g, '')}><Icon name="phone" size={15} />{r.phone}</a> : <span className="badge">pas de numéro</span>}
        </li>
      ))}
    </ul>
  );

  if (done) {
    const n = done.moved.length;
    return (
      <Sheet open={!!about} onClose={onClose} wide title={plural(n, 'rendez-vous', 'rendez-vous') + (n > 1 ? ' déplacés' : ' déplacé')} kicker={'Absence de ' + who}
        footer={<><Button variant="ghost" icon="undo" busy={busy} disabled={!left} onClick={undo}>{left ? 'Annuler le report (' + left + ' s)' : 'Annuler le report'}</Button><span className="grow" /><Button variant="primary" onClick={onClose}>Fermer</Button></>}>
        <Note tone="ok" icon="check">
          {done.texted ? <><b>{plural(done.texted, 'SMS', 'SMS')}</b> {done.texted > 1 ? 'partent' : 'part'} dans une minute : {done.texted > 1 ? 'chaque client prévenu' : 'le client'} reçoit sa nouvelle heure et son barbier. </> : <>Aucun SMS à envoyer. </>}
          Les acomptes, carnets et abonnements suivent le rendez-vous, rien n’est à refaire.
        </Note>
        {!left ? <p className="faint rp-hint">Les SMS sont partis : pour revenir en arrière, déplace le rendez-vous depuis l’agenda.</p> : null}
        {done.called.length ? (
          <section className="col" style={{ gap: 6 }}>
            <p className="section-k">À rappeler · {done.called.length}</p>
            <p className="faint rp-hint">Ils restent chez {who} et ne reçoivent aucun SMS. Tu les retrouves sur l’agenda, dans « À rappeler ».</p>
            {callList(done.called)}
          </section>
        ) : null}
      </Sheet>
    );
  }

  return (
    <Sheet open={!!about} onClose={onClose} wide title="Reporter ses rendez-vous" kicker={d ? who + ' absent · ' + (d.from === d.to ? dates.dayLong(d.from) : 'du ' + dates.dayShort(d.from) + ' au ' + dates.dayShort(d.to)) : undefined}
      footer={<>
        <span className="grow muted rp-foot">{offline ? 'Hors ligne : le report attend le retour de la connexion.' : !d ? '' : moving.length ? 'Chaque client déplacé reçoit un SMS. 1 min pour annuler.' : d.count ? 'Coche au moins une ligne à déplacer.' : ''}</span>
        <Button variant="primary" size="lg" icon="move" busy={busy} disabled={!d || !moving.length || offline} title={offline ? 'Hors ligne' : d && !moving.length ? 'Coche au moins une ligne à déplacer' : undefined} onClick={go}>{moving.length ? 'Déplacer ' + plural(moving.length, 'rendez-vous', 'rendez-vous') : 'Déplacer'}</Button>
      </>}>
      {error ? <Note tone="err" icon="alert">{error}</Note> : !d ? <Skeleton h={220} r={18} /> : !d.count ? <Note tone="ok" icon="check">Plus aucun rendez-vous à venir chez {who}.</Note> : (
        <div className="rp">
          {refused.length ? <Note tone="err" icon="alert"><b>Pas déplacé{refused.length > 1 ? 's' : ''} :</b> {refused.map((f) => f.message).join(' ')}</Note> : null}
          <Note tone="warn" icon="alert">
            <b>{plural(d.count, 'rendez-vous', 'rendez-vous')} chez {who}.</b> Voici la meilleure place pour chacun : même heure avec un autre barbier, sinon l’heure libre la plus proche. Décoche une ligne pour la laisser « à rappeler ».
          </Note>
          {days.map((day) => (
            <div key={day} className="col" style={{ gap: 4 }}>
              {days.length > 1 ? <p className="section-k">{cap(dates.dayLong(day))}</p> : null}
              <ul className="list">
                {d.rows.filter((r) => r.day === day).map((r) => {
                  const to = target(r), on = !!to, none = !r.options.length;
                  return (
                    <li key={r.id} className={'li rp-row' + (refused.some((f) => f.apptId === r.id) ? ' rp-err' : '')}>
                      <label className="rp-check" title={none ? 'Aucun créneau libre ce jour-là : à rappeler' : undefined}>
                        <input type="checkbox" checked={on} disabled={none} aria-label={'Déplacer ' + r.name + ' de ' + time(r.start)} onChange={(e) => setPicks({ ...picks, [r.id]: e.target.checked ? Math.max(0, r.options.findIndex((o) => !takenBy(r, o))) : -1 })} />
                        <span className={'rp-tick' + (on ? ' on' : '')} aria-hidden>{on ? <Icon name="check" size={16} /> : null}</span>
                      </label>
                      <span className="li-main">
                        <b>{r.name}</b>
                        <small>{r.services.join(' + ')}{r.deposit ? ' · acompte payé' : ''}{on && !r.textable ? ' · pas de SMS possible : à prévenir' : ''}</small>
                      </span>
                      {/* from → to: the destination is a choice when the server found more than one */}
                      <span className="rp-move tnum">
                        <span className={on ? 'rp-from' : 'rp-stay'}>{time(r.start)}</span>
                        {on ? (
                          <>
                            <Icon name="arrowR" size={14} />
                            {r.options.length > 1 ? (
                              <select className="input select rp-pick" aria-label={'Créneau pour ' + r.name} value={pickOf(r)} onChange={(e) => setPicks({ ...picks, [r.id]: +e.target.value })}>
                                {r.options.map((o, i) => { const t = takenBy(r, o); return <option key={i} value={i} disabled={!!t}>{where(o)}{t ? ' · pris pour ' + t.name : ''}</option>; })}
                              </select>
                            ) : <b>{where(to!)}</b>}
                          </>
                        ) : (
                          <>
                            <span className="badge badge-warn">{none ? 'aucun créneau libre · à rappeler' : 'à rappeler'}</span>
                            {r.phone ? <a className="btn btn-sm btn-subtle rp-tel" href={'tel:' + r.phone.replace(/\s/g, '')}><Icon name="phone" size={15} />{r.phone}</a> : null}
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {calling.length ? <p className="faint rp-hint">{plural(calling.length, 'client')} à rappeler : aucun SMS ne part pour {calling.length > 1 ? 'eux' : 'lui'}, {calling.length > 1 ? 'ils restent' : 'il reste'} sur l’agenda dans « À rappeler ».</p> : null}
        </div>
      )}
    </Sheet>
  );
}
