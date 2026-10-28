// Clients › Abonnés: the members at a glance. The strip of figures (MembersKpis, also the Pilotage tile), then who is a member
// with where each stands, then the carnets still running. A tap on a row opens the client's file.
// PAY-07: each member's weeks of his billing month as dots, this week (venu / pas encore) and his last visit; « Pas venu
// cette semaine (n) » first when someone has not come, sorted by the days since his last visit, with « Écrire » (the
// Relances compose path: consent, STOP and the daily cap are the server's) and « Appeler » (with the full numbers only).
import { useMemo, useState } from 'react';
import { api, qs } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { navigate } from '../../../lib/router';
import { dates, dayShortWord, eur, plural } from '../../../lib/format';
import { ddmm, liveMembers, rhythmOf, statusWords, toneClass, useWords } from '../../../lib/members';
// @ts-ignore — plain JS module with JSDoc types
import * as SmsRules from '../../../../../shared/sms.js';
import { Avatar, Button, Chip, Empty, Kpi, Skeleton, Sheet, toast, toastError } from '../../../ui/kit';
import { Icon } from '../../../ui/Icon';
import { useApp } from '../../state';
import type { ClientCard, MemberRow, MemberStatus, MemberSummary, MemberWeek, MemberWeekDot } from '../../types';
import WeekDots from './WeekDots';
import './clients-members.css';

const sms = SmsRules as { withStop(body: string, stop: string): string };

/**
 * 16 abonnés · présence 85 % · 3 semaines manquées · 1 280 €/mois · 1 paiement à régulariser · 1 résiliation (30 j) · coupes
 * ce mois : 21 (valeur 430 €). report.shop only: it renders nothing for anyone else (the server answers 403), so a tile can
 * drop it in as it is. The tiles wrap to a second row rather than scroll sideways, so no word is cut.
 */
export function MembersKpis() {
  const { can } = useApp();
  const q = useQuery<MemberSummary>(can('report.shop') ? '/api/v1/memberships/summary' : null);
  const s = q.data;
  if (!can('report.shop') || q.error) return null;
  if (!s) return <div className="kpis k5 mbs-kpis" aria-hidden><Skeleton h={92} r={20} /><Skeleton h={92} r={20} /><Skeleton h={92} r={20} /></div>;
  const month = s.month.cuts;
  const w = s.weeks && s.weeks.members ? s.weeks : null;
  return (
    <div className="kpis k5 mbs-kpis" data-guide="members-kpis" role="group" aria-label="Les abonnés en chiffres">
      <Kpi k="Abonnés" v={s.live} s={s.ending ? plural(s.ending, 'résilié, encore couvert', 'résiliés, encore couverts') : s.pending ? plural(s.pending, 'paiement attendu', 'paiements attendus') : 'en cours'} icon="clients" />
      {w ? <div className="mbs-kpi-g" data-guide="members-presence"><Kpi k="Présence" v={w.elapsed ? w.rate + '\u00a0%' : '—'} s={w.elapsed ? w.attended + ' sur ' + plural(w.elapsed, 'semaine') : 'aucune semaine passée'} icon="check" bar={w.elapsed ? w.rate / 100 : undefined} /></div> : null}
      {w ? <div className="mbs-kpi-g" data-guide="members-missed"><Kpi k="Semaines manquées" v={w.missed} s={w.notYet ? plural(w.notYet, 'pas venu', 'pas venus') + ' cette semaine' : 'tous venus cette semaine'} hot={w.missed > 0} icon="calendar" /></div> : null}
      <Kpi k="Chaque mois" v={<span className="money">{eur(s.mrr)}</span>} s="aux abonnés qui renouvellent" icon="euro" />
      <Kpi k="À régulariser" v={s.troubled + s.disputed} s={s.troubled || s.disputed ? 'paiement refusé' + (s.troubled + s.disputed > 1 ? 's' : '') + (s.disputed ? ', dont ' + s.disputed + ' litige' + (s.disputed > 1 ? 's' : '') : '') : 'aucun paiement refusé'} hot={s.troubled + s.disputed > 0} icon="alert" />
      <Kpi k="Résiliations (30 j)" v={s.days30.left} s={s.days30.joined ? s.days30.joined + ' nouveau' + (s.days30.joined > 1 ? 'x' : '') + ' · départ ' + String(s.days30.churn).replace('.', ',') + '\u00a0%' : 'départ ' + String(s.days30.churn).replace('.', ',') + '\u00a0%'} icon="x" />
      <Kpi k="Coupes ce mois" v={month} s={<>valeur <span className="money">{eur(s.month.value)}</span> au tarif normal</>} icon="scissors" />
    </div>
  );
}

/** Troubles first, then the ones leaving, then the rest by name. */
const RANK: Record<string, number> = { unpaid: 0, grace: 1, pending: 2, ending: 3, active: 4, paused: 5 };

/**
 * A member as the board reads him: from the rows (GET /api/v1/memberships: anyone who sees the files; the money and a
 * payment in trouble only for who manages the contracts), or from the client's card when the rows cannot be read.
 */
type Mem = {
  id: string; plan: string; status: MemberStatus; used: number; of: number; until: string | null; cancelAt: string | null; disputed: boolean; toConfirm: boolean;
  rhythm: 'month' | 'week'; perWeek?: number; missed?: 'lost' | 'month' | 'free'; week: (MemberWeek & { came?: boolean }) | null; weeks: MemberWeekDot[]; lastVisit: string | null;
};
type Row = { c: ClientCard; m: Mem };
/** a weekly member not come this week yet (the chip's filter) */
const notYet = (m: Mem) => m.rhythm === 'week' && !!m.week && !m.week.used && m.status !== 'unpaid';

/** « venu aujourd’hui », « venu hier », « venu il y a 9 j », « pas encore venu » */
function lastWords(day: string | null, today: string) {
  if (!day) return 'pas encore venu';
  const n = dates.diffDays(day, today);
  return n <= 0 ? 'venu aujourd’hui' : n === 1 ? 'venu hier' : 'venu il y a ' + n + ' j';
}

/** The 'abonnes' segment of the client list. q: the search box. active: the file open beside it. */
export default function Members({ q, active }: { q: string; active: string | null }) {
  const { boot, can } = useApp();
  const { data, loading } = useQuery<{ total: number; items: ClientCard[] }>('/api/v1/clients' + qs({ q, segment: 'abonnes', sort: 'name', limit: 200 }));
  // the rows: everyone who sees the files reads the weeks; reading them as the owner also catches up a month whose
  // renewal notice never came (nothing else does in production)
  const rows = useQuery<{ members: MemberRow[] }>(can('client.view') ? '/api/v1/memberships' : null);
  const [only, setOnly] = useState(false);
  const [write, setWrite] = useState<ClientCard | null>(null);
  const today = boot.today;
  const [members, carnets] = useMemo(() => {
    const items = data?.items || [];
    const fromCard = (c: ClientCard): Row[] => liveMembers(c.memberships).map((m) => ({ c, m: { ...m, disputed: false, toConfirm: false, rhythm: rhythmOf(m), week: m.week || null, weeks: [], lastVisit: c.lastDay } }));
    let mem: Row[];
    if (rows.data) {
      const by = new Map(items.map((c) => [c.id, c]));
      mem = rows.data.members.flatMap((m) => {
        const c = m.clientId ? by.get(m.clientId) : undefined;
        return c && m.status !== 'pending' && m.status !== 'ended' ? [{ c, m: { id: m.id, plan: m.plan, status: m.status, used: m.used, of: m.of, until: m.until, cancelAt: m.cancelAt, disputed: m.disputed, toConfirm: m.cancelVerified === false, rhythm: m.rhythm, perWeek: m.perWeek, missed: m.missed, week: m.week, weeks: m.weeks || [], lastVisit: m.lastVisit } }] : [];
      });
    } else mem = items.flatMap(fromCard);
    mem.sort((a, b) => (RANK[a.m.status] ?? 9) - (RANK[b.m.status] ?? 9) || a.c.name.localeCompare(b.c.name, 'fr'));
    const car = items.flatMap((c) => c.packs.map((p) => ({ c, p }))).sort((a, b) => a.p.expires.localeCompare(b.p.expires));
    return [mem, car] as const;
  }, [data, rows.data]);
  const missing = useMemo(() => members.filter((x) => notYet(x.m)).sort((a, b) => (a.m.lastVisit || '').localeCompare(b.m.lastVisit || '') || a.c.name.localeCompare(b.c.name, 'fr')), [members]);
  const filtered = only && missing.length ? missing : members;
  const open = (id: string) => navigate('/clients/' + id + location.search);
  if ((loading && !data) || (can('client.view') && !rows.data && !rows.error)) return <div className="col" style={{ gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={52} />)}</div>;
  if (!members.length && !carnets.length) return <Empty icon="clients" title={q ? 'Personne à ce nom' : 'Aucun abonné ni carnet'}>{q ? 'Vérifie l’orthographe.' : 'Les abonnements et les carnets en cours apparaissent ici.'}</Empty>;
  const canWrite = can('marketing');
  const canCall = can('client.contact');
  return (
    <div className="mbs">
      <MembersKpis />
      {members.length ? (
        <section aria-labelledby="mbs-a" data-guide="members-list">
          <h3 id="mbs-a" className="mbs-h section-k">Abonnés <small>{members.length}</small></h3>
          {missing.length ? (
            <div className="chips mbs-filter" role="group" aria-label="Filtrer les abonnés">
              <span data-guide="members-notyet"><Chip small on={only} onClick={() => setOnly(!only)}>Pas venu cette semaine ({missing.length})</Chip></span>
              <Chip small on={!only} onClick={() => setOnly(false)}>Tous ({members.length})</Chip>
            </div>
          ) : null}
          <ul className="list">
            {filtered.map(({ c, m }, i) => {
              const w = statusWords(m);
              const weekly = m.rhythm === 'week';
              const came = !!m.week && m.week.used > 0;
              const phone = canCall && c.hasPhone && c.phone ? c.phone.replace(/[^\d+]/g, '') : '';
              const writable = canWrite && c.hasPhone && c.sms;
              return (
                <li key={m.id} className="mbs-item">
                  <button type="button" className="li mbs-row" aria-current={active === c.id ? 'true' : undefined} onClick={() => open(c.id)}>
                    <Avatar name={c.first + ' ' + c.last} size="sm" color={m.status === 'grace' || m.status === 'unpaid' ? 'var(--warn)' : undefined} />
                    <span className="li-main">
                      <b>{c.first} {c.last}<span className={'badge' + toneClass(w.tone)}>{w.text}</span></b>
                      <small>{m.plan} · {lastWords(m.lastVisit, today)}{m.until && m.status === 'active' && !weekly ? ' · couvert jusqu’au ' + ddmm(m.until) : ''}{m.toConfirm ? ' · résiliation à confirmer' : ''}</small>
                      {weekly && m.week ? (
                        <span className="mbs-line">
                          {m.weeks.length ? <WeekDots weeks={m.weeks} today={today} guide={i === 0} /> : null}
                          <span className={'mbs-now' + (came ? ' ok' : '')} data-guide={i === 0 ? 'members-thisweek' : undefined}><span aria-hidden="true">{came ? '✓ ' : '· '}</span><span className="vh">{useWords(m, m)}</span><span aria-hidden="true">{came ? 'venu cette semaine' : 'pas encore cette semaine'}</span></span>
                        </span>
                      ) : m.weeks.length ? <span className="mbs-line"><WeekDots weeks={m.weeks} today={today} guide={i === 0} /></span> : null}
                    </span>
                    {weekly && m.week ? null : <span className="li-end"><b className="money tnum">{m.of ? m.used + '/' + m.of : m.used}</b><small className="faint">ce mois-ci</small></span>}
                  </button>
                  {writable || phone ? (
                    <span className="mbs-acts">
                      {writable ? <Button size="sm" variant="ghost" icon="sms" aria-label={'Écrire à ' + c.first} onClick={() => setWrite(c)}>Écrire</Button> : null}
                      {phone ? <a className="btn btn-ghost btn-sm" href={'tel:' + phone} aria-label={'Appeler ' + c.first + ' au ' + c.phone}><Icon name="phone" size={14} />Appeler</a> : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {carnets.length ? (
        <section aria-labelledby="mbs-c" data-guide="members-carnets">
          <h3 id="mbs-c" className="mbs-h section-k">Carnets en cours <small>{carnets.length}</small></h3>
          <ul className="list">
            {carnets.map(({ c, p }) => {
              const late = p.expires < boot.today;
              const soon = !late && p.expires <= dates.addDays(boot.today, 14);
              return (
                <li key={p.id}>
                  <button type="button" className="li mbs-row" aria-current={active === c.id ? 'true' : undefined} onClick={() => open(c.id)}>
                    <Avatar name={c.first + ' ' + c.last} size="sm" />
                    <span className="li-main"><b>{c.first} {c.last}{late ? <span className="badge badge-warn">expiré</span> : soon ? <span className="badge badge-warn">bientôt fini</span> : null}</b><small>{p.name} · valable jusqu’au {dayShortWord(p.expires, boot.today)}</small></span>
                    <span className="li-end"><b className="money tnum">{p.total - p.used}</b><small className="faint">restante{p.total - p.used > 1 ? 's' : ''}</small></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {data && data.total > data.items.length ? <p className="muted" style={{ fontSize: 13 }}><Icon name="info" size={14} /> Les {data.items.length} premiers sur {data.total} : cherche un nom pour les autres.</p> : null}
      {write ? <WriteSheet c={write} onClose={() => setWrite(null)} /> : null}
    </div>
  );
}

/** the text the sheet opens with: the client's first name and the booking link are filled when it leaves */
export const NUDGE = '{prenom}, on te garde ta place cette semaine ? Réserve ta coupe : {lien}';

/**
 * « Écrire à Karim »: one relance through the Relances path (/api/v1/relances/send), prefilled « On te garde ta place
 * cette semaine ? ». The server sends it only to a file that said yes to the salon's texts, with the STOP mention, once a
 * day at most and not within a week of his last visit; the answer says when it did not.
 */
function WriteSheet({ c, onClose }: { c: ClientCard; onClose: () => void }) {
  const { boot } = useApp();
  const [text, setText] = useState(NUDGE);
  const [busy, setBusy] = useState(false);
  const stop = (boot.settings.messages && boot.settings.messages.stopSuffix) || '';
  const preview = sms.withStop(text.split('{prenom}').join(c.first).split('{lien}').join(location.origin + '/').split('{jours}').join(String(c.sinceLast ?? '')), stop);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ sent: number; skipped: number }>('/api/v1/relances/send', { clientIds: [c.id], text: text.trim() });
      toast(r.sent ? { title: 'Message envoyé à ' + c.first, sub: 'Il part tout de suite, ou à la fin des heures calmes.', icon: 'sms' }
        : { title: 'Message non envoyé', sub: c.first + ' n’a pas dit oui aux SMS du salon, est venu il y a moins de 7 jours ou a déjà eu un message aujourd’hui.', icon: 'sms' });
      if (r.sent) { refreshAll(); onClose(); }
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title={'Écrire à ' + c.first} kicker="SMS"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" icon="sms" busy={busy} disabled={text.trim().length < 10} onClick={send}>Envoyer</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <label className="label" htmlFor="mbs-w-t">Le message</label>
        <textarea id="mbs-w-t" className="input textarea" rows={4} maxLength={320} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="bubble" aria-label="Aperçu"><small>Aperçu pour {c.first}</small><p>{preview}</p></div>
        <p className="faint" style={{ fontSize: 12.5 }}>Il le reçoit seulement s’il a dit oui aux SMS du salon ; la mention STOP est ajoutée à la fin.</p>
      </div>
    </Sheet>
  );
}
