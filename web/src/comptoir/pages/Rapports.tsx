// Les chiffres: what came in, from whom, when the chairs are full and when they are empty,
// and what to do about it. A barber sees his own numbers and his commission; the owner sees the salon.
import { useEffect, useMemo, useRef, useState } from 'react';
import { qs } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { setQuery, useRoute } from '../../lib/router';
import { cap, dates, eur, METHOD, pct, plural, SOURCE } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Chip, Delta, Empty, Kpi, Skeleton } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import './rapports.css';

type StaffRow = { id: string; name: string; color: string; revenue: number; serviceRevenue: number; productRevenue: number; services: number; tips: number; tickets: number; clients: number; avgTicket: number; done: number; noShows: number; occupancy: number; rebookRate: number; commission: number; rates: { service: number; product: number } };
type Report = {
  from: string; to: string; days: number; scope: 'own' | 'staff' | 'shop';
  revenue: number; revenueHT: number; vat: number; tips: number; tickets: number; avgTicket: number; refunds: number; liability: number; productRevenue: number;
  clients: number; newClients: number; done: number; noShows: number; cancelled: number; lateCancels: number; noShowRate: number; occupancy: number;
  series: { day: string; revenue: number; tickets: number; tips: number }[]; staff: StaffRow[];
  services: { id: string; name: string; count: number; revenue: number }[]; categories: { name: string; revenue: number }[];
  products: { id: string; name: string; count: number; revenue: number; margin: number }[];
  methods: Record<string, number>; sources: Record<string, number>; heatmap: (number | null)[][];
  prev: { revenue: number; tickets: number; avgTicket: number; clients: number; newClients: number; occupancy: number; noShowRate: number; tips: number; series: number[] };
  prevRange: { from: string; to: string };
  goal: { target: number; done: number; days: number; elapsed: number } | null;
};

const PERIODS = [
  { v: 'jour', t: 'Aujourd’hui' }, { v: '7j', t: '7 jours' }, { v: 'mois', t: 'Ce mois' }, { v: 'mois-1', t: 'Mois dernier' }, { v: '90j', t: '3 mois' }, { v: 'annee', t: 'Cette année' }
];
function rangeOf(p: string, today: string): [string, string] {
  switch (p) {
    case 'jour': return [today, today];
    case '7j': return [dates.addDays(today, -6), today];
    case 'mois-1': { const end = dates.addDays(dates.monthStart(today), -1); return [dates.monthStart(end), end]; }
    case '90j': return [dates.addDays(today, -89), today];
    case 'annee': return [today.slice(0, 4) + '-01-01', today];
    default: return [dates.monthStart(today), today];
  }
}
const rel = (cur: number, prev: number) => (prev ? (cur - prev) / Math.abs(prev) : null);
const short = (c: number) => (Math.abs(c) >= 100000 ? (c / 100000).toFixed(c >= 1000000 ? 0 : 1).replace('.', ',') + ' k€' : eur(c));

export default function Rapports() {
  const { boot, can, staffById } = useApp();
  const route = useRoute();
  const shop = can('report.shop');
  const p = route.query.get('p') || 'mois';
  const custom = p === 'perso';
  const [from, to] = custom ? [route.query.get('du') || dates.monthStart(boot.today), route.query.get('au') || boot.today] : rangeOf(p, boot.today);
  const staff = shop ? route.query.get('barbier') : null;
  const { data, loading, error } = useQuery<Report>('/api/v1/reports' + qs({ from, to, staff }));
  const barbers = boot.staff.filter((s) => s.chair && s.active);
  const title = shop ? 'Rapports' : 'Mes chiffres';

  return (
    <>
      <PageTitle><h1>{title}</h1></PageTitle>
      <div className="rp-filters">
        <div className="chips rp-periods" role="group" aria-label="Période">
          {PERIODS.map((x) => <Chip key={x.v} small on={p === x.v} onClick={() => setQuery({ p: x.v === 'mois' ? null : x.v, du: null, au: null })}>{x.t}</Chip>)}
          <Chip small on={custom} onClick={() => setQuery({ p: 'perso', du: from, au: to })}>Dates…</Chip>
        </div>
        {custom ? (
          <div className="row rp-dates">
            <input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setQuery({ du: e.target.value })} aria-label="Du" />
            <span className="faint">→</span>
            <input className="input" type="date" value={to} min={from} max={boot.today} onChange={(e) => e.target.value && setQuery({ au: e.target.value })} aria-label="Au" />
          </div>
        ) : null}
        {shop ? (
          <div className="chips rp-staff" role="group" aria-label="Barbier">
            <Chip small on={!staff} onClick={() => setQuery({ barbier: null })}>Tout le salon</Chip>
            {barbers.map((s) => <Chip key={s.id} small dot={s.color} on={staff === s.id} onClick={() => setQuery({ barbier: s.id })}>{s.name}</Chip>)}
          </div>
        ) : null}
      </div>

      {error ? <Empty icon="alert" title="Chiffres indisponibles">{error.message}</Empty> : loading && !data ? (
        <div className="col" style={{ gap: 14 }}><div className="kpis">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={118} r={22} />)}</div><Skeleton h={300} r={22} /></div>
      ) : data ? <Body r={data} shop={shop} who={staff ? staffById.get(staff)?.name || '' : ''} /> : null}
    </>
  );
}

function Body({ r, shop, who }: { r: Report; shop: boolean; who: string }) {
  const { boot, can } = useApp();
  const mine = r.scope === 'own' ? r.staff[0] : r.scope === 'staff' ? r.staff[0] : null;
  const span = r.from === r.to ? cap(dates.dayLong(r.from)) : 'Du ' + dates.dayShort(r.from) + ' au ' + dates.dayShort(r.to);
  const prevSpan = r.prevRange.from === r.prevRange.to ? dates.dayShort(r.prevRange.from) : dates.dayShort(r.prevRange.from) + ' → ' + dates.dayShort(r.prevRange.to);
  const nothing = !r.tickets && !r.done && !r.noShows;
  return (
    <div className="col" style={{ gap: 16 }}>
      <p className="muted rp-span">{span}{who ? ' · ' + who : ''} · comparé à {prevSpan}</p>
      {r.goal && r.scope === 'shop' ? <Goal g={r.goal} /> : null}
      <section className="kpis k5">
        <Kpi k="Chiffre d’affaires" v={eur(r.revenue)} s={'HT ' + eur(r.revenueHT) + (r.refunds ? ' · avoirs ' + eur(r.refunds) : '')} delta={rel(r.revenue, r.prev.revenue)} icon="euro" />
        <Kpi k="Panier moyen" v={eur(r.avgTicket)} s={plural(r.tickets, 'ticket')} delta={rel(r.avgTicket, r.prev.avgTicket)} icon="ticket" />
        <Kpi k="Clients" v={r.clients} s={r.newClients ? r.newClients + ' nouveau' + (r.newClients > 1 ? 'x' : '') : 'aucun nouveau'} delta={rel(r.clients, r.prev.clients)} icon="clients" />
        <Kpi k="Remplissage" v={pct(r.occupancy)} s={r.noShows ? plural(r.noShows, 'absence') + ' · ' + pct(r.noShowRate, 1) : 'aucune absence'} delta={rel(r.occupancy, r.prev.occupancy)} bar={r.occupancy} icon="chair" />
        {mine && r.scope !== 'shop' ? <Kpi k="Commission estimée" v={eur(mine.commission)} s={'prestations ' + mine.rates.service / 100 + ' % · produits ' + mine.rates.product / 100 + ' %'} icon="percent" /> : <Kpi k="Pourboires" v={eur(r.tips)} s="hors chiffre d’affaires" delta={rel(r.tips, r.prev.tips)} icon="heart" />}
      </section>
      {nothing ? <section className="card"><Empty icon="rapports" title="Rien sur cette période">Choisis une autre période : les chiffres se remplissent à chaque encaissement.</Empty></section> : (
        <>
          <section className="card">
            <div className="card-h">
              <h2><Icon name="rapports" size={16} />Chiffre par jour</h2>
              <span className="rp-legend"><i className="sw cur" />Cette période<i className="sw prev" />Période précédente</span>
            </div>
            <Bars series={r.series} prev={r.prev.series} />
          </section>
          <Insights r={r} />
          <div className="rp-two">
            <div className="col" style={{ gap: 16 }}>
              <section className="card">
                <div className="card-h"><h2><Icon name="clock" size={16} />Quand les fauteuils sont pleins</h2></div>
                <Heat map={r.heatmap} />
              </section>
              {Object.keys(r.methods).length ? (
                <section className="card">
                  <div className="card-h"><h2><Icon name="card" size={16} />Encaissements</h2></div>
                  <Split parts={Object.entries(r.methods).filter(([k]) => !k.startsWith('refund_')).map(([k, v]) => ({ k, label: METHOD[k] || k, v }))} money />
                </section>
              ) : null}
              <section className="card">
                <div className="card-h"><h2><Icon name="calendar" size={16} />D’où viennent les rendez-vous</h2></div>
                <Split parts={Object.entries(r.sources).filter(([, v]) => v > 0).map(([k, v]) => ({ k, label: k === 'site' ? 'Site' : SOURCE[k] || k, v }))} />
              </section>
            </div>
            <section className="card">
              <div className="card-h"><h2><Icon name="scissors" size={16} />Prestations</h2><span className="faint" style={{ fontSize: 13 }}>{plural(r.services.reduce((t, x) => t + x.count, 0), 'prestation')}</span></div>
              <Ranked rows={r.services.slice(0, 8).map((x) => ({ k: x.id, name: x.name, sub: x.count + ' ×', v: x.revenue }))} />
              {r.products.length ? (
                <>
                  <div className="card-h" style={{ marginTop: 18 }}><h2><Icon name="box" size={16} />Produits</h2><span className="faint" style={{ fontSize: 13 }}>{pct(r.revenue ? r.productRevenue / r.revenue : 0)} du chiffre</span></div>
                  <Ranked rows={r.products.slice(0, 5).map((x) => ({ k: x.id, name: x.name, sub: x.count + ' vendu' + (x.count > 1 ? 's' : '') + (shop ? ' · marge ' + eur(x.margin) : ''), v: x.revenue }))} />
                </>
              ) : null}
            </section>
          </div>
          {r.scope === 'shop' ? <Team rows={r.staff} r={r} /> : null}
          <Exports from={r.from} to={r.to} shop={shop} canTeam={can('team')} canClosure={can('closure')} canData={can('data')} mode={boot.mode} />
        </>
      )}
    </div>
  );
}

/* ---------------- the month's target ---------------- */

function Goal({ g }: { g: { target: number; done: number; days: number; elapsed: number } }) {
  const proj = g.elapsed ? Math.round((g.done / g.elapsed) * g.days / 100) * 100 : 0;
  const ratio = g.target ? g.done / g.target : 0;
  const left = Math.max(0, g.target - g.done);
  const daysLeft = Math.max(0, g.days - g.elapsed);
  const ahead = proj >= g.target;
  return (
    <section className="card rp-goal">
      <div className="grow">
        <p className="section-k">Objectif du mois</p>
        <p className="rp-goal-v"><b className="money">{eur(g.done)}</b> <span>sur {eur(g.target)}</span></p>
        <div className="rp-track" role="img" aria-label={pct(ratio) + ' de l’objectif'}>
          <i style={{ width: Math.min(100, ratio * 100) + '%' }} />
          <s style={{ left: Math.min(100, (g.elapsed / g.days) * 100) + '%' }} title="Où on devrait en être aujourd’hui" />
        </div>
      </div>
      <div className="rp-goal-side">
        <span className={'badge ' + (ahead ? 'badge-ok' : 'badge-warn')}>{ahead ? 'en avance' : 'en retard'}</span>
        <p>Au rythme actuel : <b className="money">{eur(proj)}</b> fin du mois.</p>
        {left && daysLeft ? <p className="faint">Il reste {eur(left)} à faire en {plural(daysLeft, 'jour')}.</p> : left ? null : <p className="faint">Objectif atteint.</p>}
      </div>
    </section>
  );
}

/* ---------------- bars by day, last period as a dotted line ---------------- */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Bars({ series, prev }: { series: Report['series']; prev: number[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  // a long period reads better by week
  const weekly = series.length > 45;
  const pts = useMemo(() => {
    if (!weekly) return series.map((d, i) => ({ label: d.day, v: d.revenue, p: prev[i] ?? null, n: d.tickets }));
    const out: { label: string; v: number; p: number | null; n: number }[] = [];
    series.forEach((d, i) => {
      const k = dates.weekStart(d.day);
      let b = out[out.length - 1];
      if (!b || b.label !== k) { b = { label: k, v: 0, p: 0, n: 0 }; out.push(b); }
      b.v += d.revenue; b.n += d.tickets; b.p = (b.p || 0) + (prev[i] || 0);
    });
    return out;
  }, [series, prev]);
  const H = 220, padL = 48, padB = 26, padT = 10;
  const max = Math.max(1, ...pts.map((x) => x.v), ...pts.map((x) => x.p || 0));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const iw = w - padL - 4, ih = H - padB - padT;
  const bw = iw / pts.length;
  const y = (v: number) => padT + ih - (v / top) * ih;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  // closed days break the line instead of dragging it to zero
  const line = pts.map((x, i) => (!x.p ? '' : (i && pts[i - 1].p ? 'L' : 'M') + (padL + bw * i + bw / 2).toFixed(1) + ' ' + y(x.p).toFixed(1))).join(' ');
  const every = Math.ceil(pts.length / Math.max(2, Math.floor(iw / 64)));
  const h = hover != null ? pts[hover] : null;
  return (
    <div ref={ref} className="rp-chart" onMouseLeave={() => setHover(null)}>
      <svg width={w} height={H} role="img" aria-label="Chiffre d’affaires par jour">
        {ticks.map((t) => <g key={t}><line x1={padL} x2={w - 4} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 8} y={y(t) + 4} className="ax" textAnchor="end">{short(t)}</text></g>)}
        {pts.map((x, i) => {
          const bh = Math.max(x.v > 0 ? 2 : 0, ih - (y(x.v) - padT));
          const bx = padL + bw * i + Math.max(1, bw * 0.16), bwi = Math.max(2, bw * 0.68);
          return (
            <g key={x.label}>
              <path d={roundTop(bx, y(x.v), bwi, bh, Math.min(4, bwi / 2))} className={'bar' + (hover === i ? ' on' : '') + (dates.weekday(x.label) === 6 && !weekly ? ' sat' : '')} />
              {i % every === 0 ? <text x={padL + bw * i + bw / 2} y={H - 8} className="ax" textAnchor="middle">{weekly ? dates.dayParts(x.label).d + ' ' + dates.MONTHS_SH[dates.dayParts(x.label).m - 1] : pts.length <= 8 ? dates.DAYS_SH[dates.weekday(x.label)] + ' ' + dates.dayParts(x.label).d : String(dates.dayParts(x.label).d)}</text> : null}
              <rect x={padL + bw * i} y={padT} width={bw} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            </g>
          );
        })}
        {line ? <path d={line} className="prev" /> : null}
      </svg>
      {h ? (
        <div className="rp-tip" style={{ left: Math.min(w - 190, Math.max(0, padL + bw * (hover as number) + bw / 2 - 90)) }}>
          <b>{weekly ? 'Semaine du ' + dates.dayShort(h.label) : cap(dates.dayShort(h.label))}</b>
          <span><i className="sw cur" />{eur(h.v)} · {plural(h.n, 'ticket')}</span>
          {h.p != null ? <span><i className="sw prev" />{eur(h.p)} avant {h.p ? <Delta v={(h.v - h.p) / h.p} /> : null}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
function niceStep(max: number) {
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
function roundTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  r = Math.min(r, h);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

/* ---------------- occupancy by weekday and hour ---------------- */

function Heat({ map }: { map: (number | null)[][] }) {
  const [hover, setHover] = useState<{ wd: number; h: number } | null>(null);
  const days = [1, 2, 3, 4, 5, 6, 0].filter((wd) => map[wd].some((v) => v != null));
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) if (days.some((wd) => map[wd][h] != null)) hours.push(h);
  if (!days.length) return <Empty icon="clock" title="Pas encore de données" />;
  const v = hover ? map[hover.wd][hover.h] : null;
  return (
    <div className="rp-heat">
      <div className="rp-heat-grid" style={{ gridTemplateColumns: `44px repeat(${hours.length}, minmax(0, 1fr))` }} onMouseLeave={() => setHover(null)}>
        <span />
        {hours.map((h) => <span key={h} className="hh">{h % 2 === 0 || hours.length < 10 ? h + 'h' : ''}</span>)}
        {days.map((wd) => [
          <span key={'d' + wd} className="hd">{dates.DAYS_SH[wd]}</span>,
          ...hours.map((h) => {
            const x = map[wd][h];
            return <button type="button" key={wd + '-' + h} className={'cell' + (x == null ? ' off' : '') + (hover && hover.wd === wd && hover.h === h ? ' on' : '')} style={x == null ? undefined : { ['--o' as any]: (0.1 + 0.9 * x).toFixed(2) }} onMouseEnter={() => setHover({ wd, h })} onFocus={() => setHover({ wd, h })} onClick={() => setHover({ wd, h })} aria-label={dates.DAYS_FR[wd] + ' ' + h + ' h : ' + (x == null ? 'fermé' : pct(x) + ' occupé')} />;
          })
        ])}
      </div>
      <p className="rp-heat-k">{hover ? <><b>{cap(dates.DAYS_FR[hover.wd])} {hover.h} h–{hover.h + 1} h</b> · {v == null ? 'fermé' : pct(v) + ' des fauteuils occupés'}</> : <span className="faint">Plus c’est rouge, plus c’est plein. Survole une case pour le détail.</span>}<span className="rp-scale" aria-hidden><i style={{ ['--o' as any]: 0.1 }} /><i style={{ ['--o' as any]: 0.4 }} /><i style={{ ['--o' as any]: 0.7 }} /><i style={{ ['--o' as any]: 1 }} /></span></p>
    </div>
  );
}

/* ---------------- ranked lists, splits, team ---------------- */

function Ranked({ rows }: { rows: { k: string; name: string; sub: string; v: number }[] }) {
  const max = Math.max(1, ...rows.map((x) => x.v));
  if (!rows.length) return <p className="muted">Rien sur cette période.</p>;
  return (
    <ul className="rp-ranked">
      {rows.map((x) => (
        <li key={x.k}>
          <span className="nm"><b>{x.name}</b><small>{x.sub}</small></span>
          <span className="vl money tnum">{eur(x.v)}</span>
          <span className="tr" aria-hidden><i style={{ width: (x.v / max) * 100 + '%' }} /></span>
        </li>
      ))}
    </ul>
  );
}

function Split({ parts, money }: { parts: { k: string; label: string; v: number }[]; money?: boolean }) {
  const total = parts.reduce((t, x) => t + x.v, 0);
  if (!total) return <p className="muted">Rien sur cette période.</p>;
  const sorted = [...parts].sort((a, b) => b.v - a.v);
  const tone = (i: number) => ['var(--tx)', 'var(--stone)', 'var(--tx2)', 'var(--tx3)', 'var(--panel4)'][Math.min(4, i)];
  return (
    <div className="rp-split">
      <div className="bar" role="img" aria-label={sorted.map((x) => x.label + ' ' + pct(x.v / total)).join(', ')}>{sorted.map((x, i) => <i key={x.k} style={{ flex: x.v, background: tone(i) }} title={x.label} />)}</div>
      <ul>{sorted.map((x, i) => <li key={x.k}><i className="sw" style={{ background: tone(i) }} /><span className="grow">{x.label}</span><b className={money ? 'money tnum' : 'tnum'}>{money ? eur(x.v) : x.v}</b><span className="faint tnum">{pct(x.v / total)}</span></li>)}</ul>
    </div>
  );
}

function Team({ rows, r }: { rows: StaffRow[]; r: Report }) {
  const max = Math.max(1, ...rows.map((x) => x.revenue));
  return (
    <section className="card">
      <div className="card-h"><h2><Icon name="equipe" size={16} />L’équipe</h2><span className="faint" style={{ fontSize: 13 }}>Commission = prestations × taux + produits × taux</span></div>
      <div className="table-wrap">
        <table className="table rp-team">
          <thead><tr><th>Barbier</th><th className="num">Chiffre</th><th className="num">Prestations</th><th className="num">Panier</th><th className="num">Remplissage</th><th className="num" title="Clients qui reprennent rendez-vous avant de partir">Reprise RDV</th><th className="num">Absences</th><th className="num">Pourboires</th><th className="num">Commission</th></tr></thead>
          <tbody>{rows.filter((x) => x.revenue || x.done).map((x) => (
            <tr key={x.id}>
              <td><span className="row" style={{ gap: 10 }}><i className="sw" style={{ background: x.color }} /><b>{x.name}</b></span><span className="tr" aria-hidden><i style={{ width: (x.revenue / max) * 100 + '%', background: x.color }} /></span></td>
              <td className="num money"><b>{eur(x.revenue)}</b><small>{r.revenue ? pct(x.revenue / r.revenue) : ''}</small></td>
              <td className="num">{x.services}</td>
              <td className="num money">{eur(x.avgTicket)}</td>
              <td className="num">{pct(x.occupancy)}</td>
              <td className="num">{x.done ? pct(x.rebookRate) : '—'}</td>
              <td className="num">{x.noShows || '—'}</td>
              <td className="num money">{eur(x.tips)}</td>
              <td className="num money"><b>{eur(x.commission)}</b></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- what the numbers say ---------------- */

function Insights({ r }: { r: Report }) {
  const { boot } = useApp();
  const out: { icon: string; tone: string; title: string; body: string }[] = [];
  // the fullest and the emptiest hour
  const cells: { wd: number; h: number; v: number }[] = [];
  r.heatmap.forEach((row, wd) => row.forEach((v, h) => { if (v != null) cells.push({ wd, h, v }); }));
  const own = r.scope === 'own';
  if (cells.length > 6 && r.days >= 14 && !own) {
    const full = cells.reduce((a, b) => (b.v > a.v ? b : a));
    const mid = cells.filter((c) => c.h >= 10 && c.h < 18);
    const empty = mid.length ? mid.reduce((a, b) => (b.v < a.v ? b : a)) : null;
    if (full.v > 0.85) out.push({ icon: 'bolt', tone: 'accent', title: cap(dates.DAYS_FR[full.wd]) + ' ' + full.h + ' h est plein à ' + pct(full.v), body: 'Des clients repartent sans place. Un fauteuil de plus ce créneau-là, ou un tarif « heure de pointe », se rentabilise vite.' });
    if (empty && empty.v < 0.45) out.push({ icon: 'clock', tone: '', title: cap(dates.DAYS_FR[empty.wd]) + ' ' + empty.h + ' h n’est rempli qu’à ' + pct(empty.v), body: 'Une relance ciblée ou une offre sur ce créneau remplit les heures creuses sans brader les heures pleines.' });
  }
  if (r.noShows >= 2 && r.avgTicket) {
    const cost = Math.round((r.noShows * r.avgTicket) / 100) * 100;
    const dep = boot.settings.deposits;
    out.push({ icon: 'alert', tone: 'warn', title: 'Les absences ont coûté environ ' + eur(cost), body: own ? 'Le rappel la veille et le lien pour déplacer partent tout seuls. Un client qui manque deux fois est signalé sur sa fiche.' : dep.mode === 'off' ? 'Active l’acompte en ligne dans Réglages : les absences baissent nettement quand le client a payé une partie.' : 'L’acompte est actif au-delà de ' + eur(dep.thresholdCents) + '. Le baisser couvrirait plus de rendez-vous.' });
  }
  const done = r.staff.reduce((t, x) => t + x.done, 0);
  const rebook = done ? r.staff.reduce((t, x) => t + x.rebookRate * x.done, 0) / done : 0;
  if (done >= 10) out.push({ icon: 'calendar', tone: rebook >= 0.35 ? 'ok' : '', title: pct(rebook) + (own ? ' de tes clients reprennent' : ' des clients reprennent') + ' rendez-vous avant de partir', body: rebook >= 0.35 ? 'Très bon réflexe. L’écran de fin d’encaissement propose déjà trois créneaux à son rythme.' : 'C’est le levier le plus simple : à la fin de l’encaissement, la caisse propose trois créneaux à son rythme. Un tap suffit.' });
  const mine = own ? r.staff[0] : null;
  if (mine && mine.revenue && mine.rates.product) {
    const share = mine.productRevenue / mine.revenue;
    if (share < 0.12) out.push({ icon: 'box', tone: '', title: 'Les produits font ' + pct(share) + ' de ton chiffre', body: 'Chaque produit vendu te rapporte ' + mine.rates.product / 100 + ' %. Conseiller la cire ou l’huile utilisée pendant la coupe, c’est souvent oui.' });
  }
  const site = r.sources.site || 0, all = Object.values(r.sources).reduce((t, v) => t + v, 0);
  if (all >= 10 && !own) out.push({ icon: 'globe', tone: '', title: pct(site / all) + ' des rendez-vous sont pris en ligne', body: site / all < 0.4 ? 'Mets le lien de réservation en bio Instagram et sur la fiche Google : chaque réservation en ligne, c’est un appel de moins pendant une coupe.' : 'Autant d’appels en moins pendant les coupes, et des confirmations envoyées toutes seules.' });
  if (!out.length) return null;
  return (
    <section className="rp-insights" aria-label="Ce que disent les chiffres">
      {out.slice(0, 4).map((x) => <div key={x.title} className={'rp-ins ' + x.tone}><Icon name={x.icon} /><div><b>{x.title}</b><p>{x.body}</p></div></div>)}
    </section>
  );
}

function Exports({ from, to, shop, canTeam, canClosure, canData, mode }: { from: string; to: string; shop: boolean; canTeam: boolean; canClosure: boolean; canData: boolean; mode: string }) {
  const q = (kind: string) => '/api/v1/export' + qs({ kind, from, to });
  const items = [
    shop ? { href: q('sales'), t: 'Ventes détaillées', s: 'Une ligne par article, pour le comptable', icon: 'ticket' } : null,
    shop ? { href: q('vat'), t: 'TVA et clôtures Z', s: 'Chiffre HT, TVA, moyens de paiement, grand total', icon: 'lock' } : null,
    canTeam ? { href: q('commissions'), t: 'Commissions', s: 'Par barbier, pour la paie', icon: 'percent' } : null,
    canData ? { href: q('journal'), t: 'Archive du journal', s: 'Toutes les opérations scellées, vérifiables (JSON)', icon: 'shield' } : null
  ].filter(Boolean) as { href: string; t: string; s: string; icon: string }[];
  if (!items.length) return null;
  return (
    <section className="card">
      <div className="card-h"><h2><Icon name="download" size={16} />Exports</h2><span className="faint" style={{ fontSize: 13 }}>Période affichée · CSV compatible Excel</span></div>
      <div className="rp-exports">{items.map((x) => <a key={x.t} className="rp-exp" href={x.href} download><Icon name={x.icon} /><span><b>{x.t}</b><small>{x.s}</small></span><Icon name="download" /></a>)}</div>
      {canClosure && mode === 'production' ? <p className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>Les tickets et les Z ne se modifient jamais : l’export est la copie fidèle du journal.</p> : null}
    </section>
  );
}
