// Relances: the clients drifting away, the people waiting for a place, and every SMS that left the salon.
// A regular who skips one cut is a regular at risk; one short message at the right time brings most of them back.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { refreshAll, useQuery } from '../../lib/query';
import { Link, navigate, useRoute } from '../../lib/router';
import { ago, cap, clock, dates, dayShortWord, eur, pct, plural, rhythmWords, time } from '../../lib/format';
// @ts-ignore — plain JS module with JSDoc types: the server's own quiet hours and STOP rule
import * as SmsRules from '../../../../shared/sms.js';
import { Icon } from '../../ui/Icon';
import { Avatar, Button, Empty, Kpi, Note, Skeleton, confirm, toast, toastError } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import type { ClientCard } from '../types';
import './relances.css';

type Overdue = ClientCard & { lastText: number | null; lastDue?: number | null };
type WaitItem = { id: string; first: string; phone: string; day: string; staffId: string; serviceId: string; from: number; to: number; status: string; offer: { start: number; staffId: string; exp: number } | null; at: number };
type Msg = { id: string; template: string; status: string; at: number; dueAt: number; sentAt: number | null; to: string; body: string; error: string };
type Back = { sent: number; clientsBack: number; revenueBack: number; rate: number };
type Quiet = { from: number; to: number; sunday: boolean; holidays?: boolean } | undefined;
type RebookData = { items: Overdue[]; excludedNoConsent: number; stats: Back; template: string; stop: string; quiet?: Quiet };

const sms = SmsRules as { afterQuiet(q: Quiet, t: number): number; withStop(body: string, stop: string): string };
/** When a quiet text sent at `t` really leaves (the server's own rule): `t` itself outside the quiet hours. */
export const afterQuiet = (q: Quiet, t: number) => sms.afterQuiet(q, t);
/** The opt-out mention the server adds to every marketing text, unless the text already ends with it. */
export const withStop = (body: string, stop: string) => sms.withStop(body, stop);
/** "à 8 h", "demain à 8 h", "lun. 9 à 8 h", read from the current day (the counter tablet stays open past midnight). */
function leavesWords(t: number, now: number) {
  const p = dates.localParts(t), today = dates.localParts(now).day;
  return (p.day === today ? 'à ' : dayShortWord(p.day, today) + ' à ') + time(p.min);
}

const LABEL: Record<string, string> = { confirmation: 'Confirmation', reminder: 'Rappel la veille', reminder2h: 'Rappel 2 h avant', review: 'Demande d’avis', rebook: 'Relance', waitlist: 'Place libérée', queue: 'File d’attente', cancelled: 'Annulation', receipt: 'Reçu', moved: 'Déplacement', deposit: 'Lien d’acompte', lookup: 'Lien Mon rendez-vous', giftcardCode: 'Code carte cadeau' };
const STATUS: Record<string, [string, string]> = { sent: ['envoyé', 'badge-ok'], simulated: ['simulé (démo)', 'badge-info'], failed: ['échec', 'badge-danger'], skipped: ['non envoyé', 'badge-warn'], expired: ['trop tard', 'badge-warn'], claimed: ['en cours', ''], queued: ['en file', ''] };
/** Outside the demo nothing is simulated: without a provider a text waits for one (and an old 'simulé' never left). */
function msgStatus(m: Msg, demo: boolean, provider: string | null, now: number): [string, string] {
  const status = m.status;
  if (!demo && status === 'queued' && !provider) return ['en attente d’un fournisseur SMS', 'badge-warn'];
  // held back by the quiet hours: it says when it leaves
  if (status === 'queued' && m.dueAt > now + 60000) return ['part ' + leavesWords(m.dueAt, now), 'badge-info'];
  if (!demo && status === 'simulated') return ['jamais parti', 'badge-warn'];
  return STATUS[status] || [status, ''];
}

/** "Pas d’envoi entre 20 h et 8 h, ni le dimanche et les jours fériés (sauf confirmations)." */
export function quietWords(q: Quiet) {
  if (!q || (q.from === q.to && !q.sunday && !q.holidays)) return 'Les SMS partent à toute heure.';
  const hours = q.from !== q.to ? 'entre ' + time(q.from) + ' et ' + time(q.to) : '';
  const days = q.sunday && q.holidays ? 'le dimanche et les jours fériés' : q.sunday ? 'le dimanche' : q.holidays ? 'les jours fériés' : '';
  return 'Pas d’envoi ' + (hours && days ? hours + ', ni ' + days : hours || days) + ' (sauf confirmations).';
}

export default function Relances() {
  const { pulse, can } = useApp();
  const route = useRoute();
  const tab = route.id === 'attente' ? 'attente' : route.id === 'envoyes' ? 'envoyes' : 'relancer';
  const tabs = [
    { to: '/relances', id: 'relancer', label: 'À relancer', icon: 'relances', count: pulse?.badges.relances },
    { to: '/relances/attente', id: 'attente', label: 'Liste d’attente', icon: 'wait', count: pulse?.badges.waitlist },
    { to: '/relances/envoyes', id: 'envoyes', label: 'SMS envoyés', icon: 'sms' }
  ];
  return (
    <>
      <PageTitle><h1>Relances</h1></PageTitle>
      <nav className="tabs" aria-label="Relances">
        {tabs.map((t) => <Link key={t.id} to={t.to} className="tab" aria-current={tab === t.id ? 'page' : undefined}><Icon name={t.icon} size={16} />{t.label}{t.count ? <span className="count">{t.count}</span> : null}</Link>)}
      </nav>
      {tab === 'relancer' ? (can('marketing') ? <Rebook /> : <Empty icon="lock" title="Réservé à l’accueil et au gérant" />) : tab === 'attente' ? <Waiting /> : <Sent />}
    </>
  );
}

/* ---------------- who to bring back ---------------- */

function Rebook() {
  const { now, boot } = useApp();
  const { data, loading } = useQuery<RebookData>('/api/v1/relances');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // the last send: how many, when, when they leave, and the selection it left (the button waits until that changes)
  const [done, setDone] = useState<{ n: number; at: number; due: number; left: string } | null>(null);
  const quiet: Quiet = data?.quiet || boot.settings.messages?.quiet;
  const recent = (c: Overdue) => !!c.lastText && now() - c.lastText < 14 * 86400000;
  useEffect(() => {
    if (!data) return;
    setSel(new Set(data.items.filter((c) => !recent(c)).map((c) => c.id)));
    setText((t) => t || data.template);
  }, [data?.items.length]);
  const sample = data?.items.find((c) => sel.has(c.id)) || data?.items[0];
  const preview = useMemo(() => withStop(render(text, sample, location.origin + '/site'), data?.stop || ''), [text, sample?.id, data?.stop]);
  const seg = smsSegments(preview);
  const allOn = !!data && data.items.length > 0 && data.items.every((c) => sel.has(c.id));
  const selKey = [...sel].sort().join(',');
  const justSent = !!done && done.left === selKey;

  const send = async () => {
    const ids = [...sel];
    if (!ids.length) return;
    const t = now(), out = afterQuiet(quiet, t);
    const later = out > t;
    const when = later ? leavesWords(out, t) : '';
    const yes = await confirm({ title: 'Envoyer ' + plural(ids.length, 'SMS') + ' ?', body: 'Chaque client reçoit un message personnalisé avec le lien de réservation.' + (later ? ' Hors des heures d’envoi : ils partiront ' + when + '.' : '') + (seg.count > 1 ? ' Attention : ce texte compte pour ' + seg.count + ' SMS par client.' : ''), ok: 'Envoyer' });
    if (!yes) return;
    setBusy(true);
    const sentIds = new Set<string>();
    try {
      let sent = 0, skipped = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const r = await api.post<{ sent: number; skipped: number; ids?: string[] }>('/api/v1/relances/send', { clientIds: ids.slice(i, i + 200), text: text !== data?.template ? text : undefined });
        sent += r.sent; skipped += r.skipped;
        for (const id of r.ids || []) sentIds.add(id);
      }
      // the rows that left are unticked; what stays ticked was not sent (already texted today)
      const left = new Set(ids.filter((id) => !sentIds.has(id)));
      setSel(left);
      if (sent) setDone({ n: sent, at: now(), due: out, left: [...left].sort().join(',') });
      // skipped: already texted today, or a number the salon does not text (abroad)
      const notSent = skipped ? plural(skipped, 'SMS') + ' non ' + (skipped > 1 ? 'envoyés' : 'envoyé') + ' (déjà relancé aujourd’hui ou numéro non autorisé)' : '';
      toast(sent
        ? { title: plural(sent, 'relance') + (later ? ' prévue' + (sent > 1 ? 's' : '') + ' ' + when : ' en route'), sub: notSent || 'Les réservations qui suivent sont comptées ici.', icon: 'sms' }
        : { title: 'Aucun SMS envoyé', sub: notSent, icon: 'sms' });
      refreshAll();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };

  if (loading && !data) return <div className="rl-grid"><Skeleton h={420} r={22} /><Skeleton h={320} r={22} /></div>;
  if (!data) return null;
  const st = data.stats;
  return (
    <>
      <section className="kpis">
        <Kpi k="À relancer" v={data.items.length} s="en retard sur leur rythme" icon="clock" hot={data.items.length > 0} />
        <Kpi k="Relancés" v={st.sent} s={(st.sent > 1 ? 'clients' : 'client') + ' ces 60 derniers jours'} icon="sms" />
        {/* distinct clients who booked within 21 days of their text: never more than were texted */}
        <Kpi k="Revenus" v={st.clientsBack} s={st.sent ? (st.clientsBack > 1 ? 'clients' : 'client') + ' sur ' + st.sent + ' (' + st.rate + ' %) · ' + eur(st.revenueBack, { decimals: false }) + ' de rendez-vous' : 'après une relance'} icon="calendar" bar={st.rate / 100} />
      </section>
      <div className="rl-grid">
        <section className="card">
          <div className="card-h">
            <h2><Icon name="clients" size={16} />{plural(data.items.length, 'client')} à relancer</h2>
            {data.items.length ? <button type="button" className="link" onClick={() => setSel(allOn ? new Set() : new Set(data.items.map((c) => c.id)))}>{allOn ? 'Tout décocher' : 'Tout cocher'}</button> : null}
          </div>
          {data.excludedNoConsent ? <p className="faint" style={{ fontSize: 12.5, margin: '0 2px 8px' }}>{plural(data.excludedNoConsent, 'client')} {data.excludedNoConsent > 1 ? 'exclus' : 'exclu'} : pas d’accord pour les bons plans</p> : null}
          {!data.items.length ? <Empty icon="heart" title="Tout le monde est à jour">Aucun habitué n’a dépassé son rythme. Les clients en retard apparaîtront ici d’eux-mêmes.</Empty> : (
            <ul className="list">
              {data.items.map((c) => (
                <li key={c.id} className="li rl-row">
                  <label className="rl-check"><input type="checkbox" checked={sel.has(c.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(c.id); else n.delete(c.id); setSel(n); }} aria-label={'Relancer ' + c.first} /></label>
                  <Avatar name={c.first + ' ' + c.last} size="sm" />
                  <button type="button" className="li-main" onClick={() => navigate('/clients/' + c.id)}>
                    <b>{c.first} {c.last}</b>
                    <small>{c.sinceLast} j sans venir{c.cadence ? ' · venait ' + rhythmWords(c.cadence) : ' · une seule visite'}{c.lastDue && c.lastDue > now() ? ' · relance prévue ' + leavesWords(c.lastDue, now()) : c.lastText ? ' · relancé ' + ago(c.lastText, now()) : ''}</small>
                  </button>
                  <span className="li-end"><span className={'badge ' + ((c.dueIn ?? 0) < -21 ? 'badge-danger' : 'badge-warn')}>{-(c.dueIn ?? 0)} j de retard</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="col rl-side">
          <section className="card col" style={{ gap: 12 }}>
            <div className="card-h"><h2><Icon name="edit" size={16} />Le message</h2><small className={seg.count > 1 ? 'warn-t' : 'faint'}>{seg.chars} car. · {plural(seg.count, 'SMS')}</small></div>
            <textarea className="input textarea" rows={4} value={text} maxLength={320} onChange={(e) => setText(e.target.value)} aria-label="Texte de la relance" />
            <div className="chips">{['{prenom}', '{jours}', '{lien}'].map((v) => <button key={v} type="button" className="chip chip-sm" onClick={() => setText((t) => (t.endsWith(' ') || !t ? t : t + ' ') + v)}>{v}</button>)}<span className="grow" />{text !== data.template ? <button type="button" className="link" onClick={() => setText(data.template)}>Texte d’origine</button> : null}</div>
            <div className="bubble" aria-label="Aperçu"><small>{sample ? 'Aperçu pour ' + sample.first : 'Aperçu'}</small><p>{preview}</p></div>
            {seg.unicode ? <p className="faint" style={{ fontSize: 12.5 }}>Les caractères {seg.offenders.map((c) => '« ' + c + ' »').join(', ')} font passer le SMS en Unicode (70 caractères au lieu de 160). Remplace-les pour payer moins.</p> : null}
            <Button variant="primary" size="lg" block icon={justSent ? 'check' : 'sms'} busy={busy} disabled={justSent || !sel.size || text.trim().length < 10} onClick={send}>{justSent && done ? (done.due > now() ? 'Prévu pour ' + done.n + ' · part ' + leavesWords(done.due, now()) : 'Envoyé à ' + done.n + ' · ' + ago(done.at, now())) : 'Envoyer à ' + plural(sel.size, 'client')}</Button>
            <p className="faint" style={{ fontSize: 12.5 }}>Seuls les clients d’accord pour les bons plans sont listés, et le texte finit par la mention STOP. Personne n’est relancé deux fois le même jour ; ceux relancés il y a moins de 14 jours sont décochés. {quietWords(quiet)}</p>
          </section>
          <Automations />
        </aside>
      </div>
    </>
  );
}

function render(t: string, c: Overdue | undefined, site: string) {
  // the same clean-up as the server: typographic quotes and dashes become plain ones
  return t.replace(/\{prenom\}/g, c?.first || 'Karim').replace(/\{jours\}/g, String(c?.sinceLast ?? 35)).replace(/\{lien\}/g, site).replace(/[’‘]/g, "'").replace(/«\s*|\s*»|[“”]/g, '"').replace(/[–—−]/g, '-');
}

// GSM 03.38: what fits in a 160-character SMS. Anything else (’, ê, ç, emoji) switches the whole message to 70.
const GSM = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà');
const GSM_EXT = new Set('^{}\\[~]|€');
export function smsSegments(text: string) {
  const offenders = [...new Set([...text].filter((ch) => !GSM.has(ch) && !GSM_EXT.has(ch)))];
  const unicode = offenders.length > 0;
  const chars = unicode ? [...text].length : [...text].reduce((n, ch) => n + (GSM_EXT.has(ch) ? 2 : 1), 0);
  const count = unicode ? (chars <= 70 ? 1 : Math.ceil(chars / 67)) : chars <= 160 ? 1 : Math.ceil(chars / 153);
  return { chars, count, unicode, offenders: offenders.slice(0, 4) };
}

function Automations() {
  const { boot, can } = useApp();
  const m = boot.settings.messages;
  const rows: [boolean, string, string][] = [
    [m.confirmation, 'Confirmation', 'dès la réservation, avec le lien pour gérer'],
    [m.reminder, 'Rappel la veille', 'envoyé à ' + m.reminderHour + ' h'],
    [m.reminder2h, 'Rappel 2 h avant', 'pour les oublis de dernière minute'],
    [m.review, 'Demande d’avis', m.reviewDelayMin + ' min après le passage, une fois par trimestre'],
    [m.waitlist, 'Place libérée', 'proposée au premier de la liste d’attente, 30 min pour la prendre'],
    [m.rebook, 'Relances', 'proposées ici, envoyées quand tu le décides']
  ];
  return (
    <section className="card">
      <div className="card-h"><h2><Icon name="bolt" size={16} />Messages automatiques</h2>{can('settings') ? <Link to="/reglages/messages" className="link">Régler</Link> : null}</div>
      <ul className="list">{rows.map(([on, t, s]) => <li key={t} className="li" style={{ minHeight: 0, padding: '10px 2px' }}><span className={'dot ' + (on ? 'on' : '')} aria-hidden /><span className="li-main"><b>{t}</b><small>{s}</small></span><span className={'badge ' + (on ? 'badge-ok' : '')}>{on ? 'actif' : 'coupé'}</span></li>)}</ul>
      {boot.mode === 'demo' ? <p className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>Démo : les SMS sont simulés, rien ne part vraiment.</p> : !boot.providers.sms ? <Note tone="warn" icon="alert">Aucun fournisseur SMS n’est branché : les messages attendent dans la boîte d’envoi. Une fois branché, ceux de plus de 6 h ou dont le rendez-vous est passé ne partiront pas.</Note> : null}
    </section>
  );
}

/* ---------------- the waiting list ---------------- */

function Waiting() {
  const { boot, staffById, serviceById, can, now } = useApp();
  const { data, loading } = useQuery<{ items: WaitItem[]; stats: { added: number; booked: number } }>('/api/v1/waitlist');
  if (loading && !data) return <Skeleton h={320} r={22} />;
  if (!data) return null;
  const byDay = new Map<string, WaitItem[]>();
  for (const w of data.items) { if (!byDay.has(w.day)) byDay.set(w.day, []); byDay.get(w.day)!.push(w); }
  const remove = async (w: WaitItem) => {
    if (!await confirm({ title: 'Retirer ' + w.first + ' de la liste ?', ok: 'Retirer', danger: true })) return;
    try { await api.del('/api/v1/waitlist/' + w.id); refreshAll(); toast('Retiré de la liste d’attente'); } catch (e) { toastError(e); }
  };
  return (
    <>
      <section className="kpis">
        <Kpi k="En attente" v={data.items.length} s="personnes sur la liste" icon="wait" />
        <Kpi k="Inscrits" v={data.stats.added} s="ces 30 derniers jours" icon="plus" />
        <Kpi k="Placés" v={data.stats.booked} s={data.stats.added ? pct(data.stats.booked / data.stats.added) + ' ont obtenu une place' : 'grâce à une annulation'} icon="check" />
      </section>
      <Note icon="info">Quand un rendez-vous se libère, la place est proposée par SMS au premier inscrit compatible. Il a 30 minutes pour la prendre, sinon elle passe au suivant. Personne n’a rien à faire.</Note>
      {!data.items.length ? <section className="card" style={{ marginTop: 14 }}><Empty icon="wait" title="Personne n’attend">Les clients s’inscrivent depuis le site quand le créneau voulu est complet.</Empty></section> : (
        <div className="col" style={{ gap: 14, marginTop: 14 }}>
          {[...byDay].map(([day, items]) => (
            <section key={day} className="card">
              <div className="card-h"><h2>{cap(dayShortWord(day, boot.today))}</h2><span className="badge">{items.length}</span></div>
              <ul className="list">{items.map((w) => {
                const st = staffById.get(w.offer?.staffId || w.staffId);
                return (
                  <li key={w.id} className="li">
                    {st ? <Avatar name={st.name} initials={st.initials} color={st.color} size="sm" /> : <span className="av av-sm" style={{ ['--c' as any]: 'var(--panel3)' }}><Icon name="clients" size={14} /></span>}
                    <span className="li-main">
                      <b>{w.first} <span className="faint" style={{ fontWeight: 500 }}>{w.phone}</span></b>
                      <small>{serviceById.get(w.serviceId)?.name || 'Prestation'} · {w.from <= 0 && w.to >= 1440 ? 'toute la journée' : 'entre ' + time(w.from) + ' et ' + time(w.to)} · {w.staffId === 'any' ? 'sans préférence' : 'avec ' + (staffById.get(w.staffId)?.name || '')} · inscrit {ago(w.at, now())}</small>
                    </span>
                    <span className="li-end">
                      {w.status === 'offered' && w.offer ? <span className="badge badge-accent">place proposée à {time(w.offer.start)} · {Math.max(0, Math.round((w.offer.exp - now()) / 60000))} min</span> : <span className="badge">en attente</span>}
                      {can('agenda.edit') ? <Button size="sm" variant="ghost" icon="x" aria-label={'Retirer ' + w.first} onClick={() => remove(w)} /> : null}
                    </span>
                  </li>
                );
              })}</ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- the outbox ---------------- */

function Sent() {
  const { can, now } = useApp();
  const { data, loading } = useQuery<{ items: Msg[]; provider: string | null; mode: string }>(can('marketing') ? '/api/v1/messages?limit=150' : null);
  if (!can('marketing')) return <Empty icon="lock" title="Réservé à l’accueil et au gérant" />;
  if (loading && !data) return <Skeleton h={320} r={22} />;
  if (!data) return null;
  const failed = data.items.filter((m) => m.status === 'failed').length;
  return (
    <section className="card">
      <div className="card-h"><h2><Icon name="sms" size={16} />Derniers messages</h2><span className="faint" style={{ fontSize: 13 }}>{data.mode === 'demo' ? 'Démo · envois simulés' : data.provider ? 'Envoi via ' + cap(data.provider) : 'Aucun fournisseur branché'}</span></div>
      {failed ? <Note tone="warn" icon="alert">{plural(failed, 'message')} en échec : numéro invalide ou fournisseur indisponible. Le détail est dans chaque ligne.</Note> : null}
      {!data.items.length ? <Empty icon="sms" title="Aucun message pour l’instant" /> : (
        <div className="table-wrap">
          <table className="table rl-table">
            <thead><tr><th className="hide-phone">Quand</th><th>Message</th><th className="hide-phone">À</th>{can('settings') ? <th className="hide-phone">Texte</th> : null}<th>État</th></tr></thead>
            <tbody>{data.items.map((m) => {
              const [label, tone] = msgStatus(m, data.mode === 'demo', data.provider, now());
              const day = dates.localParts(m.at).day;
              return (
                <tr key={m.id}>
                  <td className="tnum hide-phone" style={{ whiteSpace: 'nowrap' }}>{dates.dayShort(day)} · {clock(m.at)}</td>
                  {/* on a phone, when and to whom fold under the message so the state stays in view */}
                  <td>{LABEL[m.template] || m.template}<small className="rl-meta tnum">{dates.dayShort(day)} · {clock(m.at)} · {m.to}</small></td>
                  <td className="tnum hide-phone" style={{ whiteSpace: 'nowrap' }}>{m.to}</td>
                  {can('settings') ? <td className="hide-phone rl-body" title={m.body}>{m.body}</td> : null}
                  {/* why it did not leave, in words: a tooltip never shows on a phone */}
                  <td><span className={'badge ' + tone}>{label}</span>{m.error && ['expired', 'failed', 'skipped'].includes(m.status) ? <small className="rl-why">{m.status === 'expired' ? cap(m.error.replace(/^Trop tard : /, '')) : m.error}</small> : null}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
