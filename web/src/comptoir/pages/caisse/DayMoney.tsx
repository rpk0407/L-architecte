// The money of the day, under « À encaisser » on the Caisse home (owner, manager, desk): what came in by method and by
// barber (tips apart), the deposits, the memberships of the day and the failures to follow up, the gift cards, and the
// cash barbers took on their phone and still hold. One read (GET /api/v1/caisse/jour), the same figures as the Z.
import { useRef, useState } from 'react';
import { api, uuid } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { navigate } from '../../../lib/router';
import { eur } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Avatar, Button, Skeleton, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';

export type TillDay = {
  day: string; closed: boolean; takings: number; prepaid: number; net: number; tickets: number; tips: number; refunds: number;
  toPay: { id: string; name: string; start: number; end: number; status: string; staffId: string; staff: string; price: number; waited: number }[];
  methods: { method: string; amount: number }[];
  staff: { id: string; name: string; color: string; performed: number; tickets: number; tips: number; cash: number }[];
  credits: { carnet: number; member: number };
  deposits: Record<'waiting' | 'used' | 'refunded', { n: number; amount: number }>;
  members: { renewed: { id: string; name: string; plan: string; amount: number }[]; failed: { id: string; name: string; plan: string; amount: number; attempt: number; since: string; clientId: string | null }[] };
  giftcards: { sold: number; used: number };
  held: { id: string; name: string; amount: number }[];
  drawer: { open: boolean };
};
export const DAY_KEY = '/api/v1/caisse/jour';
export const METHOD_WORDS: Record<string, string> = { cash: 'Espèces', card: 'Carte (terminal)', online: 'QR et en ligne', deposit: 'Acomptes en ligne', giftcard: 'Cartes cadeaux utilisées', ancien: 'Payé sur l’ancien site' };
const c = (v: number) => eur(v, { decimals: v % 100 !== 0 });
const plural = (n: number, one: string, many: string) => n + ' ' + (n > 1 ? many : one);

export function DayMoney() {
  const { data } = useQuery<TillDay>(DAY_KEY);
  if (!data) return <Skeleton h={220} r={22} />;
  const d = data;
  const anyDeposit = d.deposits.waiting.n + d.deposits.used.n + d.deposits.refunded.n > 0;
  return (
    <div className="col dm" style={{ gap: 14 }} data-guide="cs-day">
      <section className="card cs-list" aria-labelledby="dm-in">
        <div className="card-h"><h2 id="dm-in"><Icon name="cash" size={16} />Encaissé aujourd’hui</h2><b className="money tnum">{c(d.takings)}</b></div>
        {!d.tickets ? <p className="muted dm-line">Aucun ticket pour l’instant.</p> : (
          <>
            {d.methods.map((m) => <div key={m.method} className="kv" data-method={m.method}><span>{METHOD_WORDS[m.method] || m.method}</span><b className="money tnum">{c(m.amount)}</b></div>)}
            {d.credits.carnet || d.credits.member ? <div className="kv"><span>Coupes payées d’avance</span><span className="muted">{[d.credits.carnet ? plural(d.credits.carnet, 'carnet', 'carnets') : '', d.credits.member ? plural(d.credits.member, 'abonné', 'abonnés') : ''].filter(Boolean).join(' · ')}</span></div> : null}
            {d.tips ? <div className="kv dm-tips"><span>dont pourboires (aux barbiers)</span><b className="money tnum">{c(d.tips)}</b></div> : null}
            {d.refunds ? <div className="kv"><span>Remboursé</span><b className="money tnum">−{c(d.refunds)}</b></div> : null}
            <p className="faint dm-line">{plural(d.tickets, 'ticket', 'tickets')} · chiffre {c(d.net)}{d.prepaid ? ' · ' + c(d.prepaid) + ' payés d’avance' : ''}</p>
          </>
        )}
      </section>

      {d.staff.length ? (
        <section className="card cs-list" aria-labelledby="dm-staff">
          <div className="card-h"><h2 id="dm-staff"><Icon name="equipe" size={16} />Par barbier</h2></div>
          <ul className="list">{d.staff.map((s) => (
            <li key={s.id} className="li dm-staff">
              <Avatar name={s.name} color={s.color} size="sm" />
              <span className="li-main"><b>{s.name}</b><small>{plural(s.tickets, 'ticket', 'tickets')}{s.tips ? ' · pourboires ' + c(s.tips) : ''}{s.cash ? ' · espèces sur son téléphone ' + c(s.cash) : ''}</small></span>
              <span className="li-end"><b className="money tnum">{c(s.performed)}</b></span>
            </li>
          ))}</ul>
        </section>
      ) : null}

      <HeldCash held={d.held} drawerOpen={d.drawer.open} />

      {anyDeposit ? (
        <section className="card cs-list" aria-labelledby="dm-dep">
          <div className="card-h"><h2 id="dm-dep"><Icon name="globe" size={16} />Acomptes</h2></div>
          <div className="kv"><span>En attente de la visite</span><b className="money tnum">{plural(d.deposits.waiting.n, 'acompte', 'acomptes')} · {c(d.deposits.waiting.amount)}</b></div>
          <div className="kv"><span>Utilisés aujourd’hui</span><b className="money tnum">{c(d.deposits.used.amount)}</b></div>
          <div className="kv"><span>Remboursés aujourd’hui</span><b className="money tnum">{c(d.deposits.refunded.amount)}</b></div>
        </section>
      ) : null}

      {d.members.renewed.length || d.members.failed.length ? (
        <section className="card cs-list" aria-labelledby="dm-mem">
          <div className="card-h"><h2 id="dm-mem"><Icon name="refund" size={16} />Abonnements</h2></div>
          {d.members.renewed.length ? <div className="kv"><span>Renouvelés aujourd’hui</span><b className="money tnum">{d.members.renewed.length} · {c(d.members.renewed.reduce((t, m) => t + m.amount, 0))}</b></div> : null}
          {d.members.failed.length ? (
            <>
              <p className="label dm-line">Paiements refusés à relancer</p>
              <ul className="list">{d.members.failed.map((m) => (
                <li key={m.id}><button type="button" className="li" disabled={!m.clientId} onClick={() => m.clientId && navigate('/clients/' + m.clientId)}>
                  <span className="li-main"><b>{m.name}</b><small>{m.plan} · essai {m.attempt} · depuis le {m.since.split('-').reverse().slice(0, 2).join('/')}</small></span>
                  <span className="li-end"><b className="money tnum">{c(m.amount)}</b><small className="faint">Voir la fiche</small></span>
                </button></li>
              ))}</ul>
            </>
          ) : null}
        </section>
      ) : null}

      {d.giftcards.sold || d.giftcards.used ? (
        <section className="card cs-list" aria-labelledby="dm-gift">
          <div className="card-h"><h2 id="dm-gift"><Icon name="gift" size={16} />Cartes cadeaux</h2></div>
          <div className="kv"><span>Vendues aujourd’hui</span><b className="money tnum">{c(d.giftcards.sold)}</b></div>
          <div className="kv"><span>Utilisées aujourd’hui</span><b className="money tnum">{c(d.giftcards.used)}</b></div>
        </section>
      ) : null}
    </div>
  );
}

/** Cash barbers took on their phone and still hold: shown until each one hands it to the drawer (« Remis à la caisse »). */
export function HeldCash({ held, drawerOpen }: { held: TillDay['held']; drawerOpen: boolean }) {
  const { can } = useApp();
  const [busy, setBusy] = useState('');
  // one request id per handover (barber and amount): a retry after a lost answer, or a double tap, is the same write
  const rids = useRef(new Map<string, string>());
  if (!held.length) return null;
  const hand = async (h: TillDay['held'][number]) => {
    if (!(await confirm({ title: h.name + ' remet ' + c(h.amount) + ' ?', body: 'Les espèces entrent dans le tiroir : le comptage du soir les attend.', ok: 'Remis à la caisse' }))) return;
    if (busy) return;
    const key = h.id + ':' + h.amount;
    if (!rids.current.has(key)) rids.current.set(key, uuid());
    setBusy(h.id);
    try {
      await api.post('/api/v1/drawer/move', { amount: h.amount, reason: 'Espèces remises par ' + h.name, staffId: h.id }, rids.current.get(key));
      toast({ title: c(h.amount) + ' de ' + h.name + ' dans la caisse', icon: 'cash' });
      refreshAll();
    } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  return (
    <section className="card cs-list" aria-labelledby="dm-held" data-guide="cs-held">
      <div className="card-h"><h2 id="dm-held"><Icon name="cash" size={16} />Espèces chez les barbiers</h2><b className="money tnum">{c(held.reduce((t, h) => t + h.amount, 0))}</b></div>
      <ul className="list">{held.map((h) => (
        <li key={h.id} className="li dm-held">
          <span className="li-main"><b>{h.name}</b><small>Encaissées sur son téléphone, pas encore dans le tiroir</small></span>
          <span className="li-end"><b className="money tnum">{c(h.amount)}</b></span>
          {can('drawer') ? <Button size="sm" variant="subtle" busy={busy === h.id} disabled={!drawerOpen} title={drawerOpen ? undefined : 'Ouvre la caisse pour y mettre les espèces'} onClick={() => hand(h)}>Remis à la caisse</Button> : null}
        </li>
      ))}</ul>
      {!drawerOpen && can('drawer') ? <p className="faint dm-line">Ouvre la caisse pour y mettre ces espèces.</p> : null}
    </section>
  );
}

/** The same block on Caisse & clôture, next to the drawer it is counted with. */
export function HeldCashCard() {
  const { can } = useApp();
  const { data } = useQuery<TillDay>(can('sale.all') ? DAY_KEY : null);
  return data ? <HeldCash held={data.held} drawerOpen={data.drawer.open} /> : null;
}
