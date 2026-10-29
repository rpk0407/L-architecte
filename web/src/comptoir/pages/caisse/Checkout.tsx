// The ticket: what was done, who did it, how it is paid. Every amount is computed with the same
// function as the server's, and the request carries one idempotency key, so a double tap never counts twice.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, qs, uuid } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { navigate, useRoute } from '../../../lib/router';
import { dates, dayShortWord, eur, money, rhythmWords, time } from '../../../lib/format';
import { useDebounced, buzz } from '../../../lib/hooks';
import { QR } from '../../../lib/qr';
import { liveMembers } from '../../../lib/members';
import { Icon } from '../../../ui/Icon';
import { Avatar, Button, Chip, Field, Modal, Money, Note, Seg, Sheet, Skeleton, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Appt, ApptService, Boot, ClientCard, ClientFull, Cover, Service } from '../../types';
import { GiftCode, Receipt, Voucher, printNow, type VoucherCard } from './Receipt';
import { LoyaltyDone, RewardChip } from './RewardChip';
import { TillChips } from './TillChips';

type Kind = 'service' | 'product' | 'giftcard' | 'pack' | 'fee';
// base: the price the line starts from (the booked one for an appointment), now: today's catalogue price
type Line = { key: string; kind: Kind; ref: string | null; name: string; qty: number; unit: number; base: number; now: number; booked?: boolean; from: boolean; staffId: string | null; packId: string | null; discount: number; vat: number; recipient?: string; rewardId?: string;
  // PAY-05: the membership that pays the cut (0 €, the month is already paid), what the till said of it, and the cuts the person decided himself
  memberId?: string | null; force?: boolean; memberOff?: boolean; auto?: boolean; cover?: { label: string; note: string; canForce: boolean; retry?: boolean } };
type Pay = { key: string; method: 'card' | 'cash' | 'online' | 'giftcard' | 'deposit' | 'ancien'; amount: number; given?: number; ref?: string; label: string };
const k = () => Math.random().toString(36).slice(2, 9);
/** the badges TillChips shows itself (membership, carnet, loyalty reward: its own plain badge when no reward chip is passed) */
const CHIPPED = ['abonné', 'carnet', 'récompense'];
const METHOD_ICON: Record<string, string> = { card: 'card', cash: 'cash', online: 'qr', giftcard: 'gift', deposit: 'globe', ancien: 'globe' };
/** The test checkout takes no real money: outside the demo, a QR needs Stripe (the server refuses it too). */
export const qrOff = (boot: Pick<Boot, 'mode' | 'providers'>) => boot.mode !== 'demo' && boot.providers.payments === 'simulated';

export function Checkout({ apptId, drawerOpen, onClose }: { apptId: string | null; drawerOpen: boolean; onClose: () => void }) {
  const { boot, staffById, serviceById, can, now } = useApp();
  const S = boot.settings.payments;
  const noQr = qrOff(boot);
  const isBoss = ['owner', 'manager'].includes(boot.me.role);
  const detail = useQuery<{ appt: Appt; client: ClientFull | null; payments: { id: string; kind: string; amount: number; status: string }[] }>(apptId ? '/api/v1/appointments/' + apptId : null);
  const [client, setClient] = useState<ClientCard | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [disc, setDisc] = useState<{ amount: number; reason: string } | null>(null);
  const [tip, setTip] = useState<{ amount: number; staffId: string } | null>(null);
  const [pays, setPays] = useState<Pay[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [modal, setModal] = useState<'' | 'add' | 'discount' | 'cash' | 'qr' | 'gift' | 'client' | 'tip' | 'who'>('');
  const rid = useRef(uuid());
  const loaded = useRef('');

  // an appointment's line starts from the price the client booked at, or today's when it went down (the server agrees)
  const svcLine = (b: ApptService, staffId: string | null): Line => {
    const s = serviceById.get(b.id);
    const cur = s ? s.price : b.price;
    const base = s?.pack ? cur : b.price;
    return { key: k(), kind: s?.pack ? 'pack' : 'service', ref: b.id, name: s?.name || b.name, qty: 1, unit: Math.min(base, cur), base, now: cur, booked: !s?.pack, from: s ? s.from : b.from, staffId, packId: null, discount: 0, vat: s ? s.vat : S.vat };
  };
  // a payment made online on no ticket (Caisse › En ligne, « Encaisser sur un ticket »): the free sale starts paid by it
  const paidOnline = useRoute().query.get('paiement');
  useEffect(() => {
    if (apptId || !paidOnline) return;
    api.get<{ id: string; status: string; amount: number; usedBy: string | null }>('/api/v1/payments/' + encodeURIComponent(paidOnline))
      .then((p) => { if (p.status === 'paid' && !p.usedBy) setPays((ps) => (ps.some((x) => x.ref === p.id) ? ps : [...ps, { key: k(), method: 'online', amount: p.amount, ref: p.id, label: 'Payé en ligne' }])); })
      .catch(toastError);
  }, [apptId, paidOnline]);
  useEffect(() => {
    if (!apptId) { if (loaded.current !== 'free') { loaded.current = 'free'; setLines([]); setClient(null); } return; }
    const d = detail.data;
    if (!d || loaded.current === apptId) return;
    loaded.current = apptId;
    rid.current = uuid();
    setClient(d.client);
    const ls = d.appt.services.map((s) => svcLine(s, d.appt.staffId));
    // a carnet's cut is covered by the carnet, unless the membership pays it (the effect below: the month is already paid)
    for (const l of ls) {
      const pk = d.client?.packs.find((p) => p.used < p.total && (!p.serviceIds.length || p.serviceIds.includes(l.ref!)));
      if (pk) { l.packId = pk.id; l.auto = true; }
    }
    setLines(ls);
    const dep = d.appt.deposit;
    setPays(dep && dep.paid && dep.paymentId ? [{ key: k(), method: 'deposit', amount: dep.paid, ref: dep.paymentId, label: 'Acompte payé en ligne' }] : []);
    setDisc(null); setTip(null); setDone(null);
  }, [apptId, detail.data]);

  // the membership pays a covered cut before any carnet: asked of the server (its rule, not a copy), in the order of the ticket so
  // the third cut of a plan of two is the one that stays priced. A cut the person decided himself (memberOff, a chosen carnet) is left alone.
  const [checking, setChecking] = useState(false);
  const [recheck, setRecheck] = useState(0);
  const member = liveMembers(client?.memberships)[0] || null;
  const sig = lines.map((l) => l.key + ':' + l.ref + ':' + (l.kind === 'service' && !l.memberOff && (!l.packId || l.auto) ? '1' : '0')).join(',') + '|' + (member?.id || '') + '|' + recheck;
  useEffect(() => {
    if (!member) { setLines((ls) => (ls.some((l) => l.memberId || l.cover) ? ls.map((l) => (l.memberId || l.cover ? { ...l, memberId: null, force: false, cover: undefined } : l)) : ls)); return; }
    let alive = true;
    setChecking(true);
    (async () => {
      const patches = new Map<string, Partial<Line>>();
      let covered = 0;
      for (const l of lines) {
        if (l.kind !== 'service' || l.memberOff || (l.packId && !l.auto)) continue;
        // a cut given on purpose stays given, if it was given on this member's plan; it counts on the plan's month as the server counts it
        if (l.force && l.memberId === member.id) { covered++; continue; }
        try {
          const c = await api.get<Cover>('/api/v1/memberships/' + member.id + '/cover' + qs({ serviceId: l.ref, pending: covered }));
          if (c.ok) { covered++; patches.set(l.key, { memberId: member.id, packId: null, force: false, cover: { label: c.label, note: '', canForce: false } }); }
          // a service the plan never covers is simply a priced cut; the other refusals say why (quota, one a week, payment)
          else patches.set(l.key, { memberId: null, force: false, cover: c.why === 'service' || c.why === 'ended' ? undefined : { label: '', note: c.words + ' — encaissée au prix normal', canForce: c.force } });
        // not checked: the cut would go through at full price under the member's chip, so the till says it and waits for a retry
        } catch { patches.set(l.key, { memberId: null, force: false, cover: { label: '', note: 'Abonnement non vérifié : vérifie ta connexion', canForce: false, retry: true } }); }
      }
      if (!alive) return;
      setLines((ls) => ls.map((l) => {
        const p = patches.get(l.key);
        if (!p || l.memberOff || (l.force && l.memberId === member.id && p.cover?.canForce)) return l;
        // back to the carnet the line was attached to when the membership no longer pays it (the carnet pays it: no refusal to show)
        const pk = p.memberId || !l.auto || l.packId ? null : client?.packs.find((x) => x.used < x.total && (!x.serviceIds.length || x.serviceIds.includes(l.ref!)));
        return { ...l, ...p, ...(pk ? { packId: pk.id, cover: undefined } : {}) };
      }));
      setChecking(false);
    })();
    return () => { alive = false; setChecking(false); };
  }, [sig]);

  const paidBy = (l: Line) => !!(l.packId || l.memberId);
  const totals = useMemo(() => money.ticketTotals(lines.map((l) => ({ kind: l.kind, qty: l.qty, unit: paidBy(l) ? 0 : l.unit, discount: l.discount, vat: l.vat })), disc?.amount || 0, tip?.amount || 0), [lines, disc, tip]);
  const paid = pays.reduce((t, p) => t + p.amount, 0);
  const left = totals.due - paid;
  // someone without a chair (the desk) is never credited by default: the appointment's barber, or she says who
  const ownChair = !!staffById.get(boot.me.id)?.chair;
  const performer = lines.find((l) => l.kind === 'service' && l.staffId)?.staffId || detail.data?.appt.staffId || (ownChair ? boot.me.id : null);
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addPay = (p: Omit<Pay, 'key'>) => { setPays((ps) => [...ps, { ...p, key: k() }]); buzz(8); };
  const maxPct = isBoss ? 100 : boot.me.role === 'desk' ? 20 : boot.settings.team.barberMaxDiscountPct;
  // the server refuses the rest: whoever edits every chair's agenda (owner, manager, desk) credits any chair, a barber himself or the appointment's barber
  const performers = (l: Line) => boot.staff.filter((s) => s.active && (s.id === l.staffId || (can('agenda.edit') ? s.chair : s.id === boot.me.id || s.id === detail.data?.appt.staffId)));

  const packOptions = (l: Line) => {
    const out: { id: string; label: string }[] = [];
    for (const p of client?.packs || []) if (p.used < p.total && (!p.serviceIds.length || p.serviceIds.includes(l.ref!))) out.push({ id: p.id, label: p.name + ' · ' + (p.total - p.used) + ' restante' + (p.total - p.used > 1 ? 's' : '') });
    const sold = lines.find((x) => x.kind === 'pack');
    const svc = sold ? serviceById.get(sold.ref!) : null;
    if (svc && svc.pack && (!svc.pack.serviceIds?.length || svc.pack.serviceIds.includes(l.ref!))) out.push({ id: 'new', label: 'Le carnet vendu sur ce ticket' });
    return out;
  };

  const submit = async (ls: Line[] = lines) => {
    if (left !== 0 || !ls.length || checking || ls.some((l) => l.cover?.retry)) return;
    if (ls.some((l) => !l.staffId)) { setModal('who'); return; }
    setBusy(true);
    try {
      const body = {
        apptId: apptId || undefined, clientId: client?.id || undefined,
        lines: ls.map((l) => ({ kind: l.kind, ref: l.ref || undefined, name: l.kind === 'fee' ? l.name : undefined, qty: l.qty, unit: l.kind === 'giftcard' || l.kind === 'fee' || (l.kind === 'service' && !l.packId && !l.memberId) ? l.unit : undefined, discount: l.rewardId ? undefined : l.discount || undefined, rewardId: l.rewardId, staffId: l.staffId || undefined, packId: l.packId || undefined, memberId: l.memberId || undefined, force: l.force || undefined, recipient: l.recipient || undefined })),
        discount: disc && disc.amount ? disc : undefined, tip: tip && tip.amount ? tip : undefined,
        payments: pays.length ? pays.map((p) => ({ method: p.method, amount: p.amount, given: p.given, ref: p.ref })) : [{ method: 'card', amount: 0 }]
      };
      const r = await api.post('/api/v1/sales', body, rid.current);
      buzz([20, 60, 20]);
      // the barber picked in « Qui a fait la prestation ? » is on the lines sent, not yet in `performer`
      setDone({ ...r, client, lines: ls, pays, apptId, staffId: ls.find((l) => l.kind === 'service' && l.staffId)?.staffId ?? performer, habit: detail.data?.appt.start ?? dates.localParts(now()).min });
      refreshAll();
    } catch (e: any) {
      if (e.code === 'drawer_closed') toast({ kind: 'err', title: 'La caisse n’est pas ouverte', sub: can('drawer') ? 'Ouvre-la dans l’onglet « Caisse & clôture » avec le fond de caisse.' : 'Demande au gérant de l’ouvrir, ou encaisse par carte.', icon: 'alert' });
      else toastError(e);
    } finally { setBusy(false); }
  };

  if (apptId && !detail.data) return <div className="card"><div className="col"><Skeleton h={40} w={220} /><Skeleton h={160} /><Skeleton h={90} /></div></div>;
  if (done) return <Done done={done} onNext={onClose} />;
  const appt = detail.data?.appt;

  return (
    <div className="card ticket">
      <div className="tk-head" data-guide="tk-head">
        <div>
          <p className="section-k">{appt ? 'Rendez-vous de ' + time(appt.start) + ' · ' + staffById.get(appt.staffId)?.name : 'Vente libre'}</p>
          <h2>{client ? client.first + ' ' + client.last : appt ? appt.name : 'Nouveau ticket'}</h2>
        </div>
        <div className="row">
          {!apptId ? <Button size="sm" variant="ghost" icon="user" onClick={() => setModal('client')}>{client ? 'Changer de client' : 'Associer un client'}</Button> : null}
          <Button size="sm" variant="ghost" icon="x" onClick={async () => { if (!lines.length || await confirm({ title: 'Abandonner ce ticket ?', ok: 'Abandonner', danger: true })) onClose(); }}>Fermer</Button>
        </div>
      </div>
      {appt && (appt.paidOld || appt.note) ? <Note icon="info"><span data-guide="tk-old">{appt.paidOld ? <b>Acompte de {eur(appt.paidOld, { decimals: appt.paidOld % 100 !== 0 })} déjà payé sur l’ancien site.</b> : null}{appt.paidOld && appt.note ? ' ' : ''}{appt.note ? <>Note : « {appt.note} »</> : null}</span></Note> : null}
      {client?.badges.length ? <div className="row wrap" style={{ gap: 6, marginTop: -6 }}>{client.badges.filter((b) => !CHIPPED.includes(b)).map((b) => <span key={b} className={'badge ' + (b === 'fidèle' ? 'badge-ok' : b === 'nouveau' ? 'badge-info' : '')}>{b}</span>)}<TillChips client={client} />{client.visits ? <span className="badge">{client.visits} visite{client.visits > 1 ? 's' : ''} · {rhythmWords(client.cadence)}</span> : null}</div> : null}
      <RewardChip client={client} lines={lines} setLines={setLines} />

      <div className="tk-lines" data-guide="tk-lines">
        {!lines.length ? <p className="muted" style={{ padding: '10px 4px' }}>Ajoute une prestation, un produit ou une carte cadeau.</p> : null}
        {lines.map((l) => {
          const opts = l.kind === 'service' ? packOptions(l) : [];
          const st = l.staffId ? staffById.get(l.staffId) : null;
          const net = paidBy(l) ? 0 : l.unit * l.qty - l.discount;
          return (
            <div key={l.key} className="tk-line" data-guide={l.memberId ? 'till-member-line' : undefined}>
              <button type="button" className="tk-main" onClick={() => setOpen(open === l.key ? null : l.key)} aria-expanded={open === l.key}>
                {st ? <Avatar name={st.name} initials={st.initials} color={st.color} size="sm" /> : <span className="av av-sm" style={{ ['--c' as any]: 'var(--panel3)' }}><Icon name={l.kind === 'giftcard' ? 'gift' : 'box'} size={14} /></span>}
                <span className="nm"><b>{l.qty > 1 ? l.qty + ' × ' : ''}{l.name}{l.rewardId ? ' · fidélité' : ''}</b><small>{l.memberId ? (l.cover?.label || 'Abonnement') + (st ? ' · par ' + st.name : ' · Qui l’a fait ? À choisir') : l.packId ? 'Couvert par le carnet' : l.kind === 'giftcard' ? (l.recipient || 'Carte cadeau') + ' · valable 1 an' : st ? 'par ' + st.name : 'Qui l’a fait ? À choisir'}{l.discount ? (l.rewardId ? ' · fidélité −' : ' · remise ') + eur(l.discount) : ''}</small>{l.booked && !paidBy(l) && l.base !== l.now ? <small style={{ color: 'var(--warn-tx)' }}>Réservé à {eur(l.base, { decimals: l.base % 100 !== 0 })} (prix actuel {eur(l.now, { decimals: l.now % 100 !== 0 })})</small> : null}{l.cover?.note ? <small className="tk-refused" role="status">{l.cover.note}</small> : null}</span>
              </button>
              <span className="pr"><Money cents={net} />{paidBy(l) || l.discount ? <s><Money cents={l.unit * l.qty} /></s> : null}</span>
              {l.cover?.retry ? <button type="button" className="link tk-force" onClick={() => setRecheck((n) => n + 1)}>Réessayer</button> : null}
              {l.cover?.canForce && !l.memberId && can('member.manage') ? <button type="button" className="link tk-force" onClick={() => update(l.key, { memberId: member?.id, force: true, packId: null, cover: { label: 'Offerte hors forfait · ' + l.cover!.note.split(' — ')[0], note: '', canForce: false } })}>L’offrir quand même</button> : null}
              {open === l.key ? (
                <div className="ed">
                  {l.kind === 'product' ? <div className="row"><span className="muted grow">Quantité</span><span className="qty"><Button size="sm" icon="minus" aria-label="Moins" onClick={() => update(l.key, { qty: Math.max(1, l.qty - 1) })} /><b>{l.qty}</b><Button size="sm" icon="plus" aria-label="Plus" onClick={() => update(l.key, { qty: Math.min(99, l.qty + 1) })} /></span></div> : null}
                  {l.kind === 'service' && (l.from || isBoss) && !paidBy(l) ? <PriceField l={l} isBoss={isBoss} onUnit={(unit) => update(l.key, { unit })} /> : null}
                  {l.kind !== 'giftcard' || !ownChair ? (
                    <div className="col" style={{ gap: 8 }}><span className="label">{l.kind === 'giftcard' ? 'Vendue par' : 'Réalisé par'}</span><div className="chips">{performers(l).map((s) => <Chip key={s.id} small dot={s.color} on={l.staffId === s.id} onClick={() => update(l.key, { staffId: s.id })}>{s.name}</Chip>)}</div></div>
                  ) : null}
                  {opts.length || (member && l.kind === 'service') ? <div className="col" style={{ gap: 8 }}><span className="label">Incluse dans</span><div className="chips"><Chip small on={!l.packId && !l.memberId} onClick={() => update(l.key, { packId: null, memberId: null, force: false, memberOff: true, auto: false, cover: undefined })}>Rien : la payer</Chip>{member && l.kind === 'service' ? <Chip small on={!!l.memberId} onClick={() => update(l.key, l.memberId ? { memberOff: false } : { memberOff: false, packId: null, auto: true, cover: undefined })}>Abonnement {member.plan}</Chip> : null}{opts.map((o) => <Chip key={o.id} small on={l.packId === o.id} onClick={() => update(l.key, { packId: o.id, memberId: null, force: false, memberOff: true, auto: false, cover: undefined })}>{o.label}</Chip>)}</div></div> : null}
                  <div className="row"><span className="grow" /><Button size="sm" variant="danger" icon="trash" onClick={() => { setLines(lines.filter((x) => x.key !== l.key)); setOpen(null); }}>Retirer</Button></div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="tk-add" data-guide="tk-add">
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setModal('add')}>Ajouter</Button>
        {can('sale.discount') ? <Button size="sm" variant="ghost" icon="percent" onClick={() => setModal('discount')} disabled={!lines.length}>{disc ? 'Remise ' + eur(disc.amount) : 'Remise'}</Button> : null}
        {S.tips ? <Button size="sm" variant="ghost" icon="heart" onClick={() => setModal('tip')} disabled={!lines.length}>{tip ? 'Pourboire ' + eur(tip.amount) : 'Pourboire'}</Button> : null}
      </div>

      <div className="tk-sum">
        {totals.discount ? <div className="kv"><span>Remise{disc?.reason ? ' · ' + disc.reason : ''}</span><b className="money">−{eur(totals.discount)}</b></div> : null}
        {totals.vat.map((v) => <div key={v.rate} className="kv"><span>dont TVA {v.rate / 100} %</span><span className="money tnum">{eur(v.tax, { decimals: true })}</span></div>)}
        {totals.liability ? <div className="kv"><span>Cartes cadeaux (hors TVA)</span><span className="money">{eur(totals.liability)}</span></div> : null}
        {totals.tip ? <div className="kv"><span>Pourboire · {staffById.get(tip!.staffId)?.name}</span><span className="money">{eur(totals.tip)}</span></div> : null}
        <div className="tk-total"><span>À payer</span><b className="money tnum">{eur(totals.due, { decimals: totals.due % 100 !== 0 })}</b></div>
      </div>

      {pays.length ? <div className="pays">{pays.map((p) => (
        <div key={p.key} className="pay"><Icon name={METHOD_ICON[p.method]} /><span className="grow">{p.label}{p.given ? <small>Reçu {eur(p.given, { decimals: true })} · rendu {eur(p.given - p.amount, { decimals: true })}</small> : null}</span><Money cents={p.amount} decimals={p.amount % 100 !== 0} />{p.method !== 'online' && p.method !== 'deposit' ? <Button size="sm" icon="x" aria-label="Retirer ce paiement" onClick={() => setPays(pays.filter((x) => x.key !== p.key))} /> : null}</div>
      ))}</div> : null}

      {left > 0 ? (
        <>
          <div className="remaining"><span>{pays.length ? 'Reste à payer' : 'Comment paie-t-il ?'}</span><b className="money tnum">{eur(left, { decimals: left % 100 !== 0 })}</b></div>
          <div className="methods" data-guide="tk-methods">
            <button type="button" className="method" disabled={!S.card} onClick={() => addPay({ method: 'card', amount: left, label: 'Carte · terminal' })}><Icon name="card" /><span><b>Carte</b><small>Terminal de paiement</small></span></button>
            <button type="button" className="method" disabled={!S.cash} onClick={() => setModal('cash')}><Icon name="cash" /><span><b>Espèces</b><small>{drawerOpen ? 'Calcule la monnaie' : 'Caisse fermée'}</small></span></button>
            <button type="button" className="method" disabled={!S.qr || noQr} onClick={() => setModal('qr')}><Icon name="qr" /><span><b>QR code</b><small>{noQr ? 'Branche Stripe pour le QR' : 'Apple Pay, carte'}</small></span></button>
            <button type="button" className="method" disabled={!S.giftcard || lines.some((l) => l.kind === 'giftcard')} onClick={() => setModal('gift')}><Icon name="gift" /><span><b>Carte cadeau</b><small>Saisir le code</small></span></button>
            {/* an imported booking with a deposit paid on the old site: once, never more than was paid there */}
            {appt?.paidOld && !pays.some((p) => p.method === 'ancien') ? <button type="button" className="method" data-method="ancien" onClick={() => addPay({ method: 'ancien', amount: Math.min(appt.paidOld!, left), label: 'Payé sur l’ancien site' })}><Icon name="globe" /><span><b>Payé sur l’ancien site</b><small>{eur(appt.paidOld, { decimals: appt.paidOld % 100 !== 0 })} déjà payés</small></span></button> : null}
          </div>
        </>
      ) : left < 0 ? <Note tone="warn" icon="alert">Les paiements dépassent le total de {eur(-left)}. Retire un paiement.</Note> : null}

      <Button variant="primary" size="xl" block data-guide="tk-validate" busy={busy || checking} disabled={left !== 0 || !lines.length || lines.some((l) => l.cover?.retry)} onClick={() => submit()} icon="check">{left === 0 && lines.length ? 'Valider l’encaissement · ' + eur(totals.due) : 'Encaisser'}</Button>

      <AddSheet open={modal === 'add'} onClose={() => setModal('')} onAdd={(ls) => { setLines((x) => { const next = [...x, ...ls]; if (ls.some((l) => l.kind === 'pack')) { const svc = serviceById.get(ls.find((l) => l.kind === 'pack')!.ref!); const cut = next.find((l) => l.kind === 'service' && !l.packId && !l.memberId && (!svc?.pack?.serviceIds?.length || svc.pack.serviceIds.includes(l.ref!))); if (cut) cut.packId = 'new'; } return next; }); setModal(''); }} performer={performer} />
      <DiscountModal open={modal === 'discount'} onClose={() => setModal('')} gross={lines.filter((l) => l.kind !== 'giftcard' && !paidBy(l)).reduce((t, l) => t + l.unit * l.qty - l.discount, 0)} maxPct={maxPct} value={disc} onSet={(d) => { setDisc(d); setModal(''); }} />
      <TipModal open={modal === 'tip'} onClose={() => setModal('')} presets={S.tipPresets} staffId={tip?.staffId || performer || ''} value={tip} onSet={(t) => { setTip(t); setModal(''); }} />
      <WhoModal open={modal === 'who'} onClose={() => setModal('')} onPick={(id) => { const next = lines.map((l) => (l.staffId ? l : { ...l, staffId: id })); setLines(next); setModal(''); submit(next); }} />
      <CashModal open={modal === 'cash'} onClose={() => setModal('')} due={left} drawerOpen={drawerOpen} onPay={(amount, given) => { addPay({ method: 'cash', amount, given, label: 'Espèces' }); setModal(''); }} />
      {/* the label lands in the chained journal: the salon's name, never the client's */}
      <QrModal open={modal === 'qr'} onClose={() => setModal('')} amount={left} label={boot.settings.shop.name} onPaid={(id, amount) => { addPay({ method: 'online', amount, ref: id, label: 'Payé par QR code' }); setModal(''); }} />
      <GiftModal open={modal === 'gift'} onClose={() => setModal('')} due={left} onPay={(amount, code, last4) => { addPay({ method: 'giftcard', amount, ref: code, label: 'Carte cadeau •••• ' + last4 }); setModal(''); }} />
      <ClientSheet open={modal === 'client'} onClose={() => setModal('')} onPick={(c) => { setClient(c); setModal(''); }} />
    </div>
  );
}

/* ---------------- adding items ---------------- */

function AddSheet({ open, onClose, onAdd, performer }: { open: boolean; onClose: () => void; onAdd: (l: Line[]) => void; performer: string | null }) {
  const { boot } = useApp();
  const [tab, setTab] = useState<'svc' | 'prd' | 'gift' | 'pack'>('svc');
  const [amount, setAmount] = useState(5000);
  const [to, setTo] = useState('');
  const svc = boot.services.filter((s) => s.active && !s.pack);
  const packs = boot.services.filter((s) => s.active && s.pack);
  const products = boot.products.filter((p) => p.active);
  return (
    <Sheet open={open} onClose={onClose} title="Ajouter" kicker="Au ticket">
      <Seg value={tab} onChange={setTab} options={[{ v: 'svc', t: 'Prestation' }, { v: 'prd', t: 'Produit' }, { v: 'gift', t: 'Carte cadeau' }, ...(packs.length ? [{ v: 'pack' as const, t: 'Carnet' }] : [])]} />
      {tab === 'svc' ? <div className="pick">{svc.map((s) => <button key={s.id} type="button" className="pick-r" onClick={() => onAdd([{ key: k(), kind: 'service', ref: s.id, name: s.name, qty: 1, unit: s.price, base: s.price, now: s.price, from: s.from, staffId: performer, packId: null, discount: 0, vat: s.vat }])}><span className="li-main"><b>{s.name}</b><small>{s.category} · {dates.fmtDur(s.dur)}</small></span><b className="money">{s.from ? 'dès ' : ''}{eur(s.price)}</b></button>)}</div> : null}
      {tab === 'prd' ? <div className="pick">{products.map((p) => <button key={p.id} type="button" className="pick-r" onClick={() => onAdd([{ key: k(), kind: 'product', ref: p.id, name: p.name, qty: 1, unit: p.price, base: p.price, now: p.price, from: false, staffId: performer, packId: null, discount: 0, vat: p.vat }])}><span className="li-main"><b>{p.name}</b><small>{p.stock <= 0 ? 'Rupture de stock' : p.stock <= p.low ? 'Plus que ' + p.stock + ' en stock' : p.stock + ' en stock'}</small></span><b className="money">{eur(p.price)}</b></button>)}</div> : null}
      {tab === 'gift' ? (
        <div className="col" style={{ gap: 14 }}>
          <div className="chips">{[2000, 3000, 5000, 8000, 10000].map((a) => <Chip key={a} on={amount === a} onClick={() => setAmount(a)}>{eur(a)}</Chip>)}</div>
          <Field label="Pour qui ?" htmlFor="gc-to" hint="Imprimé sur la carte"><input id="gc-to" className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Ex. : Pour Karim, joyeux anniversaire" maxLength={60} /></Field>
          <Note icon="info">Une carte cadeau n’est pas du chiffre d’affaires : la TVA est due quand elle est utilisée. Valable 1 an, code unique imprimé sur le ticket.</Note>
          <Button variant="primary" onClick={() => onAdd([{ key: k(), kind: 'giftcard', ref: null, name: 'Carte cadeau', qty: 1, unit: amount, base: amount, now: amount, from: false, staffId: performer, packId: null, discount: 0, vat: 0, recipient: to }])}>Ajouter la carte de {eur(amount)}</Button>
        </div>
      ) : null}
      {tab === 'pack' ? <div className="pick">{packs.map((s) => <button key={s.id} type="button" className="pick-r" onClick={() => onAdd([{ key: k(), kind: 'pack', ref: s.id, name: s.name, qty: 1, unit: s.price, base: s.price, now: s.price, from: false, staffId: performer, packId: null, discount: 0, vat: s.vat }])}><span className="li-main"><b>{s.name}</b><small>{s.pack!.credits} prestations · valable {Math.round(s.pack!.days / 7)} semaines</small></span><b className="money">{eur(s.price)}</b></button>)}<Note icon="info">La coupe d’aujourd’hui est déduite du carnet.</Note></div> : null}
    </Sheet>
  );
}

/** Asked once before validating when a line has nobody to credit (a sale rung up at the desk): the chairs, or herself. */
function WhoModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (staffId: string) => void }) {
  const { boot } = useApp();
  const chairs = boot.staff.filter((s) => s.active && s.chair);
  const me = boot.staff.find((s) => s.id === boot.me.id);
  return (
    <Modal open={open} onClose={onClose} label="Qui a fait la prestation ?">
      <h2>Qui a fait la prestation ?</h2>
      <p>Le chiffre et la commission vont à la personne choisie.</p>
      <div className="chips">{chairs.map((s) => <Chip key={s.id} dot={s.color} onClick={() => onPick(s.id)}>{s.name}</Chip>)}{me && !me.chair ? <Chip onClick={() => onPick(me.id)}>Moi · {me.name}</Chip> : null}</div>
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button></div>
    </Modal>
  );
}

/** The price of a service line: the lower of the booked and today's prices, the steps of a "dès" price, or either price (or any amount) for the owner. */
function PriceField({ l, isBoss, onUnit }: { l: Line; isBoss: boolean; onUnit: (unit: number) => void }) {
  const moved = l.base !== l.now;
  const floor = Math.min(l.base, l.now);
  // a barber never charges a booked client more than he booked for, nor more than today's price
  const opts = [...new Set([...(isBoss ? [l.base, l.now] : [floor]), ...(l.from ? [1000, 2000, 3000].map((x) => floor + x) : [])])];
  const label = (v: number) => (moved && v === l.base ? 'Réservé ' : moved && v === l.now ? 'Actuel ' : '') + eur(v, { decimals: v % 100 !== 0 });
  return (
    <Field label={l.from ? 'Prix (dès ' + eur(floor) + ')' : 'Prix'} htmlFor={'u' + l.key}>
      <div className="chips">{opts.map((v) => <Chip key={v} small on={l.unit === v} onClick={() => onUnit(v)}>{label(v)}</Chip>)}
        {isBoss || l.from ? <input id={'u' + l.key} className="input" style={{ width: 110, minHeight: 32 }} inputMode="decimal" placeholder="Autre" onBlur={(e) => { const v = money.parseEur(e.target.value); if (v != null && (isBoss || v >= floor)) onUnit(v); }} /> : null}</div>
    </Field>
  );
}

// the same list as DISCOUNT_REASONS (server/commands/sales.js): a reason outside it is kept out of the chain
const REASONS = ['Fidélité', 'Ami de la maison', 'Geste commercial', 'Retard du salon', 'Étudiant'];
const OTHER = 'Autre raison';

function DiscountModal({ open, onClose, gross, maxPct, value, onSet }: { open: boolean; onClose: () => void; gross: number; maxPct: number; value: { amount: number; reason: string } | null; onSet: (d: { amount: number; reason: string } | null) => void }) {
  // the field keeps what is typed ("2,", "2,5"): it is read as an amount, never rewritten while typing
  const [txt, setTxt] = useState('');
  const [reason, setReason] = useState('Fidélité');
  const [other, setOther] = useState('');
  const fmt = (c: number) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
  useEffect(() => {
    if (!open) return;
    const r = value?.reason || 'Fidélité';
    setTxt(fmt(value?.amount || 0));
    setReason(REASONS.includes(r) ? r : OTHER); setOther(REASONS.includes(r) ? '' : r);
  }, [open]);
  const typed = money.parseEur(txt);
  const amount = typed == null || typed < 0 ? 0 : Math.min(typed, gross);
  const pcts = [5, 10, 15, 20, 50].filter((p) => p <= maxPct);
  // a round amount off is how a barber says it ("5 € de remise"), within what the role allows
  const cap = Math.floor((gross * maxPct) / 100);
  const euros = [200, 500, 1000].filter((c) => c <= cap);
  const pct = gross ? (amount * 100) / gross : 0;
  const why = reason === OTHER ? other.trim() : reason;
  return (
    <Modal open={open} onClose={onClose} label="Remise">
      <h2>Une remise</h2>
      <p>{maxPct >= 100 ? 'Sans plafond pour ton rôle.' : 'Jusqu’à ' + maxPct + ' % pour ton rôle.'} Chaque remise est tracée avec sa raison.</p>
      <div className="chips">
        {pcts.map((p) => { const c = Math.round((gross * p) / 100 / 50) * 50; return <Chip key={p} on={!!amount && amount === c} onClick={() => setTxt(fmt(c))}>{p} %</Chip>; })}
        {euros.map((c) => <Chip key={'e' + c} on={amount === c} onClick={() => setTxt(fmt(c))}>{eur(c)}</Chip>)}
      </div>
      <Field label="Montant" htmlFor="dc-a"><input id="dc-a" className="input input-money" inputMode="decimal" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => { if (typed != null) setTxt(fmt(amount)); }} placeholder="0,00" autoComplete="off" /></Field>
      {txt.trim() && typed == null ? <Note tone="warn" icon="alert">Un montant en euros, par exemple 2,50.</Note> : null}
      <div className="chips">{[...REASONS, OTHER].map((r) => <Chip key={r} small on={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>
      {reason === OTHER ? <Field label="Raison" htmlFor="dc-r" hint="Reste au salon : le reçu du client indique « Autre »."><input id="dc-r" className="input" value={other} onChange={(e) => setOther(e.target.value)} maxLength={40} placeholder="Ex. : coupe de l’enfant offerte" data-autofocus /></Field> : null}
      {pct > maxPct + 0.01 ? <Note tone="err" icon="alert">C’est au-dessus de ta limite ({maxPct} %).</Note> : null}
      <div className="acts">{value ? <Button variant="ghost" onClick={() => onSet(null)}>Retirer la remise</Button> : null}<Button variant="primary" disabled={!amount || pct > maxPct + 0.01 || !why} onClick={() => onSet({ amount, reason: why })}>Appliquer −{eur(amount, { decimals: amount % 100 !== 0 })}</Button></div>
    </Modal>
  );
}

function TipModal({ open, onClose, presets, staffId, value, onSet }: { open: boolean; onClose: () => void; presets: number[]; staffId: string; value: { amount: number; staffId: string } | null; onSet: (t: { amount: number; staffId: string } | null) => void }) {
  const { boot } = useApp();
  const [who, setWho] = useState(staffId);
  const [custom, setCustom] = useState('');
  useEffect(() => { if (open) { setWho(value?.staffId || staffId); setCustom(''); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} label="Pourboire">
      <h2>Un pourboire</h2>
      <p>Il revient entièrement au barbier, hors chiffre d’affaires et hors TVA.</p>
      <div className="chips">{boot.staff.filter((s) => s.active && s.chair).map((s) => <Chip key={s.id} small dot={s.color} on={who === s.id} onClick={() => setWho(s.id)}>{s.name}</Chip>)}</div>
      <div className="quick">{presets.map((p) => <button key={p} type="button" disabled={!who} onClick={() => onSet({ amount: p, staffId: who })}>{eur(p)}</button>)}<button type="button" onClick={() => onSet(null)}>Aucun</button></div>
      <div className="row"><input className="input" inputMode="decimal" placeholder="Autre montant" value={custom} onChange={(e) => setCustom(e.target.value)} /><Button variant="primary" disabled={!who || !money.parseEur(custom)} onClick={() => onSet({ amount: money.parseEur(custom)!, staffId: who })}>OK</Button></div>
    </Modal>
  );
}

function CashModal({ open, onClose, due, drawerOpen, onPay }: { open: boolean; onClose: () => void; due: number; drawerOpen: boolean; onPay: (amount: number, given: number) => void }) {
  const { can } = useApp();
  const [txt, setTxt] = useState('');
  const [float, setFloat] = useState('150');
  const [opening, setOpening] = useState(false);
  const [isOpen, setIsOpen] = useState(drawerOpen);
  useEffect(() => { if (open) { setTxt(''); setIsOpen(drawerOpen); } }, [open, drawerOpen]);
  const given = money.parseEur(txt || '') ?? 0;
  const amount = Math.min(given, due);
  const press = (d: string) => setTxt((t) => (d === '⌫' ? t.slice(0, -1) : d === ',' ? (t.includes(',') ? t : (t || '0') + ',') : (t + d).replace(/^0(\d)/, '$1').replace(/,(\d{2})\d+$/, ',$1')));
  const quick = [due, Math.ceil(due / 500) * 500, Math.ceil(due / 1000) * 1000, Math.ceil(due / 2000) * 2000, 5000, 10000].filter((v, i, a) => v >= due && a.indexOf(v) === i).slice(0, 4);
  const openDrawer = async () => {
    setOpening(true);
    try { await api.post('/api/v1/drawer/open', { float: money.parseEur(float) || 0 }); setIsOpen(true); refreshAll(); toast('Caisse ouverte'); } catch (e) { toastError(e); } finally { setOpening(false); }
  };
  return (
    <Modal open={open} onClose={onClose} label="Paiement en espèces">
      <h2>Espèces</h2>
      {!isOpen ? (can('drawer') ? (
        <>
          <p>La caisse n’est pas encore ouverte aujourd’hui. Compte le fond de caisse, puis ouvre-la.</p>
          <Field label="Fond de caisse" htmlFor="fl"><input id="fl" className="input input-money" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} /></Field>
          <div className="acts"><Button variant="primary" busy={opening} onClick={openDrawer}>Ouvrir la caisse</Button></div>
        </>
      ) : <Note tone="warn" icon="alert">La caisse n’est pas ouverte. Demande au gérant de l’ouvrir, ou encaisse par carte.</Note>) : (
        <>
          <p>À payer : <b style={{ color: 'var(--tx)' }}>{eur(due, { decimals: true })}</b>. Combien te donne-t-il ?</p>
          <div className="quick">{quick.map((q) => <button key={q} type="button" onClick={() => setTxt((q / 100).toFixed(2).replace('.', ','))}>{q === due ? 'Le compte' : eur(q)}</button>)}</div>
          <div className="cash-input money tnum" aria-live="polite">{txt ? txt + ' €' : '0 €'}</div>
          <div className="keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((d) => <button key={d} type="button" className={d === '⌫' || d === ',' ? 'fn' : ''} onClick={() => press(d)} aria-label={d === '⌫' ? 'Effacer' : d}>{d}</button>)}</div>
          {given >= due ? <div className="change"><span>À rendre</span><b className="tnum">{eur(given - due, { decimals: true })}</b></div> : given > 0 ? <Note icon="info">Paiement partiel : il restera {eur(due - given, { decimals: true })} à régler autrement.</Note> : null}
          <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!given} onClick={() => onPay(amount, Math.max(given, amount))}>Valider {eur(amount, { decimals: amount % 100 !== 0 })}</Button></div>
        </>
      )}
    </Modal>
  );
}

function QrModal({ open, onClose, amount, label, onPaid }: { open: boolean; onClose: () => void; amount: number; label: string; onPaid: (id: string, amount: number) => void }) {
  const [p, setP] = useState<{ id: string; url: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) { setP(null); return; }
    let alive = true;
    api.post<{ id: string; url: string }>('/api/v1/payments/qr', { amount, label }).then((r) => { if (alive) setP(r); }).catch((e) => setErr(e.message));
    return () => { alive = false; };
  }, [open]);
  useEffect(() => {
    if (!p) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await api.get<{ status: string }>('/api/v1/payments/' + p.id);
        if (!alive) return;
        if (r.status === 'paid') { buzz([20, 60, 20]); toast({ title: 'Paiement reçu · ' + eur(amount), icon: 'check' }); onPaid(p.id, amount); return; }
        if (r.status === 'failed' || r.status === 'expired') { setErr('Le paiement a été abandonné.'); return; }
      } catch { /* retry */ }
      if (alive) setTimeout(poll, 2000);
    };
    const t = setTimeout(poll, 2000);
    return () => { alive = false; clearTimeout(t); };
  }, [p]);
  return (
    <Modal open={open} onClose={onClose} label="Paiement par QR code">
      <h2>{eur(amount, { decimals: amount % 100 !== 0 })}</h2>
      <p>Le client scanne avec son téléphone et paie avec Apple Pay, Google Pay ou sa carte. L’écran passe au vert tout seul.</p>
      <div style={{ display: 'grid', placeItems: 'center', padding: 8 }}>{p ? <QR text={p.url} size={240} label="QR code de paiement" /> : err ? null : <Skeleton h={240} w={240} r={16} />}</div>
      {err ? <Note tone="err" icon="alert">{err}</Note> : <p className="row" style={{ justifyContent: 'center', gap: 10 }}><span className="spin" />En attente du paiement…</p>}
      <div className="acts">{p ? <a className="btn btn-ghost btn-sm" href={p.url} target="_blank" rel="noopener">Ouvrir ici</a> : null}<Button variant="ghost" onClick={onClose}>Fermer</Button></div>
    </Modal>
  );
}

function GiftModal({ open, onClose, due, onPay }: { open: boolean; onClose: () => void; due: number; onPay: (amount: number, code: string, last4: string) => void }) {
  const [code, setCode] = useState('');
  const [card, setCard] = useState<{ balance: number; expires: string; last4: string; status: string; expired: boolean } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setCode(''); setCard(null); setErr(''); } }, [open]);
  const check = async () => {
    setErr(''); setCard(null);
    try { setCard(await api.get('/api/v1/giftcards/check' + qs({ code }))); } catch (e: any) { setErr(e.message); }
  };
  const usable = card && card.status === 'active' && !card.expired ? Math.min(card.balance, due) : 0;
  return (
    <Modal open={open} onClose={onClose} label="Carte cadeau">
      <h2>Carte cadeau</h2>
      <div className="row"><input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && check()} style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: '.06em' }} /><Button variant="solid" onClick={check} disabled={code.replace(/[^A-Z0-9]/g, '').length < 12}>Vérifier</Button></div>
      {err ? <Note tone="err" icon="alert">{err}</Note> : null}
      {card ? (card.expired || card.status !== 'active' ? <Note tone="err" icon="alert">Carte {card.status !== 'active' ? 'annulée' : 'expirée le ' + card.expires.split('-').reverse().join('/')}.</Note> : <Note tone="ok" icon="gift">Solde {eur(card.balance, { decimals: true })} · valable jusqu’au {card.expires.split('-').reverse().join('/')}</Note>) : null}
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!usable} onClick={() => onPay(usable, code, card!.last4)}>Utiliser {eur(usable, { decimals: usable % 100 !== 0 })}</Button></div>
    </Modal>
  );
}

function ClientSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: ClientCard) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 180);
  const r = useQuery<{ items: ClientCard[] }>(open && dq.trim().length >= 2 ? '/api/v1/clients' + qs({ q: dq, limit: 8 }) : null);
  return (
    <Sheet open={open} onClose={onClose} title="Associer un client">
      <div className="search"><Icon name="search" /><input className="input" placeholder="Prénom, nom ou numéro" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus /></div>
      <div className="pick">{r.data?.items.map((c) => <button key={c.id} type="button" className="pick-r" onClick={() => onPick(c)}><Avatar name={c.name} size="sm" /><span className="li-main"><b>{c.first} {c.last}</b><small>{c.phone}</small></span>{c.packs.length ? <span className="badge badge-ok">abonné</span> : null}</button>)}</div>
    </Sheet>
  );
}

/* ---------------- after payment ---------------- */

// a colour or a transformation has no rhythm of its own: the next visit is the next cut, not the same service.
// Read from the names until the catalogue carries a per-service "no rebooking" flag.
const NO_RHYTHM = /colo|d[ée]co|couleur|transfo|changer de t[êe]te|silver|m[èe]ches?|balayage|ombr[ée]|teinture|henn[ée]|lissage|d[ée]frisage|permanente|blond/i;
// the weeks behind rhythmWords' words, so the heading and the first suggestion always agree
const rhythmWeeks = (days: number) => (days < 10 ? 1 : days <= 17 ? 2 : days <= 24 ? 3 : days <= 31 ? 4 : Math.round(days / 7));
const rhythmFree = (s: Service | undefined) => !!s && NO_RHYTHM.test(s.category + ' ' + s.name);
type Slots = { days: { day: string; slots: { m: number; s: string }[] }[] };

function Done({ done, onNext }: { done: any; onNext: () => void }) {
  const { boot, staffById, serviceById, can } = useApp();
  const [sent, setSent] = useState(false);
  const [booked, setBooked] = useState('');
  // what the printer gets: the ticket, or one gift card's voucher
  const [voucher, setVoucher] = useState<VoucherCard | null>(null);
  useEffect(() => { const off = () => setVoucher(null); window.addEventListener('afterprint', off); return () => window.removeEventListener('afterprint', off); }, []);
  const c: ClientCard | null = done.client;
  // a new client has no rhythm yet: 3 weeks is a proposal, not a fact
  const known = !!c?.cadence;
  const weeks = known ? rhythmWeeks(c!.cadence!) : 3;
  // the same weekday as today, three weeks in a row: people keep their day as much as their hour
  const targets = [0, 1, 2].map((i) => dates.addDays(boot.today, (weeks + i) * 7));
  const serviceIds = (done.lines as Line[]).filter((l) => l.kind === 'service' && !rhythmFree(serviceById.get(l.ref!))).map((l) => l.ref!).slice(0, 2);
  const ask = !!c && !!serviceIds.length && can('agenda.own');
  // with the same barber; a sale rung up by someone without a chair (the owner at the desk) looks at every chair
  const staff = staffById.get(done.staffId)?.chair ? done.staffId : 'any';
  const url = (day: string) => (ask ? '/api/v1/slots' + qs({ day, services: serviceIds.join(','), staff, days: 1 }) : null);
  const w0 = useQuery<Slots>(url(targets[0])), w1 = useQuery<Slots>(url(targets[1])), w2 = useQuery<Slots>(url(targets[2]));
  const loading = [w0, w1, w2].some((q) => q.loading && !q.data);
  // one suggestion per week, at the hour he came today (or was booked for)
  const habit: number = done.habit;
  const picks = [w0, w1, w2].flatMap((q) => q.data?.days || []).filter((d) => d.slots.length).map((d) => {
    const best = d.slots.reduce((a, x) => (Math.abs(x.m - habit) < Math.abs(a.m - habit) ? x : a));
    return { day: d.day, ...best };
  });
  const sale = useQuery<any>('/api/v1/sales/' + done.id);
  const book = async (p: { day: string; m: number; s: string }) => {
    try { await api.post('/api/v1/appointments', { clientId: c!.id, serviceIds, staffId: p.s, day: p.day, start: p.m, sms: true, source: 'salon' }); setBooked(dayShortWord(p.day, boot.today) + ' à ' + time(p.m)); refreshAll(); buzz(10); }
    catch (e) { toastError(e); }
  };
  return (
    <div className="card done">
      <span className="ok"><Icon name="check" /></span>
      <h2>Encaissé · <span className="money">{eur(done.totals.due, { decimals: done.totals.due % 100 !== 0 })}</span></h2>
      <p className="muted">Ticket T{String(done.number).padStart(6, '0')}{c ? ' · ' + c.first : ''}</p>
      <LoyaltyDone client={c} saleId={done.id} />
      {done.change ? <div className="change" style={{ minWidth: 260 }}><span>Monnaie à rendre</span><b className="tnum">{eur(done.change, { decimals: true })}</b></div> : null}
      {(done.giftcards as VoucherCard[] | undefined)?.map((g) => <GiftCode key={g.code} card={g} from={c?.first} onPrint={() => { setVoucher(g); printNow(); }} />)}
      <div className="row wrap" style={{ justifyContent: 'center' }}>
        {c?.hasPhone ? <Button variant="ghost" icon="sms" disabled={sent} onClick={async () => { try { await api.post('/api/v1/sales/' + done.id + '/receipt', {}); setSent(true); toast('Reçu envoyé par SMS'); } catch (e) { toastError(e); } }}>{sent ? 'Reçu envoyé' : 'Reçu par SMS'}</Button> : null}
        <Button variant="ghost" icon="print" disabled={!sale.data} onClick={() => { setVoucher(null); printNow(); }}>Imprimer le ticket</Button>
        <Button variant="solid" icon="arrowR" onClick={onNext}>Ticket suivant</Button>
      </div>
      {c && ask ? (
        <div className="rebook">
          <p className="section-k">Avant qu’il parte</p>
          <h3>{booked ? 'Prochain rendez-vous : ' + booked + '.' : known ? c.first + ' revient ' + rhythmWords(c.cadence) + '. On réserve ?' : 'On lui garde une place dans 3 semaines ?'}</h3>
          {booked ? <p className="muted">Confirmation et rappel partent par SMS.</p> : loading ? <Skeleton h={44} /> : picks.length ? <div className="chips">{picks.map((p) => <Chip key={p.day + p.m} onClick={() => book(p)}>{dayShortWord(p.day, boot.today)} · {time(p.m)} · {staffById.get(p.s)?.name}</Chip>)}</div> : <p className="muted">Pas de créneau le {dates.DAYS_FR[dates.weekday(boot.today)]} dans {weeks} à {weeks + 2} semaines : propose-lui un autre jour depuis l’agenda.</p>}
        </div>
      ) : null}
      {c ? <OfferMember c={c} lines={done.lines as Line[]} /> : null}
      {voucher ? <Voucher card={voucher} /> : sale.data ? <Receipt sale={sale.data} /> : null}
    </div>
  );
}

/** A quiet line for a client with no membership, when plans are on sale: the subscribe link by SMS in one tap (no form). */
function OfferMember({ c, lines }: { c: ClientCard; lines: Line[] }) {
  const { can } = useApp();
  const [state, setState] = useState<'' | 'busy' | 'sent'>('');
  // what the counter sells, the formules kept for the salon too (the site's list leaves them out); `live` says money can move
  const shop = useQuery<{ live: boolean; plans: { id: string; name: string; price: number; serviceIds: string[] }[] }>(can('member.manage') && c.hasPhone && !c.memberships?.length ? '/api/v1/memberships/plans' : null);
  const plans = [...(shop.data?.plans || [])].sort((a, b) => a.price - b.price);
  // memberships on a card are the ones running or waiting for their checkout
  if (!shop.data?.live || !plans.length) return null;
  const done = lines.filter((l) => l.kind === 'service').map((l) => l.ref!);
  const plan = plans.find((p) => p.serviceIds.some((x) => done.includes(x))) || plans[0];
  // the contract's confirmation goes to his e-mail: without one the offer would only fail, so the line says what to do
  if (!c.hasEmail) return <div className="till-offer" data-guide="till-offer"><p className="muted">Pour lui proposer l’abonnement, ajoute son e-mail à sa fiche. <button type="button" className="link" onClick={() => navigate('/clients/' + c.id)}>Ouvrir la fiche</button></p></div>;
  const send = async () => {
    setState('busy');
    try { await api.post('/api/v1/memberships/offer', { clientId: c.id, planId: plan.id, send: 'sms' }, uuid()); setState('sent'); toast({ title: 'Lien envoyé par SMS à ' + c.first, icon: 'sms' }); refreshAll(); }
    catch (e) { setState(''); toastError(e); }
  };
  return (
    <div className="till-offer" data-guide="till-offer">
      {state === 'sent' ? <p className="muted" role="status">Lien de l’abonnement {plan.name} envoyé à {c.first}.</p> : <Button className="till-offer-btn" variant="ghost" size="sm" icon="sms" busy={state === 'busy'} onClick={send}>Proposer l’abonnement {plan.name} (<span className="money">{eur(plan.price)}</span>/mois)</Button>}
    </div>
  );
}
