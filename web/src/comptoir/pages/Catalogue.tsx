// Le catalogue: what the salon sells. Prices change for new bookings only; stock only moves through
// counted adjustments, so every jar on the shelf is accounted for.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { refreshAll, useQuery } from '../../lib/query';
import { Link, navigate, useRoute } from '../../lib/router';
import { ago, clock, dates, dur, eur, money, pct, plural } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Button, Chip, Empty, Field, Kpi, Modal, Note, Sheet, Skeleton, Switch, confirm, toast, toastError } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle, Reserved } from '../App';
import type { Product, Service } from '../types';
import { GiftCode, Voucher, printNow, type VoucherCard } from './caisse/Receipt';
import './catalogue.css';

type Catalog = { services: Service[]; products: Product[] };
// legacy: a paper card taken over ('reprise'); reissueOf: the card it replaced
type Gift = { id: string; last4: string; amount: number; balance: number; expires: string; status: string; recipient: string; buyer: string; issuedAt: number; uses: number; legacy?: boolean; reissueOf?: string | null; voidReason?: string; replacedBy?: string | null };
// a card bought on /carte-cadeau (GET /api/v1/giftshop): how it was to be given, and its text
// cardIds: the card and those that replaced it (reissued), the live one last
type Online = {
  giftcardId: string; cardIds?: string[]; reissued?: boolean; paymentId: string; amount: number; paidAt: number; delivery: 'buyer' | 'recipient'; sendAt: number;
  sms: { status: string; state?: 'planned' | 'leaving' | 'sent' | 'failed'; dueAt: number; to: string; error: string } | null;
};
const VATS = [{ v: 2000, t: '20 %' }, { v: 1000, t: '10 %' }, { v: 550, t: '5,5 %' }, { v: 0, t: '0 %' }];
const DURS = [10, 15, 20, 30, 45, 60, 90, 120];
const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
const onSite = (s: Service) => s.active && s.online;

/* The menu of the old WordPress site, so the owner starts from it instead of an empty page. The slugs are the
   site's historical ones (?prestation=cl), the subscription covers the classic cut as in the demo. */
const OLD_MENU: (Record<string, unknown> & { slug: string; name: string })[] = [
  { slug: 'cl', name: 'Coupe classique', short: 'Coupe', category: 'Coupes', price: 2000, dur: 30, includes: ['Coupe', 'Shampooing', 'Coiffage'] },
  { slug: 'cc', name: 'Coupe + contour de barbe', short: 'Coupe + contour', category: 'Coupes', price: 2500, dur: 30, includes: ['Coupe', 'Contour de la barbe'] },
  { slug: 'ct', name: 'Coupe + taille de barbe', short: 'Coupe + taille', category: 'Coupes', price: 3000, dur: 30, tag: 'La plus complète', includes: ['Coupe', 'Taille de barbe', 'Shampooing', 'Coiffage', 'Soin cheveux', 'Soin barbe'] },
  { slug: 'tb', name: 'Taille de barbe', category: 'Barbe', price: 1800, dur: 30, includes: ['Taille', 'Mise en forme', 'Huile'] },
  { slug: 'eb', name: 'Entretien barbe', category: 'Barbe', price: 1500, dur: 30, includes: ['Contour de la barbe', 'Huile'] },
  { slug: 'cb', name: 'Cover barbe', category: 'Barbe', price: 1500, dur: 30, includes: ['Couleur de la barbe', 'Soin'] },
  { slug: 'tr', name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60, tag: 'Changement de look', includes: ['Diagnostic', 'Étude de faisabilité', 'Coupe', 'Coiffage et soin'] },
  { slug: 'de', name: 'Décoloration', category: 'Changer de tête', price: 6000, from: true, dur: 60, includes: ['Décoloration', 'Sans coupe'], description: 'Sous condition de faisabilité.' },
  { slug: 'co', name: 'Coloration', category: 'Changer de tête', price: 3000, from: true, dur: 60, includes: ['Coloration', 'Sans coupe'] },
  { slug: 'si', name: 'Silver', category: 'Changer de tête', price: 10000, dur: 60, tag: 'Blanc ou gris', includes: ['Décoloration jusqu’au blanc', 'Coloration grise', 'Soin', 'Produit d’entretien offert'], description: 'Ne pas laver la tête pendant 4 jours minimum.' },
  // the WordPress pack, as the « Carnet » (PAY-04: « Abonnement » is the monthly plan): sold at the salon, never booked online
  { slug: 'ab', name: 'Carnet 5 coupes', short: 'Carnet', category: 'Carnet', price: 8000, dur: 30, online: false, tag: '16 € la coupe', includes: ['5 coupes sur 5 semaines', 'Sans barbe'], description: '16 € la coupe. Il se prend au salon : on fixe tes coupes avec toi.', pack: { credits: 5, days: 70 } }
];

/** Swap a service with its neighbour in its category: the order is the site's order. */
async function moveService(items: Service[], s: Service, dir: -1 | 1) {
  const list = items.filter((x) => x.active && x.category === s.category).sort((a, b) => a.order - b.order);
  const i = list.findIndex((x) => x.id === s.id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const other = list[j];
  try {
    await Promise.all([api.patch('/api/v1/services/' + s.id, { order: other.order }), api.patch('/api/v1/services/' + other.id, { order: s.order === other.order ? s.order + dir : s.order })]);
    refreshAll();
  } catch (e) { toastError(e); }
}

function SiteBadge({ s }: { s: Service }) {
  if (onSite(s)) return <span className="badge badge-ok"><Icon name="globe" size={12} />visible sur le site</span>;
  return <span className="badge badge-warn">pas sur le site ({s.active ? 'hors ligne' : 'archivée'})</span>;
}

export default function Catalogue() {
  const { can, boot } = useApp();
  const route = useRoute();
  const tab = route.id === 'produits' ? 'produits' : route.id === 'cartes' ? 'cartes' : 'prestations';
  // without `catalog` the page is the price list, from the bootstrap (active items only): nothing to edit, nothing refused
  const owner = can('catalog');
  const q = useQuery<Catalog>(owner ? '/api/v1/catalog' : null);
  const { data, loading } = owner ? q : { data: { services: boot.services, products: boot.products }, loading: false };
  const low = owner ? (data?.products || []).filter((p) => p.active && p.stock <= p.low).length : 0;
  const tabs = [
    { to: '/catalogue', id: 'prestations', label: 'Prestations', icon: 'scissors' },
    { to: '/catalogue/produits', id: 'produits', label: 'Produits & stock', icon: 'box', count: low },
    ...(can('sale.all') ? [{ to: '/catalogue/cartes', id: 'cartes', label: 'Cartes cadeaux', icon: 'gift' }] : [])
  ];
  return (
    <>
      <PageTitle><h1>Catalogue</h1></PageTitle>
      <nav className="tabs" aria-label="Catalogue">
        {tabs.map((t) => <Link key={t.id} to={t.to} className="tab" aria-current={tab === t.id ? 'page' : undefined}><Icon name={t.icon} size={16} />{t.label}{(t as any).count ? <span className="count">{(t as any).count}</span> : null}</Link>)}
      </nav>
      {tab === 'cartes' ? (can('sale.all') ? <Gifts /> : <Reserved />) : loading && !data ? <Skeleton h={360} r={22} /> : !data ? null
        : !owner ? (tab === 'produits' ? <ProductPrices items={data.products} /> : <PriceList items={data.services} />)
        : tab === 'produits' ? <Products items={data.products} /> : <Services items={data.services} />}
    </>
  );
}

/* ---------------- read-only: the price list for the team ---------------- */

function PriceList({ items }: { items: Service[] }) {
  const active = items.filter((s) => s.active).sort((a, b) => a.order - b.order);
  const cats = [...new Set(active.map((s) => s.category))];
  return (
    <>
      <div className="row wrap ct-bar"><p className="muted grow">{plural(active.length, 'prestation')} · les prix et les durées se changent avec le gérant</p></div>
      <div className="col" style={{ gap: 14 }}>
        {!active.length ? <section className="card"><Empty icon="scissors" title="Pas encore de prestation">Le gérant prépare la carte du salon.</Empty></section> : null}
        {cats.map((c) => (
          <section key={c} className="card">
            <div className="card-h"><h2>{c}</h2><span className="faint" style={{ fontSize: 13 }}>{active.filter((s) => s.category === c).length}</span></div>
            <ul className="list">
              {active.filter((s) => s.category === c).map((s) => (
                <li key={s.id} className="li">
                  <span className="li-main">
                    <b>{s.name}{s.pack ? <span className="badge badge-ok">{s.pack.credits} passages · {s.pack.days} j</span> : null}{!s.online ? <span className="badge">au salon seulement</span> : null}</b>
                    <small>{dur(s.dur)}{s.buffer ? ' + ' + s.buffer + ' min de battement' : ''}{s.description ? ' · ' + s.description : ''}</small>
                  </span>
                  <span className="li-end"><b className="ct-price">{s.from ? <small>dès </small> : null}{eur(s.price)}</b></span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function ProductPrices({ items }: { items: Product[] }) {
  const active = items.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return (
    <section className="card">
      {!active.length ? <Empty icon="box" title="Aucun produit">Le salon ne vend pas encore de produits.</Empty> : (
        <ul className="list">{active.map((p) => (
          <li key={p.id} className="li">
            <span className="li-main"><b>{p.name}</b><small>{p.category}</small></span>
            <span className={'badge ' + (p.stock <= 0 ? 'badge-danger' : p.stock <= p.low ? 'badge-warn' : '')}>{p.stock <= 0 ? 'rupture' : p.stock + ' en rayon'}</span>
            <span className="li-end"><b className="ct-price">{eur(p.price, { decimals: p.price % 100 !== 0 })}</b></span>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

/* ---------------- services ---------------- */

function Services({ items }: { items: Service[] }) {
  const [edit, setEdit] = useState<Service | 'new' | null>(null);
  const active = items.filter((s) => s.active).sort((a, b) => a.order - b.order);
  const archived = items.filter((s) => !s.active);
  const cats = [...new Set(active.map((s) => s.category))];
  const { reloadBoot } = useApp();
  const move = (s: Service, dir: -1 | 1) => moveService(items, s, dir);
  const [taking, setTaking] = useState(false);
  // the old menu's slugs not created yet: a takeover cut short (network, rights) can be finished later without duplicates
  const missing = OLD_MENU.filter((m) => !items.some((x) => x.slug === m.slug));
  const resume = missing.length > 0 && missing.length < OLD_MENU.length;
  const takeOver = async () => {
    setTaking(true);
    let done = 0;
    try {
      const ids: Record<string, string> = Object.fromEntries(items.filter((x) => x.slug).map((x) => [x.slug as string, x.id]));
      for (const [order, sv] of OLD_MENU.entries()) {
        if (ids[sv.slug]) continue;
        const body = sv.slug === 'ab' && ids.cl ? { ...sv, order, pack: { credits: 5, days: 70, serviceIds: [ids.cl] } } : { ...sv, order };
        ids[sv.slug] = (await api.post<{ id: string }>('/api/v1/services', body)).id;
        done++;
      }
      toast({ title: 'Ta carte est reprise', sub: plural(done, 'prestation') + ' sur le site. Ajuste les prix si besoin.', icon: 'check' });
    } catch (e) { toastError(e); } finally { setTaking(false); refreshAll(); reloadBoot().catch(() => {}); }
  };
  return (
    <>
      <div className="row wrap ct-bar">
        <p className="muted grow">{plural(active.length, 'prestation')} · {plural(active.filter(onSite).length, 'visible', 'visibles')} sur le site · l’ordre est celui du site</p>
        <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Nouvelle prestation</Button>
      </div>
      <div className="col" style={{ gap: 14 }}>
        {!items.length ? (
          <section className="card">
            <Empty icon="scissors" title="Pas encore de prestation" action={<Button variant="primary" icon="download" busy={taking} onClick={takeOver}>Reprendre la carte de l’ancien site</Button>}>
              Ta carte de l’ancien site, prête en un geste&nbsp;: tu ajustes ensuite les prix.
            </Empty>
          </section>
        ) : resume ? (
          <section className="card card-tight row wrap" style={{ gap: 12 }}>
            <p className="grow muted" style={{ margin: 0 }}>La reprise de l’ancienne carte s’est arrêtée en route&nbsp;: {plural(missing.length, 'prestation manque', 'prestations manquent')}.</p>
            <Button icon="download" busy={taking} onClick={takeOver}>Compléter la carte de l’ancien site</Button>
          </section>
        ) : null}
        {cats.map((c) => (
          <section key={c} className="card">
            <div className="card-h"><h2>{c}</h2><span className="faint" style={{ fontSize: 13 }}>{active.filter((s) => s.category === c).length}</span></div>
            <ul className="list">
              {active.filter((s) => s.category === c).map((s, i, arr) => (
                <li key={s.id} className="ct-row">
                  <button type="button" className="li ct-main" onClick={() => setEdit(s)}>
                    <span className="li-main">
                      <b>{s.name}{s.pack ? <span className="badge badge-ok">{s.pack.credits} passages · {s.pack.days} j</span> : null}<SiteBadge s={s} />{s.tag ? <span className="badge badge-accent">{s.tag}</span> : null}</b>
                      <small>{dur(s.dur)}{s.buffer ? ' + ' + s.buffer + ' min de battement' : ''} · TVA {s.vat / 100} %{s.description ? ' · ' + s.description : ''}</small>
                    </span>
                    <span className="ct-flags">
                      {s.deposit ? <span className="badge badge-info">acompte {eur(s.deposit)}</span> : null}
                    </span>
                    <span className="li-end"><b className="ct-price">{s.from ? <small>dès </small> : null}{eur(s.price)}</b></span>
                  </button>
                  <span className="ct-order">
                    <button type="button" aria-label="Monter" disabled={i === 0} onClick={() => move(s, -1)}><Icon name="chevL" size={14} /></button>
                    <button type="button" aria-label="Descendre" disabled={i === arr.length - 1} onClick={() => move(s, 1)}><Icon name="chevR" size={14} /></button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {archived.length ? (
          <details className="card ct-archived">
            <summary>{plural(archived.length, 'prestation archivée', 'prestations archivées')}</summary>
            <ul className="list">{archived.map((s) => <li key={s.id} className="li"><span className="li-main"><b>{s.name} <SiteBadge s={s} /></b><small>{s.category} · {eur(s.price)}</small></span><Button size="sm" variant="ghost" onClick={async () => { try { await api.post('/api/v1/services/' + s.id + '/archive', { restore: true }); refreshAll(); toast(s.name + ' est de retour'); } catch (e) { toastError(e); } }}>Remettre en vente</Button></li>)}</ul>
          </details>
        ) : null}
      </div>
      <ServiceSheet sv={edit} all={items} onClose={() => setEdit(null)} />
    </>
  );
}

function ServiceSheet({ sv, all, onClose }: { sv: Service | 'new' | null; all: Service[]; onClose: () => void }) {
  const { boot, reloadBoot } = useApp();
  const isNew = sv === 'new';
  const cats = [...new Set(all.filter((s) => s.active).map((s) => s.category))];
  const blank = { name: '', short: '', category: cats[0] || 'Coupes', price: '', from: false, dur: 30, buffer: 0, online: true, deposit: '' as string, depositMode: 'auto' as 'auto' | 'none' | 'custom', vat: boot.settings.payments.vat ?? 2000, description: '', includes: '', tag: '', isPack: false, credits: 5, days: 70, covers: [] as string[] };
  const [f, setF] = useState(blank);
  const [newCat, setNewCat] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!sv) return;
    if (sv === 'new') { setF(blank); setNewCat(''); return; }
    setF({ name: sv.name, short: sv.short === sv.name ? '' : sv.short, category: sv.category, price: euros(sv.price), from: sv.from, dur: sv.dur, buffer: sv.buffer, online: sv.online, deposit: sv.deposit != null ? euros(sv.deposit) : '', depositMode: sv.deposit == null ? 'auto' : sv.deposit === 0 ? 'none' : 'custom', vat: sv.vat, description: sv.description, includes: sv.includes.join(', '), tag: sv.tag || '', isPack: !!sv.pack, credits: sv.pack?.credits || 5, days: sv.pack?.days || 70, covers: sv.pack?.serviceIds || [] });
    setNewCat('');
  }, [sv]);
  const price = money.parseEur(f.price);
  // where it sits on the site, from the live list so the arrows follow each move
  const place = useMemo(() => {
    if (!sv || sv === 'new') return null;
    const list = all.filter((x) => x.active && x.category === sv.category).sort((a, b) => a.order - b.order);
    const i = list.findIndex((x) => x.id === sv.id);
    return i < 0 ? null : { i, n: list.length, s: list[i] };
  }, [sv, all]);
  // another category picked but not saved yet: the position shown would be the old one's
  const moved = !!place && (newCat.trim() || f.category) !== place.s.category;
  const dep = boot.settings.deposits;
  const autoDep = !price || dep.mode === 'none' || (dep.mode === 'threshold' && price < dep.thresholdCents) ? 0 : Math.min(price, Math.max(500, Math.round((price * dep.percent) / 100 / 100) * 100));
  const valid = f.name.trim().length >= 2 && price != null && price >= 0 && (f.category || newCat.trim());
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: f.name.trim(), short: f.short.trim() || undefined, category: (newCat.trim() || f.category), price, from: f.from, dur: f.dur, buffer: f.buffer, online: f.online, vat: f.vat,
        description: f.description.trim(), includes: f.includes.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10), tag: f.tag.trim()
      };
      body.deposit = f.depositMode === 'auto' ? null : f.depositMode === 'none' ? 0 : money.parseEur(f.deposit) ?? 0;
      if (f.isPack) body.pack = { credits: f.credits, days: f.days, serviceIds: f.covers };
      if (isNew) await api.post('/api/v1/services', body);
      else await api.patch('/api/v1/services/' + (sv as Service).id, body);
      // say where it shows: an offline or archived service is saved but clients don't see it
      const shown = f.online && (isNew || (sv as Service).active);
      toast({ title: shown ? 'Visible sur le site' : 'Enregistrée · pas affichée sur le site', sub: f.name.trim(), icon: 'check' });
      refreshAll(); reloadBoot().catch(() => {}); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const archive = async () => {
    if (isNew || !sv) return;
    if (!await confirm({ title: 'Retirer « ' + sv.name + ' » de la vente ?', body: 'Elle disparaît du site et de la caisse. Les rendez-vous déjà pris et l’historique ne bougent pas.', ok: 'Retirer', danger: true })) return;
    try { await api.post('/api/v1/services/' + sv.id + '/archive', {}); refreshAll(); reloadBoot().catch(() => {}); toast('Prestation archivée'); onClose(); } catch (e) { toastError(e); }
  };
  return (
    <Sheet open={!!sv} onClose={onClose} title={isNew ? 'Nouvelle prestation' : 'Prestation'} wide
      footer={<>{!isNew ? <Button variant="ghost" icon="trash" onClick={archive}>Archiver</Button> : null}<span className="grow" /><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={!valid} onClick={save}>Enregistrer</Button></>}>
      <div className="grid2">
        <Field label="Nom" htmlFor="sv-n"><input id="sv-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Coupe + contour de barbe" /></Field>
        <Field label="Nom court (agenda, ticket)" htmlFor="sv-s"><input id="sv-s" className="input" value={f.short} maxLength={30} onChange={(e) => setF({ ...f, short: e.target.value })} placeholder="Coupe + contour" /></Field>
      </div>
      <Field label="Catégorie">
        <div className="chips">{cats.map((c) => <Chip key={c} small on={!newCat && f.category === c} onClick={() => { setF({ ...f, category: c }); setNewCat(''); }}>{c}</Chip>)}<input className="input ct-newcat" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="+ nouvelle" aria-label="Nouvelle catégorie" /></div>
      </Field>
      <div className="grid2">
        <Field label="Prix TTC (€)" htmlFor="sv-p"><input id="sv-p" className="input input-money" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="25" /></Field>
        <Field label="TVA"><div className="chips">{VATS.map((v) => <Chip key={v.v} small on={f.vat === v.v} onClick={() => setF({ ...f, vat: v.v })}>{v.t}</Chip>)}</div></Field>
      </div>
      <Switch on={f.from} onChange={(v) => setF({ ...f, from: v })} title="Prix « à partir de »" hint="Le prix final se fixe à la caisse (couleur, cheveux longs…)." />
      <Field label="Durée">
        <div className="chips">{DURS.map((d) => <Chip key={d} small on={f.dur === d} onClick={() => setF({ ...f, dur: d })}>{dur(d)}</Chip>)}<input className="input ct-num" inputMode="numeric" value={f.dur} onChange={(e) => setF({ ...f, dur: Math.max(5, Math.min(480, Number(e.target.value.replace(/\D/g, '')) || 5)) })} aria-label="Durée en minutes" /><span className="faint">min</span></div>
      </Field>
      <Field label="Battement après" hint="Temps de nettoyage bloqué dans l’agenda, invisible pour le client.">
        <div className="chips">{[0, 5, 10, 15].map((b) => <Chip key={b} small on={f.buffer === b} onClick={() => setF({ ...f, buffer: b })}>{b ? b + ' min' : 'aucun'}</Chip>)}</div>
      </Field>
      <Switch on={f.online} onChange={(v) => setF({ ...f, online: v })} title="Réservable en ligne" hint="Décoche pour les prestations à valider au salon (couleur, mariage…)." />
      <Field label="Acompte en ligne">
        <div className="chips">
          <Chip small on={f.depositMode === 'auto'} onClick={() => setF({ ...f, depositMode: 'auto' })}>Règle du salon{autoDep ? ' · ' + eur(autoDep) : ' · aucun'}</Chip>
          <Chip small on={f.depositMode === 'none'} onClick={() => setF({ ...f, depositMode: 'none' })}>Jamais</Chip>
          <Chip small on={f.depositMode === 'custom'} onClick={() => setF({ ...f, depositMode: 'custom' })}>Montant précis</Chip>
          {f.depositMode === 'custom' ? <input className="input ct-num" inputMode="decimal" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} placeholder="0" aria-label="Montant de l’acompte" /> : null}
        </div>
      </Field>
      <Field label="Description sur le site" hint={f.description.length + ' / 300'} htmlFor="sv-d"><textarea id="sv-d" className="input textarea" rows={2} maxLength={300} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Inclus (séparés par des virgules)" htmlFor="sv-i"><input id="sv-i" className="input" value={f.includes} onChange={(e) => setF({ ...f, includes: e.target.value })} placeholder="Shampooing, serviette chaude, coiffage" /></Field>
      <div className="grid2">
        <Field label="Mise en avant" hint="Un petit badge sur la carte du site. Vide : aucun." htmlFor="sv-t"><input id="sv-t" className="input" value={f.tag} maxLength={30} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="La plus complète" /></Field>
        <Field label="Ordre d’affichage" hint={place && !moved ? 'Chaque flèche déplace tout de suite sur le site.' : undefined}>{place && moved ? (
          <span className="faint" style={{ fontSize: 13.5 }}>Nouvelle catégorie : tu la places dedans après l’enregistrement.</span>
        ) : place ? (
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" icon="chevU" aria-label="Monter" disabled={place.i === 0} onClick={() => moveService(all, place.s, -1)} />
            <Button size="sm" icon="chevD" aria-label="Descendre" disabled={place.i === place.n - 1} onClick={() => moveService(all, place.s, 1)} />
            <span className="muted" style={{ fontSize: 13.5 }}>{place.i + 1}<sup>{place.i ? 'e' : 're'}</sup> sur {place.n} dans {place.s.category}</span>
          </div>
        ) : <span className="faint" style={{ fontSize: 13.5 }}>{isNew ? 'En dernier dans sa catégorie ; tu la déplaces ensuite.' : 'Archivée : pas sur le site.'}</span>}</Field>
      </div>
      <Switch on={f.isPack} onChange={(v) => setF({ ...f, isPack: v })} title="C’est un abonnement" hint="Vendu une fois, puis chaque passage est décompté à la caisse." />
      {f.isPack ? (
        <div className="card card-tight ct-pack">
          <div className="grid2">
            <Field label="Nombre de passages" htmlFor="pk-c"><input id="pk-c" className="input" inputMode="numeric" value={f.credits} onChange={(e) => setF({ ...f, credits: Math.max(2, Math.min(50, Number(e.target.value.replace(/\D/g, '')) || 2)) })} /></Field>
            <Field label="Valable (jours)" htmlFor="pk-d"><input id="pk-d" className="input" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: Math.max(7, Math.min(730, Number(e.target.value.replace(/\D/g, '')) || 7)) })} /></Field>
          </div>
          <Field label="Prestations couvertes" hint={f.covers.length ? '' : 'Aucune cochée : couvre toutes les prestations.'}>
            <div className="chips">{all.filter((s) => s.active && !s.pack).map((s) => <Chip key={s.id} small on={f.covers.includes(s.id)} onClick={() => setF({ ...f, covers: f.covers.includes(s.id) ? f.covers.filter((x) => x !== s.id) : [...f.covers, s.id] })}>{s.name}</Chip>)}</div>
          </Field>
          {price ? <p className="faint" style={{ fontSize: 13 }}>Soit {eur(Math.round(price / f.credits))} le passage.</p> : null}
        </div>
      ) : null}
      {!isNew ? <Note icon="info">Un changement de prix vaut pour les nouvelles réservations ; celles déjà prises gardent leur prix.</Note> : null}
    </Sheet>
  );
}

/* ---------------- products and stock ---------------- */

function Products({ items }: { items: Product[] }) {
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const [adj, setAdj] = useState<Product | null>(null);
  const [inv, setInv] = useState(false);
  const active = items.filter((p) => p.active).sort((a, b) => (a.stock <= a.low ? 0 : 1) - (b.stock <= b.low ? 0 : 1) || a.name.localeCompare(b.name, 'fr'));
  const archived = items.filter((p) => !p.active);
  const value = active.reduce((t, p) => t + Math.max(0, p.stock) * p.cost, 0);
  const retail = active.reduce((t, p) => t + Math.max(0, p.stock) * p.price, 0);
  const low = active.filter((p) => p.stock <= p.low);
  return (
    <>
      <section className="kpis">
        <Kpi k="Références" v={active.length} s={plural(active.reduce((t, p) => t + Math.max(0, p.stock), 0), 'article') + ' en rayon'} icon="box" />
        <Kpi k="Valeur du stock" v={eur(value)} s={'au prix d’achat · ' + eur(retail) + ' en vente'} icon="euro" />
        <Kpi k="À commander" v={low.length} s={low.length ? low.slice(0, 2).map((p) => p.name).join(', ') + (low.length > 2 ? '…' : '') : 'tout est en stock'} icon="alert" hot={low.length > 0} />
      </section>
      <div className="row wrap ct-bar">
        <span className="grow" />
        <Button variant="ghost" icon="journal" onClick={() => setInv(true)}>Inventaire</Button>
        <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Nouveau produit</Button>
      </div>
      <section className="card">
        {!active.length ? <Empty icon="box" title="Aucun produit" action={<Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Ajouter un produit</Button>}>Cires, huiles, shampooings : vendus à la caisse, suivis en stock.</Empty> : (
          <div className="table-wrap">
            <table className="table ct-table">
              <thead><tr><th>Produit</th><th className="num">Prix</th><th className="num hide-phone">Achat</th><th className="num hide-phone">Marge</th><th className="num">Stock</th><th /></tr></thead>
              <tbody>{active.map((p) => {
                const m = p.price ? (p.price / (1 + p.vat / 10000) - p.cost) / (p.price / (1 + p.vat / 10000)) : 0;
                return (
                  <tr key={p.id}>
                    <td><button type="button" className="ct-pname" onClick={() => setEdit(p)}><b>{p.name}</b><small>{p.category}{p.sku ? ' · ' + p.sku : ''}</small></button></td>
                    <td className="num money">{eur(p.price, { decimals: p.price % 100 !== 0 })}</td>
                    <td className="num money hide-phone">{p.cost ? eur(p.cost, { decimals: p.cost % 100 !== 0 }) : '—'}</td>
                    <td className="num hide-phone">{p.cost ? pct(m) : '—'}</td>
                    <td className="num"><span className={'badge ' + (p.stock <= 0 ? 'badge-danger' : p.stock <= p.low ? 'badge-warn' : '')}>{p.stock}</span></td>
                    <td className="num"><Button size="sm" variant="ghost" icon="plus" onClick={() => setAdj(p)}>Stock</Button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      {archived.length ? (
        <details className="card ct-archived" style={{ marginTop: 14 }}>
          <summary>{plural(archived.length, 'produit archivé', 'produits archivés')}</summary>
          <ul className="list">{archived.map((p) => <li key={p.id} className="li"><span className="li-main"><b>{p.name}</b><small>{eur(p.price)} · stock {p.stock}</small></span><Button size="sm" variant="ghost" onClick={async () => { try { await api.post('/api/v1/products/' + p.id + '/archive', { restore: true }); refreshAll(); } catch (e) { toastError(e); } }}>Remettre en vente</Button></li>)}</ul>
        </details>
      ) : null}
      <ProductSheet p={edit} onClose={() => setEdit(null)} />
      <StockModal p={adj} onClose={() => setAdj(null)} />
      <Inventory open={inv} items={active} onClose={() => setInv(false)} />
    </>
  );
}

function ProductSheet({ p, onClose }: { p: Product | 'new' | null; onClose: () => void }) {
  const { boot, reloadBoot } = useApp();
  const isNew = p === 'new';
  const [f, setF] = useState({ name: '', category: 'Produits', price: '', cost: '', low: 3, vat: 2000, sku: '', stock: 0 });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!p) return;
    if (p === 'new') setF({ name: '', category: 'Produits', price: '', cost: '', low: 3, vat: boot.settings.payments.vat ?? 2000, sku: '', stock: 0 });
    else setF({ name: p.name, category: p.category, price: euros(p.price), cost: p.cost ? euros(p.cost) : '', low: p.low, vat: p.vat, sku: p.sku, stock: p.stock });
  }, [p]);
  const price = money.parseEur(f.price), cost = money.parseEur(f.cost || '0');
  const ht = price ? price / (1 + f.vat / 10000) : 0;
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: f.name.trim(), category: f.category.trim() || 'Produits', price, cost: cost || 0, low: f.low, vat: f.vat, sku: f.sku.trim() };
      if (isNew) {
        const r = await api.post<{ id: string }>('/api/v1/products', body);
        if (f.stock > 0) await api.post('/api/v1/products/' + r.id + '/stock', { delta: f.stock, reason: 'Stock initial' });
      } else await api.patch('/api/v1/products/' + (p as Product).id, body);
      toast({ title: isNew ? 'Produit ajouté' : 'Produit enregistré', icon: 'check' }); refreshAll(); reloadBoot().catch(() => {}); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const archive = async () => {
    if (isNew || !p) return;
    if (!await confirm({ title: 'Retirer « ' + p.name + ' » de la vente ?', ok: 'Retirer', danger: true })) return;
    try { await api.post('/api/v1/products/' + p.id + '/archive', {}); refreshAll(); reloadBoot().catch(() => {}); onClose(); } catch (e) { toastError(e); }
  };
  return (
    <Sheet open={!!p} onClose={onClose} title={isNew ? 'Nouveau produit' : 'Produit'}
      footer={<>{!isNew ? <Button variant="ghost" icon="trash" onClick={archive}>Archiver</Button> : null}<span className="grow" /><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={f.name.trim().length < 2 || price == null} onClick={save}>Enregistrer</Button></>}>
      <Field label="Nom" htmlFor="pr-n"><input id="pr-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Cire mate 100 ml" /></Field>
      <div className="grid2">
        <Field label="Prix de vente TTC (€)" htmlFor="pr-p"><input id="pr-p" className="input input-money" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label="Prix d’achat HT (€)" hint={price && cost ? 'Marge ' + pct((ht - cost) / ht) + ' · ' + eur(Math.round(ht - cost), { decimals: true }) + ' par vente' : ''} htmlFor="pr-c"><input id="pr-c" className="input input-money" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
      </div>
      <div className="grid2">
        <Field label="Catégorie" htmlFor="pr-k"><input id="pr-k" className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Référence / code-barres" htmlFor="pr-s"><input id="pr-s" className="input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
      </div>
      <div className="grid2">
        <Field label="Alerte stock bas à" hint="Le gérant est prévenu dans le fil." htmlFor="pr-l"><input id="pr-l" className="input" inputMode="numeric" value={f.low} onChange={(e) => setF({ ...f, low: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} /></Field>
        {isNew ? <Field label="Quantité en rayon" htmlFor="pr-q"><input id="pr-q" className="input" inputMode="numeric" value={f.stock} onChange={(e) => setF({ ...f, stock: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} /></Field> : <Field label="TVA"><div className="chips">{VATS.slice(0, 2).map((v) => <Chip key={v.v} small on={f.vat === v.v} onClick={() => setF({ ...f, vat: v.v })}>{v.t}</Chip>)}</div></Field>}
      </div>
      {!isNew ? <p className="faint" style={{ fontSize: 13 }}>Le stock ne se modifie pas ici : passe par « Stock » ou « Inventaire », chaque mouvement est tracé.</p> : null}
    </Sheet>
  );
}

const STOCK_REASONS: [string, number][] = [['Livraison fournisseur', 1], ['Casse ou perte', -1], ['Usage au salon', -1], ['Retour client', 1]];
function StockModal({ p, onClose }: { p: Product | null; onClose: () => void }) {
  const [q, setQ] = useState(1);
  const [reason, setReason] = useState(STOCK_REASONS[0]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (p) { setQ(p.stock <= p.low ? Math.max(6, p.low * 3) : 1); setReason(STOCK_REASONS[0]); } }, [p?.id]);
  if (!p) return null;
  const delta = q * reason[1];
  const go = async () => {
    setBusy(true);
    try { await api.post('/api/v1/products/' + p.id + '/stock', { delta, reason: reason[0] }); toast({ title: p.name + ' : ' + (p.stock + delta) + ' en stock', icon: 'box' }); refreshAll(); onClose(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!p} onClose={onClose} label="Mouvement de stock">
      <h2>{p.name}</h2>
      <p>En stock : <b>{p.stock}</b>. Après ce mouvement : <b>{p.stock + delta}</b>.</p>
      <div className="chips">{STOCK_REASONS.map((r) => <Chip key={r[0]} small on={reason[0] === r[0]} onClick={() => setReason(r)}>{r[0]}</Chip>)}</div>
      <div className="row ct-qty"><Button icon="minus" aria-label="Moins" onClick={() => setQ(Math.max(1, q - 1))} /><input className="input tnum" inputMode="numeric" value={q} onChange={(e) => setQ(Math.max(1, Math.min(9999, Number(e.target.value.replace(/\D/g, '')) || 1)))} aria-label="Quantité" /><Button icon="plus" aria-label="Plus" onClick={() => setQ(q + 1)} /></div>
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} onClick={go}>{delta > 0 ? 'Ajouter ' + delta : 'Retirer ' + -delta}</Button></div>
    </Modal>
  );
}

function Inventory({ open, items, onClose }: { open: boolean; items: Product[]; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setCounts({}); }, [open]);
  const diffs = useMemo(() => items.map((p) => ({ p, n: counts[p.id] === undefined || counts[p.id] === '' ? null : Number(counts[p.id]) })).filter((x) => x.n != null && x.n !== x.p.stock), [counts, items]);
  const go = async () => {
    setBusy(true);
    try {
      for (const { p, n } of diffs) await api.post('/api/v1/products/' + p.id + '/stock', { delta: (n as number) - p.stock, reason: 'Inventaire' });
      toast({ title: 'Inventaire enregistré', sub: plural(diffs.length, 'écart corrigé', 'écarts corrigés'), icon: 'check' }); refreshAll(); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Inventaire" kicker="Compte ce qu’il y a vraiment en rayon"
      footer={<><span className="faint grow" style={{ fontSize: 13 }}>{diffs.length ? plural(diffs.length, 'écart') : 'Aucun écart pour l’instant'}</span><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={!diffs.length} onClick={go}>Corriger le stock</Button></>}>
      <p className="muted" style={{ fontSize: 13.5 }}>Laisse vide ce que tu n’as pas compté. Chaque écart est enregistré avec la raison « Inventaire ».</p>
      <ul className="list">{items.map((p) => {
        const n = counts[p.id];
        const d = n === undefined || n === '' ? null : Number(n) - p.stock;
        return (
          <li key={p.id} className="li">
            <span className="li-main"><b>{p.name}</b><small>attendu : {p.stock}</small></span>
            {d ? <span className={'badge ' + (d < 0 ? 'badge-warn' : 'badge-info')}>{d > 0 ? '+' : ''}{d}</span> : null}
            <input className="input ct-count tnum" inputMode="numeric" value={n ?? ''} placeholder={String(p.stock)} onChange={(e) => setCounts({ ...counts, [p.id]: e.target.value.replace(/\D/g, '') })} aria-label={'Compté pour ' + p.name} />
          </li>
        );
      })}</ul>
    </Sheet>
  );
}

/* ---------------- gift cards ---------------- */

function Gifts() {
  const { boot, now, can } = useApp();
  const { data, loading } = useQuery<{ items: Gift[]; outstanding: number }>('/api/v1/giftcards');
  const shop = useQuery<{ items: Online[] }>('/api/v1/giftshop');
  const online = useMemo(() => new Map((shop.data?.items || []).flatMap((o) => (o.cardIds || [o.giftcardId]).map((id) => [id, o] as const))), [shop.data]);
  const [code, setCode] = useState('');
  const [found, setFound] = useState<any>(null);
  const [open, setOpen] = useState<Gift | null>(null);
  const [takeover, setTakeover] = useState(false);
  // a code shown once (reissued, or printed for a paper card taken over), and what the printer gets
  const [fresh, setFresh] = useState<{ card: VoucherCard; title: string } | null>(null);
  const [voucher, setVoucher] = useState<VoucherCard | null>(null);
  useEffect(() => { const off = () => setVoucher(null); window.addEventListener('afterprint', off); return () => window.removeEventListener('afterprint', off); }, []);
  const check = async () => {
    try { setFound(await api.get('/api/v1/giftcards/check?code=' + encodeURIComponent(code.trim()))); } catch (e) { setFound(null); toastError(e); }
  };
  if (loading && !data) return <Skeleton h={300} r={22} />;
  if (!data) return null;
  const live = data.items.filter((g) => g.status === 'active' && g.balance > 0 && g.expires >= boot.today);
  const soon = live.filter((g) => dates.diffDays(boot.today, g.expires) <= 30);
  // a reissued card is the same money under a new code, a paper card taken over was sold before: neither is a sale here
  const sold = data.items.filter((g) => !g.reissueOf && !g.legacy);
  const taken = data.items.filter((g) => g.legacy && !g.reissueOf).length;
  const state = (g: Gift) => (g.status !== 'active' ? (g.voidReason === 'reissued' ? 'remplacée' : g.voidReason === 'refunded' ? 'remboursée' : 'annulée') : '');
  // a void card holds nothing any more (a reissued one's balance moved to its new card)
  const off = (g: Gift) => g.status !== 'active';
  return (
    <>
      <section className="kpis">
        <Kpi k="En circulation" v={eur(data.outstanding)} s={plural(live.length, 'carte') + ' encore utilisable' + (live.length > 1 ? 's' : '')} icon="gift" />
        <Kpi k="Vendues" v={sold.length} s={eur(sold.reduce((t, g) => t + g.amount, 0)) + ' au total' + (taken ? ' · ' + plural(taken, 'reprise') : '')} icon="ticket" />
        <Kpi k="Expirent bientôt" v={soon.length} s="dans les 30 jours" icon="clock" hot={soon.length > 0} />
      </section>
      <Note icon="info">Une carte cadeau n’est pas du chiffre d’affaires à la vente : c’est une dette envers le client, comptée au moment où elle paie une prestation. La TVA suit la même règle.</Note>
      <div className="ct-gifts">
        <section className="card col" style={{ gap: 10 }}>
          <div className="card-h"><h2><Icon name="search" size={16} />Vérifier un code</h2></div>
          <div className="row" style={{ gap: 8 }}><input className="input tnum" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CADO-XXXX-XXXX" onKeyDown={(e) => e.key === 'Enter' && code.trim() && check()} aria-label="Code de la carte" /><Button variant="primary" disabled={code.trim().length < 6} onClick={check}>Vérifier</Button></div>
          {found ? <div className={'note ' + (found.expired || found.status !== 'active' ? 'warn' : found.balance ? 'ok' : '')}><Icon name="gift" /><div><b>{found.status !== 'active' ? (found.replacedBy ? 'Carte remplacée par •••• ' + found.replacedBy : 'Carte annulée') : found.balance ? eur(found.balance, { decimals: true }) + ' disponibles' : 'Carte épuisée'}</b>{found.status === 'active' ? ' sur ' + eur(found.amount) : ''} · •••• {found.last4} · {found.expired ? 'expirée le ' : 'valable jusqu’au '}{dates.dayShort(found.expires)} {found.expires.slice(0, 4)}</div></div> : null}
          <Button variant="ghost" icon="plus" onClick={() => navigate('/caisse?vente=1')}>Vendre une carte cadeau</Button>
          {can('settings') ? <Button variant="ghost" icon="gift" onClick={() => setTakeover(true)}>Reprendre une carte existante</Button> : null}
          {fresh ? <><p className="section-k">{fresh.title}</p><GiftCode card={fresh.card} onPrint={() => { setVoucher(fresh.card); printNow(); }} /></> : null}
        </section>
        <section className="card">
          <div className="card-h"><h2><Icon name="gift" size={16} />Toutes les cartes</h2></div>
          {!data.items.length ? <Empty icon="gift" title="Aucune carte vendue">Elles se vendent depuis la caisse, en vente libre.</Empty> : (
            <ul className="list">{data.items.slice(0, 80).map((g) => (
              <li key={g.id}><button type="button" className="li" onClick={() => setOpen(g)} style={{ width: '100%', textAlign: 'left' }}>
                <span className="ct-card"><Icon name="gift" size={16} /></span>
                <span className="li-main"><b>•••• {g.last4}{g.recipient ? ' · ' + g.recipient : ''}{online.has(g.id) ? <span className="badge badge-info" style={{ marginLeft: 8 }}><Icon name="globe" size={12} />en ligne</span> : null}{g.legacy && !g.reissueOf ? <span className="badge" style={{ marginLeft: 8 }}>reprise</span> : null}{g.reissueOf ? <span className="badge badge-info" style={{ marginLeft: 8 }}>réémise</span> : null}{state(g) ? <span className="badge badge-warn" style={{ marginLeft: 8 }}>{state(g)}</span> : null}</b><small>{g.legacy && !g.reissueOf ? 'Reprise' : g.reissueOf ? 'Réémise' : online.has(g.id) ? 'Achetée en ligne' + (g.buyer ? ' par ' + g.buyer : '') : 'Vendue'} {ago(g.issuedAt, now())} · {g.uses ? plural(g.uses, 'utilisation') + ' · ' : ''}{g.expires < boot.today ? 'expirée' : 'valable jusqu’au ' + dates.dayShort(g.expires) + (g.expires.slice(0, 4) !== boot.today.slice(0, 4) ? ' ' + g.expires.slice(0, 4) : '')}</small></span>
                <span className="li-end">{off(g) ? <b className="faint">—</b> : <b className="money tnum">{eur(g.balance, { decimals: g.balance % 100 !== 0 })}</b>}<small className="faint">{off(g) && g.replacedBy ? '→ •••• ' + g.replacedBy : 'sur ' + eur(g.amount)}</small></span>
              </button></li>
            ))}</ul>
          )}
        </section>
      </div>
      <GiftSheet gift={open} online={open ? online.get(open.id) || null : null} onClose={() => setOpen(null)} onReissued={(card) => { setOpen(null); setFresh({ card, title: 'Nouvelle carte · l’ancien code ne marche plus' }); }} />
      <TakeoverModal open={takeover} onClose={() => setTakeover(false)} onDone={(card) => { setTakeover(false); setFresh({ card, title: 'Carte reprise' }); }} />
      {voucher ? <Voucher card={voucher} /> : null}
    </>
  );
}

/** One card: where it stands, and for the owner, a new code when the old one is lost or leaked. */
function GiftSheet({ gift: g, online: o, onClose, onReissued }: { gift: Gift | null; online: Online | null; onClose: () => void; onReissued: (c: VoucherCard) => void }) {
  const { boot, can } = useApp();
  const [busy, setBusy] = useState(false);
  const usable = !!g && g.status === 'active' && g.balance > 0 && g.expires >= boot.today;
  const reissue = async () => {
    if (!g || !await confirm({ title: 'Annuler •••• ' + g.last4 + ' et réémettre ?', body: 'L’ancien code ne marchera plus. Une nouvelle carte de ' + eur(g.balance, { decimals: g.balance % 100 !== 0 }) + ', valable jusqu’au ' + g.expires.split('-').reverse().join('/') + ', reçoit un nouveau code, affiché une seule fois.', ok: 'Annuler et réémettre', danger: true })) return;
    setBusy(true);
    try {
      const r = await api.post<{ id: string; code: string; amount: number; expires: string; recipient: string }>('/api/v1/giftcards/' + g.id + '/reissue', {});
      refreshAll(); toast({ title: 'Nouvelle carte •••• ' + r.code.slice(-4), icon: 'gift' });
      onReissued({ id: r.id, code: r.code, amount: r.amount, expires: r.expires, recipient: r.recipient });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open={!!g} onClose={onClose} title={g ? 'Carte •••• ' + g.last4 : 'Carte cadeau'} kicker={g ? (g.legacy && !g.reissueOf ? 'Reprise de l’ancien salon' : g.reissueOf ? 'Réémise' : o ? 'Achetée en ligne' : 'Vendue au salon') : ''}
      footer={g && usable && can('sale.refund') ? <><span className="grow" /><Button variant="danger" icon="gift" busy={busy} onClick={reissue}>Annuler et réémettre</Button></> : null}>
      {g ? (
        <div className="card card-tight">
          <div className="kv"><span>Solde</span>{g.status !== 'active' ? <b className="faint">— (carte de {eur(g.amount)})</b> : <b className="money">{eur(g.balance, { decimals: true })} sur {eur(g.amount)}</b>}</div>
          <div className="kv"><span>Valable jusqu’au</span><b>{g.expires.split('-').reverse().join('/')}</b></div>
          {g.recipient ? <div className="kv"><span>Pour</span><b>{g.recipient}</b></div> : null}
          {g.buyer ? <div className="kv"><span>Offerte par</span><b>{g.buyer}</b></div> : null}
          <div className="kv"><span>Utilisations</span><b>{g.uses}</b></div>
          <div className="kv"><span>État</span><b>{g.status !== 'active' ? (g.voidReason === 'reissued' ? 'Remplacée par ' + (g.replacedBy ? '•••• ' + g.replacedBy : 'une nouvelle carte') : g.voidReason === 'refunded' ? 'Annulée et remboursée' : 'Annulée') : g.expires < boot.today ? 'Expirée' : g.balance ? 'Utilisable' : 'Épuisée'}</b></div>
        </div>
      ) : null}
      {g && o ? <OnlineGift gift={g} online={o} usable={usable && o.giftcardId === g.id} /> : null}
      {g && usable ? <p className="faint" style={{ fontSize: 12.5 }}>Carte perdue ou code divulgué ? « Annuler et réémettre » bloque l’ancien code et en donne un nouveau, avec le même solde et la même date.</p> : null}
    </Sheet>
  );
}

/**
 * A card bought on /carte-cadeau: the text the buyer planned, and DO-03's resend. Nobody at the salon holds its code,
 * so the server sends it (POST /api/v1/giftshop/:id/resend): to the order's number, or, for whoever may reissue a card
 * (sale.refund), to another one. A reissued card has a code nobody keeps: it goes out from the reissue screen.
 */
function OnlineGift({ gift: g, online: o, usable }: { gift: Gift; online: Online; usable: boolean }) {
  const { now, can } = useApp();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const when = (ms: number) => dates.dayShort(dates.localParts(ms).day) + ' à ' + clock(ms);
  const m = o.sms;
  const st = !m ? '' : m.state || (m.status === 'sent' || m.status === 'simulated' ? 'sent' : m.status === 'queued' || m.status === 'claimed' ? 'leaving' : 'failed');
  const smsLine = !m ? 'Aucun' : st === 'planned' || (st === 'leaving' && m.dueAt > now()) ? 'Prévu ' + when(m.dueAt)
    : st === 'failed' ? 'Pas parti' + (m.error ? ' (' + m.error + ')' : m.status === 'expired' ? ' (trop tard)' : '')
      : st === 'leaving' ? 'En cours d’envoi' : 'Envoyé' + (m.status === 'simulated' ? ' (simulé)' : '');
  const other = can('sale.refund');
  const resend = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string; to: string }>('/api/v1/giftshop/' + g.id + '/resend', phone.trim() ? { phone } : {});
      setSent((x) => [...x, r.to]); setPhone(''); toast({ title: 'Code renvoyé par SMS', icon: 'sms' });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="card card-tight">
      <div className="kv"><span>Payée en ligne</span><b>{o.paidAt ? when(o.paidAt) : '—'}</b></div>
      <div className="kv"><span>{o.delivery === 'recipient' ? 'SMS à la personne' : 'SMS à l’acheteur'}</span><b>{smsLine}</b></div>
      {m ? <div className="kv"><span>Numéro</span><b className="tnum" style={{ whiteSpace: 'nowrap' }}>{m.to}</b></div> : null}
      {usable && o.reissued ? <small className="muted">Code réémis : il ne se renvoie que depuis l’écran de la réémission.</small> : usable && can('sale.create') ? (
        <>
          <div className="gift-send">
            {other ? <input className="input" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Même numéro" aria-label="Renvoyer à un autre numéro" /> : null}
            <Button size="sm" variant="ghost" icon="sms" busy={busy} onClick={resend}>{other ? 'Renvoyer le code par SMS' : 'Renvoyer le code au même numéro'}</Button>
          </div>
          {sent.length ? <small className="muted">Renvoyé au {sent.join(', ')}.</small> : null}
        </>
      ) : null}
    </div>
  );
}

/** A paper card sold before the switch: its code (or a new one printed for it), its balance, its date. Not a sale: no Z counts it. */
function TakeoverModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (c: VoucherCard) => void }) {
  const { boot } = useApp();
  const [code, setCode] = useState('');
  const [bal, setBal] = useState('');
  const [exp, setExp] = useState('');
  const [buyer, setBuyer] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCode(''); setBal(''); setExp(dates.addDays(boot.today, 365)); setBuyer(''); setTo(''); } }, [open]);
  const amount = money.parseEur(bal) || 0;
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string; last4: string; code?: string }>('/api/v1/import/giftcard', { code: code.trim() || undefined, amount, expires: exp, buyer: buyer.trim() || undefined, recipient: to.trim() || undefined });
      refreshAll(); toast({ title: 'Carte •••• ' + r.last4 + ' reprise', icon: 'gift' });
      onDone({ id: r.id, code: r.code || code.trim().toUpperCase(), amount, expires: exp, recipient: to.trim() });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} label="Reprendre une carte existante">
      <h2>Reprendre une carte</h2>
      <p>Une carte vendue avant le passage au Comptoir (papier, ancien site) : elle entre avec son solde, sans compter une deuxième fois dans le chiffre.</p>
      <Field label="Code de la carte" htmlFor="tk-c" hint="Laisse vide pour imprimer un nouveau code à la place."><input id="tk-c" className="input tnum" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="KDO-2025-0042" autoComplete="off" maxLength={40} /></Field>
      <div className="row wrap" style={{ gap: 10 }}>
        <Field label="Solde restant" htmlFor="tk-b"><input id="tk-b" className="input input-money" inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} placeholder="50,00" /></Field>
        <Field label="Valable jusqu’au" htmlFor="tk-e"><input id="tk-e" className="input" type="date" value={exp} min={boot.today} onChange={(e) => setExp(e.target.value)} /></Field>
      </div>
      <Field label="Offerte par" htmlFor="tk-f"><input id="tk-f" className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)} maxLength={60} placeholder="Facultatif" /></Field>
      <Field label="Pour" htmlFor="tk-t"><input id="tk-t" className="input" value={to} onChange={(e) => setTo(e.target.value)} maxLength={60} placeholder="Facultatif" /></Field>
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={amount < 100 || !exp || exp < boot.today} onClick={go}>Reprendre {amount ? eur(amount, { decimals: amount % 100 !== 0 }) : 'la carte'}</Button></div>
    </Modal>
  );
}
