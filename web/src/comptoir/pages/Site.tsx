// Le site: what the public site says besides the catalogue, the team and the hours: the banner, the texts, the questions,
// the Google reviews, the photos and the links. Owner and managers (like the catalogue); saved with PATCH /api/v1/site,
// visible on the site at once. The texts in the FAQ take tokens ({prix:cl}) so a price changed in the Catalogue is the
// price the answer gives (server/settings/site.js). Formations edits /formations (server/settings/trainings.js), saved apart
// with PATCH /api/v1/trainings.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { load, peek, refreshAll, useQuery } from '../../lib/query';
import { Link, useRoute } from '../../lib/router';
import { cap, dates, dur, eur, money, plural } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Button, Field, Note, Skeleton, confirm, toast, toastError } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import type { Service } from '../types';
import { PhotoPicker, PhotoSlot, WordpressPhotos, type Picked } from './site/media';
import './site.css';

type Photo = { url: string; alt?: string; caption?: string };
type Work = Photo & { tag?: string; service?: string };
type Faq = { q: string; a: string; link?: string; linkLabel?: string };
type Quote = { text: string; author?: string; date?: string };
export type SiteContent = {
  announce: { text: string; from: string; to: string; link: string };
  hero: { title: string; sub: string };
  house: string;
  faq: Faq[];
  reviews: { rating: number; count: number; updatedAt: string; quotes: Quote[] };
  links: { instagram: string; facebook: string; youtube: string };
  photos: { hero: Photo; salon: Photo | null; work: Work[] };
};
type SiteData = {
  site: SiteContent; defaults: SiteContent; tokens: { t: string; d: string }[]; tokenPattern: string; tokenLike: string; limits: { announce: number; house: number; faq: number; quotes: number; work: number; heroTitle: number };
  services: Service[]; hours: Record<string, [number, number][]>; shop: { address: string; zip: string; city: string }; hoursText: string; closedText: string;
};
type Section = keyof SiteContent;

const TABS = [
  { id: 'annonce', label: 'Annonce', icon: 'bell', keys: ['announce'] },
  { id: 'textes', label: 'Textes', icon: 'edit', keys: ['hero', 'house'] },
  { id: 'faq', label: 'FAQ', icon: 'info', keys: ['faq'] },
  { id: 'avis', label: 'Avis Google', icon: 'star', keys: ['reviews'] },
  { id: 'photos', label: 'Photos', icon: 'sparkle', keys: ['photos'] },
  { id: 'liens', label: 'Liens', icon: 'link', keys: ['links'] },
  { id: 'formations', label: 'Formations', icon: 'scissors', keys: [] }
] as const;
const HTTPS = /^(https:\/\/[^\s"'<>]+)?$/;
// as server/settings/site.js: never '//host' nor '/\host', which browsers read as another site
const SITE_LINK = /^(https:\/\/[^\s"'<>\\]+|\/(?![/\\])[^\s"'<>\\]*)?$/;

/** The FAQ's tokens as the site will show them: the server's patterns (GET /api/v1/site), the same rules as resolveTokens. */
export function resolveText(text: string, d: Pick<SiteData, 'services' | 'hoursText' | 'closedText' | 'shop' | 'tokenPattern' | 'tokenLike'>) {
  const missing: string[] = [];
  const out = text.replace(new RegExp(d.tokenPattern, 'g'), (all, kind: string, code?: string) => {
    let v = '';
    if (kind === 'prix' || kind === 'duree') { const s = code ? d.services.find((x) => x.active && x.slug === code) : null; v = s ? (kind === 'prix' ? eur(s.price) : dur(s.dur)) : ''; }
    else if (kind === 'horaires') v = d.hoursText;
    else if (kind === 'fermeture') v = d.closedText;
    else v = [d.shop.address, [d.shop.zip, d.shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (!v) missing.push(all);
    return v;
  });
  // a misspelt token ({prix:CL}) would show as typed: the site leaves the question out
  for (const m of out.match(new RegExp(d.tokenLike, 'g')) || []) missing.push(m);
  return { text: out, missing };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function Site() {
  const route = useRoute();
  const q = useQuery<SiteData>('/api/v1/site');
  const tab = TABS.find((t) => t.id === route.id) || TABS[0];
  // the training page loads once opened, then stays mounted so its unsaved changes survive a tab switch
  const [trainings, setTrainings] = useState(false);
  useEffect(() => { if (tab.id === 'formations') setTrainings(true); }, [tab.id]);
  // on a phone the tabs scroll: keep the open one in sight
  useEffect(() => { document.querySelector('.si-top .tabs [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [tab.id]);
  return (
    <>
      <PageTitle><h1>Le site</h1></PageTitle>
      <div className="si-top">
        <nav className="tabs grow" aria-label="Le site">
          {TABS.map((t) => <Link key={t.id} to={'/site' + (t.id === 'annonce' ? '' : '/' + t.id)} className="tab" aria-current={tab.id === t.id ? 'page' : undefined}><Icon name={t.icon} size={16} />{t.label}</Link>)}
        </nav>
        <a className="btn btn-subtle si-see" href={tab.id === 'formations' ? '/formations' : '/'} target="_blank" rel="noopener"><Icon name="globe" />{tab.id === 'formations' ? 'Voir la page' : 'Voir le site'}</a>
      </div>
      {q.data ? <Editor key="ed" data={q.data} tab={tab.id} /> : tab.id === 'formations' ? null : q.error ? <Note tone="err" icon="alert">{q.error.message}</Note> : <Skeleton h={420} r={22} />}
      {trainings ? <div hidden={tab.id !== 'formations'}><TrainingsEditor /></div> : null}
    </>
  );
}

function Editor({ data, tab }: { data: SiteData; tab: string }) {
  const [f, setF] = useState<SiteContent>(data.site);
  const [busy, setBusy] = useState(false);
  const saved = useRef(JSON.stringify(data.site));
  const now = useRef(f);
  now.current = f;
  // what someone else saved meanwhile replaces the form, unless this screen has changes of its own
  useEffect(() => { const k = JSON.stringify(data.site); if (k !== saved.current) { if (same(f, JSON.parse(saved.current))) setF(data.site); saved.current = k; } }, [JSON.stringify(data.site)]);
  const set = <K extends Section>(k: K, v: SiteContent[K]) => setF((x) => ({ ...x, [k]: v }));
  const changed = (Object.keys(f) as Section[]).filter((k) => !same(f[k], data.site[k]));
  const problem = check(f);
  const save = async () => {
    if (problem) { toast({ kind: 'err', title: problem, icon: 'alert' }); return; }
    const patch: Record<string, unknown> = {};
    for (const k of changed) patch[k] = f[k];
    // the reviews say when they were last copied from Google
    if (patch.reviews && (f.reviews.rating !== data.site.reviews.rating || f.reviews.count !== data.site.reviews.count)) patch.reviews = { ...f.reviews, updatedAt: dates.localParts(Date.now()).day };
    setBusy(true);
    const sent = f;
    try {
      await api.patch('/api/v1/site', patch);
      toast({ title: 'Site mis à jour', sub: 'Les visiteurs le voient dans la minute.', icon: 'check' });
      // the form becomes what the server stored (the reviews' date, trimmed texts), unless it was edited meanwhile
      await load('/api/v1/site').catch(() => {});
      const fresh = peek<SiteData>('/api/v1/site');
      if (fresh && same(now.current, sent)) { saved.current = JSON.stringify(fresh.site); setF(fresh.site); }
      refreshAll();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const body: Record<string, ReactNode> = {
    annonce: <Announce v={f.announce} saved={data.site.announce} onChange={(v) => set('announce', v)} max={data.limits.announce} />,
    textes: <Texts f={f} set={set} data={data} />,
    faq: <FaqEditor items={f.faq} onChange={(v) => set('faq', v)} data={data} />,
    avis: <Reviews v={f.reviews} onChange={(v) => set('reviews', v)} max={data.limits.quotes} />,
    photos: <Photos v={f.photos} onChange={(v) => set('photos', v)} data={data} />,
    liens: <Links v={f.links} onChange={(v) => set('links', v)} />
  };
  const elsewhere = changed.filter((k) => !TABS.find((t) => t.id === tab)?.keys.includes(k as never));
  return (
    <div className="si-body">
      {body[tab]}
      {changed.length ? (
        <div className="si-save" role="region" aria-label="Enregistrer">
          <span className="grow">{problem || 'Modifications non enregistrées' + (elsewhere.length ? ' (aussi dans ' + elsewhere.map((k) => TABS.find((t) => (t.keys as readonly string[]).includes(k))?.label).join(', ') + ')' : '')}</span>
          <Button variant="ghost" onClick={() => setF(data.site)}>Annuler</Button>
          <Button variant="primary" busy={busy} disabled={!!problem} onClick={save}>Enregistrer</Button>
        </div>
      ) : null}
    </div>
  );
}

/** The first thing the server would refuse, in words, or null. */
function check(f: SiteContent): string | null {
  const a = f.announce;
  if (a.from && a.to && a.to < a.from) return 'L’annonce doit finir après son début.';
  if (!SITE_LINK.test(a.link)) return 'Le lien de l’annonce : https://… ou une page du site (/cgv).';
  if (!f.hero.title.trim()) return 'Le grand titre ne peut pas être vide.';
  for (const [k, v] of Object.entries(f.links)) if (!HTTPS.test(v)) return 'Le lien ' + cap(k) + ' doit commencer par https://';
  for (const [i, q] of f.faq.entries()) {
    if (q.q.trim().length < 3) return 'Question ' + (i + 1) + ' : la question est trop courte.';
    if (q.a.trim().length < 2) return 'Question ' + (i + 1) + ' : il manque la réponse.';
    if (q.link && !SITE_LINK.test(q.link)) return 'Question ' + (i + 1) + ' : le lien doit commencer par https:// ou /.';
  }
  if (!(f.reviews.rating >= 0 && f.reviews.rating <= 5)) return 'La note Google va de 0 à 5.';
  if (f.reviews.quotes.some((q) => q.text.trim().length < 2)) return 'Un avis cité est vide.';
  return null;
}

/* ---------------- Annonce ---------------- */

function Announce({ v, saved, onChange, max }: { v: SiteContent['announce']; saved: SiteContent['announce']; onChange: (v: SiteContent['announce']) => void; max: number }) {
  const { boot } = useApp();
  const today = boot.today;
  const runs = (a: SiteContent['announce']) => !!a.text && (!a.from || a.from <= today) && (!a.to || a.to >= today);
  // the badge says what the site shows now; the note, what it will show once this is saved
  const on = runs(v), live = runs(saved), pending = !same(v, saved);
  const status = !v.text ? { tone: '', t: 'Aucune annonce sur le site.' }
    : on ? { tone: 'ok', t: 'En ligne' + (v.to ? ' jusqu’au ' + dates.dayLong(v.to) + ' inclus' : ', jusqu’à ce que tu la retires') + '.' }
      : v.from && v.from > today ? { tone: 'accent', t: 'Programmée : visible à partir du ' + dates.dayLong(v.from) + '.' }
        : { tone: 'warn', t: 'Terminée le ' + dates.dayLong(v.to) + ' : elle n’est plus affichée.' };
  return (
    <section className="card col" style={{ gap: 14 }}>
      <div className="card-h"><h2><Icon name="bell" size={16} />Bandeau en haut du site</h2><span className={'badge ' + (live ? 'badge-ok' : '')}>{live ? 'en ligne' : saved.text ? 'pas affichée aujourd’hui' : 'aucune en ligne'}</span></div>
      <p className="muted si-lead">Un jour de fermeture, un horaire exceptionnel, une nouveauté : une phrase, affichée en haut de la page d’accueil et dans le sommaire, entre les deux dates.</p>
      <Field label="Le message" htmlFor="si-an" hint={v.text.length + ' / ' + max}>
        <input id="si-an" className="input" maxLength={max} value={v.text} placeholder="Fermé le 11 novembre (férié). Réouverture le 12 à 9 h." onChange={(e) => onChange({ ...v, text: e.target.value })} />
      </Field>
      <div className="grid2">
        <Field label="Affichée à partir du" htmlFor="si-af" hint="Vide : dès maintenant"><input id="si-af" className="input" type="date" value={v.from} onChange={(e) => onChange({ ...v, from: e.target.value })} /></Field>
        <Field label="Jusqu’au (inclus)" htmlFor="si-at" hint="Vide : jusqu’à ce que tu la retires"><input id="si-at" className="input" type="date" value={v.to} min={v.from || undefined} onChange={(e) => onChange({ ...v, to: e.target.value })} /></Field>
      </div>
      <Field label="Lien (facultatif)" htmlFor="si-al" hint="Une page du site (/cgv, /formations) ou une adresse https://" error={SITE_LINK.test(v.link) ? null : 'https://… ou une page du site commençant par /'}>
        <input id="si-al" className="input" inputMode="url" value={v.link} placeholder="/formations" onChange={(e) => onChange({ ...v, link: e.target.value.trim() })} />
      </Field>
      {v.text ? (
        <div className="si-preview si-preview-light" aria-label="Aperçu">
          <span className="si-ann"><i aria-hidden />{v.text}{v.link ? <Icon name="arrowR" size={14} /> : null}</span>
        </div>
      ) : null}
      <Note tone={status.tone as any} icon={on ? 'check' : 'info'}>{pending ? 'Une fois enregistrée : ' + status.t.charAt(0).toLowerCase() + status.t.slice(1) : status.t}</Note>
      {v.text ? <div className="row"><Button variant="ghost" icon="trash" onClick={() => onChange({ text: '', from: '', to: '', link: '' })}>Retirer l’annonce</Button></div> : null}
    </section>
  );
}

/* ---------------- Textes ---------------- */

function Texts({ f, set, data }: { f: SiteContent; set: <K extends Section>(k: K, v: SiteContent[K]) => void; data: SiteData }) {
  return (
    <div className="si-cols">
      <section className="card col" style={{ gap: 14 }}>
        <div className="card-h"><h2><Icon name="sparkle" size={16} />En haut de la page</h2>{!same(f.hero, data.defaults.hero) ? <button type="button" className="link" onClick={() => set('hero', data.defaults.hero)}>Texte d’origine</button> : null}</div>
        <Field label="Le grand mot" htmlFor="si-ht" hint={'Dessiné en pointillés sur toute la largeur : un ou deux mots (' + f.hero.title.length + ' / ' + data.limits.heroTitle + ').'}>
          <input id="si-ht" className="input si-serif" maxLength={data.limits.heroTitle} value={f.hero.title} onChange={(e) => set('hero', { ...f.hero, title: e.target.value })} />
        </Field>
        <Field label="Juste dessous" htmlFor="si-hs" hint="Deux lignes courtes. Un retour à la ligne passe à la ligne sur le site.">
          <textarea id="si-hs" className="input textarea" rows={2} maxLength={120} value={f.hero.sub} onChange={(e) => set('hero', { ...f.hero, sub: e.target.value })} />
        </Field>
        <div className="si-preview si-preview-light" aria-hidden><b className="si-hero-t">{f.hero.title || '…'}</b><span className="si-hero-s">{f.hero.sub}</span></div>
      </section>
      <section className="card col" style={{ gap: 14 }}>
        <div className="card-h"><h2><Icon name="chair" size={16} />La maison</h2>{f.house !== data.defaults.house ? <button type="button" className="link" onClick={() => set('house', data.defaults.house)}>Texte d’origine</button> : null}</div>
        <Field label="Qui vous êtes, ce que vous faites" htmlFor="si-ho" hint={f.house.length + ' / ' + data.limits.house + ' · sous « Prends place. », en grand : trois ou quatre phrases suffisent.'}>
          <textarea id="si-ho" className="input textarea" rows={6} maxLength={data.limits.house} value={f.house} onChange={(e) => set('house', e.target.value)} />
        </Field>
        <Note icon="info">Les horaires, les prix et l’équipe ne s’écrivent pas ici : ils viennent de <Link to="/reglages/horaires" className="link">Réglages › Horaires</Link>, du <Link to="/catalogue" className="link">Catalogue</Link> et de l’<Link to="/equipe" className="link">Équipe</Link>. Horaires affichés : <b>{data.hoursText || 'aucun'}</b>.</Note>
      </section>
    </div>
  );
}

/* ---------------- FAQ ---------------- */

function FaqEditor({ items, onChange, data }: { items: Faq[]; onChange: (v: Faq[]) => void; data: SiteData }) {
  const refs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const priced = data.services.filter((s) => s.active && s.slug);
  const setAt = (i: number, v: Faq) => onChange(items.map((x, j) => (j === i ? v : x)));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  const insert = (i: number, token: string) => {
    const el = refs.current[i];
    const a = items[i].a;
    const at = el ? el.selectionStart ?? a.length : a.length;
    const end = el ? el.selectionEnd ?? at : at;
    setAt(i, { ...items[i], a: a.slice(0, at) + token + a.slice(end) });
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + token.length, at + token.length); } });
  };
  const remove = async (i: number) => { if (await confirm({ title: 'Retirer cette question ?', body: '« ' + items[i].q + ' »', ok: 'Retirer', danger: true })) onChange(items.filter((_, j) => j !== i)); };
  return (
    <div className="col" style={{ gap: 14 }}>
      <Note icon="info">
        Dans une réponse, <code>{'{prix:cl}'}</code> devient le prix de la prestation dont le code est <code>cl</code> (« {priced.find((s) => s.slug === 'cl') ? eur(priced.find((s) => s.slug === 'cl')!.price) : '20 €'} ») : quand le prix change dans le Catalogue, la réponse suit. Aussi : {data.tokens.filter((t) => t.t !== '{prix:cl}').map((t, i) => <span key={t.t}>{i ? ', ' : ''}<code>{t.t}</code> {t.d}</span>)}. Une question dont un code ne correspond à rien est masquée sur le site.
      </Note>
      {items.map((x, i) => {
        const r = resolveText(x.a, data);
        return (
          <section key={i} className="card col si-faq" style={{ gap: 10 }}>
            <div className="card-h">
              <h2><span className="si-num">{String(i + 1).padStart(2, '0')}</span>Question</h2>
              <span className="row" style={{ gap: 2 }}>
                <Button size="sm" variant="ghost" icon="chevL" className="si-up" aria-label="Monter" disabled={!i} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" icon="chevL" className="si-down" aria-label="Descendre" disabled={i === items.length - 1} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" icon="trash" aria-label="Retirer la question" onClick={() => remove(i)} />
              </span>
            </div>
            <Field label="La question" htmlFor={'si-q' + i}><input id={'si-q' + i} className="input" maxLength={140} value={x.q} onChange={(e) => setAt(i, { ...x, q: e.target.value })} /></Field>
            <Field label="La réponse" htmlFor={'si-a' + i}>
              <textarea id={'si-a' + i} ref={(el) => { refs.current[i] = el; }} className="input textarea" rows={3} maxLength={600} value={x.a} onChange={(e) => setAt(i, { ...x, a: e.target.value })} />
            </Field>
            <div className="si-ins">
              <span className="faint">Insérer</span>
              <select className="input select si-ins-sel" value="" aria-label="Insérer le prix d’une prestation" onChange={(e) => e.target.value && insert(i, '{prix:' + e.target.value + '}')}>
                <option value="">un prix…</option>
                {priced.map((s) => <option key={s.id} value={s.slug!}>{s.name} · {eur(s.price)}</option>)}
              </select>
              <select className="input select si-ins-sel" value="" aria-label="Insérer la durée d’une prestation" onChange={(e) => e.target.value && insert(i, '{duree:' + e.target.value + '}')}>
                <option value="">une durée…</option>
                {priced.map((s) => <option key={s.id} value={s.slug!}>{s.name} · {dur(s.dur)}</option>)}
              </select>
              <Button size="sm" variant="ghost" onClick={() => insert(i, '{horaires}')}>Horaires</Button>
              <Button size="sm" variant="ghost" onClick={() => insert(i, '{fermeture}')}>Jours fermés</Button>
              <Button size="sm" variant="ghost" onClick={() => insert(i, '{adresse}')}>Adresse</Button>
            </div>
            {r.missing.length
              ? <Note tone="warn" icon="alert">Masquée sur le site : {r.missing.join(', ')} ne correspond à rien{r.missing.some((m) => m.startsWith('{prix') || m.startsWith('{duree')) ? ' (aucune prestation active avec ce code dans le Catalogue)' : ''}.</Note>
              : x.a !== r.text ? <p className="si-out"><span className="faint">Sur le site :</span> {r.text}</p> : null}
            <details className="si-more" open={!!x.link}>
              <summary>Un lien sous la réponse</summary>
              <div className="grid2">
                <Field label="Adresse" htmlFor={'si-l' + i} error={!x.link || SITE_LINK.test(x.link) ? null : 'https://… ou /page'}><input id={'si-l' + i} className="input" inputMode="url" value={x.link || ''} placeholder="/formations" onChange={(e) => setAt(i, { ...x, link: e.target.value.trim() })} /></Field>
                <Field label="Texte du lien" htmlFor={'si-ll' + i}><input id={'si-ll' + i} className="input" maxLength={60} value={x.linkLabel || ''} placeholder="En savoir plus" onChange={(e) => setAt(i, { ...x, linkLabel: e.target.value })} /></Field>
              </div>
            </details>
          </section>
        );
      })}
      <div className="row wrap" style={{ gap: 8 }}>
        <Button variant="subtle" icon="plus" disabled={items.length >= data.limits.faq} onClick={() => onChange([...items, { q: '', a: '' }])}>Ajouter une question</Button>
        <span className="faint">{items.length} / {data.limits.faq}</span>
        {!same(items, data.defaults.faq) ? <button type="button" className="link" onClick={async () => { if (await confirm({ title: 'Reprendre les questions d’origine ?', body: 'Les questions de cette page sont remplacées par celles du site d’origine.', ok: 'Reprendre' })) onChange(data.defaults.faq); }}>Questions d’origine</button> : null}
      </div>
    </div>
  );
}

/* ---------------- Avis Google ---------------- */

function Reviews({ v, onChange, max }: { v: SiteContent['reviews']; onChange: (v: SiteContent['reviews']) => void; max: number }) {
  const { boot } = useApp();
  const [rate, setRate] = useState(v.rating.toFixed(1).replace('.', ','));
  // follow a rating set elsewhere (Annuler, another screen), never rewrite what is being typed ("4," on the way to "4,9")
  useEffect(() => { if (Number(rate.replace(',', '.')) !== v.rating) setRate(v.rating.toFixed(1).replace('.', ',')); }, [v.rating]);
  const old = v.updatedAt ? dates.diffDays(v.updatedAt, boot.today) : null;
  const setQ = (i: number, q: Quote) => onChange({ ...v, quotes: v.quotes.map((x, j) => (j === i ? q : x)) });
  return (
    <div className="si-cols">
      <section className="card col" style={{ gap: 14 }}>
        <div className="card-h"><h2><Icon name="star" size={16} />La note</h2><a className="link" href={boot.settings.shop?.mapsUrl} target="_blank" rel="noopener">Voir la fiche Google</a></div>
        <p className="muted si-lead">Recopie la note et le nombre d’avis de ta fiche Google : le site les affiche en haut de la page et dans « La preuve ».</p>
        <div className="grid2">
          <Field label="Note sur 5" htmlFor="si-rr"><input id="si-rr" className="input tnum si-serif" inputMode="decimal" value={rate} onChange={(e) => { setRate(e.target.value); const n = Number(e.target.value.replace(',', '.')); if (Number.isFinite(n) && n >= 0 && n <= 5) onChange({ ...v, rating: Math.round(n * 10) / 10 }); }} /></Field>
          <Field label="Nombre d’avis" htmlFor="si-rc"><input id="si-rc" className="input tnum si-serif" inputMode="numeric" value={String(v.count)} onChange={(e) => onChange({ ...v, count: Math.min(100000, Number(e.target.value.replace(/\D/g, '')) || 0) })} /></Field>
        </div>
        <Note tone={old != null && old > 90 ? 'warn' : ''} icon="clock">{v.updatedAt ? 'Mise à jour le ' + dates.dayLong(v.updatedAt) + (old != null && old > 90 ? ' : pense à la recopier, elle a plus de trois mois.' : '.') : 'Jamais mise à jour depuis le Comptoir : ce sont les chiffres de l’ancien site.'} {v.count ? '' : 'À 0 avis, la note n’est pas affichée.'}</Note>
      </section>
      <section className="card col" style={{ gap: 14 }}>
        <div className="card-h"><h2><Icon name="heart" size={16} />Les avis cités</h2><span className="faint">{v.quotes.length} / {max}</span></div>
        <p className="muted si-lead">Copie un passage d’un vrai avis Google, sans le changer. Entoure quelques mots d’astérisques pour les souligner : *très à l’écoute*.</p>
        {v.quotes.map((q, i) => (
          <div key={i} className="si-quote col" style={{ gap: 10 }}>
            <Field label={'Avis ' + (i + 1)} htmlFor={'si-qt' + i} hint={q.text.length + ' / 240'}><textarea id={'si-qt' + i} className="input textarea" rows={3} maxLength={240} value={q.text} onChange={(e) => setQ(i, { ...q, text: e.target.value })} /></Field>
            <div className="grid2">
              <Field label="Auteur" htmlFor={'si-qa' + i}><input id={'si-qa' + i} className="input" maxLength={40} value={q.author || ''} placeholder="Prénom et initiale" onChange={(e) => setQ(i, { ...q, author: e.target.value })} /></Field>
              <Field label="Mois de l’avis" htmlFor={'si-qd' + i}><input id={'si-qd' + i} className="input" type="month" value={q.date || ''} onChange={(e) => setQ(i, { ...q, date: e.target.value })} /></Field>
            </div>
            <div className="row"><span className="grow" /><Button size="sm" variant="ghost" icon="trash" onClick={() => onChange({ ...v, quotes: v.quotes.filter((_, j) => j !== i) })}>Retirer</Button></div>
          </div>
        ))}
        <Button variant="subtle" icon="plus" disabled={v.quotes.length >= max} onClick={() => onChange({ ...v, quotes: [...v.quotes, { text: '', author: '', date: boot.today.slice(0, 7) }] })}>Ajouter un avis</Button>
      </section>
    </div>
  );
}

/* ---------------- Photos ---------------- */

function Photos({ v, onChange, data }: { v: SiteContent['photos']; onChange: (v: SiteContent['photos']) => void; data: SiteData }) {
  const [adding, setAdding] = useState(false);
  const [wp, setWp] = useState(false);
  const priced = data.services.filter((s) => s.active && s.online && s.slug);
  // a code the online menu does not have: said in words, never as the bare code
  const offLabel = (code: string) => { const s = data.services.find((x) => x.active && x.slug === code); return s ? s.name + ' (réservée au salon : pas de bouton)' : 'Prestation absente du catalogue : pas de bouton'; };
  const setW = (i: number, w: Work) => onChange({ ...v, work: v.work.map((x, j) => (j === i ? w : x)) });
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= v.work.length) return; const n = [...v.work]; [n[i], n[j]] = [n[j], n[i]]; onChange({ ...v, work: n }); };
  const addWork = (p: Picked) => onChange({ ...v, work: [...v.work, { url: p.url, alt: p.alt || '', caption: (p.caption || '').slice(0, 60), tag: '', service: '' }].slice(0, data.limits.work) });
  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="card col" style={{ gap: 12 }}>
        <div className="card-h"><h2><Icon name="download" size={16} />L’ancien site</h2><Button size="sm" variant={wp ? 'ghost' : 'subtle'} onClick={() => setWp(!wp)}>{wp ? 'Fermer' : 'Récupérer les photos de l’ancien site'}</Button></div>
        {wp ? <WordpressPhotos onPick={(p) => { if (v.work.length < data.limits.work) { addWork(p); toast({ title: 'Ajoutée au travail', icon: 'check' }); } else toast({ kind: 'err', title: 'Déjà ' + data.limits.work + ' photos du travail : retires-en une d’abord.' }); }} pickLabel="Ajouter au travail" /> : <p className="muted si-lead">Les photos de la médiathèque WordPress sont copiées dans le Comptoir : choisis ensuite celles du site. À faire avant la bascule du domaine (ou sur ancien.barberlarchitecte.com).</p>}
      </section>
      <div className="si-cols">
        <section className="card col" style={{ gap: 12 }}>
          <div className="card-h"><h2><Icon name="sparkle" size={16} />Photo d’accueil</h2></div>
          <PhotoSlot url={v.hero.url} alt={v.hero.alt} label="Photo d’accueil" tall onPick={(p) => onChange({ ...v, hero: { url: p.url, alt: p.alt || '', caption: '' } })} />
          <Field label="Ce qu’on y voit (pour les malvoyants et Google)" htmlFor="si-pha"><input id="si-pha" className={'input' + (v.hero.alt ? '' : ' si-todo')} maxLength={160} value={v.hero.alt || ''} onChange={(e) => onChange({ ...v, hero: { ...v.hero, alt: e.target.value } })} /></Field>
        </section>
        <section className="card col" style={{ gap: 12 }}>
          <div className="card-h"><h2><Icon name="chair" size={16} />Photo du salon</h2></div>
          <PhotoSlot url={v.salon ? v.salon.url : null} alt={v.salon?.alt} label="Photo du salon" onPick={(p) => onChange({ ...v, salon: { url: p.url, alt: p.alt || '', caption: '' } })} onRemove={() => onChange({ ...v, salon: null })} />
          {v.salon ? <Field label="Ce qu’on y voit" htmlFor="si-psa"><input id="si-psa" className="input" maxLength={160} value={v.salon.alt || ''} onChange={(e) => onChange({ ...v, salon: { ...v.salon!, alt: e.target.value } })} /></Field> : null}
          <p className="faint si-small">En bas de la page (Venir) et derrière l’équipe. Une photo à toi s’affiche aussi en plein écran dans « La maison », qui dit « à venir » jusque-là.</p>
        </section>
      </div>
      <section className="card col" style={{ gap: 12 }}>
        <div className="card-h"><h2><Icon name="scissors" size={16} />Le travail</h2><span className="faint">{v.work.length} / {data.limits.work}</span></div>
        <p className="muted si-lead">Les coupes qui défilent sous « Sorti du fauteuil. ». Un titre court, et la prestation que le bouton « Je veux cette coupe » réserve.</p>
        <ul className="si-work">
          {v.work.map((w, i) => (
            <li key={i} className="si-work-i">
              <PhotoSlot url={w.url} alt={w.alt} label={'Photo ' + (i + 1)} tall onPick={(p) => setW(i, { ...w, url: p.url, alt: p.alt || w.alt })} onRemove={() => onChange({ ...v, work: v.work.filter((_, j) => j !== i) })} />
              <Field label="Titre" htmlFor={'si-wc' + i}><input id={'si-wc' + i} className="input" maxLength={60} value={w.caption || ''} placeholder="La raie marquée" onChange={(e) => setW(i, { ...w, caption: e.target.value })} /></Field>
              <Field label="Au zoom" htmlFor={'si-wt' + i}><input id={'si-wt' + i} className="input" maxLength={60} value={w.tag || ''} placeholder="Dégradé bas, raie tracée" onChange={(e) => setW(i, { ...w, tag: e.target.value })} /></Field>
              <Field label="Le bouton réserve" htmlFor={'si-ws' + i}>
                <select id={'si-ws' + i} className="input select" value={w.service || ''} onChange={(e) => setW(i, { ...w, service: e.target.value })}>
                  <option value="">Pas de bouton (sur demande)</option>
                  {priced.map((s) => <option key={s.id} value={s.slug!}>{s.name}</option>)}
                  {w.service && !priced.some((s) => s.slug === w.service) ? <option value={w.service}>{offLabel(w.service)}</option> : null}
                </select>
              </Field>
              <Field label="Ce qu’on y voit" htmlFor={'si-wa' + i} hint={w.alt ? undefined : 'À écrire : pour les malvoyants et Google.'}><input id={'si-wa' + i} className={'input' + (w.alt ? '' : ' si-todo')} maxLength={160} value={w.alt || ''} placeholder="Dégradé bas, raie tracée sur le côté" onChange={(e) => setW(i, { ...w, alt: e.target.value })} /></Field>
              <div className="row" style={{ gap: 4 }}>
                <Button size="sm" variant="ghost" icon="chevL" aria-label="Plus tôt dans le défilé" disabled={!i} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" icon="chevL" className="si-flip" aria-label="Plus tard dans le défilé" disabled={i === v.work.length - 1} onClick={() => move(i, 1)} />
              </div>
            </li>
          ))}
          {v.work.length < data.limits.work ? <li className="si-work-add"><button type="button" className="si-slot-ph tall" onClick={() => setAdding(true)}><span className="si-slot-empty"><Icon name="plus" size={20} />Ajouter une photo</span></button></li> : null}
        </ul>
        <PhotoPicker open={adding} onClose={() => setAdding(false)} onPick={addWork} title="Une photo du travail" />
      </section>
    </div>
  );
}

/* ---------------- Liens ---------------- */

function Links({ v, onChange }: { v: SiteContent['links']; onChange: (v: SiteContent['links']) => void }) {
  const row = (k: keyof SiteContent['links'], label: string, icon: string, ph: string) => (
    <Field label={<span className="row" style={{ gap: 6 }}><Icon name={icon} size={14} />{label}</span>} htmlFor={'si-' + k} hint="Vide : le lien n’apparaît pas." error={HTTPS.test(v[k]) ? null : 'Une adresse qui commence par https://'}>
      <input id={'si-' + k} className={'input' + (HTTPS.test(v[k]) ? '' : ' invalid')} inputMode="url" value={v[k]} placeholder={ph} onChange={(e) => onChange({ ...v, [k]: e.target.value.trim() })} />
    </Field>
  );
  return (
    <section className="card col" style={{ gap: 14 }}>
      <div className="card-h"><h2><Icon name="link" size={16} />Réseaux du salon</h2></div>
      {row('instagram', 'Instagram', 'instagram', 'https://www.instagram.com/…')}
      {row('facebook', 'Facebook', 'globe', 'https://www.facebook.com/…')}
      {row('youtube', 'YouTube', 'globe', 'https://www.youtube.com/…')}
      <Note icon="info">Instagram s’affiche sous les coupes, dans « La preuve » et en bas de page ; c’est le même que dans <Link to="/reglages/salon" className="link">Réglages › Salon</Link>. Facebook et YouTube en bas de page. L’Instagram et la vidéo de chaque barbier se règlent sur sa fiche, dans <Link to="/equipe" className="link">Équipe</Link>.</Note>
    </section>
  );
}


/* ---------------- Formations ---------------- */

type Module = { id: string; title: string; points: string[]; duration: string; price: number | null };
type Session = { moduleId: string; date: string; seats: number };
type Trainings = { intro: string; modules: Module[]; sessions: Session[]; nda: string; qualiopi: string };
type TrainingsData = { trainings: Trainings; defaults: Trainings; limits: { intro: number; modules: number; points: number; sessions: number } };
const MODULE_ID = /^[a-z0-9][a-z0-9-]{0,29}$/;
// as server/settings/trainings.js: ids the page already uses (#demande, #main, t-…, tm-…, dm-…)
const RESERVED_ID = /^(main|demande|(t|tm|dm)-.*)$/;

/** The first thing the server would refuse, in words, or null. */
function checkTrainings(t: Trainings): string | null {
  const seen = new Set<string>();
  for (const [i, m] of t.modules.entries()) {
    if (m.title.trim().length < 2) return 'Module ' + (i + 1) + ' : il manque le titre.';
    if (!MODULE_ID.test(m.id)) return 'Module ' + (i + 1) + ' : le code ne prend que des minuscules, des chiffres et des tirets.';
    if (RESERVED_ID.test(m.id)) return 'Module ' + (i + 1) + ' : le code « ' + m.id + ' » est déjà pris par la page, choisis-en un autre.';
    if (seen.has(m.id)) return 'Deux modules ont le code « ' + m.id + ' ».';
    seen.add(m.id);
  }
  for (const [i, x] of t.sessions.entries()) {
    if (!x.date) return 'Session ' + (i + 1) + ' : choisis la date.';
    if (!seen.has(x.moduleId)) return 'Session ' + (i + 1) + ' : choisis le module.';
  }
  return null;
}
/** 'Taille de la barbe' → 'taille-de-la-barbe', for a new module's anchor (/formations#…). */
const slug = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');

/** A price typed as text ('45,50', '1 200'): the cents follow what reads as a price, the text is rewritten only on blur. */
function PriceField({ id, value, onChange }: { id: string; value: number | null; onChange: (c: number | null) => void }) {
  const show = (c: number | null) => (c == null ? '' : (c % 100 ? (c / 100).toFixed(2) : String(c / 100)).replace('.', ','));
  const read = (t: string) => (t.trim() ? money.parseEur(t) : null);
  const [raw, setRaw] = useState(() => show(value));
  // a value set from outside (Annuler, saved, the defaults): the text follows
  useEffect(() => { if (read(raw) !== value) setRaw(show(value)); }, [value]);
  const c = read(raw);
  const bad = !!raw.trim() && (c == null || c < 0);
  return (
    <Field label="Tarif (€)" htmlFor={id} error={bad ? 'Un prix comme 450 ou 45,50.' : null} hint={value == null ? 'Vide : « Sur devis ».' : 'Affiché : ' + eur(value) + '.'}>
      <input id={id} className="input tnum" inputMode="decimal" value={raw} placeholder="Sur devis" aria-invalid={bad || undefined}
        onChange={(e) => { const t = e.target.value; setRaw(t); const n = read(t); if (!t.trim()) onChange(null); else if (n != null && n >= 0) onChange(Math.min(1000000, n)); }}
        onBlur={() => setRaw(show(value))} />
    </Field>
  );
}

function TrainingsEditor() {
  const q = useQuery<TrainingsData>('/api/v1/trainings');
  if (!q.data) return q.error ? <Note tone="err" icon="alert">{q.error.message}</Note> : <Skeleton h={420} r={22} />;
  return <TrainingsForm data={q.data} />;
}

function TrainingsForm({ data }: { data: TrainingsData }) {
  const { boot } = useApp();
  const [f, setF] = useState<Trainings>(data.trainings);
  const [busy, setBusy] = useState(false);
  const saved = useRef(JSON.stringify(data.trainings));
  useEffect(() => { const k = JSON.stringify(data.trainings); if (k !== saved.current) { if (same(f, JSON.parse(saved.current))) setF(data.trainings); saved.current = k; } }, [JSON.stringify(data.trainings)]);
  const changed = !same(f, data.trainings);
  const problem = checkTrainings(f);
  // a module's code renamed: its sessions follow it
  const setM = (i: number, m: Module) => setF((x) => {
    const was = x.modules[i]?.id;
    return { ...x, modules: x.modules.map((y, j) => (j === i ? m : y)), sessions: was && was !== m.id ? x.sessions.map((s) => (s.moduleId === was ? { ...s, moduleId: m.id } : s)) : x.sessions };
  });
  // a new module's code follows its title until it is typed by hand (the placeholder, or what the title gave); once saved,
  // it is a public anchor (/formations#rasage, links already shared) and changes only when the code itself is edited
  const savedIds = new Set(data.trainings.modules.map((m) => m.id));
  const autoId = (m: Module) => !savedIds.has(m.id) && (/^module-\d+$/.test(m.id) || (!!m.title && m.id === slug(m.title)));
  const setS = (i: number, v: Session) => setF((x) => ({ ...x, sessions: x.sessions.map((y, j) => (j === i ? v : y)) }));
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= f.modules.length) return; const n = [...f.modules]; [n[i], n[j]] = [n[j], n[i]]; setF({ ...f, modules: n }); };
  const removeModule = async (i: number) => {
    const m = f.modules[i];
    const n = f.sessions.filter((x) => x.moduleId === m.id).length;
    if (!await confirm({ title: 'Retirer « ' + m.title + ' » ?', body: n ? 'Ses ' + plural(n, 'session') + ' partent avec lui.' : 'Il n’apparaîtra plus sur la page Formations.', ok: 'Retirer', danger: true })) return;
    setF({ ...f, modules: f.modules.filter((_, j) => j !== i), sessions: f.sessions.filter((x) => x.moduleId !== m.id) });
  };
  const save = async () => {
    if (problem) { toast({ kind: 'err', title: problem, icon: 'alert' }); return; }
    setBusy(true);
    const clean = { ...f, modules: f.modules.map((m) => ({ ...m, title: m.title.trim(), points: m.points.map((p) => p.trim()).filter(Boolean) })) };
    try {
      await api.patch('/api/v1/trainings', clean);
      toast({ title: 'Page Formations mise à jour', sub: 'Les visiteurs la voient tout de suite.', icon: 'check' });
      await load('/api/v1/trainings').catch(() => {});
      const fresh = peek<TrainingsData>('/api/v1/trainings');
      if (fresh) { saved.current = JSON.stringify(fresh.trainings); setF(fresh.trainings); }
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const past = (d: string) => !!d && d < boot.today;
  return (
    <div className="si-body">
      <div className="si-cols">
        <section className="card col" style={{ gap: 14 }}>
          <div className="card-h"><h2><Icon name="edit" size={16} />En haut de la page</h2>{f.intro !== data.defaults.intro ? <button type="button" className="link" onClick={() => setF({ ...f, intro: data.defaults.intro })}>Texte d’origine</button> : null}</div>
          <Field label="Présentation" htmlFor="tr-in" hint={f.intro.length + ' / ' + data.limits.intro + ' · sous « On forme aussi les barbiers ».'}>
            <textarea id="tr-in" className="input textarea" rows={6} maxLength={data.limits.intro} value={f.intro} onChange={(e) => setF({ ...f, intro: e.target.value })} />
          </Field>
        </section>
        <section className="card col" style={{ gap: 14 }}>
          <div className="card-h"><h2><Icon name="shield" size={16} />Agrément et financement</h2></div>
          <Field label="Numéro de déclaration d’activité" htmlFor="tr-nda" hint="Donné par la préfecture (DREETS). La page ajoute la mention obligatoire « ne vaut pas agrément de l’État ».">
            <input id="tr-nda" className="input tnum" maxLength={40} value={f.nda} placeholder="93 13 00000 13" onChange={(e) => setF({ ...f, nda: e.target.value })} />
          </Field>
          <Field label="Certification Qualiopi" htmlFor="tr-qu" hint="Le numéro du certificat ou l’organisme qui l’a délivré.">
            <input id="tr-qu" className="input" maxLength={120} value={f.qualiopi} placeholder="Certificat n° … (organisme)" onChange={(e) => setF({ ...f, qualiopi: e.target.value })} />
          </Field>
          <Note tone={f.qualiopi.trim() ? 'ok' : ''} icon={f.qualiopi.trim() ? 'check' : 'info'}>{f.qualiopi.trim() ? 'La page dit que, selon le module, le stage peut être éligible au CPF (Compte Personnel de Formation) ou pris en charge par un OPCO. Pour le CPF, le module doit aussi mener à une certification RNCP ou RS inscrite sur Mon Compte Formation.' : 'Sans certificat Qualiopi, la page ne parle pas du CPF : il ne finance que les organismes certifiés.'}</Note>
        </section>
      </div>
      <div className="col" style={{ gap: 14, marginTop: 14 }}>
        {f.modules.map((m, i) => (
          <section key={i} className="card col" style={{ gap: 12 }} aria-label={'Module ' + (i + 1)}>
            <div className="card-h">
              <h2><span className="si-num">{String(i + 1).padStart(2, '0')}</span>Module</h2>
              <span className="row" style={{ gap: 2 }}>
                <Button size="sm" variant="ghost" icon="chevL" className="si-up" aria-label="Monter" disabled={!i} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" icon="chevL" className="si-down" aria-label="Descendre" disabled={i === f.modules.length - 1} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" icon="trash" aria-label={'Retirer le module ' + (i + 1)} onClick={() => removeModule(i)} />
              </span>
            </div>
            <Field label="Titre" htmlFor={'tr-t' + i}><input id={'tr-t' + i} className="input" maxLength={100} value={m.title} onChange={(e) => setM(i, { ...m, title: e.target.value, ...(autoId(m) ? { id: slug(e.target.value) || m.id } : {}) })} /></Field>
            <Field label="Ce qu’on y apprend" htmlFor={'tr-p' + i} hint={'Une ligne par point, ' + data.limits.points + ' au plus.'}>
              <textarea id={'tr-p' + i} className="input textarea" rows={Math.max(3, m.points.length)} value={m.points.join('\n')} onChange={(e) => setM(i, { ...m, points: e.target.value.split('\n').slice(0, data.limits.points) })} />
            </Field>
            <div className="grid2 stack">
              <Field label="Durée" htmlFor={'tr-d' + i} hint="Vide : non affichée."><input id={'tr-d' + i} className="input" maxLength={60} value={m.duration} placeholder="2 jours · 14 h" onChange={(e) => setM(i, { ...m, duration: e.target.value })} /></Field>
              <PriceField id={'tr-pr' + i} value={m.price} onChange={(price) => setM(i, { ...m, price })} />
            </div>
            <Field label="Code (l’ancre de la page)" htmlFor={'tr-id' + i} hint={'/formations#' + (m.id || '…') + (['barbe', 'classique', 'complexe'].includes(m.id) ? ' · les anciennes adresses du site mènent ici : garde ce code.' : '')} error={!MODULE_ID.test(m.id) ? 'Minuscules, chiffres et tirets.' : RESERVED_ID.test(m.id) ? 'Déjà pris par la page : choisis un autre code.' : null}>
              <input id={'tr-id' + i} className="input" maxLength={30} value={m.id} onChange={(e) => setM(i, { ...m, id: e.target.value.toLowerCase() })} />
            </Field>
          </section>
        ))}
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="subtle" icon="plus" disabled={f.modules.length >= data.limits.modules} onClick={() => { let n = f.modules.length + 1; while (f.modules.some((m) => m.id === 'module-' + n)) n++; setF({ ...f, modules: [...f.modules, { id: 'module-' + n, title: '', points: [], duration: '', price: null }] }); }}>Ajouter un module</Button>
          <span className="faint">{f.modules.length} / {data.limits.modules}</span>
          {!same(f.modules, data.defaults.modules) ? <button type="button" className="link" onClick={async () => { if (await confirm({ title: 'Reprendre les modules d’origine ?', body: 'Les quatre modules de l’ancien site remplacent ceux de cette page.', ok: 'Reprendre' })) setF({ ...f, modules: data.defaults.modules, sessions: f.sessions.filter((x) => data.defaults.modules.some((m) => m.id === x.moduleId)) }); }}>Modules d’origine</button> : null}
        </div>
        <section className="card col" style={{ gap: 12 }}>
          <div className="card-h"><h2><Icon name="calendar" size={16} />Prochaines sessions</h2><span className="faint">{f.sessions.length} / {data.limits.sessions}</span></div>
          <p className="muted si-lead">Une date sous un module, avec les places qui restent. Une date passée disparaît de la page d’elle-même ; sans session, la page dit « sur demande ».</p>
          {f.sessions.map((x, i) => (
            <div key={i} className="col" style={{ gap: 4 }}>
              <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
                <Field label="Module" htmlFor={'tr-sm' + i}>
                  <select id={'tr-sm' + i} className="input select" value={x.moduleId} onChange={(e) => setS(i, { ...x, moduleId: e.target.value })}>
                    <option value="">Choisir…</option>
                    {f.modules.map((m) => <option key={m.id} value={m.id}>{m.title || m.id}</option>)}
                  </select>
                </Field>
                <Field label="Date" htmlFor={'tr-sd' + i}><input id={'tr-sd' + i} className="input" type="date" value={x.date} onChange={(e) => setS(i, { ...x, date: e.target.value })} /></Field>
                <Field label="Places" htmlFor={'tr-ss' + i}><input id={'tr-ss' + i} className="input tnum" inputMode="numeric" style={{ width: 90 }} value={String(x.seats)} onChange={(e) => setS(i, { ...x, seats: Math.min(50, Number(e.target.value.replace(/\D/g, '')) || 0) })} /></Field>
                <Button size="sm" variant="ghost" icon="trash" aria-label={'Retirer la session ' + (i + 1)} onClick={() => setF({ ...f, sessions: f.sessions.filter((_, j) => j !== i) })} />
              </div>
              {/* under the row, not under the date: a hint there would lift that one input above the others */}
              {past(x.date) ? <small className="faint" style={{ fontSize: 12.5 }}>Date passée : cette session n’est plus affichée sur la page.</small> : null}
            </div>
          ))}
          <div><Button variant="subtle" icon="plus" disabled={f.sessions.length >= data.limits.sessions || !f.modules.length} onClick={() => setF({ ...f, sessions: [...f.sessions, { moduleId: f.modules[0]?.id || '', date: '', seats: 4 }] })}>Ajouter une session</Button></div>
        </section>
        <Note icon="mail">Les demandes envoyées depuis la page arrivent dans <Link to="/relances/demandes" className="link">Relances › Demandes</Link> et par e-mail au gérant.</Note>
      </div>
      {changed ? (
        <div className="si-save" role="region" aria-label="Enregistrer les formations">
          <span className="grow">{problem || 'Formations : modifications non enregistrées'}</span>
          <Button variant="ghost" onClick={() => setF(data.trainings)}>Annuler</Button>
          <Button variant="primary" busy={busy} disabled={!!problem} onClick={save}>Enregistrer</Button>
        </div>
      ) : null}
    </div>
  );
}
