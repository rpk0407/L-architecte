// The salon's settings. Each section edits a copy and saves in one go; the server validates everything again.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { cap, dates, eur, money, plural } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Chip, Field, Note, Skeleton, Switch, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import { WeekEditor, weekMinutes, weekOf, weekProblem, type Week } from '../Equipe';
import { smsSegments } from '../Relances';

type SettingsData = { settings: any; defaultTemplates: Record<string, string>; roles: Record<string, string[]>; caps: Record<string, string> };

export default function Shop({ section }: { section: string }) {
  const { data, loading } = useQuery<SettingsData>('/api/v1/settings');
  if (loading && !data) return <Skeleton h={360} r={22} />;
  if (!data) return null;
  const S = data.settings;
  switch (section) {
    case 'salon': return <Salon s={S} />;
    case 'horaires': return <Hours s={S} />;
    case 'reservation': return <Booking s={S} />;
    case 'paiements': return <Payments s={S} />;
    case 'messages': return <Messages s={S} defaults={data.defaultTemplates} />;
    case 'equipe': return <TeamAccess s={S} roles={data.roles} caps={data.caps} />;
    case 'objectifs': return <Goals s={S} />;
    default: return null;
  }
}

/** A local copy of one settings section, with dirty tracking and one save. */
function useSection<T>(src: T) {
  const [v, setV] = useState<T>(src);
  const key = JSON.stringify(src);
  useEffect(() => { setV(src); }, [key]);
  return { v, setV, dirty: JSON.stringify(v) !== key, reset: () => setV(src) };
}
function SaveBar({ dirty, onSave, onReset, busy, disabled }: { dirty: boolean; onSave: () => void; onReset: () => void; busy: boolean; disabled?: boolean }) {
  if (!dirty) return null;
  return (
    <div className="rg-save" role="region" aria-label="Enregistrer">
      <span className="grow">Modifications non enregistrées</span>
      <Button variant="ghost" onClick={onReset}>Annuler</Button>
      <Button variant="primary" busy={busy} disabled={disabled} onClick={onSave}>Enregistrer</Button>
    </div>
  );
}
function useSave() {
  const { reloadBoot } = useApp();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Record<string, unknown>, msg = 'Réglages enregistrés') => {
    setBusy(true);
    try { await api.patch('/api/v1/settings', patch); toast({ title: msg, icon: 'check' }); refreshAll(); await reloadBoot(); return true; }
    catch (e) { toastError(e); return false; } finally { setBusy(false); }
  };
  return { busy, save };
}
function Card({ title, icon, children, aside }: { title: string; icon: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="card col" style={{ gap: 12 }}><div className="card-h"><h2><Icon name={icon} size={16} />{title}</h2>{aside}</div>{children}</section>;
}
const num = (x: string, min: number, max: number) => Math.max(min, Math.min(max, Number(x.replace(/\D/g, '')) || 0));

/* ---------------- le salon ---------------- */

function Salon({ s }: { s: any }) {
  const shop = useSection(s.shop);
  const foot = useSection(s.payments.receiptFooter as string);
  const { busy, save } = useSave();
  const f = shop.v;
  const set = (k: string, v: string) => shop.setV({ ...f, [k]: v });
  const input = (k: string, label: string, o: { hint?: string; type?: string; ph?: string } = {}) => <Field label={label} hint={o.hint} htmlFor={'sh-' + k}><input id={'sh-' + k} className="input" type={o.type || 'text'} value={f[k] || ''} onChange={(e) => set(k, e.target.value)} placeholder={o.ph} /></Field>;
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Coordonnées" icon="map">
        <div className="grid2">{input('name', 'Nom du salon')}{input('phone', 'Téléphone', { type: 'tel', ph: '04 91 …' })}</div>
        {input('address', 'Adresse')}
        <div className="grid2">{input('zip', 'Code postal')}{input('city', 'Ville')}</div>
        {input('email', 'E-mail de contact', { type: 'email' })}
      </Card>
      <Card title="Mentions légales du ticket" icon="ticket">
        <div className="grid2">{input('legalName', 'Raison sociale', { ph: 'L’Architecte SAS' })}{input('siret', 'SIRET', { ph: '123 456 789 00012' })}</div>
        {input('vatNumber', 'N° de TVA intracommunautaire', { ph: 'FR…' })}
        <Field label="Message en bas du ticket" htmlFor="sh-foot"><input id="sh-foot" className="input" maxLength={160} value={foot.v} onChange={(e) => foot.setV(e.target.value)} /></Field>
        {!f.siret ? <Note tone="warn" icon="alert">Le SIRET doit figurer sur les tickets remis aux clients.</Note> : null}
      </Card>
      <Card title="Liens" icon="link">
        {input('reviewUrl', 'Lien d’avis Google', { hint: 'Envoyé après la visite quand la demande d’avis est active.', type: 'url' })}
        {input('mapsUrl', 'Lien Google Maps', { type: 'url' })}
        {input('instagram', 'Instagram du salon', { type: 'url' })}
      </Card>
      <SaveBar dirty={shop.dirty || foot.dirty} busy={busy} disabled={!f.name || f.name.length < 2} onReset={() => { shop.reset(); foot.reset(); }} onSave={() => save({ ...(shop.dirty ? { shop: f } : {}), ...(foot.dirty ? { payments: { receiptFooter: foot.v } } : {}) })} />
    </div>
  );
}

/* ---------------- horaires et fermetures ---------------- */

function holidays(year: number) {
  // Easter (anonymous Gregorian algorithm), then the French public holidays
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const fixed: [string, string][] = [['01-01', 'Jour de l’an'], ['05-01', 'Fête du travail'], ['05-08', 'Victoire 1945'], ['07-14', 'Fête nationale'], ['08-15', 'Assomption'], ['11-01', 'Toussaint'], ['11-11', 'Armistice'], ['12-25', 'Noël']];
  return [...fixed.map(([md, label]) => ({ day: year + '-' + md, label })), { day: dates.addDays(easter, 1), label: 'Lundi de Pâques' }, { day: dates.addDays(easter, 39), label: 'Ascension' }, { day: dates.addDays(easter, 50), label: 'Lundi de Pentecôte' }].sort((x, y) => x.day.localeCompare(y.day));
}

function Hours({ s }: { s: any }) {
  const { boot } = useApp();
  const hours = useSection<Week>(weekOf(s.hours));
  const { busy, save } = useSave();
  const [cl, setCl] = useState({ from: boot.today, to: boot.today, label: 'Congés' });
  const closures: { id: string; from: string; to: string; label: string }[] = s.closures || [];
  const upcoming = closures.filter((c) => c.to >= boot.today);
  const y = Number(boot.today.slice(0, 4));
  const suggest = [...holidays(y), ...holidays(y + 1)].filter((h) => h.day >= boot.today && dates.diffDays(boot.today, h.day) <= 200 && (s.hours[dates.weekday(h.day)] || []).length && !closures.some((c) => c.from <= h.day && c.to >= h.day)).slice(0, 4);
  const addClosure = async (body: { from: string; to: string; label: string }) => {
    try { await api.post('/api/v1/settings/closures', body); toast({ title: 'Fermeture ajoutée', sub: 'Plus aucune réservation en ligne ces jours-là.', icon: 'lock' }); refreshAll(); }
    catch (e) { toastError(e); }
  };
  const total = weekMinutes(hours.v);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Semaine type" icon="clock" aside={<span className="faint" style={{ fontSize: 13 }}>{Math.floor(total / 60)} h d’ouverture</span>}>
        <p className="muted" style={{ fontSize: 13.5 }}>Les horaires de chaque barbier restent à l’intérieur de ceux du salon. Le site ne propose jamais un créneau hors de ces heures.</p>
        <WeekEditor value={hours.v} onChange={hours.setV} offLabel={() => 'Fermé'} />
      </Card>
      <Card title="Fermetures exceptionnelles" icon="lock">
        {upcoming.length ? (
          <ul className="list">{upcoming.map((c) => (
            <li key={c.id} className="li">
              <span className="li-main"><b>{c.label}</b><small>{c.from === c.to ? cap(dates.dayLong(c.from)) : 'Du ' + dates.dayShort(c.from) + ' au ' + dates.dayShort(c.to) + ' · ' + plural(dates.diffDays(c.from, c.to) + 1, 'jour')}</small></span>
              <Button size="sm" variant="ghost" icon="trash" aria-label="Supprimer" onClick={async () => { if (!await confirm({ title: 'Rouvrir ces jours ?', ok: 'Rouvrir' })) return; try { await api.del('/api/v1/settings/closures/' + c.id); refreshAll(); } catch (e) { toastError(e); } }} />
            </li>
          ))}</ul>
        ) : <p className="muted">Aucune fermeture prévue.</p>}
        {suggest.length ? <div className="col" style={{ gap: 8 }}><p className="section-k">Jours fériés à venir, salon normalement ouvert</p><div className="chips">{suggest.map((h) => <Chip key={h.day} small onClick={() => addClosure({ from: h.day, to: h.day, label: h.label })}>+ {h.label} · {dates.dayShort(h.day)}</Chip>)}</div></div> : null}
        <div className="rg-closure">
          <input className="input" value={cl.label} maxLength={60} onChange={(e) => setCl({ ...cl, label: e.target.value })} aria-label="Motif" />
          <input className="input" type="date" value={cl.from} min={boot.today} onChange={(e) => e.target.value && setCl({ ...cl, from: e.target.value, to: cl.to < e.target.value ? e.target.value : cl.to })} aria-label="Du" />
          <input className="input" type="date" value={cl.to} min={cl.from} onChange={(e) => e.target.value && setCl({ ...cl, to: e.target.value })} aria-label="Au" />
          <Button variant="primary" icon="plus" disabled={!cl.label.trim()} onClick={() => addClosure(cl)}>Fermer</Button>
        </div>
        <p className="faint" style={{ fontSize: 12.5 }}>Les rendez-vous déjà pris ces jours-là ne sont pas annulés automatiquement : déplace-les depuis l’agenda.</p>
      </Card>
      <SaveBar dirty={hours.dirty} busy={busy} onReset={hours.reset} onSave={() => { const pb = weekProblem(hours.v); if (pb) { toast({ kind: 'err', title: pb }); return; } save({ hours: hours.v }, 'Horaires du salon enregistrés'); }} />
    </div>
  );
}

/* ---------------- réservation en ligne ---------------- */

function Booking({ s }: { s: any }) {
  const b = useSection(s.booking);
  const d = useSection(s.deposits);
  const { busy, save } = useSave();
  const B = b.v, D = d.v;
  const notice = [[0, 'Aucun'], [30, '30 min'], [60, '1 h'], [120, '2 h'], [720, 'La veille (12 h)'], [1440, '24 h']] as [number, string][];
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Prise de rendez-vous" icon="globe">
        <Switch on={B.enabled} onChange={(v) => b.setV({ ...B, enabled: v })} title="Réservation en ligne ouverte" hint={B.enabled ? 'Les clients réservent sur le site, 24 h sur 24.' : 'Le site invite à appeler le salon.'} />
        <Field label="Intervalle des créneaux proposés"><div className="chips">{[15, 20, 30].map((m) => <Chip key={m} small on={B.stepMin === m} onClick={() => b.setV({ ...B, stepMin: m })}>{m} min</Chip>)}</div></Field>
        <Field label="Délai minimum avant un rendez-vous"><div className="chips">{notice.map(([m, t]) => <Chip key={m} small on={B.minNoticeMin === m} onClick={() => b.setV({ ...B, minNoticeMin: m })}>{t}</Chip>)}</div></Field>
        <Field label="Jusqu’à combien de jours à l’avance"><div className="chips">{[14, 30, 60, 90].map((n) => <Chip key={n} small on={B.maxDaysAhead === n} onClick={() => b.setV({ ...B, maxDaysAhead: n })}>{n} jours</Chip>)}</div></Field>
        <Field label="Annulation ou déplacement en ligne possible jusqu’à" hint="Après, le client doit appeler : c’est là que l’acompte protège le salon."><div className="chips">{[2, 6, 12, 24, 48].map((n) => <Chip key={n} small on={B.cancelUntilHours === n} onClick={() => b.setV({ ...B, cancelUntilHours: n })}>{n} h avant</Chip>)}</div></Field>
        <Switch on={B.waitlist} onChange={(v) => b.setV({ ...B, waitlist: v })} title="Liste d’attente" hint="Quand c’est complet, le client s’inscrit ; une place libérée lui est proposée par SMS." />
        <Switch on={B.walkinWait} onChange={(v) => b.setV({ ...B, walkinWait: v })} title="Afficher l’attente sans rendez-vous" hint="Le site montre en direct « environ 20 min d’attente »." />
      </Card>
      <Card title="Acomptes et absences" icon="card">
        <Field label="Demander un acompte">
          <div className="chips">
            <Chip small on={D.mode === 'none'} onClick={() => d.setV({ ...D, mode: 'none' })}>Jamais</Chip>
            <Chip small on={D.mode === 'threshold'} onClick={() => d.setV({ ...D, mode: 'threshold' })}>Au-delà d’un montant</Chip>
            <Chip small on={D.mode === 'all'} onClick={() => d.setV({ ...D, mode: 'all' })}>Toujours</Chip>
          </div>
        </Field>
        {D.mode !== 'none' ? (
          <div className="grid2">
            {D.mode === 'threshold' ? <Field label="À partir de (€)" htmlFor="dp-t"><input id="dp-t" className="input" inputMode="decimal" value={(D.thresholdCents / 100).toString().replace('.', ',')} onChange={(e) => d.setV({ ...D, thresholdCents: money.parseEur(e.target.value) ?? 0 })} /></Field> : <span />}
            <Field label="Montant de l’acompte (% du prix)" htmlFor="dp-p"><input id="dp-p" className="input" inputMode="numeric" value={D.percent} onChange={(e) => d.setV({ ...D, percent: num(e.target.value, 5, 100) })} /></Field>
          </div>
        ) : null}
        <p className="muted" style={{ fontSize: 13.5 }}>{D.mode === 'none' ? 'Aucun acompte : simple, mais les absences ne coûtent rien au client.' : D.mode === 'all' ? 'Chaque réservation en ligne paie ' + D.percent + ' % à l’avance (5 € minimum).' : 'Exemple : une prestation de ' + eur(Math.max(D.thresholdCents, 6000)) + ' demande ' + eur(Math.max(500, Math.round((Math.max(D.thresholdCents, 6000) * D.percent) / 10000) * 100)) + ' d’acompte. En dessous de ' + eur(D.thresholdCents) + ', rien.'} Une prestation peut avoir sa propre règle dans le Catalogue.</p>
        <Field label="Frais d’absence (carte enregistrée)" hint="Prélevés seulement si tu le décides, sur la fiche du rendez-vous manqué." htmlFor="dp-n"><input id="dp-n" className="input" inputMode="decimal" value={(D.noShowFeeCents / 100).toString().replace('.', ',')} onChange={(e) => d.setV({ ...D, noShowFeeCents: Math.min(20000, money.parseEur(e.target.value) ?? 0) })} /></Field>
      </Card>
      <SaveBar dirty={b.dirty || d.dirty} busy={busy} onReset={() => { b.reset(); d.reset(); }} onSave={() => save({ ...(b.dirty ? { booking: B } : {}), ...(d.dirty ? { deposits: D } : {}) })} />
    </div>
  );
}

/* ---------------- paiements ---------------- */

function Payments({ s }: { s: any }) {
  const { boot } = useApp();
  const p = useSection(s.payments);
  const { busy, save } = useSave();
  const P = p.v;
  const prov = boot.providers;
  const webhook = location.origin + '/api/stripe/webhook';
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Moyens acceptés à la caisse" icon="caisse">
        <Switch on={P.card} onChange={(v) => p.setV({ ...P, card: v })} title="Carte bancaire (terminal)" hint="Le montant est saisi sur ton terminal ; la caisse l’enregistre." />
        <Switch on={P.cash} onChange={(v) => p.setV({ ...P, cash: v })} title="Espèces" hint="Rendu de monnaie calculé, tiroir compté le soir." />
        <Switch on={P.qr} onChange={(v) => p.setV({ ...P, qr: v })} title="QR code" hint="Le client scanne et paie sur son téléphone (Apple Pay, carte). Sans terminal." />
        <Switch on={P.giftcard} onChange={(v) => p.setV({ ...P, giftcard: v })} title="Cartes cadeaux" />
      </Card>
      <Card title="Pourboires et TVA" icon="heart">
        <Switch on={P.tips} onChange={(v) => p.setV({ ...P, tips: v })} title="Proposer un pourboire" hint="Versé au barbier, hors chiffre d’affaires et hors TVA." />
        {P.tips ? <Field label="Montants proposés (€)"><div className="chips">{P.tipPresets.map((t: number, i: number) => <input key={i} className="input ct-num" inputMode="decimal" value={(t / 100).toString().replace('.', ',')} onChange={(e) => p.setV({ ...P, tipPresets: P.tipPresets.map((x: number, j: number) => (j === i ? money.parseEur(e.target.value) ?? 0 : x)) })} aria-label={'Pourboire ' + (i + 1)} />)}</div></Field> : null}
        <Field label="TVA par défaut des nouvelles prestations"><div className="chips">{[2000, 1000, 550].map((v) => <Chip key={v} small on={P.vat === v} onClick={() => p.setV({ ...P, vat: v })}>{v / 100} %</Chip>)}</div></Field>
      </Card>
      <Card title="Paiement en ligne" icon="globe" aside={<span className={'badge ' + (prov.paymentsLive ? 'badge-ok' : prov.payments === 'stripe' ? 'badge-info' : 'badge-warn')}>{prov.paymentsLive ? 'Stripe · réel' : prov.payments === 'stripe' ? 'Stripe · test' : 'Simulé'}</span>}>
        {prov.payments === 'stripe' ? (
          <p className="muted" style={{ fontSize: 13.5 }}>Les acomptes et les QR codes passent par Stripe. L’argent arrive sur ton compte Stripe puis sur ton compte bancaire ; les remboursements se font depuis le ticket.</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13.5 }}>{boot.mode === 'demo' ? 'Démo : les paiements en ligne sont simulés, personne n’est débité.' : 'Stripe n’est pas encore branché : les acomptes et QR codes sont simulés.'}</p>
            {boot.mode !== 'demo' ? <Note icon="info">Pour l’activer : crée un compte Stripe, puis ajoute dans Vercel les variables <code>STRIPE_SECRET_KEY</code> et <code>STRIPE_WEBHOOK_SECRET</code>. Adresse du webhook à déclarer chez Stripe : <code>{webhook}</code> (événements <code>checkout.session.completed</code> et <code>checkout.session.expired</code>).</Note> : null}
          </>
        )}
      </Card>
      <SaveBar dirty={p.dirty} busy={busy} onReset={p.reset} onSave={() => save({ payments: P })} />
    </div>
  );
}

/* ---------------- messages ---------------- */

const TPL: { k: string; t: string; when: string; vars: string[] }[] = [
  { k: 'confirmation', t: 'Confirmation', when: 'dès la réservation', vars: ['prenom', 'date', 'heure', 'barbier', 'prestation', 'lien'] },
  { k: 'reminder', t: 'Rappel la veille', when: 'la veille à l’heure choisie', vars: ['prenom', 'heure', 'barbier', 'lien'] },
  { k: 'reminder2h', t: 'Rappel 2 h avant', when: 'deux heures avant', vars: ['prenom', 'heure', 'barbier'] },
  { k: 'review', t: 'Demande d’avis', when: 'après la visite', vars: ['prenom', 'avis'] },
  { k: 'rebook', t: 'Relance', when: 'quand tu l’envoies', vars: ['prenom', 'jours', 'lien'] },
  { k: 'waitlist', t: 'Place libérée', when: 'à une annulation', vars: ['date', 'heure', 'barbier', 'lien'] },
  { k: 'queue', t: 'Bientôt ton tour', when: 'file sans rendez-vous', vars: ['prenom'] },
  { k: 'cancelled', t: 'Annulation', when: 'quand le salon annule', vars: ['date', 'heure', 'lien'] },
  { k: 'receipt', t: 'Reçu', when: 'à la demande, après encaissement', vars: ['prenom', 'ticket', 'montant', 'lien'] }
];
const SAMPLE: Record<string, string> = { prenom: 'Karim', date: 'jeudi 12 novembre', heure: '14 h 30', barbier: 'JKut', prestation: 'Coupe + taille de barbe', lien: 'https://larchitecte.fr/r/LA-7K2P', avis: 'https://g.page/r/…', jours: '34', ticket: 'T001042', montant: '30,00 €' };

function Messages({ s, defaults }: { s: any; defaults: Record<string, string> }) {
  const { boot } = useApp();
  const m = useSection(s.messages);
  const { busy, save } = useSave();
  const [open, setOpen] = useState<string | null>(null);
  const M = m.v;
  const toggles: [string, string, string][] = [['confirmation', 'Confirmation de rendez-vous', 'Avec le lien pour déplacer ou annuler soi-même.'], ['reminder', 'Rappel la veille', 'Le meilleur remède contre les absences.'], ['reminder2h', 'Rappel 2 h avant', 'En plus, pour les oublis du jour même.'], ['review', 'Demande d’avis Google', 'Une fois par trimestre au plus par client.'], ['waitlist', 'Place libérée', 'Proposée au premier de la liste d’attente.'], ['rebook', 'Relances', 'Proposées dans Relances, jamais envoyées sans toi.']];
  const bad = TPL.find((t) => (M.templates[t.k] || '').trim().length < 10);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Envois automatiques" icon="bolt" aside={<span className={'badge ' + (boot.providers.sms ? 'badge-ok' : boot.mode === 'demo' ? 'badge-info' : 'badge-warn')}>{boot.providers.sms ? 'SMS via ' + cap(boot.providers.sms) : boot.mode === 'demo' ? 'Démo · simulé' : 'Aucun fournisseur'}</span>}>
        {toggles.map(([k, t, h]) => <Switch key={k} on={!!M[k]} onChange={(v) => m.setV({ ...M, [k]: v })} title={t} hint={h} />)}
        <div className="grid2">
          <Field label="Heure du rappel de la veille"><select className="input select" value={M.reminderHour} onChange={(e) => m.setV({ ...M, reminderHour: Number(e.target.value) })}>{Array.from({ length: 14 }, (_, i) => i + 8).map((h) => <option key={h} value={h}>{h} h</option>)}</select></Field>
          <Field label="Demande d’avis, après la visite"><select className="input select" value={M.reviewDelayMin} onChange={(e) => m.setV({ ...M, reviewDelayMin: Number(e.target.value) })}>{[30, 60, 120, 240, 1440].map((n) => <option key={n} value={n}>{n < 60 ? n + ' min' : n === 1440 ? 'le lendemain' : n / 60 + ' h'}</option>)}</select></Field>
        </div>
        {!boot.providers.sms && boot.mode !== 'demo' ? <Note tone="warn" icon="alert">Branche Brevo ou Twilio (variables <code>SMS_PROVIDER</code>, <code>BREVO_API_KEY</code> ou <code>TWILIO_*</code>) pour que les SMS partent vraiment. En attendant, ils restent dans la boîte d’envoi.</Note> : null}
      </Card>
      <Card title="Les textes" icon="edit">
        <p className="muted" style={{ fontSize: 13.5 }}>Les mots entre accolades sont remplacés pour chaque client. Un SMS fait 160 caractères ; un « ç », un « ê » ou un « ô » le fait passer à 70 (les apostrophes courbes sont corrigées automatiquement).</p>
        <ul className="list">
          {TPL.map((t) => {
            const txt = M.templates[t.k] || '';
            const preview = txt.replace(/\{(\w+)\}/g, (x: string, k: string) => SAMPLE[k] ?? x).replace(/[’‘]/g, "'").replace(/«\s*|\s*»|[“”]/g, '"').replace(/[–—−]/g, '-');
            const seg = smsSegments(preview);
            const isOpen = open === t.k;
            return (
              <li key={t.k} className="rg-tpl">
                <button type="button" className="li" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.k)}>
                  <span className="li-main"><b>{t.t}</b><small>{t.when} · {seg.chars} car. · {plural(seg.count, 'SMS')}{txt !== defaults[t.k] ? ' · personnalisé' : ''}</small></span>
                  <Icon name={isOpen ? 'chevD' : 'chevR'} size={16} />
                </button>
                {isOpen ? (
                  <div className="rg-tpl-ed">
                    <textarea className="input textarea" rows={3} maxLength={320} value={txt} onChange={(e) => m.setV({ ...M, templates: { ...M.templates, [t.k]: e.target.value } })} aria-label={'Texte : ' + t.t} />
                    <div className="chips">{t.vars.map((v) => <button key={v} type="button" className="chip chip-sm" onClick={() => m.setV({ ...M, templates: { ...M.templates, [t.k]: txt + (txt.endsWith(' ') ? '' : ' ') + '{' + v + '}' } })}>{'{' + v + '}'}</button>)}<span className="grow" />{txt !== defaults[t.k] ? <button type="button" className="link" onClick={() => m.setV({ ...M, templates: { ...M.templates, [t.k]: defaults[t.k] } })}>Texte d’origine</button> : null}</div>
                    <div className="bubble"><small>Aperçu</small><p>{preview}</p></div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <SaveBar dirty={m.dirty} busy={busy} disabled={!!bad} onReset={m.reset} onSave={() => save({ messages: M })} />
    </div>
  );
}

/* ---------------- équipe et accès ---------------- */

const ROLE_ORDER: [string, string][] = [['owner', 'Gérant'], ['manager', 'Responsable'], ['desk', 'Accueil'], ['barber', 'Barbier']];
function TeamAccess({ s, roles, caps }: { s: any; roles: Record<string, string[]>; caps: Record<string, string> }) {
  const t = useSection(s.team);
  const { busy, save } = useSave();
  const T = t.v;
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Ce que les barbiers peuvent faire" icon="shield">
        <Switch on={T.barberCheckout} onChange={(v) => t.setV({ ...T, barberCheckout: v })} title="Encaisser" hint="Sinon, seuls l’accueil et le gérant encaissent." />
        <Switch on={T.barberAllAgenda} onChange={(v) => t.setV({ ...T, barberAllAgenda: v })} title="Voir l’agenda de tout le salon" hint="Utile pour prendre un client au vol quand un collègue est plein." />
        <Switch on={T.barberSeeRevenue} onChange={(v) => t.setV({ ...T, barberSeeRevenue: v })} title="Voir le chiffre du salon" hint="Sinon chacun ne voit que ses propres chiffres et sa commission." />
        <Field label="Remise maximale qu’un barbier peut accorder"><div className="chips">{[0, 5, 10, 15, 20].map((n) => <Chip key={n} small on={T.barberMaxDiscountPct === n} onClick={() => t.setV({ ...T, barberMaxDiscountPct: n })}>{n ? n + ' %' : 'aucune'}</Chip>)}</div></Field>
      </Card>
      <Card title="Qui peut quoi" icon="key" aside={<span className="faint" style={{ fontSize: 13 }}>Selon les réglages enregistrés</span>}>
        <div className="table-wrap">
          <table className="table rg-matrix">
            <thead><tr><th />{ROLE_ORDER.map(([r, l]) => <th key={r} className="num">{l}</th>)}</tr></thead>
            <tbody>{Object.entries(caps).map(([k, label]) => <tr key={k}><td>{label}</td>{ROLE_ORDER.map(([r]) => <td key={r} className="num">{roles[r]?.includes(k) ? <Icon name="check" size={16} /> : <span className="faint">·</span>}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 12.5 }}>Chaque droit est vérifié par le serveur à chaque action : masquer un bouton n’est jamais la seule protection.</p>
      </Card>
      <SaveBar dirty={t.dirty} busy={busy} onReset={t.reset} onSave={() => save({ team: T })} />
    </div>
  );
}

/* ---------------- objectifs ---------------- */

function Goals({ s }: { s: any }) {
  const { boot } = useApp();
  const g = useSection(s.goals);
  const { busy, save } = useSave();
  const last = dates.addDays(dates.monthStart(boot.today), -1);
  const prev = useQuery<any>('/api/v1/reports?from=' + dates.monthStart(last) + '&to=' + last);
  const [txt, setTxt] = useState(String(Math.round(s.goals.monthCents / 100)));
  useEffect(() => { setTxt(String(Math.round(g.v.monthCents / 100))); }, [g.v.monthCents]);
  const prevRev = prev.data?.revenue as number | undefined;
  const ideas = useMemo(() => prevRev ? [Math.round(prevRev * 1.05 / 10000) * 10000, Math.round(prevRev * 1.1 / 10000) * 10000, Math.round(prevRev * 1.2 / 10000) * 10000] : [], [prevRev]);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Objectif de chiffre mensuel" icon="target">
        <p className="muted" style={{ fontSize: 13.5 }}>Affiché dans Rapports avec la projection de fin de mois. Visible par le gérant et les responsables uniquement.</p>
        <div className="row" style={{ gap: 10 }}><input className="input input-money" inputMode="numeric" value={txt} onChange={(e) => { setTxt(e.target.value.replace(/\D/g, '')); g.setV({ monthCents: (Number(e.target.value.replace(/\D/g, '')) || 0) * 100 }); }} aria-label="Objectif en euros" style={{ maxWidth: 220 }} /><span className="serif" style={{ fontSize: 28 }}>€ / mois</span></div>
        {prevRev != null ? <p className="muted" style={{ fontSize: 13.5 }}>Le mois dernier : <b className="money">{eur(prevRev)}</b>. {ideas.length ? 'Quelques cibles réalistes :' : ''}</p> : <Skeleton h={18} w={260} />}
        {ideas.length ? <div className="chips">{ideas.map((v, i) => <Chip key={v} small on={g.v.monthCents === v} onClick={() => g.setV({ monthCents: v })}>{eur(v)} · {['+5 %', '+10 %', '+20 %'][i]}</Chip>)}</div> : null}
      </Card>
      <SaveBar dirty={g.dirty} busy={busy} onReset={g.reset} onSave={() => save({ goals: g.v }, 'Objectif enregistré')} />
    </div>
  );
}
