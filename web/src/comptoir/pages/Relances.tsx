// Relances: the clients drifting away, the people waiting for a place, the requests from the site, and every SMS that left the salon.
// A regular who skips one cut is a regular at risk; one short message at the right time brings most of them back.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { refreshAll, useQuery } from '../../lib/query';
import { Link, navigate, useRoute } from '../../lib/router';
import { ago, cap, clock, dates, dayShortWord, eur, pct, plural, rhythmWords, time } from '../../lib/format';
// @ts-ignore — plain JS module with JSDoc types: the server's own quiet hours and STOP rule
import * as SmsRules from '../../../../shared/sms.js';
import { Icon } from '../../ui/Icon';
import { Avatar, Button, Empty, Kpi, Note, Seg, Skeleton, confirm, toast, toastError } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import type { ClientCard } from '../types';
import './relances.css';

type Overdue = ClientCard & { lastText: number | null; lastDue?: number | null };
type WaitItem = { id: string; first: string; phone: string; day: string; staffId: string; serviceId: string; from: number; to: number; status: string; offer: { start: number; staffId: string; exp: number } | null; at: number };
// via, fallback (MSG-02): the way a text really left ('whatsapp' or 'sms'; 'fallback': by Brevo after the salon's phone
// refused it, FID-01), and why the first way handed it on
type Msg = { id: string; channel?: 'sms' | 'email'; template: string; status: string; at: number; dueAt: number; sentAt: number | null; to: string; body: string; subject?: string; error: string; via?: 'sms' | 'whatsapp' | 'fallback' | null; fallback?: string; held?: boolean };
type Back = { sent: number; clientsBack: number; revenueBack: number; rate: number };
type Quiet = { from: number; to: number; sunday: boolean; holidays?: boolean } | undefined;
type RebookData = { items: Overdue[]; excludedNoConsent: number; stats: Back; template: string; stop: string; quiet?: Quiet };
type Inquiry = {
  id: string; kind: 'contact' | 'formation' | 'sms'; kindLabel: string; module: string; moduleTitle: string; at: number; status: 'new' | 'handled'; handledAt: number | null; handledBy: string;
  erased: boolean; cid: string | null; first: string; message: string; hasPhone: boolean; phone: string; email: string; replies: { at: number; by: string; text: string; status: string }[];
  // FID-01: the text an SMS answer replies to, and a mere « ok » filed by itself
  re?: { template: string; at: number | null } | null; auto?: boolean;
};
type InquiryData = { items: Inquiry[]; unread: number; total: number; canErase: boolean; sms: boolean; mode: string };

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

const LABEL: Record<string, string> = { inquiry_reply: 'Réponse à une demande', owner_inquiry: 'Alerte : demande du site', confirmation: 'Confirmation', reminder: 'Rappel la veille', reminder2h: 'Rappel 2 h avant', review: 'Demande d’avis', rebook: 'Relance', waitlist: 'Place libérée', queue: 'File d’attente', cancelled: 'Annulation', receipt: 'Reçu', moved: 'Déplacement', deposit: 'Lien d’acompte', lookup: 'Lien Mon rendez-vous', giftcardCode: 'Code carte cadeau', owner_booking: 'Alerte : réservation', owner_cancel: 'Alerte : annulation', digest: 'Résumé du soir', weekly: 'Bilan de la semaine', reassign: 'Barbier absent, remplacé', reassignAt: 'Barbier absent, autre heure', reschedule: 'Rendez-vous à décaler', giftcard: 'Carte cadeau en ligne',
  memberWelcome: 'Bienvenue abonné', memberFailed: 'Paiement refusé', memberAction: 'Validation bancaire', memberCancelled: 'Résiliation', memberStopped: 'Résiliation', memberWithdrawn: 'Rétractation', memberWithdrawnNone: 'Rétractation', memberPaused: 'Pause', memberEnded: 'Abonnement arrêté', memberOffer: 'Proposition d’abonnement', memberLink: 'Lien abonnement', owner_member: 'Alerte : abonnement' };
// PAY-03's member texts and mails
Object.assign(LABEL, { memberCard: 'Changer la carte', memberLinkMail: 'Lien abonnement (e-mail)' });
// AC-01: the client space's texts (a code's words stay {code} here: its digits only exist in the text that left)
Object.assign(LABEL, { otp: 'Code de connexion', accountOpened: 'Espace client ouvert', accesInvite: 'Lien vers son espace', dataExport: 'Copie de ses données', owner_erase: 'Alerte : demande d’effacement', owner_export: 'Alerte : demande de données' });
const STATUS: Record<string, [string, string]> = { sent: ['envoyé', 'badge-ok'], simulated: ['simulé (démo)', 'badge-info'], failed: ['échec', 'badge-danger'], skipped: ['non envoyé', 'badge-warn'], expired: ['trop tard', 'badge-warn'], claimed: ['en cours', ''], queued: ['en file', ''] };
/** Outside the demo nothing is simulated: without a provider a message waits for one (and an old 'simulé' never left). */
function msgStatus(m: Msg, demo: boolean, provider: string | null, now: number): [string, string] {
  const status = m.status;
  // kept back for the Jour J switch (Réglages › Reprendre WordPress), whatever the provider
  if (status === 'queued' && m.held) return ['attend la bascule', 'badge-info'];
  // short enough for a phone row: the icon beside it says which channel, the tooltip says it in words
  if (!demo && status === 'queued' && !provider) return ['attend un fournisseur', 'badge-warn'];
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
  const tab = route.id === 'attente' ? 'attente' : route.id === 'demandes' ? 'demandes' : route.id === 'envoyes' ? 'envoyes' : 'relancer';
  // the requests from the site's forms: the tab says how many wait for an answer
  const inbox = useQuery<InquiryData>(can('marketing') ? '/api/v1/inquiries' : null);
  const tabs = [
    { to: '/relances', id: 'relancer', label: 'À relancer', icon: 'relances', count: pulse?.badges.relances },
    { to: '/relances/attente', id: 'attente', label: 'Liste d’attente', icon: 'wait', count: pulse?.badges.waitlist },
    { to: '/relances/demandes', id: 'demandes', label: 'Demandes', icon: 'mail', count: inbox.data?.unread },
    { to: '/relances/envoyes', id: 'envoyes', label: 'Messages envoyés', icon: 'sms' }
  ];
  // on a phone the four tabs scroll: keep the open one in sight (the owner's alert e-mail opens Demandes)
  useEffect(() => { document.querySelector('nav.tabs[aria-label="Relances"] [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [tab]);
  return (
    <>
      <PageTitle><h1>Relances</h1></PageTitle>
      <nav className="tabs" aria-label="Relances" data-guide="relances-tabs">
        {tabs.map((t) => <Link key={t.id} to={t.to} className="tab" aria-current={tab === t.id ? 'page' : undefined}><Icon name={t.icon} size={16} />{t.label}{t.count ? <span className="count">{t.count}</span> : null}</Link>)}
      </nav>
      {tab === 'relancer' ? (can('marketing') ? <Rebook /> : <Empty icon="lock" title="Réservé à l’accueil et au gérant" />) : tab === 'attente' ? <Waiting /> : tab === 'demandes' ? (can('marketing') ? <Inquiries /> : <Empty icon="lock" title="Réservé à l’accueil et au gérant" />) : <Sent />}
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
      <section className="kpis" data-guide="relances-kpis">
        <Kpi k="À relancer" v={data.items.length} s="en retard sur leur rythme" icon="clock" hot={data.items.length > 0} />
        <Kpi k="Relancés" v={st.sent} s={(st.sent > 1 ? 'clients' : 'client') + ' ces 60 derniers jours'} icon="sms" />
        {/* distinct clients who booked within 21 days of their text: never more than were texted */}
        <Kpi k="Revenus" v={st.clientsBack} s={st.sent ? (st.clientsBack > 1 ? 'clients' : 'client') + ' sur ' + st.sent + ' (' + st.rate + ' %) · ' + eur(st.revenueBack, { decimals: false }) + ' de rendez-vous' : 'après une relance'} icon="calendar" bar={st.rate / 100} />
      </section>
      <div className="rl-grid">
        <section className="card" data-guide="relances-list">
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
          <section className="card col" style={{ gap: 12 }} data-guide="relances-message">
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
    <section className="card" data-guide="relances-auto">
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
      <section className="kpis" data-guide="attente-kpis">
        <Kpi k="En attente" v={data.items.length} s="personnes sur la liste" icon="wait" />
        <Kpi k="Inscrits" v={data.stats.added} s="ces 30 derniers jours" icon="plus" />
        <Kpi k="Placés" v={data.stats.booked} s={data.stats.added ? pct(data.stats.booked / data.stats.added) + ' ont obtenu une place' : 'grâce à une annulation'} icon="check" />
      </section>
      <div data-guide="attente-rule"><Note icon="info">Quand un rendez-vous se libère, la place est proposée par SMS au premier inscrit compatible. Il a 30 minutes pour la prendre, sinon elle passe au suivant. Personne n’a rien à faire.</Note></div>
      {!data.items.length ? <section className="card" style={{ marginTop: 14 }}><Empty icon="wait" title="Personne n’attend">Les clients s’inscrivent depuis le site quand le créneau voulu est complet.</Empty></section> : (
        <div className="col" style={{ gap: 14, marginTop: 14 }} data-guide="attente-list">
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

/* ---------------- the requests from the site ---------------- */

/** What the WordPress forms used to e-mail: /contact and /formations land here (and in the owner's inbox, Réglages › Messages). */
function Inquiries() {
  const { data, loading, error } = useQuery<InquiryData>('/api/v1/inquiries');
  const [show, setShow] = useState<'new' | 'handled' | 'all'>('new');
  if (loading && !data) return <Skeleton h={320} r={22} />;
  if (!data) return error ? <Note tone="err" icon="alert">{error.message}</Note> : null;
  const list = show === 'all' ? data.items : data.items.filter((q) => q.status === show);
  return (
    <>
      <div className="row wrap" style={{ gap: 10, marginBottom: 14 }}>
        <span data-guide="demandes-seg"><Seg value={show} onChange={setShow} label="Quelles demandes" options={[{ v: 'new', t: 'À traiter', count: data.unread }, { v: 'handled', t: 'Traitées' }, { v: 'all', t: 'Toutes' }]} /></span>
        <span className="grow" />
        <span className="faint" style={{ fontSize: 13 }}>Depuis les pages <a className="link" href="/contact" target="_blank" rel="noopener">Contact</a> et <a className="link" href="/formations" target="_blank" rel="noopener">Formations</a> du site</span>
      </div>
      {!list.length ? (
        <section className="card">{data.total && show === 'handled'
          ? <Empty icon="check" title="Rien n’a encore été classé">Les demandes que tu marques traitées, et les simples « ok » ou « merci » à un SMS, se rangent ici.</Empty>
          : <Empty icon="mail" title={data.total ? 'Tout est traité' : 'Aucune demande pour l’instant'}>{data.total ? 'Les nouvelles demandes du site arrivent ici, avec un badge sur l’onglet.' : 'Les messages envoyés depuis les pages Contact et Formations du site arrivent ici, et par e-mail au gérant.'}</Empty>}{data.total && show !== 'all' ? <div className="row" style={{ justifyContent: 'center' }}><Button variant="ghost" onClick={() => setShow('all')}>Voir {data.total === 1 ? 'la demande' : 'les ' + plural(data.total, 'demande')}</Button></div> : null}</section>
      ) : <div className="col" style={{ gap: 14 }}>{list.map((q) => <InquiryCard key={q.id} q={q} data={data} />)}</div>}
    </>
  );
}

const INLINE = { display: 'inline-flex', alignItems: 'center', gap: 6 } as const;
function InquiryCard({ q, data }: { q: Inquiry; data: InquiryData }) {
  const { now, boot } = useApp();
  // signed like the salon's other texts, with its name from Réglages › Salon (a plain apostrophe: one SMS, not two)
  const sign = String(boot.settings?.shop?.name || 'Le salon').replace(/’/g, "'");
  // in production without a provider the text would wait and expire while the request reads as answered (the server refuses too)
  const noSms = data.mode === 'production' && !data.sms;
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const seg = smsSegments(text || '');
  const act = async (what: string, path: string, body: unknown, done: string) => {
    setBusy(what);
    try { await api.post('/api/v1/inquiries/' + q.id + path, body); toast({ title: done, icon: 'check' }); refreshAll(); return true; } catch (e) { toastError(e); return false; } finally { setBusy(''); }
  };
  const reply = async () => {
    if (!text || text.trim().length < 2) return;
    if (await act('reply', '/reply', { text: text.replace(/\{prenom\}/g, q.first) }, data.mode === 'demo' ? 'Réponse mise en file (démo : le SMS est simulé, rien ne part)' : 'SMS envoyé à ' + q.first)) setText(null);
  };
  const erase = async () => {
    if (!await confirm({ title: 'Effacer cette demande ?', body: 'Le prénom, le numéro, l’e-mail et le message de ' + (q.first || 'cette personne') + ' sont retirés pour de bon, avec l’e-mail d’alerte et les réponses. Il reste seulement la trace qu’une demande a existé.', ok: 'Effacer', danger: true })) return;
    await act('erase', '/erase', {}, 'Demande effacée');
  };
  const fresh = q.status === 'new';
  return (
    <section className="card col" style={{ gap: 12 }} data-guide="demandes-card" aria-label={'Demande de ' + (q.first || 'quelqu’un')}>
      <div className="card-h" style={{ marginBottom: 0 }}>
        <h2><Icon name={q.kind === 'formation' ? 'scissors' : q.kind === 'sms' ? 'sms' : 'mail'} size={16} />{q.erased ? 'Demande effacée' : q.first}{q.moduleTitle ? <span className="faint" style={{ fontWeight: 500 }}>· {q.moduleTitle}</span> : null}</h2>
        <span className="row" style={{ gap: 6 }}>
          <span className="badge">{cap(q.kindLabel)}</span>
          <span className={'badge ' + (fresh ? 'badge-accent' : 'badge-ok')}>{fresh ? 'à traiter' : q.replies.length ? 'répondu' : 'traité'}</span>
          <small className="faint tnum" title={dates.dayShort(dates.localParts(q.at).day) + ' · ' + clock(q.at)}>{ago(q.at, now())}</small>
        </span>
      </div>
      {q.erased ? <p className="faint" style={{ fontSize: 13.5 }}>Les données de cette personne ont été effacées (RGPD).</p> : (
        <>
          {q.re ? <p className="faint" style={{ fontSize: 13 }}>Réponse à : {LABEL[q.re.template] || q.re.template}{q.re.at ? ' du ' + dates.dayShort(dates.localParts(q.re.at).day).replace(/^\S+ /, '') : ''}</p> : null}
          {q.message ? <div className="bubble" style={{ alignSelf: 'stretch' }}><p>{q.message}</p></div> : <p className="faint" style={{ fontSize: 13.5 }}>Pas de message : {q.kind === 'formation' ? 'rappelle pour parler du module.' : 'rappelle pour en savoir plus.'}</p>}
          <div className="row wrap" style={{ gap: '6px 16px', fontSize: 14 }}>
            {q.phone ? <a className="link tnum" style={INLINE} href={'tel:' + q.phone.replace(/[^\d+]/g, '')}><Icon name="phone" size={14} />{q.phone}</a> : null}
            {q.email ? <a className="link" style={INLINE} href={'mailto:' + encodeURIComponent(q.email).replace(/%40/g, '@')}><Icon name="mail" size={14} />{q.email}</a> : null}
            {q.cid ? <Link to={'/clients/' + q.cid} className="link">Voir sa fiche client</Link> : null}
          </div>
        </>
      )}
      {q.replies.map((r, i) => (
        <div key={i} className="bubble" style={{ alignSelf: 'flex-end', borderRadius: '18px 18px 6px 18px', maxWidth: 520 }}>
          <small>{r.by || 'Le salon'} · {ago(r.at, now())} · SMS {STATUS[r.status]?.[0] || r.status}</small>
          <p>{r.text || '—'}</p>
        </div>
      ))}
      {text != null ? (
        <div className="col" style={{ gap: 8 }}>
          <textarea className="input textarea" rows={3} maxLength={480} value={text} autoFocus onChange={(e) => setText(e.target.value)} aria-label={'Réponse à ' + q.first} />
          <div className="row wrap" style={{ gap: 8 }}>
            <small className={seg.count > 1 ? 'warn-t' : 'faint'}>{seg.chars} car. · {plural(seg.count, 'SMS')}{seg.unicode ? ' (caractères spéciaux : ' + seg.offenders.join(' ') + ')' : ''}</small>
            <span className="grow" />
            <Button variant="ghost" onClick={() => setText(null)}>Annuler</Button>
            <Button variant="primary" icon="sms" busy={busy === 'reply'} disabled={text.trim().length < 2} onClick={reply}>Envoyer à {q.phone}</Button>
          </div>
        </div>
      ) : !q.erased ? (
        <div className="row wrap" style={{ gap: 8 }}>
          {!q.hasPhone ? <span className="faint" style={{ fontSize: 13 }}>Pas de numéro : réponds par e-mail.</span>
            : noSms ? <span className="faint" style={{ fontSize: 13 }}>Aucun fournisseur SMS branché : appelle ou écris, puis marque traité.</span>
            : <Button variant={fresh ? 'primary' : 'subtle'} icon="sms" onClick={() => setText(sign + ' : Bonjour ' + q.first + ', ')}>Répondre par SMS</Button>}
          {fresh ? <Button variant="subtle" icon="check" busy={busy === 'handled'} onClick={() => act('handled', '/handled', {}, 'Demande traitée')}>Marquer traité</Button> : <Button variant="ghost" icon="undo" busy={busy === 'handled'} onClick={() => act('handled', '/handled', { undo: true }, 'Remise à traiter')}>Remettre à traiter</Button>}
          <span className="grow" />
          {data.canErase ? <Button variant="ghost" size="sm" icon="trash" busy={busy === 'erase'} onClick={erase}>Effacer</Button> : null}
        </div>
      ) : null}
      {!fresh && q.auto && !q.erased ? <small className="faint" style={{ fontSize: 12 }}>Classé tout seul : un simple « merci », rien à répondre</small>
        : !fresh && q.handledBy && !q.erased ? <small className="faint" style={{ fontSize: 12 }}>Traité par {q.handledBy}{q.handledAt ? ' ' + ago(q.handledAt, now()) : ''}</small> : null}
    </section>
  );
}

/* ---------------- the outbox ---------------- */

function Sent() {
  const { can, now } = useApp();
  const { data, loading } = useQuery<{ items: Msg[]; provider: string | null; emailProvider?: string | null; mode: string }>(can('marketing') ? '/api/v1/messages?limit=150' : null);
  if (!can('marketing')) return <Empty icon="lock" title="Réservé à l’accueil et au gérant" />;
  if (loading && !data) return <Skeleton h={320} r={22} />;
  if (!data) return null;
  const failed = data.items.filter((m) => m.status === 'failed').length;
  const failedMail = data.items.filter((m) => m.status === 'failed' && m.channel === 'email').length;
  const why = failedMail === failed ? 'adresse invalide ou fournisseur e-mail indisponible' : failedMail ? 'numéro ou adresse invalide, ou fournisseur indisponible' : 'numéro invalide ou fournisseur SMS indisponible';
  return (
    <section className="card" data-guide="envoyes-list">
      <div className="card-h"><h2><Icon name="sms" size={16} />Derniers messages</h2><span className="faint" style={{ fontSize: 13 }}>{data.mode === 'demo' ? 'Démo · envois simulés' : 'SMS : ' + (data.provider ? cap(data.provider) : 'aucun fournisseur') + ' · e-mail : ' + (data.emailProvider ? cap(data.emailProvider) : 'aucun fournisseur')}</span></div>
      {failed ? <Note tone="warn" icon="alert">{plural(failed, 'message')} en échec : {why}. Le détail est dans chaque ligne.</Note> : null}
      {!data.items.length ? <Empty icon="sms" title="Aucun message pour l’instant" /> : (
        <div className="table-wrap">
          <table className="table rl-table">
            <thead><tr><th className="hide-phone">Quand</th><th>Message</th><th className="hide-phone">À</th>{can('settings') ? <th className="hide-phone">Texte</th> : null}<th>État</th></tr></thead>
            <tbody>{data.items.map((m) => {
              const mail = m.channel === 'email';
              const [label, tone] = msgStatus(m, data.mode === 'demo', mail ? data.emailProvider || null : data.provider, now());
              const day = dates.localParts(m.at).day;
              return (
                <tr key={m.id}>
                  <td className="tnum hide-phone" style={{ whiteSpace: 'nowrap' }}>{dates.dayShort(day)} · {clock(m.at)}</td>
                  {/* on a phone, when and to whom fold under the message so the state stays in view */}
                  <td><span className="faint" style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 6 }}><Icon name={mail ? 'mail' : m.via === 'whatsapp' ? 'globe' : 'sms'} size={15} title={mail ? 'E-mail' : m.via === 'whatsapp' ? 'WhatsApp' : 'SMS'} /></span>{LABEL[m.template] || m.template}{m.via === 'whatsapp' ? <span className="faint"> · WhatsApp</span> : m.via === 'fallback' ? <span className="faint"> · par Brevo, en secours</span> : null}<small className="rl-meta tnum">{dates.dayShort(day)} · {clock(m.at)} · {m.to}</small></td>
                  <td className="tnum hide-phone" style={{ whiteSpace: 'nowrap' }}>{m.to}</td>
                  {can('settings') ? <td className="hide-phone rl-body" title={m.body}>{mail && m.subject ? m.subject : m.body}</td> : null}
                  {/* why it did not leave, in words: a tooltip never shows on a phone */}
                  <td><span className={'badge ' + tone} title={label === 'attend un fournisseur' ? 'En attente d’un fournisseur ' + (mail ? 'e-mail' : 'SMS') : undefined}>{label}</span>{m.error && ['expired', 'failed', 'skipped'].includes(m.status) ? <small className="rl-why">{m.status === 'expired' ? cap(m.error.replace(/^Trop tard : /, '')) : m.error}</small> : null}{m.fallback ? <small className="rl-why">{m.via === 'fallback' ? 'Téléphone du salon : ' + m.fallback.replace(/^Téléphone du salon : /, '') : 'Par SMS : ' + m.fallback}</small> : null}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
