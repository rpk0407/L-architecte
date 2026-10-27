// Mise en route: the steps before the salon opens, in the order that works, each ticked live from GET /api/v1/health
// (server/http/routes-health.js) and linked to its screen. The Santé card of Réglages › Données reads the same answer.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../../../lib/api';
import { useQuery } from '../../../../lib/query';
import { Link } from '../../../../lib/router';
import { ago, dates, plural } from '../../../../lib/format';
import { useInterval } from '../../../../lib/hooks';
import { Icon } from '../../../../ui/Icon';
import { Button, Empty, Note, Skeleton, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';
import './mise-en-route.css';

type Channel = { provider: string | null; failed24h: number; queuedNoProvider: number };
export type Health = {
  now: number; mode: 'demo' | 'production';
  // at/ageMs: this server's last tick, from any traffic; cronAt/cronAgeMs: its last call by the external scheduler;
  // overdue/late24h: texts that waited with no dispatch at all (now, or in the last 24 h), read from the messages
  tick: {
    at: number | null; ageMs: number | null; cron: boolean; cronAt: number | null; cronAgeMs: number | null; open: boolean
    overdue: number; late24h: number; lastLate: { dueAt: number; ms: number } | null; okMs: number; lateMs: number
  };
  stripe: { provider: string; live: boolean; lastWebhook: number | null };
  sms: Channel; email: Channel;
  backup: { at: number | null; off: string; configured: boolean; problem: string; staleAfterMs: number };
  integrity: { ok: boolean; count: number; brokenAt?: number; reason?: string; at: number; events: number };
  publicUrl: string; publicUrlCustom: boolean; indexable: boolean;
  setup: {
    legal: { missing: string[] };
    hours: { openDays: number; holidays: string[]; holidaysClosed: number; closures: number };
    services: { active: number; online: number };
    team: { chairs: { id: string; name: string; pin: boolean }[] };
    devices: number;
    import: { clients: number; appts: number; last: number | null };
    siteBooking: number | null;
  };
};
type Tone = 'ok' | 'todo' | 'warn' | 'err' | 'info';
type Step = { id: string; title: string; tone: Tone; line: ReactNode; more?: ReactNode; to: string; go: string; external?: boolean; extra?: ReactNode };

/** The salon's health, asked again every minute while shown: the ages ('il y a 4 min') and the scheduler move without
 *  any new event in the journal, which is all the query cache listens to. */
export function useHealth() {
  const q = useQuery<Health>('/api/v1/health');
  useInterval(() => { if (!document.hidden) void q.refresh(); }, 60000);
  return q;
}

/** Does the site's robots.txt let search engines in? Read in the browser: it is the file this deployment serves. */
function useRobots() {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/robots.txt', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then((t) => {
      // closed: a 'Disallow: /' for every robot, as the build writes it without LX_INDEX
      if (alive) setOpen(!!t && !/^\s*Disallow:\s*\/\s*$/im.test(t));
    }).catch(() => { if (alive) setOpen(null); });
    return () => { alive = false; };
  }, []);
  return open;
}

const s = (n: number, one: string, many?: string) => plural(n, one, many);
/** "mer. 11 nov., ven. 25 déc. et 2 autres" */
function daysList(days: string[], max = 3) {
  const shown = days.slice(0, max).map((d) => dates.dayShort(d)).join(', ');
  return days.length > max ? shown + ' et ' + s(days.length - max, 'autre') : shown;
}

/** The thirteen steps, in the order that works: a wrong order (texts before PUBLIC_URL, indexing before the menu) breaks the site. */
export function stepsOf(h: Health, robots: boolean | null, countries: string[], now = h.now): Step[] {
  const demo = h.mode === 'demo';
  const st = h.setup;
  const since = (at: number) => ago(at, now);
  const out: Step[] = [];

  const legal = st.legal.missing;
  out.push({ id: 'legal', title: 'Coordonnées et mentions', tone: legal.length ? 'todo' : 'ok', to: '/reglages/salon', go: 'Le salon',
    line: legal.length ? 'Il manque : ' + legal.join(', ') + '.' : 'Les mentions légales, la confidentialité et les tickets sont complets.',
    more: 'Vérifie la ligne d’hébergement de /confidentialite (Vercel, région Paris cdg1) et celle de la base de données.' });

  const hol = st.hours.holidays;
  // once some holidays are closed, the ones left open are a choice (working on 11 November), not an oversight
  const holUndecided = hol.length > 0 && !st.hours.holidaysClosed;
  out.push({ id: 'hours', title: 'Horaires et jours fériés', tone: !st.hours.openDays ? 'todo' : holUndecided ? 'warn' : 'ok', to: '/reglages/horaires', go: 'Horaires',
    line: !st.hours.openDays ? 'Aucun jour d’ouverture : le site ne propose aucun créneau.'
      : holUndecided ? s(hol.length, 'jour férié', 'jours fériés') + ' des 12 prochains mois sans fermeture : ' + daysList(hol) + '. Ferme ceux où tu ne travailles pas ; ceux que tu laisses comptent comme ouverts.'
        : s(st.hours.openDays, 'jour') + ' d’ouverture par semaine, jours fériés des 12 prochains mois réglés' + (hol.length ? ' (ouvert ' + daysList(hol) + ').' : '.') });

  out.push({ id: 'menu', title: 'Carte', tone: st.services.online ? 'ok' : 'todo', to: '/catalogue', go: 'Catalogue',
    line: st.services.online ? s(st.services.online, 'prestation visible', 'prestations visibles') + ' sur le site.'
      : st.services.active ? 'Aucune prestation n’est réservable en ligne : le site n’a rien à proposer.' : 'Aucune prestation : reprends la carte de l’ancien site en un geste.' });

  const chairs = st.team.chairs;
  const noPin = chairs.filter((c) => !c.pin).map((c) => c.name);
  out.push({ id: 'team', title: 'Équipe', tone: chairs.length && !noPin.length ? 'ok' : 'todo', to: '/equipe', go: 'Équipe',
    line: !chairs.length ? 'Aucun fauteuil : ajoute chaque barbier avec son code, l’agenda s’ouvre avec eux.'
      : noPin.length ? 'Sans code : ' + noPin.join(', ') + '. Sans code, pas de connexion sur la tablette.' : s(chairs.length, 'fauteuil') + ', chacun avec son code.' });

  out.push({ id: 'device', title: 'Tablette enregistrée', tone: st.devices ? 'ok' : 'todo', to: '/reglages/appareils', go: 'Appareils',
    line: st.devices ? s(st.devices, 'poste autorisé', 'postes autorisés') + ' à la connexion par code.' : 'Sur la tablette du comptoir, connecte-toi puis « Enregistrer ce poste » : l’équipe y entre avec son code.' });

  const p = h.stripe;
  out.push({ id: 'stripe', title: 'Stripe', to: '/reglages/paiements', go: 'Paiements',
    tone: demo ? 'info' : p.provider !== 'stripe' ? 'todo' : !p.live ? 'warn' : p.lastWebhook ? 'ok' : 'warn',
    line: demo ? 'Démo : les acomptes passent par la page de paiement simulée.'
      : p.provider !== 'stripe' ? 'Simulé : aucun acompte n’est demandé en ligne et le QR de la caisse est coupé.'
        : !p.live ? 'Mode test : un acompte « payé » ne fait bouger aucun argent. Passe aux clés réelles avant d’ouvrir.'
          : p.lastWebhook ? 'Réel. Dernier retour de Stripe ' + since(p.lastWebhook) + '.' : 'Réel, mais Stripe n’a encore rien renvoyé : fais un acompte test de 1 €, puis rembourse-le.',
    more: <>Le jour où Stripe est branché, enregistre Réglages › Réservation pour dater une nouvelle version des CGV. Les frais d’absence restent hors des CGV tant qu’aucune carte n’est gardée.</> });

  const sms = h.sms;
  out.push({ id: 'sms', title: 'SMS', to: '/reglages/messages', go: 'Messages',
    tone: demo ? 'info' : !sms.provider ? 'todo' : sms.failed24h || !h.publicUrlCustom ? 'warn' : 'ok',
    line: demo ? 'Démo : les SMS sont simulés, rien ne part.'
      : !sms.provider ? 'Aucun fournisseur' + (sms.queuedNoProvider ? ' : ' + s(sms.queuedNoProvider, 'SMS attend', 'SMS attendent') + ' dans la boîte d’envoi.' : ' : rien ne part.')
        + ' Il se branche le jour J, juste après le passage du domaine : avant, les clients repris de WordPress recevraient un second rappel, avec un lien vers l’ancien site.'
        : (sms.provider === 'brevo' ? 'Brevo' : sms.provider === 'twilio' ? 'Twilio' : sms.provider) + ' branché' + (sms.failed24h ? ', mais ' + s(sms.failed24h, 'SMS a échoué', 'SMS ont échoué') + ' en 24 h.' : '.')
          + (h.publicUrlCustom ? '' : ' Règle PUBLIC_URL avant le premier SMS : les liens partiraient vers ' + (h.publicUrl || 'une adresse provisoire') + '.'),
    more: <>À confirmer avec Brevo avant d’ouvrir : le numéro STOP des offres (« STOP au 36173 » par défaut), les champs de son webhook et le nom d’expéditeur. Pays où les SMS partent : {countries.join(' ')}{countries.includes('+377') ? '' : ' (Monaco +377 non compris)'}.</>,
    extra: <TestSms disabled={!demo && !sms.provider} /> });

  const em = h.email;
  out.push({ id: 'email', title: 'E-mail', to: '/reglages/messages', go: 'Messages',
    tone: demo ? 'info' : !em.provider ? 'todo' : em.failed24h ? 'warn' : 'ok',
    line: demo ? 'Démo : les e-mails sont simulés.'
      : !em.provider ? 'Pas encore branché' + (em.queuedNoProvider ? ' : ' + s(em.queuedNoProvider, 'e-mail attend', 'e-mails attendent') + '.' : ' : aucun e-mail ne part (confirmation, résumé du soir).')
        : 'Branché' + (em.failed24h ? ', mais ' + s(em.failed24h, 'e-mail a échoué', 'e-mails ont échoué') + ' en 24 h.' : '.') });

  const wp = st.import;
  out.push({ id: 'wordpress', title: 'Reprise WordPress', tone: wp.clients || wp.appts ? 'ok' : 'todo', to: '/reglages/wordpress', go: 'Reprise',
    line: wp.clients || wp.appts ? s(wp.clients, 'client') + ', ' + s(wp.appts, 'rendez-vous') + ' repris' + (wp.last ? ' · dernier apport ' + since(wp.last) : '') + '.' : 'Clients, rendez-vous, cartes cadeaux et abonnements de l’ancien site : pas encore repris.',
    more: 'Le jour J, bloque les réservations sur WordPress, refais l’export et dépose-le : seul ce qui a changé est repris.' });

  const b = h.backup;
  const fresh = b.at != null && h.now - b.at < b.staleAfterMs;
  out.push({ id: 'backup', title: 'Sauvegarde', to: '/reglages/donnees', go: 'Données',
    tone: b.off ? 'info' : !b.configured ? 'todo' : b.problem || (b.at && !fresh) ? 'err' : fresh ? 'ok' : 'todo',
    line: b.off ? b.off : b.problem ? b.problem : b.at ? 'Dernière ' + since(b.at) + (fresh ? ', chiffrée.' : ' : celle de la nuit n’a pas eu lieu.') : 'Aucune pour l’instant : la première se fait cette nuit, ou maintenant.' });

  out.push(cronStep(h, since));

  const dom: string[] = [];
  if (!h.publicUrlCustom) dom.push('PUBLIC_URL vaut ' + (h.publicUrl || 'rien') + ' : mets l’adresse du site');
  if (!h.indexable) dom.push('indexation coupée (LX_INDEX)');
  if (robots === false && h.indexable) dom.push('robots.txt ferme encore le site : redéploie');
  out.push({ id: 'domain', title: 'Domaine et indexation', tone: !dom.length && robots !== false ? 'ok' : 'todo', to: '/', go: 'Voir le site', external: true,
    line: dom.length ? cap1(dom.join(' ; ')) + '.' : h.publicUrl.replace(/^https:\/\//, '') + ' répond et Google peut indexer le site.' });

  out.push({ id: 'booking', title: 'Réservation test de bout en bout', tone: st.siteBooking ? 'ok' : 'todo', to: '/?reserver', go: 'Réserver sur le site', external: true,
    line: st.siteBooking ? 'Dernière réservation faite sur le site ' + since(st.siteBooking) + '.'
      : demo || h.sms.provider ? 'Réserve un créneau sur le site comme un client, sur ton téléphone, puis annule-le depuis le SMS reçu.'
        : 'Réserve un créneau sur le site comme un client, sur ton téléphone, puis annule-le dans l’agenda. Le jour J, SMS branchés, refais-le et annule depuis le SMS reçu.' });
  return out;
}

/** ⑪ The external scheduler. Every visit ticks too, so 'a tick ran' proves nothing: what counts is a call from
 *  cron-job.org seen by this server, and above all the texts that waited with nobody sending them (lasting, shared). */
export function cronStep(h: Health, since: (at: number) => string): Step {
  const t = h.tick;
  const base = { id: 'cron', title: 'Planificateur', to: '/reglages/donnees', go: 'Données' };
  const min = (ms: number) => Math.round(ms / 60000) + ' min';
  const seen = t.cronAt != null && t.cronAgeMs != null ? 'Dernier appel de cron-job.org ' + since(t.cronAt) : '';
  const fresh = t.cronAgeMs != null && t.cronAgeMs < t.okMs;
  if (h.mode === 'demo') return { ...base, tone: 'info', line: 'Démo : le salon avance tout seul à chaque visite. En production, cron-job.org appelle /api/cron/tick toutes les 5 min.' };
  if (!t.cron) return { ...base, tone: 'todo', line: 'Pas de CRON_SECRET, donc pas de tâche cron-job.org : sans elle, les SMS retenus la nuit ne partent qu’à la première visite, et ceux de plus de 6 h ne partent plus.' };
  const check = 'Regarde l’historique de la tâche sur cron-job.org (une erreur 401 : l’en-tête CRON_SECRET est faux).';
  if (t.overdue) return { ...base, tone: 'err', line: s(t.overdue, 'message attend', 'messages attendent') + ' depuis plus de ' + min(t.lateMs) + ' sans aucun envoi : rien ne les envoie. ' + check };
  if (t.late24h) {
    return { ...base, tone: 'err',
      line: s(t.late24h, 'message est parti', 'messages sont partis') + ' en retard en 24 h' + (t.lastLate ? ', le dernier ' + min(t.lastLate.ms) + ' après son heure' : '') + ' : personne ne les envoyait. '
        + (fresh ? seen + ' : la tâche répond de nouveau, la ligne redevient verte 24 h après le dernier retard.' : check) };
  }
  if (t.cronAgeMs == null) return { ...base, tone: 'warn', line: 'Aucun appel de cron-job.org vu par ce serveur depuis son démarrage (il a pu passer par un autre). Si ça dure plus de 5 min : ' + check.charAt(0).toLowerCase() + check.slice(1) };
  // this instance's memory only: cron-job.org may reach another warm one, so a silence here is a doubt, not a breakdown
  // (the lasting proof, texts waiting with nobody sending them, is red above)
  if (t.open && t.cronAgeMs > t.lateMs) return { ...base, tone: 'warn', line: 'Aucun appel de cron-job.org vu par ce serveur depuis ' + min(t.cronAgeMs) + ' pendant les heures d’ouverture (il a pu passer par un autre). Si des rappels ne partent pas : ' + check.charAt(0).toLowerCase() + check.slice(1) };
  return { ...base, tone: fresh ? 'ok' : 'warn', line: seen + (fresh ? ', toutes les 5 min.' : ' : il passe toutes les 5 min d’habitude.') };
}
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function TestSms({ disabled }: { disabled: boolean }) {
  const { boot } = useApp();
  const saved = String((boot.settings.notify && boot.settings.notify.phone) || '');
  const [phone, setPhone] = useState(saved);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ simulated: boolean; to: string }>('/api/v1/health/test-sms', phone.trim() ? { phone } : {});
      toast({ title: r.simulated ? 'SMS simulé vers ' + r.to : 'SMS envoyé au ' + r.to, sub: r.simulated ? 'En démo, rien ne part vraiment.' : 'Il arrive dans la minute. Vérifie le nom d’expéditeur et le lien.', icon: 'sms' });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <form className="mr-sms" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="Ton portable, 06 …" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Ton numéro de portable" disabled={disabled} />
      <Button type="submit" variant="subtle" icon="sms" busy={busy} disabled={disabled}>Envoie-moi un SMS test</Button>
    </form>
  );
}

// the step's number stays unless it is done or needs a look
const ICON: Record<Tone, string> = { ok: 'check', todo: '', warn: 'alert', err: 'alert', info: '' };
const WORD: Record<Tone, string> = { ok: 'fait', todo: 'à faire', warn: 'à vérifier', err: 'en panne', info: 'démo' };

export default function MiseEnRoute() {
  const { boot, now } = useApp();
  const { data, error, loading, refresh } = useHealth();
  const robots = useRobots();
  if (loading && !data) return <Skeleton h={520} r={22} />;
  if (!data) return <section className="card"><Empty icon="alert" title="État du salon indisponible" action={<Button variant="subtle" icon="undo" onClick={() => void refresh()}>Réessayer</Button>}>{error?.message || 'Le serveur ne répond pas.'}</Empty></section>;
  const steps = stepsOf(data, robots, boot.settings.messages?.countries || [], now());
  const done = steps.filter((x) => x.tone === 'ok').length;
  const counted = steps.filter((x) => x.tone !== 'info').length;
  const broken = steps.filter((x) => x.tone === 'err');
  return (
    <div className="col" style={{ gap: 16 }}>
      <section className="card col mr-head" style={{ gap: 12 }}>
        <div className="card-h"><h2><Icon name="check" size={16} />Mise en route</h2><span className="faint tnum" style={{ fontSize: 13 }}>{done} sur {counted} prêts</span></div>
        <span className="kpi-bar" aria-hidden><i style={{ ['--w' as any]: Math.round((done / Math.max(1, counted)) * 100) + '%' }} /></span>
        <p className="muted" style={{ fontSize: 13.5 }}>Dans cet ordre : chaque étape compte sur les précédentes. Les coches se mettent à jour toutes seules ; chaque ligne mène à son écran.</p>
        {data.mode === 'demo' ? <Note icon="info">Démo : paiements, SMS et e-mails sont simulés et rien n’est sauvegardé. Ces lignes-là ne comptent pas.</Note> : null}
        {broken.length ? <Note tone="err" icon="alert"><b>{broken.map((x) => x.title).join(', ')}</b> : à regarder tout de suite.</Note> : null}
      </section>
      <ol className="mr-list" aria-label="Étapes de mise en route">
        {steps.map((x, i) => (
          <li key={x.id} className={'mr-step ' + x.tone} data-step={x.id} data-done={x.tone === 'ok' ? '1' : '0'}>
            <span className="mr-n" aria-hidden>{ICON[x.tone] ? <Icon name={ICON[x.tone]} size={16} /> : i + 1}</span>
            <div className="mr-main">
              <div className="mr-t"><b>{x.title}</b><span className={'badge' + (x.tone === 'ok' ? ' badge-ok' : x.tone === 'warn' ? ' badge-warn' : x.tone === 'err' ? ' badge-danger' : x.tone === 'info' ? ' badge-info' : '')}>{WORD[x.tone]}</span></div>
              <p>{x.line}</p>
              {x.more ? <p className="mr-more">{x.more}</p> : null}
              {x.extra}
            </div>
            {x.external
              ? <a className="btn btn-ghost btn-sm mr-go" href={x.to} target="_blank" rel="noopener">{x.go}<Icon name="ext" size={14} /></a>
              : <Link to={x.to} className="btn btn-ghost btn-sm mr-go">{x.go}<Icon name="chevR" size={14} /></Link>}
          </li>
        ))}
      </ol>
      <p className="faint" style={{ fontSize: 12.5 }}>Le passage du domaine, l’indexation et Stripe en réel suivent la liste du jour J, avec ton prestataire. Vérifié {ago(data.now, now())}.</p>
    </div>
  );
}
