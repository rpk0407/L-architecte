// En ligne: what online payments still ask of the till, at the top of Caisse only when there is something (a dispute
// to answer, a refund made at Stripe with no credit note, money paid online on no ticket). The payments of the last
// 30 days, with Stripe's fees, and the payouts are in a sheet (?enligne=1: the block's button, Réglages › Paiements).
// Three lines at most above the till, the rest in the sheet; hidden while a ticket is open, so the till comes first.
import { useState } from 'react';
import { api } from '../../../lib/api';
import { copyText } from '../../../lib/clipboard';
import { refreshAll, useQuery } from '../../../lib/query';
import { navigate, setQuery, useRoute } from '../../../lib/router';
import { dates, eur, plural, clock } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Empty, Note, Sheet, Skeleton, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import './online.css';

/** first, day, apptId: whom and which visit it is about (a first name only) */
type About = { first: string; day: string | null; apptId: string | null };
type Todo =
  | ({ kind: 'dispute'; id: string; paymentId: string; amount: number; reason: string; dueBy: number | null; label: string; payKind: string } & About)
  | { kind: 'outside'; id: string; paymentId: string; amount: number; saleId: string; ticket: string; day: string; label: string; payKind: string }
  | ({ kind: 'unused'; id: string; paymentId: string; amount: number; paidAt: number; label: string; payKind: string; apptStatus: string | null; cancelBy: string | null } & About);
type Row = { id: string; at: number; kind: string; label: string; amount: number; fee: number | null; net: number | null; refunded: number; status: string; provider: string; saleId: string | null; ticket: string | null; saleDay: string | null; apptId: string | null; day: string | null };
type Payout = { id: string; arrival: number | null; at: number; amount: number; gross: number; fee: number; count: number };
type Data = { mode: 'demo' | 'live' | 'test' | 'off'; provider: string; days: number; todo: Todo[]; payments: Row[]; payouts: Payout[] };

const KEY = '/api/v1/payments/online?days=30';
const KIND: Record<string, string> = { deposit: 'Acompte', qr: 'QR code', giftcard: 'Carte cadeau', membership: 'Abonnement', fee: 'Frais', guarantee: 'Empreinte' };
const STATUS: Record<string, [string, string]> = {
  paid: ['payé', 'badge-info'], used: ['encaissé', 'badge-ok'], partial: ['remboursé en partie', 'badge-warn'], refunded: ['remboursé', 'badge-warn'],
  disputed: ['litige', 'badge-danger'], dispute_lost: ['litige perdu', 'badge-danger']
};
const ddmm = (ms: number) => dates.localParts(ms).day.split('-').reverse().slice(0, 2).join('/');
const dayFr = (day: string) => day.split('-').reverse().slice(0, 2).join('/');
const cents = (c: number) => eur(c, { decimals: c % 100 !== 0 });
const provName = (p: string) => (p === 'stripe' ? 'Stripe' : 'le prestataire');
/** lines shown above the till; the sheet has them all */
const SHOWN = 3;
/** « de Malik », « d’Eloi » */
const of = (first: string) => (/^[aeiouyàâéèêëîïôöûü]/i.test(first) ? 'd’' : 'de ') + first;
/** where a line's action leads is the till's: the page starts at its top */
const go = (to: string) => { navigate(to); window.scrollTo({ top: 0 }); };

export function Online() {
  const { can } = useApp();
  return can('sale.all') ? <OnlineBlock /> : null;
}

function OnlineBlock() {
  const route = useRoute();
  const open = route.query.get('enligne') === '1';
  const q = useQuery<Data>(KEY, { maxAge: 20000 });
  const todo = q.data?.todo || [];
  const ticket = !!route.query.get('rdv') || route.query.get('vente') === '1';
  const more = todo.length - SHOWN;
  return (
    <>
      {todo.length && !ticket ? (
        <section className="card ol-todo" aria-labelledby="ol-h" data-guide="cs-online">
          <div className="card-h">
            <h2 id="ol-h"><Icon name="globe" size={16} />En ligne · à traiter <span className="badge badge-warn">{todo.length}</span></h2>
            <Button size="sm" variant="ghost" className="ol-more" onClick={() => setQuery({ enligne: '1' })}>Paiements et virements</Button>
          </div>
          <ul className="list">{todo.slice(0, SHOWN).map((t) => <TodoRow key={t.id} t={t} />)}</ul>
          {more > 0 ? <Button size="sm" variant="ghost" block className="ol-all" onClick={() => setQuery({ enligne: '1' })}>{more > 1 ? 'Voir les ' + more + ' autres' : 'Voir l’autre'}</Button> : null}
        </section>
      ) : null}
      <OnlineSheet open={open} data={q.data} error={!!q.error && !q.data} retry={q.refresh} onClose={() => setQuery({ enligne: null })} />
    </>
  );
}

function TodoRow({ t }: { t: Todo }) {
  const { can, boot } = useApp();
  const [busy, setBusy] = useState('');
  const what = KIND[t.payKind] || 'Paiement';
  /** one money action on the payment: confirmed, then the lists again (each post carries its request id, and the
   *  server refuses a deposit already kept or refunded: a double tap moves nothing twice) */
  const act = async (key: string, path: string, ask: { title: string; body: string; ok: string; danger?: boolean } | null, done: string) => {
    if (ask && !(await confirm(ask))) return;
    setBusy(key);
    try {
      await api.post('/api/v1/payments/' + encodeURIComponent(t.paymentId) + '/' + path, {});
      toast({ title: done, icon: 'check' });
      refreshAll();
    } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  const dossier = async () => {
    setBusy('dossier');
    try {
      const r = await api.get<{ text: string }>('/api/v1/payments/' + encodeURIComponent(t.paymentId) + '/evidence');
      await copyText(r.text);
      toast({ title: 'Dossier copié', sub: 'Colle-le dans Stripe › Litiges, avec le ticket si tu l’as.', icon: 'copy' });
    } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  if (t.kind === 'dispute') {
    return (
      <li className="ol-row">
        <span className="li-main">
          <b><span className="badge badge-danger">Litige</span><span><span className="money">{cents(t.amount)}</span> · {t.first ? t.first + ' · ' : ''}{t.label || what}</span></b>
          <small>{t.reason ? t.reason + ' · ' : ''}{t.day ? 'rendez-vous du ' + dayFr(t.day) + ' · ' : ''}{t.dueBy ? 'réponds avant le ' + ddmm(t.dueBy) + ' à ' + clock(t.dueBy) : 'sans date de réponse'}</small>
        </span>
        {can('sale.refund') ? <Button size="sm" variant="primary" icon="copy" busy={busy === 'dossier'} onClick={dossier}>Copier le dossier</Button> : null}
      </li>
    );
  }
  if (t.kind === 'outside') {
    const jour = t.day === boot.today ? '' : 'jour=' + t.day + '&';
    return (
      <li className="ol-row">
        <span className="li-main">
          <b>Remboursé chez Stripe sans avoir : fais l’avoir</b>
          <small><span className="money">{cents(t.amount)}</span> · ticket {t.ticket} du {dayFr(t.day)}</small>
        </span>
        <Button size="sm" variant="ghost" icon="ticket" onClick={() => go('/caisse/ventes?' + jour + 'ticket=' + t.saleId)}>Voir le ticket</Button>
      </li>
    );
  }
  const paid = <><span className="money">{cents(t.amount)}</span> · payé le {ddmm(t.paidAt)}</>;
  if (t.payKind === 'giftcard') {
    return (
      <li className="ol-row">
        <span className="li-main"><b>Carte cadeau payée, pas encore émise{t.first ? ' · ' + t.first : ''}</b><small>{paid} · son code n’est pas encore parti</small></span>
        <Button size="sm" variant="ghost" icon="gift" busy={busy === 'issue'} onClick={() => act('issue', 'issue', null, 'Carte cadeau émise')}>Émettre la carte</Button>
      </li>
    );
  }
  // a deposit whose visit will not happen: kept as the salon's (a no-show, a late call the salon cancelled) or given
  // back (the client cancelled in time, or paid too late: its refund did not go through). The owner decides.
  if (t.payKind === 'deposit' && (t.apptStatus === 'cancelled' || t.apptStatus === 'no_show')) {
    const owed = t.apptStatus === 'cancelled' && t.cancelBy !== 'salon';
    const on = t.day ? dayFr(t.day) : '—';
    const why = t.apptStatus === 'no_show' ? 'absent le ' + on : 'rendez-vous du ' + on + (t.cancelBy === 'client' ? ' annulé par le client' : t.cancelBy === 'salon' ? ' annulé par le salon' : ' annulé, acompte payé trop tard');
    const keep = <Button key="keep" size="sm" variant={owed ? 'ghost' : 'primary'} icon="caisse" busy={busy === 'keep'} disabled={!!busy && busy !== 'keep'}
      onClick={() => act('keep', 'keep', { title: 'Garder l’acompte de ' + cents(t.amount) + ' ?', body: 'Un ticket « Acompte conservé » est fait aujourd’hui, payé par l’acompte en ligne : il compte dans le chiffre du jour.', ok: 'Garder l’acompte' }, 'Acompte gardé : ticket fait')}>Garder l’acompte</Button>;
    const back = <Button key="back" size="sm" variant={owed ? 'primary' : 'ghost'} icon="refund" busy={busy === 'refund'} disabled={!!busy && busy !== 'refund'}
      onClick={() => act('refund', 'refund', { title: 'Rembourser ' + cents(t.amount) + (t.first ? ' à ' + t.first : '') + ' ?', body: 'L’acompte repart sur sa carte chez ' + provName('stripe') + ' (quelques jours pour le voir).', ok: 'Rembourser', danger: true }, 'Acompte remboursé')}>Rembourser</Button>;
    return (
      <li className="ol-row">
        <span className="li-main">
          <b>Acompte{t.first ? ' ' + of(t.first) : ''} · {why}</b>
          <small>{paid} · {owed ? 'à rembourser : le remboursement n’est pas passé' : 'à garder ou à rembourser'}</small>
        </span>
        {can('sale.refund') ? <span className="row ol-acts">{owed ? [back, keep] : [keep, back]}</span> : <small className="faint">Le gérant décide : garder ou rembourser.</small>}
      </li>
    );
  }
  // money waiting for its ticket: the appointment's (still to cash in), or a free sale started paid by it (a QR)
  const to = t.apptId ? '/caisse?rdv=' + t.apptId : '/caisse?vente=1&paiement=' + encodeURIComponent(t.paymentId);
  return (
    <li className="ol-row">
      <span className="li-main">
        <b>{what} payé en ligne, sur aucun ticket{t.first ? ' · ' + t.first : ''}</b>
        <small>{paid}{t.day ? ' · rendez-vous du ' + dayFr(t.day) : ''}</small>
      </span>
      <Button size="sm" variant="ghost" icon="caisse" onClick={() => go(to)}>Encaisser sur un ticket</Button>
    </li>
  );
}

function OnlineSheet({ open, data, error, retry, onClose }: { open: boolean; data: Data | undefined; error: boolean; retry: () => Promise<unknown>; onClose: () => void }) {
  const fees = (data?.payments || []).reduce((t, p) => t + (p.fee || 0), 0);
  // what stayed: a payment given back or lost to a dispute is not money in
  const kept = (data?.payments || []).filter((p) => p.status !== 'refunded' && p.status !== 'dispute_lost');
  const total = kept.reduce((t, p) => t + p.amount - (p.refunded || 0), 0);
  const back = (data?.payments || []).some((p) => p.refunded > 0 || p.status === 'dispute_lost');
  const demo = data?.mode === 'demo';
  return (
    <Sheet open={open} onClose={onClose} title="Paiements en ligne" kicker="30 derniers jours" wide>
      {error ? <Empty icon="alert" title="Impossible de charger les paiements" action={<Button variant="ghost" icon="undo" onClick={() => { retry().catch(() => undefined); }}>Réessayer</Button>}>Vérifie la connexion, puis réessaie.</Empty>
        : !data ? <Skeleton h={220} /> : (
        <div className="col ol-sheet" style={{ gap: 18 }}>
          {data.mode === 'demo' ? <Note icon="info">Démo : les paiements en ligne sont simulés. Ni frais, ni virement : ils arrivent avec Stripe.</Note>
            : data.mode === 'off' ? <Note icon="info">Paiement en ligne non branché : rien ne se paie en ligne pour l’instant.</Note>
            : data.mode === 'test' ? <Note tone="warn" icon="alert">Stripe en mode test : aucun vrai paiement.</Note> : null}
          {data.todo.length ? (
            <section aria-labelledby="ol-t">
              <div className="card-h"><h3 id="ol-t">À traiter</h3><span className="badge badge-warn">{data.todo.length}</span></div>
              <ul className="list">{data.todo.map((t) => <TodoRow key={t.id} t={t} />)}</ul>
            </section>
          ) : null}
          <section aria-labelledby="ol-p">
            <div className="card-h"><h3 id="ol-p">Paiements</h3>{data.payments.length ? <span className="muted">{plural(data.payments.length, 'paiement')} · <span className="money">{cents(total)}</span>{back ? ' après remboursements' : ''}{fees ? <> · frais <span className="money">{cents(fees)}</span></> : null}</span> : null}</div>
            {data.payments.length ? (
              <ul className="list">
                {data.payments.map((p) => {
                  const [word, tone] = STATUS[p.status] || [p.status, ''];
                  // « Acompte · Coupe » under « Acompte »: the label without the kind said again
                  const label = p.label.startsWith((KIND[p.kind] || '') + ' · ') ? p.label.slice((KIND[p.kind] || '').length + 3) : p.label;
                  return (
                    <li key={p.id} className="ol-row" tabIndex={0} aria-label={(KIND[p.kind] || 'Paiement') + ' ' + cents(p.amount) + ', ' + word}>
                      <span className="li-main">
                        <b>{KIND[p.kind] || 'Paiement'} <span className={'badge ' + tone}>{word}</span></b>
                        <small>{ddmm(p.at)} à {clock(p.at)}{label ? ' · ' + label : ''}{p.ticket ? ' · ' + p.ticket : ''}{p.refunded && p.status !== 'refunded' ? ' · remboursé ' + cents(p.refunded) : ''}</small>
                      </span>
                      <span className="li-end">
                        <b className="money tnum">{cents(p.amount)}</b>
                        {p.fee != null ? <small className="faint">frais <span className="money">{cents(p.fee)}</span> · net <span className="money">{cents(p.net ?? p.amount - p.fee)}</span></small> : demo ? null : <small className="faint">frais au virement</small>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : <Empty icon="card" title="Aucun paiement en ligne">Les acomptes, QR codes et cartes cadeaux payés en ligne apparaissent ici.</Empty>}
          </section>
          <section aria-labelledby="ol-v">
            <div className="card-h"><h3 id="ol-v">Virements</h3></div>
            {data.payouts.length ? (
              <ul className="list">
                {data.payouts.map((v) => (
                  <li key={v.id} className="ol-row" tabIndex={0} aria-label={'Virement ' + cents(v.amount)}>
                    <span className="li-main">
                      <b>Virement {provName(data.provider)}</b>
                      <small>{v.arrival ? 'sur ton compte le ' + ddmm(v.arrival) : 'reçu le ' + ddmm(v.at)} · {plural(v.count, 'opération')}</small>
                    </span>
                    <span className="li-end">
                      <b className="money tnum">{cents(v.amount)}</b>
                      <small className="faint">frais <span className="money">{cents(v.fee)}</span></small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty icon="euro" title="Aucun virement">{data.mode === 'live' || data.mode === 'test' ? 'Stripe vire chaque jour ce qui a été payé : chaque virement arrive ici avec ses frais.' : 'Les virements de Stripe vers ton compte arriveront ici, avec leurs frais.'}</Empty>}
          </section>
        </div>
      )}
    </Sheet>
  );
}
