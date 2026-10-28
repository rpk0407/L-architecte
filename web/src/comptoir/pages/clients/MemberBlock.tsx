// The client file's « Abonnement » block: the formule, since when, the next charge, the card, this month's cuts, and what the
// owner can do (member.manage): text the card link, cancel (at the end of the paid month, or now with the unused days paid
// back), and, for a client who has none, offer one by SMS or QR code. No pause, no change of formule: a member who wants
// another one cancels and joins again. The words of the contract itself are the client's own page (/abo/…), not this file's.
import { useState } from 'react';
import { api } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { copyText } from '../../../lib/clipboard';
import { dates, eur, plural } from '../../../lib/format';
import { ddmm, statusWords, toneClass } from '../../../lib/members';
import { QR } from '../../../lib/qr';
import { navigate } from '../../../lib/router';
import { Button, Chip, Note, Sheet, Skeleton, Switch, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import type { ClientFull, MemberRow } from '../../types';
import './clients-members.css';

const END_FR: Record<string, string> = { cancelled: 'résilié', withdrawn: 'rétracté', unpaid: 'arrêté faute de paiement', abandoned: 'jamais payé', ended: 'terminé' };
const dmy = (ms: number) => { const d = dates.localParts(ms).day; return ddmm(d) + '/' + d.slice(2, 4); };

/** What the counter sells right now: every formule on sale, the ones kept for the salon too; `live` when money can move (the server's word). */
export function useSellable(): { plans: { id: string; name: string; price: number; words: string }[]; live: boolean; ready: boolean } {
  const { can } = useApp();
  const q = useQuery<{ live: boolean; plans: { id: string; name: string; price: number; words: string }[] }>(can('client.edit') ? '/api/v1/memberships/plans' : null);
  return { plans: q.data?.plans || [], live: !!q.data?.live, ready: !!q.data || !can('client.edit') };
}

export default function MemberBlock({ c, onEdit }: { c: ClientFull; onEdit: () => void }) {
  const { can } = useApp();
  const q = useQuery<{ members: MemberRow[] }>('/api/v1/memberships?clientId=' + c.id);
  const [cancel, setCancel] = useState<MemberRow | null>(null);
  const [offer, setOffer] = useState(false);
  const manage = can('member.manage');
  if (!q.data) return <Skeleton h={90} />;
  const live = q.data.members.filter((m) => m.status !== 'ended');
  const ended = q.data.members.filter((m) => m.status === 'ended' && m.since);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast({ title: ok, icon: 'check' }); refreshAll(); } catch (e) { toastError(e); } };
  return (
    <>
      {live.map((m) => <MemberRowView key={m.id} m={m} manage={manage}
        onCard={() => act(() => api.post('/api/v1/memberships/' + m.id + '/card-link'), 'Lien envoyé par SMS')}
        onSync={() => act(() => api.post('/api/v1/memberships/' + m.id + '/sync'), 'Stripe relu')}
        onCancel={() => setCancel(m)} />)}
      {!live.length ? (
        <div className="col" style={{ gap: 10 }}>
          <p className="muted">{c.first} n’a pas d’abonnement.</p>
          {can('client.edit') && !c.erased ? <div><Button variant="primary" icon="card" data-guide="member-offer" onClick={() => setOffer(true)}>Abonner {c.first}</Button></div> : null}
        </div>
      ) : null}
      {ended.length ? <ul className="mb-ended">{ended.map((m) => <li key={m.id} className="muted" style={{ fontSize: 13 }}>{m.plan} · {END_FR[m.endReason] || 'terminé'}{m.endedAt ? ' le ' + dmy(m.endedAt) : ''}</li>)}</ul> : null}
      {cancel ? <CancelSheet m={cancel} first={c.first} onClose={() => setCancel(null)} /> : null}
      {offer ? <OfferSheet c={c} onClose={() => setOffer(false)} onEdit={onEdit} /> : null}
    </>
  );
}

function MemberRowView({ m, manage, onCard, onSync, onCancel }: { m: MemberRow; manage: boolean; onCard: () => void; onSync: () => void; onCancel: () => void }) {
  const w = statusWords(m);
  const trouble = m.status === 'grace' || m.status === 'unpaid';
  return (
    <div className="mb">
      <div className="mb-h"><b>{m.plan}</b><span className={'badge' + toneClass(w.tone)}>{w.text}</span><span className="muted grow" style={{ textAlign: 'right' }}><span className="money">{eur(m.price)}</span>/mois</span></div>
      <dl className="mb-kv">
        {m.since ? <><dt>Depuis</dt><dd>{dates.dayShort(dates.localParts(m.since).day)}</dd></> : null}
        {m.next ? <><dt>Prochain prélèvement</dt><dd><span className="money">{eur(m.price)}</span> le {ddmm(m.next)}</dd></> : null}
        {manage ? <><dt>Carte</dt><dd>{m.card || '—'}</dd></> : null}
        {m.status !== 'pending' ? <><dt>Coupes ce mois-ci</dt><dd>{m.of ? m.used + ' sur ' + m.of : plural(m.used, 'coupe') + ' (illimité)'}{m.until ? ' · jusqu’au ' + ddmm(m.until) : ''}</dd></> : null}
      </dl>
      {m.status === 'pending' ? <Note icon="info">Son premier paiement n’est pas encore fait : l’abonnement commence dès qu’il a payé.</Note> : null}
      {trouble && m.pastDueSince ? <Note tone="warn" icon="alert">Paiement refusé le {ddmm(dates.localParts(m.pastDueSince).day)}. {m.status === 'grace' && m.until ? 'Il garde ses coupes jusqu’au ' + ddmm(m.until) + ', le temps que la banque réessaie.' : 'Ses coupes sont suspendues.'} {manage ? 'Envoie-lui le lien de sa carte.' : ''}</Note> : null}
      {m.disputed ? <Note tone="err" icon="alert">Sa banque conteste un mois : ses prélèvements sont suspendus.</Note> : null}
      {m.cancelAt ? <Note tone={m.cancelVerified === false ? 'warn' : ''} icon="info">{m.cancelVerified === false ? 'Résiliation reçue sans lien, à confirmer : dernier jour ' + ddmm(m.cancelAt) + '.' : 'Résilié : dernier jour inclus le ' + ddmm(m.cancelAt) + '.'}</Note> : null}
      {manage ? (
        <div className="mb-acts">
          {m.status !== 'pending' ? <Button size="sm" icon="sms" onClick={onCard}>Envoyer le lien carte</Button> : null}
          {trouble ? <Button size="sm" icon="undo" onClick={onSync}>Relire Stripe</Button> : null}
          <Button size="sm" variant="danger" icon="x" data-guide="member-cancel" onClick={onCancel}>{m.cancelVerified === false ? 'Confirmer sa résiliation' : 'Résilier'}</Button>
        </div>
      ) : null}
    </div>
  );
}

/** « À la fin du mois payé (30/11) » or « Tout de suite », the second with the unused days given back (on by default). */
function CancelSheet({ m, first, onClose }: { m: MemberRow; first: string; onClose: () => void }) {
  const { can } = useApp();
  const unconfirmed = m.cancelVerified === false;
  const waiting = m.status === 'pending';
  // a membership already cancelled for the month's end can only be stopped sooner
  const atEnd = !waiting && !m.cancelAt;
  const [when, setWhen] = useState<'end' | 'now'>(atEnd ? 'end' : 'now');
  const [refund, setRefund] = useState(true);
  const [busy, setBusy] = useState(false);
  const canRefund = can('sale.refund') && m.refund > 0;
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ effective: string; ended: boolean; provider: { ok: boolean; error?: string }; refunded: { amount: number; ok: boolean; error?: string } | null }>('/api/v1/memberships/' + m.id + '/cancel', unconfirmed ? {} : { now: when === 'now', ...(when === 'now' && refund && canRefund ? { refund: true } : {}) });
      if (!r.provider.ok) toast({ kind: 'err', title: 'Résiliation notée, mais pas chez Stripe', sub: r.provider.error, icon: 'alert' });
      else if (r.refunded && !r.refunded.ok) toast({ kind: 'err', title: 'Résilié, mais le remboursement a échoué', sub: r.refunded.error, icon: 'alert' });
      else toast({ title: r.ended ? 'Abonnement arrêté' : 'Résiliation enregistrée · fin le ' + ddmm(dates.addDays(r.effective, -1)), sub: r.refunded?.ok ? eur(r.refunded.amount, { decimals: true }) + ' remboursés' : undefined, icon: 'check' });
      refreshAll(); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title="Résilier l’abonnement" kicker={first + ' · ' + m.plan}
      footer={<><Button variant="ghost" onClick={onClose}>Garder</Button><span className="grow" /><Button variant="danger" busy={busy} onClick={go}>{unconfirmed ? 'Confirmer' : 'Résilier'}</Button></>}>
      {unconfirmed ? <Note tone="warn" icon="info">{first} a demandé de résilier sans son lien. En confirmant, l’abonnement s’arrête à la fin du mois payé ({m.cancelAt ? ddmm(m.cancelAt) : ''}) et il reçoit la confirmation.</Note> : waiting ? <Note icon="info">Son premier paiement n’est pas fait : la demande est annulée, rien n’est prélevé.</Note> : (
        <fieldset className="col" style={{ gap: 10, border: 0, padding: 0, margin: 0 }}>
          <legend className="section-k" style={{ marginBottom: 8 }}>Quand ça s’arrête</legend>
          {atEnd ? (
            <label className="mb-opt"><input type="radio" name="when" checked={when === 'end'} onChange={() => setWhen('end')} /><span><b>À la fin du mois payé{m.until ? ' (' + ddmm(m.until) + ')' : ''}</b><small>Il garde ses coupes jusqu’à cette date, puis plus aucun prélèvement.</small></span></label>
          ) : null}
          <label className="mb-opt"><input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} /><span><b>Tout de suite</b><small>Ses coupes s’arrêtent aujourd’hui.</small></span></label>
          {when === 'now' && canRefund ? <Switch on={refund} onChange={setRefund} title={<>Rembourser <span className="money">{eur(m.refund, { decimals: true })}</span> (jours non utilisés)</>} hint="Le reste du mois payé lui est rendu sur sa carte, avec un avoir." /> : null}
        </fieldset>
      )}
    </Sheet>
  );
}

/** « Abonner {prénom} »: pick the formule, then the link by SMS (member.manage) or a QR code to show. */
function OfferSheet({ c, onClose, onEdit }: { c: ClientFull; onClose: () => void; onEdit: () => void }) {
  const { can } = useApp();
  const { plans, live, ready } = useSellable();
  const [planId, setPlanId] = useState('');
  const [now, setNow] = useState(false);
  const [busy, setBusy] = useState<'' | 'sms' | 'qr'>('');
  const [qr, setQr] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === (planId || plans[0]?.id));
  // the contract's confirmation goes to his e-mail and the link to his number, by SMS or as a QR code: the server wants both
  const missing = !c.hasPhone ? 'son numéro' : !c.hasEmail ? 'son e-mail' : '';
  const go = async (send: 'sms' | 'qr') => {
    if (!plan) return;
    setBusy(send);
    try {
      const r = await api.post<{ link: string; sent: boolean }>('/api/v1/memberships/offer', { clientId: c.id, planId: plan.id, send, startNow: now || undefined });
      refreshAll();
      if (send === 'qr') setQr(r.link);
      else { toast({ title: 'Lien envoyé par SMS à ' + c.first, sub: plan.name + ' · ' + eur(plan.price) + '/mois', icon: 'sms' }); onClose(); }
    } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  return (
    <Sheet open onClose={onClose} title={'Abonner ' + c.first} kicker={c.first + ' ' + c.last}>
      {!ready ? <Skeleton h={80} /> : !live ? (
        <Note tone="warn" icon="info">{plans.length ? 'Branche Stripe pour vendre des abonnements.' : 'Aucune formule n’est en vente : ajoute-en une dans Réglages › Abonnements.'}</Note>
      ) : qr ? (
        <>
          <p>{c.first} scanne ce code avec son téléphone, choisit sa carte et c’est fait.</p>
          <div className="mb-qr"><QR text={qr} size={240} label={'QR code de l’abonnement ' + (plan?.name || '')} /></div>
          <div className="mb-acts"><Button icon="copy" onClick={() => copyText(qr).then(() => toast({ title: 'Lien copié', icon: 'copy' }), toastError)}>Copier le lien</Button><Button variant="ghost" onClick={() => navigate('/clients/' + c.id)}>C’est fait</Button></div>
        </>
      ) : (
        <>
          <p className="muted">Il reçoit un lien pour choisir sa carte et payer le premier mois. L’abonnement commence quand c’est payé.</p>
          <div className="chips" role="group" aria-label="Formule">{plans.map((p) => <Chip key={p.id} on={plan?.id === p.id} onClick={() => setPlanId(p.id)}>{p.name} · {eur(p.price)}/mois</Chip>)}</div>
          {plan?.words ? <p className="muted" style={{ fontSize: 13.5 }}>{plan.words}</p> : null}
          <Switch on={now} onChange={setNow} title="Il commence tout de suite, à sa demande" hint="Sinon, le premier prélèvement a lieu après les 14 jours de rétractation. Commencer tout de suite : s’il se rétracte, les coupes prises lui sont facturées." />
          <div className="mb-acts">
            {can('member.manage') ? <Button variant="primary" icon="sms" busy={busy === 'sms'} disabled={!!missing || !plan} onClick={() => go('sms')}>Envoyer le lien par SMS</Button> : null}
            <Button icon="qr" busy={busy === 'qr'} disabled={!!missing || !plan} onClick={() => go('qr')}>Afficher le QR</Button>
          </div>
          {missing ? <Note icon={c.hasPhone ? 'info' : 'phone'}>Ajoute {missing} pour l’abonner. <button type="button" className="link" onClick={() => { onClose(); onEdit(); }}>Modifier la fiche</button></Note> : null}
        </>
      )}
    </Sheet>
  );
}
