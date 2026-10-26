// Le catalogue: what the salon sells. Prices change for new bookings only; stock only moves through
// counted adjustments, so every jar on the shelf is accounted for.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { refreshAll, useQuery } from '../../lib/query';
import { Link, navigate, useRoute } from '../../lib/router';
import { ago, dates, dur, eur, money, pct, plural } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Button, Chip, Empty, Field, Kpi, Modal, Note, Sheet, Skeleton, Switch, confirm, toast, toastError } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import type { Product, Service } from '../types';
import './catalogue.css';

type Catalog = { services: Service[]; products: Product[] };
type Gift = { id: string; last4: string; amount: number; balance: number; expires: string; status: string; recipient: string; buyer: string; issuedAt: number; uses: number };
const VATS = [{ v: 2000, t: '20 %' }, { v: 1000, t: '10 %' }, { v: 550, t: '5,5 %' }, { v: 0, t: '0 %' }];
const DURS = [10, 15, 20, 30, 45, 60, 90, 120];
const euros = (c: number) => (c / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');

export default function Catalogue() {
  const { can } = useApp();
  const route = useRoute();
  const tab = route.id === 'produits' ? 'produits' : route.id === 'cartes' ? 'cartes' : 'prestations';
  const { data, loading } = useQuery<Catalog>('/api/v1/catalog');
  const low = (data?.products || []).filter((p) => p.active && p.stock <= p.low).length;
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
      {tab === 'cartes' ? <Gifts /> : loading && !data ? <Skeleton h={360} r={22} /> : data ? (tab === 'produits' ? <Products items={data.products} /> : <Services items={data.services} />) : null}
    </>
  );
}

/* ---------------- services ---------------- */

function Services({ items }: { items: Service[] }) {
  const [edit, setEdit] = useState<Service | 'new' | null>(null);
  const active = items.filter((s) => s.active).sort((a, b) => a.order - b.order);
  const archived = items.filter((s) => !s.active);
  const cats = [...new Set(active.map((s) => s.category))];
  const move = async (s: Service, dir: -1 | 1) => {
    const list = active.filter((x) => x.category === s.category);
    const i = list.findIndex((x) => x.id === s.id), j = i + dir;
    if (j < 0 || j >= list.length) return;
    const other = list[j];
    try {
      await Promise.all([api.patch('/api/v1/services/' + s.id, { order: other.order }), api.patch('/api/v1/services/' + other.id, { order: s.order === other.order ? s.order + dir : s.order })]);
      refreshAll();
    } catch (e) { toastError(e); }
  };
  return (
    <>
      <div className="row wrap ct-bar">
        <p className="muted grow">{plural(active.length, 'prestation')} · {active.filter((s) => s.online).length} réservables en ligne · l’ordre est celui du site</p>
        <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Nouvelle prestation</Button>
      </div>
      <div className="col" style={{ gap: 14 }}>
        {cats.map((c) => (
          <section key={c} className="card">
            <div className="card-h"><h2>{c}</h2><span className="faint" style={{ fontSize: 13 }}>{active.filter((s) => s.category === c).length}</span></div>
            <ul className="list">
              {active.filter((s) => s.category === c).map((s, i, arr) => (
                <li key={s.id} className="ct-row">
                  <button type="button" className="li ct-main" onClick={() => setEdit(s)}>
                    <span className="li-main">
                      <b>{s.name}{s.pack ? <span className="badge badge-ok">{s.pack.credits} passages · {s.pack.days} j</span> : null}</b>
                      <small>{dur(s.dur)}{s.buffer ? ' + ' + s.buffer + ' min de battement' : ''} · TVA {s.vat / 100} %{s.description ? ' · ' + s.description : ''}</small>
                    </span>
                    <span className="ct-flags">
                      {s.online ? <span className="badge"><Icon name="globe" size={12} />en ligne</span> : <span className="badge badge-warn">au salon</span>}
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
            <ul className="list">{archived.map((s) => <li key={s.id} className="li"><span className="li-main"><b>{s.name}</b><small>{s.category} · {eur(s.price)}</small></span><Button size="sm" variant="ghost" onClick={async () => { try { await api.post('/api/v1/services/' + s.id + '/archive', { restore: true }); refreshAll(); toast(s.name + ' est de retour'); } catch (e) { toastError(e); } }}>Remettre en vente</Button></li>)}</ul>
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
  const blank = { name: '', short: '', category: cats[0] || 'Coupes', price: '', from: false, dur: 30, buffer: 0, online: true, deposit: '' as string, depositMode: 'auto' as 'auto' | 'none' | 'custom', vat: boot.settings.payments.vat ?? 2000, description: '', includes: '', isPack: false, credits: 5, days: 70, covers: [] as string[] };
  const [f, setF] = useState(blank);
  const [newCat, setNewCat] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!sv) return;
    if (sv === 'new') { setF(blank); setNewCat(''); return; }
    setF({ name: sv.name, short: sv.short === sv.name ? '' : sv.short, category: sv.category, price: euros(sv.price), from: sv.from, dur: sv.dur, buffer: sv.buffer, online: sv.online, deposit: sv.deposit != null ? euros(sv.deposit) : '', depositMode: sv.deposit == null ? 'auto' : sv.deposit === 0 ? 'none' : 'custom', vat: sv.vat, description: sv.description, includes: sv.includes.join(', '), isPack: !!sv.pack, credits: sv.pack?.credits || 5, days: sv.pack?.days || 70, covers: sv.pack?.serviceIds || [] });
    setNewCat('');
  }, [sv]);
  const price = money.parseEur(f.price);
  const dep = boot.settings.deposits;
  const autoDep = !price || dep.mode === 'none' || (dep.mode === 'threshold' && price < dep.thresholdCents) ? 0 : Math.min(price, Math.max(500, Math.round((price * dep.percent) / 100 / 100) * 100));
  const valid = f.name.trim().length >= 2 && price != null && price >= 0 && (f.category || newCat.trim());
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: f.name.trim(), short: f.short.trim() || undefined, category: (newCat.trim() || f.category), price, from: f.from, dur: f.dur, buffer: f.buffer, online: f.online, vat: f.vat,
        description: f.description.trim(), includes: f.includes.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10)
      };
      body.deposit = f.depositMode === 'auto' ? null : f.depositMode === 'none' ? 0 : money.parseEur(f.deposit) ?? 0;
      if (f.isPack) body.pack = { credits: f.credits, days: f.days, serviceIds: f.covers };
      if (isNew) await api.post('/api/v1/services', body);
      else await api.patch('/api/v1/services/' + (sv as Service).id, body);
      toast({ title: isNew ? 'Prestation créée' : 'Prestation enregistrée', sub: f.online ? 'Elle est à jour sur le site.' : 'Réservable au salon uniquement.', icon: 'check' });
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
  const { boot, now } = useApp();
  const { data, loading } = useQuery<{ items: Gift[]; outstanding: number }>('/api/v1/giftcards');
  const [code, setCode] = useState('');
  const [found, setFound] = useState<any>(null);
  const check = async () => {
    try { setFound(await api.get('/api/v1/giftcards/check?code=' + encodeURIComponent(code.trim()))); } catch (e) { setFound(null); toastError(e); }
  };
  if (loading && !data) return <Skeleton h={300} r={22} />;
  if (!data) return null;
  const live = data.items.filter((g) => g.status === 'active' && g.balance > 0 && g.expires >= boot.today);
  const soon = live.filter((g) => dates.diffDays(boot.today, g.expires) <= 30);
  return (
    <>
      <section className="kpis">
        <Kpi k="En circulation" v={eur(data.outstanding)} s={plural(live.length, 'carte') + ' encore utilisable' + (live.length > 1 ? 's' : '')} icon="gift" />
        <Kpi k="Vendues" v={data.items.length} s={eur(data.items.reduce((t, g) => t + g.amount, 0)) + ' au total'} icon="ticket" />
        <Kpi k="Expirent bientôt" v={soon.length} s="dans les 30 jours" icon="clock" hot={soon.length > 0} />
      </section>
      <Note icon="info">Une carte cadeau n’est pas du chiffre d’affaires à la vente : c’est une dette envers le client, comptée au moment où elle paie une prestation. La TVA suit la même règle.</Note>
      <div className="ct-gifts">
        <section className="card col" style={{ gap: 10 }}>
          <div className="card-h"><h2><Icon name="search" size={16} />Vérifier un code</h2></div>
          <div className="row" style={{ gap: 8 }}><input className="input tnum" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CADO-XXXX-XXXX" onKeyDown={(e) => e.key === 'Enter' && code.trim() && check()} aria-label="Code de la carte" /><Button variant="primary" disabled={code.trim().length < 6} onClick={check}>Vérifier</Button></div>
          {found ? <div className={'note ' + (found.expired || found.status !== 'active' ? 'warn' : found.balance ? 'ok' : '')}><Icon name="gift" /><div><b>{found.balance ? eur(found.balance, { decimals: true }) + ' disponibles' : 'Carte épuisée'}</b> sur {eur(found.amount)} · •••• {found.last4} · {found.expired ? 'expirée le ' : 'valable jusqu’au '}{dates.dayShort(found.expires)} {found.expires.slice(0, 4)}</div></div> : null}
          <Button variant="ghost" icon="plus" onClick={() => navigate('/caisse?vente=1')}>Vendre une carte cadeau</Button>
        </section>
        <section className="card">
          <div className="card-h"><h2><Icon name="gift" size={16} />Toutes les cartes</h2></div>
          {!data.items.length ? <Empty icon="gift" title="Aucune carte vendue">Elles se vendent depuis la caisse, en vente libre.</Empty> : (
            <ul className="list">{data.items.slice(0, 80).map((g) => (
              <li key={g.id} className="li">
                <span className="ct-card"><Icon name="gift" size={16} /></span>
                <span className="li-main"><b>•••• {g.last4}{g.recipient ? ' · ' + g.recipient : ''}</b><small>Vendue {ago(g.issuedAt, now())} · {g.uses ? plural(g.uses, 'utilisation') + ' · ' : ''}{g.expires < boot.today ? 'expirée' : 'valable jusqu’au ' + dates.dayShort(g.expires) + (g.expires.slice(0, 4) !== boot.today.slice(0, 4) ? ' ' + g.expires.slice(0, 4) : '')}</small></span>
                <span className="li-end"><b className="money tnum">{eur(g.balance, { decimals: g.balance % 100 !== 0 })}</b><small className="faint">sur {eur(g.amount)}</small></span>
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </>
  );
}
