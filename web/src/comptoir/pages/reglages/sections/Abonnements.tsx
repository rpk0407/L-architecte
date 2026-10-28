// Abonnements: the monthly membership the salon sells. Up to four formules (name, price a month, cuts a month or illimité,
// the services a cut may be), the grace after a refused payment, and a preview of the card the site shows. A member keeps
// the price and the cuts he signed for: changing a formule moves nobody. No pause, no SEPA, no plan change in v1.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '../../../../lib/query';
import { eur, money } from '../../../../lib/format';
import { Icon } from '../../../../ui/Icon';
import { Button, Chip, Field, Note, Switch } from '../../../../ui/kit';
import { useApp } from '../../../state';
import type { MemberRow, Plan } from '../../../types';
import { Card, SaveBar, num, useSave, useSection, type SectionProps } from '../shared';
import './abonnements.css';

type Membership = { enabled: boolean; plans: Plan[]; graceDays: number };
const MAX = 4;
const CUTS = [1, 2, 3, 4, 0];
const GRACE = [3, 7, 14];
const PRICE_MIN = 500, PRICE_MAX = 50000;

/** « Duo barbe » → duo-barbe: a formule's code, once and for all (the member's links and the site's anchor carry it). */
const slug = (name: string) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const blank = (): Plan => ({ id: '', name: '', price: 3000, cuts: 2, minDays: 0, serviceIds: [], online: true, blurb: '', active: true });

/** What the site's card says of a formule: « 2 coupes par mois · Coupe classique ». */
export function planWords(p: Pick<Plan, 'cuts' | 'minDays'>, names: string[]) {
  const n = p.cuts ? p.cuts + (p.cuts > 1 ? ' coupes' : ' coupe') + ' par mois' : p.minDays ? '1 coupe tous les ' + p.minDays + ' jours' : 'coupes illimitées';
  return n + (names.length ? ' · ' + names.join(', ') : '');
}

export default function Abonnements({ s }: SectionProps) {
  const { boot } = useApp();
  const m = useSection<Membership>(s.membership);
  const { busy, save } = useSave();
  const board = useQuery<{ members: MemberRow[] }>('/api/v1/memberships');
  const services = boot.services.filter((x) => x.active && !x.pack);
  const M = m.v;
  // money moves only in the demo or with a live Stripe key (the server refuses the rest)
  const moneyOk = boot.mode === 'demo' || boot.providers.paymentsLive;
  const holders = useMemo(() => { const n = new Map<string, number>(); for (const r of board.data?.members || []) if (r.status !== 'ended') n.set(r.planId, (n.get(r.planId) || 0) + 1); return n; }, [board.data]);
  const set = (i: number, patch: Partial<Plan>) => m.setV({ ...M, plans: M.plans.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const problem = (p: Plan) => (p.name.trim().length < 2 ? 'Donne un nom à la formule.' : p.price < PRICE_MIN || p.price > PRICE_MAX ? 'Un prix entre 5 € et 500 € par mois.' : !p.serviceIds.length ? 'Coche au moins une prestation couverte.' : '');
  // a new formule's code is chosen once the board of members has said which codes are taken
  const bad = M.plans.some((p) => !!problem(p)) || (M.enabled && !M.plans.some((p) => p.active !== false)) || (!board.data && !board.error && M.plans.some((p) => !p.id));
  const doSave = () => {
    // a new formule's code comes from its name, once, and never the same twice
    // (a formule taken off sale earlier but still held keeps its code too: two contracts never share one)
    const used = new Set([...M.plans.map((p) => p.id), ...(board.data?.members || []).map((r) => r.planId)].filter(Boolean));
    const plans = M.plans.map((p) => {
      let id = p.id;
      if (!id) { const base = slug(p.name) || 'formule'; id = base; for (let n = 2; used.has(id); n++) id = base.slice(0, 21) + '-' + n; used.add(id); }
      return { id, name: p.name.trim(), price: p.price, cuts: p.cuts, minDays: p.cuts === 0 ? p.minDays || 7 : 0, serviceIds: p.serviceIds, ...(p.vat != null ? { vat: p.vat } : {}), online: p.online !== false, blurb: (p.blurb || '').trim(), active: p.active !== false };
    });
    return save({ membership: { enabled: M.enabled, plans, graceDays: M.graceDays } }, 'Abonnements enregistrés');
  };
  const remove = (i: number) => {
    const p = M.plans[i];
    // a formule somebody holds stays, off sale: it only leaves for good while nobody has ever held it
    if (p.id && holders.get(p.id)) set(i, { active: false, online: false });
    else m.setV({ ...M, plans: M.plans.filter((_, j) => j !== i) });
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Abonnements" icon="card" aside={<span className={'badge' + (M.enabled ? ' badge-ok' : '')}>{M.enabled ? 'En vente' : 'Éteint'}</span>}>
        <p className="muted" style={{ fontSize: 13.5 }}>Un client paie chaque mois et ses coupes sont déjà payées : à la caisse, une touche et la coupe passe à 0 €. Il peut résilier quand il veut.</p>
        <div data-guide="abo-switch">
          <Switch on={M.enabled} onChange={(v) => m.setV({ ...M, enabled: v })} disabled={!moneyOk && !M.enabled} title="Vendre des abonnements"
            hint={!moneyOk ? 'Branche Stripe pour vendre des abonnements' : 'Les formules en vente apparaissent sur le site et à la caisse.'} />
        </div>
        {M.enabled && !M.plans.some((p) => p.active !== false) ? <Note tone="warn" icon="alert">Aucune formule en vente : ajoutes-en une avant d’enregistrer.</Note> : null}
      </Card>

      <div className="col" style={{ gap: 14 }} data-guide="abo-plans">
        {M.plans.map((p, i) => (
          <PlanCard key={i} p={p} i={i} set={(patch) => set(i, patch)} remove={() => remove(i)} known={!!board.data || !p.id} problem={problem(p)} holders={p.id ? holders.get(p.id) || 0 : 0}
            saved={s.membership.plans.find((x: Plan) => x.id === p.id)} services={services.map((x) => ({ id: x.id, name: x.name }))} />
        ))}
        <div><Button icon="plus" disabled={M.plans.length >= MAX} onClick={() => m.setV({ ...M, plans: [...M.plans, blank()] })}>Ajouter une formule</Button>{M.plans.length >= MAX ? <span className="muted" style={{ fontSize: 13, marginLeft: 10 }}>{MAX} formules au plus.</span> : null}</div>
      </div>

      <Card title="Après un paiement refusé" icon="alert">
        <div data-guide="abo-grace"><Field label="Délai de grâce" hint="Il garde ses coupes pendant que la banque réessaie. Passé ce délai sans paiement, l’abonnement s’arrête.">
          <div className="chips" role="group" aria-label="Délai de grâce">{[...new Set([...GRACE, M.graceDays])].sort((a, b) => a - b).map((d) => <Chip key={d} on={M.graceDays === d} onClick={() => m.setV({ ...M, graceDays: d })}>{d} jours</Chip>)}</div>
        </Field></div>
      </Card>
      <SaveBar dirty={m.dirty} busy={busy} disabled={bad} onReset={m.reset} onSave={doSave} />
    </div>
  );
}

function PlanCard({ p, i, set, remove, known, problem, holders, saved, services }: { p: Plan; i: number; set: (patch: Partial<Plan>) => void; remove: () => void; known: boolean; problem: string; holders: number; saved?: Plan; services: { id: string; name: string }[] }) {
  // the price is typed as it is said (« 34 », « 34,50 »), never rewritten under the fingers
  const [txt, setTxt] = useState(p.price % 100 ? (p.price / 100).toFixed(2).replace('.', ',') : String(p.price / 100));
  // the price changed from outside (an undo, a reset): the field follows
  useEffect(() => { if (money.parseEur(txt) !== p.price) setTxt(p.price % 100 ? (p.price / 100).toFixed(2).replace('.', ',') : String(p.price / 100)); }, [p.price]);
  const names = p.serviceIds.map((x) => services.find((y) => y.id === x)?.name).filter(Boolean) as string[];
  const cutsOpts = [...new Set([...CUTS, p.cuts])];
  const idl = 'ab-' + i;
  return (
    <section className={'card col ab-plan' + (p.active === false ? ' off' : '')} style={{ gap: 14 }} aria-label={'Formule ' + (p.name || i + 1)}>
      <div className="card-h">
        <h2><Icon name="card" size={16} />{p.name.trim() || 'Nouvelle formule'}</h2>
        <span className="row" style={{ gap: 8 }}>
          {holders ? <span className="badge badge-ok">{holders} abonné{holders > 1 ? 's' : ''}</span> : null}
          {p.active === false ? <span className="badge">Hors vente</span> : null}
          {holders && p.active === false
            ? <Button size="sm" variant="ghost" icon="undo" aria-label={'Remettre en vente la formule ' + (p.name || i + 1)} onClick={() => set({ active: true })}>Remettre en vente</Button>
            : <Button size="sm" variant="ghost" icon="trash" disabled={!known} aria-label={'Retirer la formule ' + (p.name || i + 1)} onClick={remove}>{holders ? 'Arrêter la vente' : 'Retirer'}</Button>}
        </span>
      </div>
      <div className="ab-grid">
        <Field label="Nom" htmlFor={idl + '-n'}><input id={idl + '-n'} className="input" value={p.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} placeholder="Ex. : Essentiel" /></Field>
        <Field label="Prix par mois" htmlFor={idl + '-p'}>
          <div className="row" style={{ gap: 8 }}>
            <input id={idl + '-p'} className="input input-money" inputMode="decimal" value={txt} onChange={(e) => { setTxt(e.target.value); const v = money.parseEur(e.target.value); if (v != null) set({ price: v }); }} onBlur={() => setTxt(p.price % 100 ? (p.price / 100).toFixed(2).replace('.', ',') : String(p.price / 100))} />
            <span className="serif" style={{ fontSize: 22 }}>€</span>
          </div>
        </Field>
      </div>
      <Field label="Coupes par mois">
        <div className="chips" role="group" aria-label="Coupes par mois">{cutsOpts.map((c) => <Chip key={c} on={p.cuts === c} onClick={() => set({ cuts: c, minDays: c === 0 ? p.minDays || 7 : 0 })}>{c === 0 ? 'Illimité' : c}</Chip>)}</div>
      </Field>
      {p.cuts === 0 ? (
        <Field label="Une coupe incluse au plus tous les … jours" htmlFor={idl + '-d'} hint="Évite une coupe par jour : sept jours par défaut.">
          <input id={idl + '-d'} className="input ct-num" inputMode="numeric" value={p.minDays || 7} onChange={(e) => set({ minDays: num(e.target.value, 1, 30) })} style={{ maxWidth: 90 }} />
        </Field>
      ) : null}
      <Field label="Prestations couvertes" hint="Ce que l’abonnement paie : une coupe à 0 € à la caisse.">
        <div className="chips" role="group" aria-label="Prestations couvertes">{services.map((x) => <Chip key={x.id} small on={p.serviceIds.includes(x.id)} onClick={() => set({ serviceIds: p.serviceIds.includes(x.id) ? p.serviceIds.filter((y) => y !== x.id) : [...p.serviceIds, x.id] })}>{x.name}</Chip>)}</div>
      </Field>
      <Field label="Phrase d’accroche (facultatif)" htmlFor={idl + '-b'}><input id={idl + '-b'} className="input" value={p.blurb} maxLength={120} onChange={(e) => set({ blurb: e.target.value })} placeholder="Ex. : 2 coupes par mois, sans engagement." /></Field>
      <Switch on={p.online !== false} onChange={(v) => set({ online: v })} title="En vente sur le site" hint="Sinon, tu ne la proposes qu’au salon, depuis la fiche du client." />
      {problem ? <Note tone="warn" icon="alert">{problem}</Note> : null}
      {saved && saved.price !== p.price ? <Note icon="info">Les abonnés en cours gardent leur prix.</Note> : null}
      <div className="ab-prev" data-guide="abo-preview" aria-label="Aperçu sur le site">
        <p className="section-k">Aperçu sur le site</p>
        <div className="ab-card">
          <b className="ab-n">{p.name.trim() || 'Nom de la formule'}</b>
          <span className="ab-p"><b>{eur(p.price, { decimals: p.price % 100 !== 0 })}</b>/mois</span>
          <span className="ab-w">{planWords(p, names)}</span>
          {p.blurb.trim() ? <span className="ab-b">{p.blurb.trim()}</span> : null}
        </div>
      </div>
    </section>
  );
}
