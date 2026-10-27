// PAY-04 · The member's page: where his month stands (« 1/2 coupes ce mois-ci »), his next charge and card, and the
// two legal functions: « Résilier mon abonnement » (recap, then « Confirmer la résiliation ») and, during the 14 days,
// « Renoncer au contrat ici » (recap, then « Confirmer la rétractation »). No retention offer, no survey, no step
// before the final buttons. One view for both ways in: the signed link of the texts and of /resilier (/abo/:token,
// PAY-03's routes) and the client space (/moi, /api/me/membership*).
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { dates, eur, time } from '../../lib/format';
import './member.css';

export type MemberStatus = 'pending' | 'active' | 'grace' | 'unpaid' | 'paused' | 'ending' | 'ended';
export type AckKind = 'welcome' | 'cancel' | 'withdraw';
/** What PAY-03's memberView answers (server/http/routes-membership.js): no number, no e-mail. */
export type MemberView = {
  id: string; first: string; status: MemberStatus; startDay: string | null;
  plan: { id: string; name: string; price: number; cuts: number; minDays: number; words: string; services: { id: string; name: string; slug: string | null }[] };
  used: number; of: number; nextCut: string | null;
  period: { start: string; end: string; last: string; paid: boolean } | null;
  next: { amount: number; day: string } | null; card: string;
  pastDue: { since: number; action: boolean } | null;
  cancel: { at: number; effective: string; last: string; by: string; verified: boolean } | null;
  withdraw: { until: string; refund: number; used: number } | null;
  withdrawn: { at: number; refund: number } | null;
  ended: { reason: string } | null;
  actions: { cancel: boolean; withdraw: boolean; card: boolean };
  acks: { kind: AckKind; at: number; sent: boolean; sentAt: number | null }[];
  shop: { name: string; phone: string };
};
export type MemberPage = { member: MemberView | null; mbr: string | null; reasons?: string[]; demo?: boolean };
type Done = { cancelled?: { at: number; effective: string; last: string; ended: boolean }; withdrawn?: { at: number; refund: number; refunded: boolean }; member: MemberView; demo?: boolean };

/** Where the page reads and writes: the signed link's routes, or the client session's. */
export type MemberSource = {
  load(): Promise<MemberPage>;
  cancel(reason: string): Promise<Done>;
  withdraw(): Promise<Done>;
  card(): Promise<{ url: string }>;
  ackUrl(kind: AckKind): string;
};
/** /abo/:token: PAY-03's token routes; « Réserver ma coupe » carries that same signed link. */
export function tokenSource(token: string): MemberSource {
  const base = '/api/public/memberships/' + encodeURIComponent(token);
  return {
    load: () => api.get<MemberView>(base).then((member) => ({ member, mbr: token })),
    cancel: (reason) => api.post<Done>(base + '/cancel', reason ? { reason } : {}),
    withdraw: () => api.post<Done>(base + '/withdraw', {}),
    card: () => api.post<{ url: string }>(base + '/card', {}),
    ackUrl: (kind) => base + '/ack/' + kind
  };
}
/** /moi: the session's file (server/http/routes-me-membership.js). */
export const meSource: MemberSource = {
  load: () => api.get<MemberPage>('/api/me/membership'),
  cancel: (reason) => api.post<Done>('/api/me/membership/cancel', reason ? { reason } : {}),
  withdraw: () => api.post<Done>('/api/me/membership/withdraw', {}),
  card: () => api.post<{ url: string }>('/api/me/membership/card', {}),
  ackUrl: (kind) => '/api/me/membership/ack/' + kind
};

const REASONS = ['Je viens moins souvent', 'Trop cher pour moi', 'Je déménage', 'Autre raison'];
const pad = (n: number) => (n < 10 ? '0' : '') + n;
/** 30/11 */
export const ddmm = (day: string) => { const p = dates.dayParts(day); return pad(p.d) + '/' + pad(p.m); };
/** « 27/10 à 14 h 05 », Paris time */
export const atWords = (ms: number) => { const p = dates.localParts(ms); return ddmm(p.day) + ' à ' + time(p.min); };
const today = () => dates.localParts(Date.now()).day;
const plural = (n: number, w: string) => n + ' ' + w + (n > 1 ? 's' : '');

/** The chip's words: always text, the colour only repeats them. */
export function statusWords(m: MemberView): { text: string; tone: '' | 'ok' | 'warn' } {
  if (m.status === 'ended') return { text: m.withdrawn ? 'rétracté' : 'arrêté', tone: '' };
  if (m.status === 'ending' && m.cancel) return { text: 's’arrête le ' + ddmm(m.cancel.last), tone: 'warn' };
  if (m.status === 'grace' || m.status === 'unpaid' || m.pastDue) return { text: 'paiement à régulariser', tone: 'warn' };
  if (m.status === 'pending') return { text: m.startDay ? 'démarre le ' + ddmm(m.startDay) : 'en attente du paiement', tone: '' };
  return { text: 'actif', tone: 'ok' };
}
/** « 1/2 coupes ce mois » / « Illimité · prochaine coupe incluse dès le 12/11 », for the /moi row. */
export function counterWords(m: MemberView) {
  if (m.status === 'ended' || m.status === 'pending') return statusWords(m).text;
  if (m.of) return m.used + '/' + m.of + ' coupes ce mois';
  return 'Illimité' + (m.nextCut && m.nextCut > today() ? ' · prochaine coupe incluse dès le ' + ddmm(m.nextCut) : ' · prochaine coupe incluse');
}

/** « Prochain prélèvement : 34 € le 30/11 »; a renewal being retried says so rather than a day gone by. */
function chargeWords(m: MemberView, day: string) {
  if (m.pastDue) return 'Paiement de ' + eur(m.plan.price) + ' en attente : la banque réessaie';
  if (m.cancel) return 'Plus aucun prélèvement';
  if (!m.next) return 'Aucun prélèvement prévu';
  return 'Prochain prélèvement : ' + eur(m.next.amount) + (m.next.day <= day ? ' aujourd’hui' : ' le ' + ddmm(m.next.day));
}

/** Under the counter: until when this month runs, or when the next covered cut comes. */
function counterSub(m: MemberView, included: boolean | null | '') {
  const until = m.period ? 'jusqu’au ' + ddmm(m.period.last) : '';
  if (!m.of) return [included || !m.nextCut ? 'Ta prochaine coupe est incluse' : 'Prochaine coupe incluse dès le ' + ddmm(m.nextCut), until].filter(Boolean).join(' · ');
  if (m.used >= m.of && m.nextCut) return 'Tes coupes du mois sont prises : la prochaine est incluse dès le ' + ddmm(m.nextCut) + '.';
  return until;
}

/** The acknowledgement: sent (when), or on its way; and the file to keep. */
function Ack({ m, kind, source }: { m: MemberView; kind: AckKind; source: MemberSource }) {
  const a = [...m.acks].reverse().find((x) => x.kind === kind);
  if (!a) return null;
  return (
    <div className="mb-ack" data-guide="member-ack">
      <p className={'mb-ack-s' + (a.sent ? ' ok' : '')} role="status">{a.sent ? 'Confirmation envoyée le ' + atWords(a.sentAt || a.at) : 'Envoi en cours'}</p>
      <a className="c-btn ghost mb-dl" href={source.ackUrl(kind)} download>Télécharger la confirmation</a>
    </div>
  );
}

type Mode = 'home' | 'cancel' | 'withdraw' | 'cancelled' | 'withdrawn';

/**
 * The page itself, from a source. initial: the screen the link asks for (?resilier: the cancellation's recap, ?renoncer:
 * the withdrawal's), shown when that action is open. back: ?paiement=ok after the checkout (the bank's confirmation may
 * take a few seconds: the page asks again).
 */
export function MemberPanel({ source, initial, back, onChange }: { source: MemberSource; initial?: 'cancel' | 'withdraw' | null; back?: string | null; onChange?: () => void }) {
  const [page, setPage] = useState<MemberPage | null>(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<Mode>('home');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: string; text: string } | null>(back === 'ok' ? { tone: 'ok', text: 'Paiement reçu. On active ton abonnement…' } : null);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [tries, setTries] = useState(0);
  const head = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);

  const load = () => source.load().then((p) => { setPage(p); return p; }).catch((e) => { setErr(e.message); return null; });
  useEffect(() => {
    load().then((p) => {
      const m = p && p.member;
      if (!m || opened.current) return;
      opened.current = true;
      if (initial === 'cancel' && m.actions.cancel) setMode('cancel');
      else if (initial === 'withdraw' && m.actions.withdraw) setMode('withdraw');
    });
  }, []);
  // after the checkout: ask again until the payment is recorded, then say so
  useEffect(() => {
    const m = page && page.member;
    if (back !== 'ok' || !m) return;
    if (m.status !== 'pending' || m.startDay) { setNote({ tone: 'ok', text: m.startDay && m.status === 'pending' ? 'C’est enregistré. Ton abonnement démarre le ' + ddmm(m.startDay) + ' : rien n’est prélevé avant.' : 'Merci, ton abonnement est actif. La confirmation part par e-mail et par SMS.' }); return; }
    if (tries >= 15) { setNote({ tone: 'warn', text: 'La confirmation de la banque tarde. Reviens sur ce lien dans quelques minutes.' }); return; }
    const t = setTimeout(() => { setTries((n) => n + 1); load(); }, 2000);
    return () => clearTimeout(t);
  }, [page]);
  // an acknowledgement on its way: the page says when it left
  useEffect(() => {
    const m = done ? done.member : null;
    if (!m || !m.acks.some((a) => !a.sent) || tries > 20) return;
    const t = setTimeout(() => { setTries((n) => n + 1); source.load().then((p) => { if (p.member) setDone((d) => (d ? { ...d, member: p.member! } : d)); }).catch(() => {}); }, 4000);
    return () => clearTimeout(t);
  }, [done, tries]);
  // each screen starts at its title: a screen reader hears where it is
  useEffect(() => { if (opened.current && head.current) head.current.focus({ preventScroll: false }); }, [mode]);

  if (err && !page) return <section className="c-card c-center"><p className="c-k">Abonnement</p><h1 className="c-h">{err}</h1><p className="c-muted">Demande un nouveau lien : il arrive par SMS et par e-mail.</p><a className="c-btn" href="/resilier">Recevoir un nouveau lien</a></section>;
  if (!page) return <div className="c-card c-center" aria-busy="true"><span className="c-spin" /><p className="c-muted">Un instant…</p></div>;
  const m = page.member;
  if (!m) return <section className="c-card c-center"><p className="c-k">Abonnement</p><h1 className="c-h">Pas d’abonnement en cours.</h1><a className="c-btn" href="/#abonnement">Voir les formules</a></section>;

  const st = statusWords(m);
  const live = m.status !== 'ended';
  const day = today();
  const slug = m.plan.services.find((x) => x.slug)?.slug || '';
  const book = '/?reserver' + (slug ? '&prestation=' + encodeURIComponent(slug) : '') + (page.mbr && live && m.status !== 'pending' ? '&mbr=' + encodeURIComponent(page.mbr) : '');
  const run = async (fn: () => Promise<Done>, next: Mode) => {
    setBusy(true); setErr('');
    try {
      const r = await fn();
      setDone(r); setPage({ ...page, member: r.member }); setMode(next); setTries(0);
      onChange && onChange();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const card = async () => {
    setBusy(true); setErr('');
    try { const r = await source.card(); location.href = r.url; } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const errLine = err ? <p className="c-note warn" role="alert">{err}</p> : null;
  const demoLine = page.demo ? <p className="c-note" role="status">Démo : ce client de démo ne change pas, rien n’est enregistré.</p> : null;

  /* ---------- the cancellation: recap, then the final button ---------- */
  if (mode === 'cancel') {
    const now = !m.period || !m.period.paid || m.status === 'pending' || m.status === 'unpaid';
    return (
      <section className="c-card mb-recap" aria-labelledby="mb-cx-t">
        <p className="c-k">Résilier mon abonnement</p>
        <h1 className="c-h2" id="mb-cx-t" ref={head} tabIndex={-1}>Résilier mon abonnement</h1>
        <dl className="mb-dl-list">
          {m.first ? <div><dt>Abonné</dt><dd>{m.first}</dd></div> : null}
          <div><dt>Formule</dt><dd>{m.plan.name} · {eur(m.plan.price)}/mois</dd></div>
          <div><dt>Fin</dt><dd>{m.status === 'pending' ? 'Ton abonnement ne commencera pas : rien n’est prélevé.' : now ? 'Aujourd’hui. Aucun autre prélèvement.' : 'Fin le ' + ddmm(m.period!.last) + ' : tes coupes restent incluses jusque-là. Aucun autre prélèvement.'}</dd></div>
        </dl>
        <div className="mb-field">
          <label htmlFor="mb-reason">Une raison ? <span className="c-muted">facultatif</span></label>
          <select id="mb-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Je préfère ne pas le dire</option>
            {(page.reasons || REASONS).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        {errLine}
        <button type="button" className="c-btn mb-final" data-guide="member-cancel-confirm" disabled={busy} onClick={() => run(() => source.cancel(reason), 'cancelled')}>{busy ? 'Un instant…' : 'Confirmer la résiliation'}</button>
        <button type="button" className="c-link mb-back" disabled={busy} onClick={() => { setErr(''); setMode('home'); }}>Garder mon abonnement</button>
      </section>
    );
  }
  if (mode === 'cancelled' && done) {
    const c = done.cancelled;
    return (
      <section className="c-card c-center mb-done" aria-labelledby="mb-cxd-t">
        <span className="c-check" aria-hidden>✓</span>
        {demoLine}
        <h1 className="c-h2" id="mb-cxd-t" ref={head} tabIndex={-1}>Résiliation enregistrée{c ? ' le ' + atWords(c.at) : ''}.</h1>
        <p className="c-muted">{c ? (c.ended || c.effective <= day ? 'Ton abonnement s’arrête aujourd’hui.' : 'Fin le ' + ddmm(c.last) + '.') : ''} Confirmation envoyée par e-mail et SMS.</p>
        <Ack m={done.member} kind="cancel" source={source} />
        <a className="c-link mb-back" href="/">Retour au site</a>
      </section>
    );
  }

  /* ---------- the withdrawal (14 days): recap, then the final button ---------- */
  if (mode === 'withdraw' && m.withdraw) {
    const w = m.withdraw;
    return (
      <section className="c-card mb-recap" aria-labelledby="mb-wd-t">
        <p className="c-k">Rétractation · jusqu’au {ddmm(w.until)}</p>
        <h1 className="c-h2" id="mb-wd-t" ref={head} tabIndex={-1}>Renoncer au contrat</h1>
        <dl className="mb-dl-list">
          <div><dt>Formule</dt><dd>{m.plan.name} · {eur(m.plan.price)}/mois</dd></div>
          <div><dt>Remboursement</dt><dd>{(w.used ? 'Tu as utilisé ' + plural(w.used, 'coupe') + '. ' : 'Tu n’as utilisé aucune coupe. ') + (w.refund ? 'On te rembourse ' + eur(w.refund, { decimals: w.refund % 100 !== 0 }) + ' sous 14 jours.' : 'Elles valent le mois payé : rien à rembourser.')}</dd></div>
          <div><dt>Fin</dt><dd>Aujourd’hui : ton abonnement s’arrête, plus rien n’est prélevé.</dd></div>
        </dl>
        {errLine}
        <button type="button" className="c-btn mb-final" data-guide="member-withdraw-confirm" disabled={busy} onClick={() => run(() => source.withdraw(), 'withdrawn')}>{busy ? 'Un instant…' : 'Confirmer la rétractation'}</button>
        <button type="button" className="c-link mb-back" disabled={busy} onClick={() => { setErr(''); setMode('home'); }}>Garder mon abonnement</button>
      </section>
    );
  }
  if (mode === 'withdrawn' && done) {
    const w = done.withdrawn;
    return (
      <section className="c-card c-center mb-done" aria-labelledby="mb-wdd-t">
        <span className="c-check" aria-hidden>✓</span>
        {demoLine}
        <h1 className="c-h2" id="mb-wdd-t" ref={head} tabIndex={-1}>Rétractation enregistrée{w ? ' le ' + atWords(w.at) : ''}.</h1>
        <p className="c-muted">{w && w.refund ? 'Remboursement de ' + eur(w.refund, { decimals: w.refund % 100 !== 0 }) + ' sous 14 jours, sur ta carte.' : 'Rien à rembourser : tes coupes valent le mois payé.'} Confirmation envoyée par e-mail et SMS.</p>
        <Ack m={done.member} kind="withdraw" source={source} />
        <a className="c-link mb-back" href="/">Retour au site</a>
      </section>
    );
  }

  /* ---------- the page ---------- */
  // the contract's confirmation matters while it can still be withdrawn; afterwards, the latest acknowledgement only
  const lastAck: AckKind | null = m.withdrawn ? 'withdraw' : m.cancel ? 'cancel' : m.withdraw ? 'welcome' : null;
  const unlimited = !m.of;
  const included = m.nextCut && m.nextCut <= day;
  return (
    <>
      {note ? <p className={'c-note ' + note.tone} role="status">{note.text}</p> : null}
      {errLine}
      {m.pastDue && live ? (
        <section className="c-card mb-due" aria-labelledby="mb-due-t" data-guide="member-due">
          <h2 className="c-h2" id="mb-due-t">Le paiement de {eur(m.plan.price)} n’est pas passé</h2>
          <p className="c-muted">{m.pastDue.action ? 'Ta banque demande de valider le paiement.' : 'Mets ta carte à jour : tes coupes restent incluses en attendant.'}</p>
          {m.actions.card ? <button type="button" className="c-btn" disabled={busy} onClick={card}>Mettre ma carte à jour</button> : null}
        </section>
      ) : null}
      <section className="c-card c-ticket mb-card" aria-labelledby="mb-t">
        <div className="c-row"><span className={'c-pill ' + st.tone} data-guide="member-status">{st.text}</span>{m.first ? <span className="c-code">{m.first}</span> : null}</div>
        <h1 className="mb-plan" id="mb-t">Abonnement {m.plan.name}</h1>
        {m.status === 'pending' ? (
          <p className="mb-sub">{m.startDay ? 'Il démarre le ' + ddmm(m.startDay) + ' : rien n’est prélevé avant, et d’ici là tes coupes sont au prix normal.' : 'On attend la confirmation du paiement.'}</p>
        ) : live ? (
          <div className="mb-count" data-guide="member-counter">
            {unlimited ? <p className="mb-big">Illimité</p> : <p className="mb-big" aria-label={m.used + ' coupe' + (m.used > 1 ? 's' : '') + ' sur ' + m.of + ' ce mois-ci'}>{m.used}/{m.of}<small>coupes ce mois-ci</small></p>}
            <p className="mb-sub">{counterSub(m, included)}</p>
          </div>
        ) : (
          <p className="mb-sub">{m.withdrawn ? 'Rétractation enregistrée le ' + atWords(m.withdrawn.at) + '.' : m.cancel ? 'Résilié : fin le ' + ddmm(m.cancel.last) + '.' : 'Cet abonnement est arrêté.'}</p>
        )}
        {live && m.status !== 'pending' ? <a className="c-btn mb-book" href={book} data-guide="member-book">Réserver ma coupe</a> : null}
        {!live ? <a className="c-btn mb-book" href="/#abonnement">Voir les formules</a> : null}
      </section>
      {live ? (
        <section className="c-card mb-pay" aria-label="Paiement" data-guide="member-charge">
          <p className="mb-line">{chargeWords(m, day)}{m.card ? <> · <span className="mb-nw">{m.card}</span></> : null}</p>
          {m.actions.card && !m.pastDue ? <button type="button" className="c-link mb-link" data-guide="member-card" disabled={busy} onClick={card}>Changer de carte</button> : null}
        </section>
      ) : null}
      {lastAck ? <Ack m={m} kind={lastAck} source={source} /> : null}
      {m.actions.cancel || m.actions.withdraw ? (
        <section className="mb-acts" aria-label="Gérer mon abonnement">
          {m.actions.cancel ? <button type="button" className="c-btn ghost mb-act" data-guide="member-cancel" onClick={() => { setErr(''); setMode('cancel'); }}>Résilier mon abonnement</button> : null}
          {m.actions.withdraw && m.withdraw ? (
            <div className="mb-wd" data-guide="member-withdraw">
              <button type="button" className="c-btn ghost mb-act" onClick={() => { setErr(''); setMode('withdraw'); }}>Renoncer au contrat ici</button>
              <p className="c-muted c-small">Pendant 14 jours, jusqu’au {ddmm(m.withdraw.until)} : on te rembourse le mois, moins les coupes déjà faites.</p>
            </div>
          ) : null}
        </section>
      ) : null}
      <p className="c-muted c-small mb-help">Une question ? {m.shop.phone ? <>Appelle le salon au <a href={'tel:' + m.shop.phone.replace(/\s/g, '')}>{m.shop.phone}</a>.</> : 'Passe au salon.'} <a href="/cgv#abonnement">Conditions de l’abonnement</a></p>
    </>
  );
}

/** /abo/:token, the member page reached from a text, an e-mail or /resilier. */
export default function Member({ token }: { token: string }) {
  const q = new URLSearchParams(location.search);
  const initial = q.has('resilier') ? 'cancel' : q.has('renoncer') ? 'withdraw' : null;
  const back = q.get('paiement');
  const [source] = useState(() => tokenSource(token));
  // the address keeps nothing but the link (a shared screenshot does not reopen the recap)
  useEffect(() => { document.title = 'Mon abonnement · Barber L’Architecte'; if (location.search) history.replaceState(null, '', location.pathname); }, []);
  return <MemberPanel source={source} initial={initial} back={back} />;
}
