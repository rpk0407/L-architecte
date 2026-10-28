// Comptabilité (CPT-03): how the books are kept, set once with the accountant. The VAT choices (regime, VAT on services,
// gift cards as the till books them, deposits taxed when paid, Stripe's fees self-assessed), the chart of accounts the
// files post to, who the accountant is, and the month's files for him: the entries (an import file and its Excel copy),
// the VAT to declare and the month-end balances. The server builds and checks every file (domain/ledger.js).
import { useState } from 'react';
import { useQuery } from '../../../../lib/query';
import { dates, eur } from '../../../../lib/format';
// @ts-ignore — plain JS module with JSDoc types
import { ACCOUNT_ROLES, DEFAULT_ACCOUNTS, ACCOUNT_PATTERN } from '../../../../../../shared/accounts.js';
import { Button, Field, Money, Note, Seg, Skeleton, Switch, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';
import './compta.css';

type Regime = 'a-confirmer' | 'reel-mensuel' | 'reel-trimestriel' | 'simplifie' | 'franchise';
type ComptaCfg = {
  regime: Regime; servicesVat: 'encaissements' | 'debits'; giftcards: 'multiple'; depositVat: boolean; feesReverseCharge: boolean;
  accounts: Record<string, string>; accountant: { name: string; firm: string; email: string }; autoSend: boolean;
};
type Role = { role: string; account: string; label: string; group: string; alias?: boolean; soon?: boolean };
type Row = { rate: number; base: number; tax: number };
type Vat = { month: string; label: string; rows: Row[]; tax: number; adjustments: { deposits: { base: number; tax: number } }; autoliquidation: { label: string; base: number; tax: number }; ticketsVat: Row[]; warnings: string[]; period: 'definitif' | 'provisoire'; open: string[] };
type Balances = { day: string; giftcards: { closing: number; legacy: { count: number; balance: number } }; packs: { open: number; cutsLeft: number; value: number; valueHT: number }; deposits: { count: number; amount: number }; stripe: number; payouts: boolean };

const ROLES = (ACCOUNT_ROLES as Role[]).filter((r) => !r.soon);
const GROUPS = [...new Set(ROLES.map((r) => r.group))];
const REGIMES: { v: Regime; t: string }[] = [{ v: 'a-confirmer', t: 'À confirmer' }, { v: 'reel-mensuel', t: 'Réel mensuel' }, { v: 'reel-trimestriel', t: 'Réel trimestriel' }, { v: 'simplifie', t: 'Simplifié' }, { v: 'franchise', t: 'Franchise' }];
const REGIME_HINT: Record<Regime, string> = {
  'a-confirmer': 'Demande-le à ton comptable : il est sur ton dernier avis de TVA.',
  'reel-mensuel': 'Une déclaration CA3 chaque mois.',
  'reel-trimestriel': 'Une déclaration CA3 par trimestre (moins de 4 000 € de TVA par an).',
  simplifie: 'Le régime simplifié disparaît le 1er janvier 2027 : vois avec ton comptable le régime qui le remplace.',
  franchise: 'Pas de TVA facturée : tes tarifs du Catalogue doivent alors être à 0 %.'
};
const pct = (rate: number) => String(rate / 100).replace('.', ',') + ' %';
/** 'YYYY-MM' of the month before `day`, and the eleven before it */
const lastMonths = (today: string) => {
  const out: string[] = [];
  let d = dates.addDays(dates.monthStart(today), -1);
  for (let i = 0; i < 12; i++) { out.push(d.slice(0, 7)); d = dates.addDays(dates.monthStart(d), -1); }
  return [today.slice(0, 7), ...out];
};
/** The same as the server's 409 (domain/ledger.js openWords): a past day misses its Z, today's month is not over. */
const openWords = (day: string, today: string) => day >= today
  ? monthLabel(day.slice(0, 7)).replace(/ \d{4}$/, '') + ' n’est pas terminé (Z du ' + dates.dayLong(day) + ' à faire).'
  : 'Il manque le Z du ' + dates.dayLong(day) + '.';
const isEmail = (v: string) => !v || /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(v);
const monthLabel = (m: string) => { const t = dates.MONTHS_FR[Number(m.slice(5, 7)) - 1]; return t.charAt(0).toUpperCase() + t.slice(1) + ' ' + m.slice(0, 4); };

/** A file from the server: downloaded as is, or its refusal said (a day without Z). */
async function download(url: string) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw Object.assign(new Error((j && j.error && j.error.message) || 'Erreur ' + res.status), { code: j && j.error && j.error.code });
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'export';
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  toast({ title: name + ' téléchargé', icon: 'download' });
}

export default function Compta({ s }: SectionProps) {
  const { boot, can } = useApp();
  const sec = useSection<ComptaCfg>(s.compta);
  const c = sec.v;
  const { busy, save } = useSave();
  const set = (patch: Partial<ComptaCfg>) => sec.setV({ ...c, ...patch });
  const bad = ROLES.filter((r) => !ACCOUNT_PATTERN.test(c.accounts[r.role] ?? ''));
  const badMail = !isEmail(c.accountant.email);
  const changed = Object.keys(DEFAULT_ACCOUNTS).some((k) => (c.accounts[k] ?? DEFAULT_ACCOUNTS[k]) !== DEFAULT_ACCOUNTS[k]);
  // the rates the salon sells at: one rate everywhere is the case the BOFiP calls a single-purpose voucher
  const rates = new Set<number>([s.payments.vat, ...boot.services.filter((x) => x.active).map((x) => x.vat), ...boot.products.filter((x) => x.active).map((x) => x.vat)]);
  const oneRate = rates.size === 1 ? [...rates][0] : null;
  const debits = c.servicesVat === 'debits';
  return (
    <div className="col cp" style={{ gap: 16 }}>
      <Card title="TVA" icon="percent">
        <div className="col" style={{ gap: 16 }} data-guide="compta.vat">
          <Field label="Régime" hint={REGIME_HINT[c.regime]}><Seg<Regime> label="Régime de TVA" value={c.regime} onChange={(regime) => set({ regime })} options={REGIMES} /></Field>
          <Field label="TVA des prestations" hint={debits ? 'Option sur les débits : la TVA est due à la prestation, un acompte n’en porte pas.' : 'La règle pour les services : la TVA est due quand l’argent arrive (un acompte la porte le jour où il est payé).'}>
            <Seg<'encaissements' | 'debits'> label="TVA des prestations" value={c.servicesVat} onChange={(servicesVat) => set({ servicesVat })} options={[{ v: 'encaissements', t: 'À l’encaissement' }, { v: 'debits', t: 'Sur les débits' }]} />
          </Field>
          <div className="cp-fixed" data-guide="compta.giftcards">
            <b>Cartes cadeaux : TVA à l’utilisation (comme ta caisse)</b>
            <small>{oneRate != null
              ? 'Tous tes tarifs sont à ' + pct(oneRate) + ' : une carte valable seulement chez toi peut être « à usage unique », avec la TVA due à la vente (BOFiP TVA-CHAMP-10-10-40-50). Change-le avec ton comptable.'
              : 'Tu as plusieurs taux : la carte est « à usages multiples », la TVA est due quand elle sert, comme sur tes tickets. Change-le avec ton comptable.'}</small>
          </div>
          <Switch on={c.depositVat && !debits} disabled={debits} onChange={(depositVat) => set({ depositVat })} title="TVA sur les acomptes le jour du paiement"
            hint={debits ? 'Sur les débits, un acompte ne porte pas de TVA.' : 'Un acompte payé en ligne porte sa TVA le jour où il arrive ; le ticket qui l’utilise la reprend.'} />
          <Switch on={c.feesReverseCharge} onChange={(feesReverseCharge) => set({ feesReverseCharge })} title="Autoliquider la TVA des frais Stripe"
            hint="Stripe facture depuis l’Irlande : la TVA de ses frais est due et déductible en même temps, sur ta CA3." />
          <p className="muted cp-foot">À valider une fois avec ton comptable.</p>
        </div>
      </Card>

      <Card title="Plan de comptes" icon="journal" aside={changed ? <span className="badge">Modifié</span> : null}>
        <div className="col" style={{ gap: 14 }} data-guide="compta.accounts">
          <p className="muted" style={{ fontSize: 13.5 }}>Les numéros où vont tes ventes, ta TVA et tes encaissements dans les fichiers du comptable. Garde ceux par défaut, ou reprends ceux de son plan.</p>
          {GROUPS.map((g) => (
            <div key={g} className="cp-group" role="group" aria-labelledby={'cp-g-' + g}>
              <p className="section-k" id={'cp-g-' + g}>{g}</p>
              <ul className="cp-list">
                {ROLES.filter((r) => r.group === g).map((r) => {
                  const v = c.accounts[r.role] ?? r.account;
                  const err = !ACCOUNT_PATTERN.test(v);
                  const id = 'cp-' + r.role.replace(/\W/g, '-');
                  return (
                    <li key={r.role} className="cp-row">
                      <label htmlFor={id} className="grow">{r.label}{v !== r.account ? <small>par défaut {r.account}</small> : null}</label>
                      <input id={id} className={'input cp-num' + (err ? ' err' : '')} inputMode="numeric" autoComplete="off" maxLength={10} value={v} aria-invalid={err || undefined} aria-describedby={err ? id + '-e' : undefined}
                        onChange={(e) => set({ accounts: { ...c.accounts, [r.role]: e.target.value.replace(/\D/g, '').slice(0, 10) } })} />
                      {err ? <span id={id + '-e'} className="hint err cp-err" role="alert">3 à 10 chiffres</span> : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="muted cp-foot">Un mois déjà envoyé, téléchargé de nouveau, prend les numéros d’aujourd’hui : change-les plutôt en début d’exercice.</p>
          <div><Button variant="ghost" icon="undo" disabled={!changed} onClick={() => set({ accounts: { ...DEFAULT_ACCOUNTS } })}>Remettre les comptes par défaut</Button></div>
        </div>
      </Card>

      <Card title="Ton comptable" icon="user">
        <div className="col" style={{ gap: 12 }} data-guide="compta.accountant">
          <div className="grid2 stack">
            <Field label="Nom" htmlFor="cp-acc-name"><input id="cp-acc-name" className="input" autoComplete="off" maxLength={120} value={c.accountant.name} onChange={(e) => set({ accountant: { ...c.accountant, name: e.target.value } })} /></Field>
            <Field label="Cabinet" htmlFor="cp-acc-firm"><input id="cp-acc-firm" className="input" autoComplete="off" maxLength={120} value={c.accountant.firm} onChange={(e) => set({ accountant: { ...c.accountant, firm: e.target.value } })} /></Field>
          </div>
          <Field label="E-mail" htmlFor="cp-acc-mail" error={badMail ? 'Adresse e-mail incorrecte' : undefined}><input id="cp-acc-mail" className={'input' + (badMail ? ' err' : '')} type="email" inputMode="email" autoComplete="off" maxLength={120} value={c.accountant.email} aria-invalid={badMail || undefined} onChange={(e) => set({ accountant: { ...c.accountant, email: e.target.value.trim() } })} /></Field>
          <Switch on={c.autoSend} onChange={(autoSend) => set({ autoSend })} title="Lui envoyer le pack chaque mois" hint="Le mois clôturé, ses fichiers partent seuls à cette adresse, avec le pack comptable." />
        </div>
      </Card>

      {can('compta') ? <Exports today={boot.today} /> : null}

      <SaveBar dirty={sec.dirty} busy={busy} disabled={bad.length > 0 || badMail} onReset={sec.reset} onSave={() => save({ compta: c }, 'Comptabilité enregistrée')} />
    </div>
  );
}

/** The files alone, for a manager (cap `compta`, no settings): Réglages › Comptabilité without its configuration. */
export function ComptaFiles() {
  const { boot } = useApp();
  return <div className="col cp" style={{ gap: 16 }}><Exports today={boot.today} /></div>;
}

/** The month's files for the accountant, its VAT and its month-end balances. */
function Exports({ today }: { today: string }) {
  const months = lastMonths(today);
  const [month, setMonth] = useState(months[1]);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const vat = useQuery<Vat>('/api/v1/compta/vat?month=' + month);
  const end = dates.monthEnd(month + '-01');
  const bal = useQuery<Balances>('/api/v1/compta/balances?day=' + (end < today ? end : today));
  const get = async (key: string, url: string) => {
    // the month still has a day without its Z: said at once, as the server would refuse the file
    const missing = (key === 'fec' || key === 'csv') && vat.data && vat.data.month === month ? vat.data.open[0] : null;
    if (missing) { setOpen(openWords(missing, today)); return; }
    setBusy(key); setOpen(null);
    try { await download(url); }
    catch (e: any) { if (e && e.code === 'open') setOpen(e.message); else toastError(e); }
    finally { setBusy(''); }
  };
  const v = vat.data;
  const b = bal.data;
  return (
    <Card title="Pour ton comptable" icon="download">
      <div className="col" style={{ gap: 14 }} data-guide="compta.exports">
        <Field label="Mois" htmlFor="cp-month">
          <select id="cp-month" className="input cp-month" value={month} onChange={(e) => { setMonth(e.target.value); setOpen(null); }}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}{m === today.slice(0, 7) ? ' (en cours)' : ''}</option>)}
          </select>
        </Field>
        <div className="cp-files">
          <Button icon="download" busy={busy === 'fec'} onClick={() => get('fec', '/api/v1/compta/entries?month=' + month + '&format=fec')}>Écritures · fichier d’import</Button>
          <Button icon="download" busy={busy === 'csv'} onClick={() => get('csv', '/api/v1/compta/entries?month=' + month + '&format=csv')}>Écritures · Excel</Button>
          <Button icon="download" busy={busy === 'vat'} onClick={() => get('vat', '/api/v1/compta/vat?month=' + month + '&csv=1')}>TVA · Excel</Button>
        </div>
        <div aria-live="polite">
          {open ? (
            <Note tone="warn" icon="alert">
              <b>{open}</b> Le fichier d’import attend que chaque jour du mois ait son Z.{' '}
              <Button variant="ghost" className="cp-prov" busy={busy === 'prov'} onClick={() => get('prov', '/api/v1/compta/entries?month=' + month + '&format=csv&provisional=1')}>Version provisoire · Excel</Button>
            </Note>
          ) : null}
        </div>
        <div className="cp-vat" data-guide="compta.vatdue">
          <p className="section-k">{v ? v.label : 'TVA à déclarer'}{v ? <span className={'badge ' + (v.period === 'definitif' ? 'badge-ok' : '')}>{v.period === 'definitif' ? 'Définitif' : 'Provisoire'}</span> : null}</p>
          {!v ? <Skeleton h={90} /> : (
            <table className="cp-table" aria-label={'TVA à déclarer, ' + monthLabel(month)}>
              <thead><tr><th scope="col">Taux</th><th scope="col">Base HT</th><th scope="col">TVA</th></tr></thead>
              <tbody>
                {v.rows.length ? v.rows.map((r) => <tr key={r.rate}><th scope="row">{pct(r.rate)}</th><td tabIndex={0}><Money cents={r.base} decimals /></td><td tabIndex={0}><Money cents={r.tax} decimals /></td></tr>)
                  : <tr><td colSpan={3} className="muted cp-empty">Aucune vente ce mois-ci.</td></tr>}
                {v.adjustments.deposits.tax ? <tr className="cp-sub"><th scope="row">dont acomptes</th><td tabIndex={0}><Money cents={v.adjustments.deposits.base} decimals /></td><td tabIndex={0}><Money cents={v.adjustments.deposits.tax} decimals /></td></tr> : null}
                {v.autoliquidation.tax ? <tr className="cp-sub"><th scope="row">{v.autoliquidation.label}</th><td tabIndex={0}><Money cents={v.autoliquidation.base} decimals /></td><td tabIndex={0}><Money cents={v.autoliquidation.tax} decimals /></td></tr> : null}
              </tbody>
            </table>
          )}
          {v && v.warnings.length ? <Note tone="warn" icon="alert"><b>À vérifier</b><ul className="cp-warn">{v.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Note> : null}
        </div>
        <p className="section-k" id="cp-bal">Soldes au {b ? b.day.split('-').reverse().join('/') : '…'}</p>
        <div className="cp-figs" data-guide="compta.balances" aria-labelledby="cp-bal" role="group">
          {!b ? <Skeleton h={64} /> : (
            <>
              <div className="cp-fig" tabIndex={0}><span>Cartes cadeaux dues</span><Money cents={b.giftcards.closing} decimals />{b.giftcards.legacy.count ? <small>dont {eur(b.giftcards.legacy.balance)} de l’ancien site</small> : null}</div>
              <div className="cp-fig" tabIndex={0}><span>Carnets : coupes dues (HT)</span><Money cents={b.packs.valueHT} decimals /><small>{b.packs.cutsLeft} coupe{b.packs.cutsLeft > 1 ? 's' : ''} · {eur(b.packs.value)} TTC</small></div>
              <div className="cp-fig" tabIndex={0}><span>Acomptes en attente</span><Money cents={b.deposits.amount} decimals /><small>{b.deposits.count} paiement{b.deposits.count > 1 ? 's' : ''}</small></div>
              <div className="cp-fig" tabIndex={0}><span>Payé en ligne, pas encore viré</span><Money cents={b.stripe} decimals />{!b.payouts && b.stripe ? <small>Virements Stripe non suivis : ce montant ne baisse pas</small> : null}</div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
