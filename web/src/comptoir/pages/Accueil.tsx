// Accueil (WP5): the page everyone opens. One server read (GET /api/v1/home) says the moment, the sentence, the day
// (the next client, each chair, what is still coming) and the cards to deal with, already cut to this person's role
// and rights; the page writes it down and works out nothing. The last answer is kept on the device and painted first
// with « lu à … » (never on a shared salon screen; removed at sign-out), then replaced.
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { useInterval, useIsPhone, useLocal } from '../../lib/hooks';
import { useQuery } from '../../lib/query';
import { Link, navigate } from '../../lib/router';
import { Icon } from '../../ui/Icon';
import { Button, Empty, Seg, Skeleton, toast, toastError } from '../../ui/kit';
import { useApp, useMaskedAmounts, useSharedScreen } from '../state';
import { PageTitle } from '../App';
import type { Home, HomeAppt, HomeCard, HomeChair } from '../types';
import { ALL_BLOCKS, BLOCKS_KEY, PHONE_APPTS, blocksOf, fold, hiddenAfter, nameOf, stepOf } from './accueil/actions';
import { allShut, chairText, chairWho, dayOf, factText, firstTake, freeNow, hm, readAt, splitLabel, statusWord } from './accueil/format';
import { readSnap, writeSnap } from './accueil/snapshot';
import { done, isLater, keep, later, readUsage, toAsk, writeUsage, type Usage } from './accueil/usage';
import { Card } from './accueil/Card';
import { Customize } from './accueil/Customize';
import { Dock } from './accueil/Dock';
import './accueil.css';

// the Agenda's sheets and Équipe's plan of an absence: fetched when first asked for (and warmed up once the page is read)
const sheets = () => import('./accueil/sheets');
const WalkinSheet = lazy(() => sheets().then((m) => ({ default: m.WalkinSheet })));
const ApptSheet = lazy(() => sheets().then((m) => ({ default: m.ApptSheet })));
const CreateSheet = lazy(() => sheets().then((m) => ({ default: m.CreateSheet })));
const HandoverSheet = lazy(() => import('./Equipe').then((m) => ({ default: m.HandoverSheet })));

const KEY = '/api/v1/home';
/** The amounts of a shared salon screen start hidden; a tap on the eye shows them for 30 seconds (as Pilotage). */
const REVEAL_MS = 30000;
const store = () => { try { return localStorage; } catch { return null; } };
/** What the read says beyond the shared types (server/domain/home.js): the client on a busy chair, the minutes a booked
 *  client is late. Both are optional: a copy kept by an older visit has neither. */
type ChairX = HomeChair & { now?: { id: string; client: string } | null };
type ApptX = HomeAppt & { late?: number };

export default function Accueil() {
  const app = useApp();
  const { boot, can, staffById } = app;
  const shared = useSharedScreen();
  const { data, error, refreshing, refresh } = useQuery<Home>(KEY);
  // the copy of the last visit, read once: what the screen shows until the server answers (or when it cannot)
  const [snap] = useState(() => readSnap(store(), boot.me.id));
  useEffect(() => { if (data) writeSnap(store(), boot.me.id, data, shared); }, [data, shared]);
  const d = data || snap;
  // the chairs follow the clock without the journal moving: ask again every minute while the page is in front
  useInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
  useEffect(() => { const t = window.setTimeout(() => { void sheets().catch(() => {}); }, 1500); return () => clearTimeout(t); }, []);

  const masked = useMaskedAmounts();
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!shown) return; const t = window.setTimeout(() => setShown(false), REVEAL_MS); return () => clearTimeout(t); }, [shown]);

  // the page's blocks are the person's (prefs.homeBlocks: they follow him to another phone); what this device chose
  // before is only the first-run fallback, and stays written so the switch answers at once
  const [rawBlocks, setRawBlocks] = useLocal<unknown>(BLOCKS_KEY, ALL_BLOCKS);
  const [pending, setPending] = useState<unknown>(null);
  const blocks = blocksOf(pending || boot.me.prefs?.homeBlocks || rawBlocks);
  const [use, setUse] = useState<Usage>(() => readUsage(store(), Date.now()));
  const useRef_ = useRef(use);
  useRef_.current = use;
  const track = (next: Usage) => { setUse(next); writeUsage(store(), next); };

  const [appt, setAppt] = useState<string | null>(null);
  const [walk, setWalk] = useState<{ staffId?: string; serviceId?: string } | null>(null);
  const [create, setCreate] = useState(false);
  const phone = useIsPhone();
  const [handover, setHandover] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!d) {
    return (
      <div className="hm">
        <PageTitle><h1>Accueil</h1></PageTitle>
        {error ? (
          <section className="card" role="alert"><Empty icon="alert" title="L’Accueil ne s’est pas chargé" action={<Button variant="primary" busy={refreshing} onClick={() => { void refresh(); }}>Réessayer</Button>}>{error.message}</Empty></section>
        ) : (
          <div className="col" style={{ gap: 14 }} aria-busy="true"><Skeleton h={96} r={18} /><Skeleton h={72} r={18} /><Skeleton h={200} r={22} /></div>
        )}
      </div>
    );
  }

  const today = dayOf(d.asOf);
  const label = splitLabel(d.line);
  const hasMoney = d.line.facts.some((f) => f.unit === 'eur') || d.cards.some((c) => c.amount != null);
  const hide = masked && !shown && hasMoney;
  const cards = d.cards.filter((c) => !(c.canHide && isLater(use, c.id, today)));
  const { shown: top, folded } = fold(cards);
  const ask = toAsk(use, cards);
  const free = freeNow(d.day.chairs);
  const shut = allShut(d.day.chairs);
  const usual = boot.services.find((s) => s.slug === 'cl')?.id;
  // a phone shows the first rows of « Aujourd’hui »; the rest is counted, one touch from the Agenda
  const rows: ApptX[] = phone ? d.day.appts.slice(0, PHONE_APPTS) : d.day.appts;
  const more = d.day.more + d.day.appts.length - rows.length;
  // the quick gestures: « Encaisser » opens the one ticket waiting, or the till
  const pay = d.cards.find((c) => c.id === 'encaisser');
  const toTill = () => navigate(pay && pay.count === 1 && pay.preview[0] ? '/caisse?rdv=' + pay.preview[0].id : '/caisse');
  const books = can('agenda.own') || can('agenda.all');

  const setPrefs = async (patch: Record<string, unknown>) => { await api.patch('/api/v1/prefs', patch); await Promise.all([app.reloadBoot(), refresh()]); };
  const saveBlocks = (b: typeof blocks) => {
    setPending(b); setRawBlocks(b);
    api.patch('/api/v1/prefs', { homeBlocks: b }).then(() => app.reloadBoot()).catch(toastError).finally(() => setPending(null));
  };
  const run = (c: HomeCard) => {
    track(done(useRef_.current, c.id, Date.now()));
    const s = stepOf(c);
    if (s.kind === 'handover') setHandover(s.id); else navigate(s.to);
  };
  const putOff = (c: HomeCard) => { track(later(useRef_.current, c.id, Date.now(), today)); toast({ title: nameOf(c.id) + ' : remise à demain', sub: 'Sur cet appareil seulement.', icon: 'clock' }); };
  const hideCard = async (id: string) => {
    const before = boot.me.prefs?.homeHidden || [];
    try {
      await setPrefs({ homeHidden: hiddenAfter(before, id, false) });
      toast({ title: nameOf(id) + ' : carte masquée', sub: 'Elle revient depuis « Personnaliser ».', icon: 'eyeOff', action: { label: 'Annuler', run: () => { setPrefs({ homeHidden: before }).catch(toastError); } } });
    } catch (e) { toastError(e); }
  };
  const scope = async (v: 'salon' | 'moi') => { setBusy(true); try { await setPrefs({ homeDay: v }); } catch (e) { toastError(e); } finally { setBusy(false); } };
  const who = (id: string) => staffById.get(id);
  const dot = (id: string) => <i className="hm-dot" style={{ background: who(id)?.color || 'var(--tx3)' }} aria-hidden />;

  return (
    <div className={'hm' + (hide ? ' hm-masked' : '')}>
      <PageTitle><h1>Accueil</h1></PageTitle>

      {/* the moment and the sentence */}
      <header className="hm-head" data-guide="accueil.phrase">
        <div className="hm-when">
          <h2>{label.day}</h2>
          <p className="muted">{label.when ? <>{label.when} · </> : null}<span className="hm-asof" role="status">{readAt(d.asOf)}</span></p>
        </div>
        {masked && hasMoney ? (
          <button type="button" className="hm-eye" aria-pressed={shown} aria-label={shown ? 'Remasquer les montants' : 'Afficher les montants pendant 30 secondes'} onClick={() => setShown(!shown)}>
            <Icon name={shown ? 'eyeOff' : 'eye'} size={16} />{shown ? 'Remasquer' : 'Afficher 30 s'}
          </button>
        ) : null}
        {d.line.facts.length ? (
          <dl className="hm-facts">
            {d.line.facts.slice(0, 3).map((f) => { const t = factText(f); return <div key={f.k}><dd className={'tnum' + (t.money ? ' money' : '')}>{t.value}</dd><dt>{t.label}</dt></div>; })}
          </dl>
        ) : null}
        {d.line.note ? <p className="hm-note">{d.line.note}</p> : null}
      </header>

      <Dock onNew={books ? () => setCreate(true) : undefined} onWalkin={books && d.moment !== 'ferme' ? () => setWalk({}) : undefined} onPay={can('sale.create') ? toTill : undefined} toPay={pay ? pay.count : 0} />

      {error ? (
        <div className="hm-fail" role="alert"><Icon name="alert" size={16} /><span>Pas de réponse du serveur : ce que tu vois a été {readAt(d.asOf)}.</span><Button busy={refreshing} onClick={() => { void refresh(); }}>Réessayer</Button></div>
      ) : null}

      <div className="hm-grid">
        <div className="hm-day">
          {blocks.prochain ? <Next a={d.day.next as ApptX | null} moment={d.moment} name={who(d.day.next?.staffId || '')?.name} dot={d.day.next ? dot(d.day.next.staffId) : null} onOpen={setAppt} /> : null}

          {blocks.fauteuils && d.day.chairs.length ? (
            <section className="hm-block" aria-labelledby="hm-ch" data-guide="accueil.fauteuils">
              <h2 id="hm-ch" className="section-k">{d.day.chairs.length > 1 ? 'Fauteuils' : 'Mon fauteuil'}</h2>
              <ul className="hm-chairs">
                {shut ? <li className="hm-chair"><span className="hm-chair-t"><b>Tous les fauteuils</b><small>{chairText(d.day.chairs[0])}</small></span></li>
                  : d.day.chairs.map((c: ChairX) => <Chair key={c.staffId} c={c} dot={dot(c.staffId)} onOpen={setAppt} onTake={() => setWalk({ staffId: c.staffId, serviceId: firstTake(c, usual) })} />)}
              </ul>
            </section>
          ) : null}

          {blocks.jour ? (
            <section className="hm-block" aria-labelledby="hm-td" data-guide="accueil.jour">
              <div className="hm-block-h">
                <h2 id="hm-td" className="section-k">Aujourd’hui{d.day.scope === 'moi' && d.day.canSwitch ? ' · moi' : ''}</h2>
                {d.day.canSwitch ? <span aria-busy={busy}><Seg label="Quelle journée" value={d.day.scope} onChange={(v) => { if (v !== d.day.scope) void scope(v); }} options={[{ v: 'salon', t: 'Salon' }, { v: 'moi', t: 'Moi' }]} /></span> : null}
              </div>
              {rows.length ? (
                <ul className="hm-appts">
                  {rows.map((a) => (
                    <li key={a.id}><button type="button" className="hm-appt" onClick={() => setAppt(a.id)}>
                      <span className="hm-appt-h tnum">{hm(a.start)}</span>
                      <span className="hm-appt-t"><b className="ellipsis">{a.client}</b><small className={'ellipsis' + (a.late ? ' hm-late' : '')}>{a.services}{statusWord(a) ? ' · ' + statusWord(a) : ''}</small></span>
                      <span className="hm-appt-w">{dot(a.staffId)}<small className="ellipsis">{who(a.staffId)?.name}</small></span>
                    </button></li>
                  ))}
                </ul>
              ) : <p className="hm-none muted">{d.moment === 'ferme' ? 'Aucun rendez-vous aujourd’hui.' : 'Plus de rendez-vous à venir aujourd’hui.'}</p>}
              {can('agenda.own') ? <Link to="/agenda" className="hm-link">{more > 0 ? 'et ' + more + (more > 1 ? ' autres dans l’agenda' : ' autre dans l’agenda') : 'Ouvrir l’agenda'}<Icon name="arrowR" size={15} /></Link> : null}
            </section>
          ) : null}
        </div>

        <div className="hm-todo">
          <section className="hm-block" aria-labelledby="hm-cd" data-guide="accueil.cartes" id="a-traiter">
            <h2 id="hm-cd" className="section-k">À traiter{cards.length ? ' · ' + cards.length : ''}</h2>
            {cards.length ? (
              <ul className="hm-cards">
                {(all ? cards : top).map((c) => <Card key={c.id} c={c} onRun={() => run(c)} onLater={() => putOff(c)} onHide={() => void hideCard(c.id)} />)}
              </ul>
            ) : <p className="hm-none">Rien à traiter.</p>}
            {folded.length && !all ? <button type="button" className="hm-link" aria-expanded={false} onClick={() => setAll(true)}>{folded.length + (folded.length > 1 ? ' autres' : ' autre')}<Icon name="chevL" size={15} className="hm-down" /></button> : null}
            {ask ? (
              <div className="hm-ask" role="group" aria-label="Proposition">
                <p>Tu remets « {nameOf(ask)} » à plus tard depuis {use[ask].l.length} fois : la masquer ?</p>
                <span><Button size="sm" variant="ghost" onClick={() => track(keep(use, ask))}>Garder</Button><Button size="sm" onClick={() => { track(keep(use, ask)); void hideCard(ask); }}>Masquer</Button></span>
              </div>
            ) : null}
            {d.quiet.length ? <p className="hm-quiet muted"><Icon name="check" size={15} />Tout va bien pour : {d.quiet.join(', ')}.</p> : null}
          </section>
          <footer className="hm-foot" data-guide="accueil.perso">
            {can('report.shop') ? <Link to="/pilotage" className="hm-link">Voir les chiffres<Icon name="arrowR" size={15} /></Link> : null}
            {boot.me.chair ? <Link to="/espace" className="hm-link">Ma journée<Icon name="arrowR" size={15} /></Link> : null}
            <span className="grow" />
            <Button variant="ghost" icon="edit" onClick={() => setCustom(true)}>Personnaliser</Button>
          </footer>
        </div>
      </div>

      <Customize open={custom} onClose={() => setCustom(false)} home={d} blocks={blocks} setBlocks={saveBlocks} onSaved={refresh} />
      <Suspense fallback={null}>
        {appt ? <ApptSheet id={appt} onClose={() => setAppt(null)} /> : null}
        {walk ? <WalkinSheet open onClose={() => setWalk(null)} freeNow={free} prefill={walk} /> : null}
        {create ? <CreateSheet open prefill={{ day: today }} onClose={() => setCreate(false)} onCreated={() => { void refresh(); }} /> : null}
        {handover ? <HandoverSheet id={handover} onClose={() => setHandover(null)} /> : null}
      </Suspense>
    </div>
  );
}

/** « Prochain »: the next client who is not in a chair yet, his hour, what he comes for and with whom. */
function Next({ a, moment, name, dot, onOpen }: { a: ApptX | null; moment: Home['moment']; name?: string; dot: ReactNode; onOpen: (id: string) => void }) {
  return (
    <section className="hm-block" aria-labelledby="hm-nx" data-guide="accueil.prochain">
      <h2 id="hm-nx" className="section-k">Prochain</h2>
      {a ? (
        <button type="button" className="hm-next" onClick={() => onOpen(a.id)}>
          <span className="hm-next-h tnum">{hm(a.start)}</span>
          <span className="hm-next-t"><b className="ellipsis">{a.client}</b><small className={'ellipsis' + (a.late ? ' hm-late' : '')}>{a.services}{statusWord(a) ? ' · ' + statusWord(a) : ''}</small></span>
          <span className="hm-appt-w">{dot}<small className="ellipsis">{name}</small></span>
          <Icon name="arrowR" size={16} />
        </button>
      ) : <p className="hm-none muted">{moment === 'ferme' ? 'Personne aujourd’hui : le salon est fermé.' : moment === 'apres' ? 'Plus personne aujourd’hui.' : 'Personne n’est attendu pour l’instant.'}</p>}
    </section>
  );
}

/** One chair: who, its state in plain words (and with whom when a client is there: the row then opens his
 *  appointment), and one button when someone can sit down now. */
function Chair({ c, dot, onTake, onOpen }: { c: ChairX; dot: ReactNode; onTake: () => void; onOpen: (id: string) => void }) {
  const who = chairWho(c);
  const text = <span className="hm-chair-t"><b className="ellipsis">{c.name}</b><small>{chairText(c)}{who ? ' · ' + who : ''}</small></span>;
  return (
    <li className={'hm-chair' + (c.state === 'libre' ? ' free' : '')}>
      {c.now ? <button type="button" className="hm-chair-o" onClick={() => onOpen(c.now!.id)} aria-label={c.name + ' : ' + chairText(c) + (who ? ', ' + who : '') + '. Ouvrir le rendez-vous'}>{dot}{text}<Icon name="chevR" size={16} /></button> : <>{dot}{text}</>}
      {c.canTake.length ? <Button icon="walk" onClick={onTake} aria-label={'Prendre un passage chez ' + c.name}>Prendre un passage</Button> : null}
    </li>
  );
}
