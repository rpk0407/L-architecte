// Le salon: contact details, the ticket's legal lines, the site's legal pages and the links sent to clients.
import { dates } from '../../../../lib/format';
import { Button, Field, Note, toast } from '../../../../ui/kit';
import { Link } from '../../../../lib/router';
import { useApp } from '../../../state';
import { Card, SaveBar, useSave, useSection, type SectionProps } from '../shared';

// what the old WordPress site's mentions légales said (an EI must show « EI » next to its name since 2022)
const OLD_SITE = { legalName: 'Frank Mariani EI', siret: '51292347500028', ape: '9602A', publicationDirector: 'Frank Mariani' } as const;
const PAGES = [['/mentions-legales', 'Mentions légales'], ['/confidentialite', 'Confidentialité'], ['/cgv', 'CGV']] as const;
// where this server really keeps the salon's data (boot.providers.store), to check the « base de données » line against
const STORES: Record<string, string> = { postgres: 'une base Postgres', blob: 'Vercel Blob', file: 'un fichier sur le serveur', memory: 'la mémoire du serveur (rien n’est gardé)' };

const get = (o: any, path: string) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
/** The same checks as the server (server/settings/shop.js), shown before saving. */
function errors(f: any) {
  const e: Record<string, string> = {};
  const siret = String(f.siret || '');
  if (siret && !/^[\d ]*$/.test(siret)) e.siret = 'Des chiffres seulement.';
  else if (siret && siret.replace(/ /g, '').length !== 14) e.siret = '14 chiffres, comme 512 923 475 00028.';
  if (f.ape && !/^(\d{2}\.?\d{2}[A-Za-z])?$/.test(String(f.ape).trim())) e.ape = '4 chiffres et une lettre, comme 9602A.';
  const mu = String(get(f, 'mediator.url') || '').trim();
  if (mu && !/^https:\/\/\S+$/.test(mu)) e['mediator.url'] = 'Une adresse qui commence par https://';
  if (!String(get(f, 'host.name') || '').trim()) e['host.name'] = 'Obligatoire sur les mentions légales.';
  return e;
}

export default function Salon({ s }: SectionProps) {
  const { boot } = useApp();
  const shop = useSection(s.shop);
  const foot = useSection(s.payments.receiptFooter as string);
  const { busy, save } = useSave();
  const f = shop.v;
  const err = errors(f);
  const setPath = (path: string, raw: string) => {
    // a SIRET pasted from a Kbis PDF carries non-breaking or narrow spaces
    const v = path === 'siret' ? raw.replace(/\s/g, ' ') : raw;
    const [k, sub] = path.split('.');
    shop.setV(sub ? { ...f, [k]: { ...(f[k] || {}), [sub]: v } } : { ...f, [k]: v });
  };
  const input = (k: string, label: string, o: { hint?: string; type?: string; ph?: string; max?: number } = {}) => {
    const id = 'sh-' + k.replace('.', '-');
    return <Field label={label} hint={o.hint} error={err[k] || null} htmlFor={id}><input id={id} className="input" type={o.type || 'text'} value={get(f, k) || ''} maxLength={o.max} onChange={(e) => setPath(k, e.target.value)} placeholder={o.ph} aria-invalid={err[k] ? true : undefined} /></Field>;
  };
  const missing = (Object.keys(OLD_SITE) as (keyof typeof OLD_SITE)[]).filter((k) => !String(f[k] || '').trim());
  const takeOver = () => {
    shop.setV({ ...f, ...Object.fromEntries(missing.map((k) => [k, OLD_SITE[k]])) });
    toast({ title: 'Infos de l’ancien site reprises', sub: 'Vérifie-les, puis enregistre.', icon: 'check' });
  };
  const store = boot.providers.store;
  // only what changed, and never the CGV version: the server dates it, and a screen loaded before a change would send it back
  const changed = () => Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== 'cgvVersion' && JSON.stringify(v) !== JSON.stringify(s.shop[k])));
  const cgv = typeof f.cgvVersion === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.cgvVersion) ? dates.dayParts(f.cgvVersion) : null;
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Coordonnées" guide="salon-coordonnees" icon="map">
        <div className="grid2">{input('name', 'Nom du salon')}{input('phone', 'Téléphone', { type: 'tel', ph: '04 91 …', hint: 'Obligatoire sur les mentions légales (LCEN) : un portable suffit.' })}</div>
        {input('address', 'Adresse')}
        <div className="grid2">{input('zip', 'Code postal')}{input('city', 'Ville')}</div>
        {input('email', 'E-mail de contact', { type: 'email' })}
      </Card>
      <Card title="Mentions légales du ticket" guide="salon-ticket" icon="ticket">
        <div className="grid2">{input('legalName', 'Raison sociale', { ph: 'Prénom Nom EI' })}{input('siret', 'SIRET', { ph: '14 chiffres', max: 20 })}</div>
        {input('vatNumber', 'N° de TVA intracommunautaire', { ph: 'FR…' })}
        <Field label="Message en bas du ticket" htmlFor="sh-foot"><input id="sh-foot" className="input" maxLength={160} value={foot.v} onChange={(e) => foot.setV(e.target.value)} /></Field>
        {!f.siret ? <Note tone="warn" icon="alert">Le SIRET doit figurer sur les tickets remis aux clients.</Note> : null}
      </Card>
      <Card title="Site et mentions légales" guide="salon-legal" icon="shield" aside={<span className="row wrap" style={{ gap: 4 }}>{PAGES.map(([href, t]) => <a key={href} className="btn btn-ghost btn-sm" href={href} target="_blank" rel="noopener">{t}</a>)}</span>}>
        <p className="muted" style={{ fontSize: 13.5 }}>Les pages Mentions légales, Confidentialité et CGV du site se remplissent avec ces infos et celles de Réservation.</p>
        {missing.length ? (
          <div className="note" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: '1 1 240px' }}>Les mentions de l’ancien site, prêtes en un geste&nbsp;: <b>{OLD_SITE.legalName}</b>, SIRET 512 923 475 00028, APE {OLD_SITE.ape}, directeur de la publication {OLD_SITE.publicationDirector}. Seuls les champs vides sont remplis.</div>
            <Button variant="primary" size="sm" icon="download" onClick={takeOver}>Reprendre les infos de l’ancien site</Button>
          </div>
        ) : null}
        <div className="grid2 stack">
          {input('legalForm', 'Forme juridique', { ph: 'Entrepreneur individuel', max: 60 })}
          {input('registration', 'Immatriculation (RM ou RNE)', { ph: 'N° au répertoire des métiers', max: 60 })}
          {input('ape', 'Code APE', { ph: '4 chiffres et une lettre', max: 6 })}
          {input('publicationDirector', 'Directeur de la publication', { ph: 'Prénom Nom', max: 80 })}
        </div>
        <div className="grid2 stack">
          {input('mediator.name', 'Médiateur de la consommation', { ph: 'Nom du médiateur', max: 120, hint: 'Obligatoire quand on vend aux particuliers. Ta CMA ou ton syndicat t’en indique un.' })}
          {input('mediator.url', 'Site du médiateur', { type: 'url', ph: 'https://…', max: 300 })}
        </div>
        {!String(get(f, 'mediator.name') || '').trim() ? <Note tone="warn" icon="alert">Sans médiateur, les CGV et les mentions légales ne peuvent pas l’indiquer : la loi l’exige pour les clients particuliers.</Note> : null}
        {!String(f.phone || '').trim() ? <Note tone="warn" icon="alert">Ajoute un téléphone dans Coordonnées : la loi (LCEN) l’impose sur les mentions légales.</Note> : null}
        <div className="grid2 stack">
          {input('host.name', 'Hébergeur du site', { max: 80 })}
          {input('host.phone', 'Téléphone de l’hébergeur', { type: 'tel', max: 30 })}
        </div>
        {input('host.address', 'Adresse de l’hébergeur', { max: 160 })}
        {input('dataHost', 'Hébergeur de la base de données', { max: 120, hint: store ? 'Ce serveur enregistre les données dans ' + (STORES[store] || store) + '.' : undefined })}
        {store && store !== 'postgres' ? <Note tone="warn" icon="alert">Les données ne sont pas dans une base Postgres (Neon) mais dans {STORES[store] || store} : écris ici le vrai hébergeur et sa région, la page Confidentialité le reprend.</Note> : null}
        <p className="muted" style={{ fontSize: 13.5 }}>{cgv ? 'CGV en vigueur : version du ' + cgv.d + (cgv.d === 1 ? 'er' : '') + ' ' + dates.MONTHS_FR[cgv.m - 1] + ' ' + cgv.y + '. ' : ''}La version change d’elle-même quand tu modifies l’acompte ou l’annulation dans Réservation.</p>
      </Card>
      <Card title="Liens" icon="link">
        <p className="muted" style={{ fontSize: 13.5 }}>Le lien d’avis Google se règle avec la demande d’avis, dans <Link to="/reglages/messages">Messages › Avis Google</Link>.</p>
        {input('mapsUrl', 'Lien Google Maps', { type: 'url' })}
        {input('instagram', 'Instagram du salon', { type: 'url' })}
      </Card>
      <SaveBar dirty={shop.dirty || foot.dirty} busy={busy} disabled={!f.name || f.name.length < 2 || Object.keys(err).length > 0} onReset={() => { shop.reset(); foot.reset(); }} onSave={() => save({ ...(shop.dirty ? { shop: changed() } : {}), ...(foot.dirty ? { payments: { receiptFooter: foot.v } } : {}) })} />
    </div>
  );
}
