// @ts-check
// Le site: what the public site says besides the catalogue, the team and the hours. The owner edits it in the Comptoir
// (Le site), the site reads it from /api/public/salon. Defaults are the texts site.html carried before, so nothing
// changes on the page until the owner writes his own.
//
// FAQ answers take tokens, resolved from the catalogue and the settings when the site asks (resolveTokens):
//   {prix:cl}    the price of the service whose code (slug) is cl, as on the menu: "20 €" (write "dès" yourself)
//   {duree:cl}   its length: "30 min", "1 h 30"
//   {horaires}   the weekly hours, from Réglages › Horaires: "Du mardi au samedi, 9 h – 18 h 30"
//   {fermeture}  the days the salon is closed every week: "le dimanche et le lundi"
//   {adresse}    "16, place Pélabon, 13013 Marseille"
// A question whose answer has a token that resolves to nothing (a service no longer sold) stays off the site
// until it is fixed: the Comptoir says which. So does a misspelt one ({prix:CL}, {prixx:cl}): it would show as typed.
// No import of the engine here: the settings registry (index.js) loads this file while the engine is still loading.
import { str, int, opt, nullable, obj, arr, day, InvalidInput, parse } from '../lib/validate.js';
import { fmtEur } from '../../shared/money.js';
import { fmtTime, fmtDur, DAYS_FR } from '../../shared/dates.js';

/** https only (a link people tap from the site), or empty to hide it. */
const link = (max = 300) => str({ max, pattern: /^(https:\/\/[^\s"'<>]+)?$/ });
/** a link from the banner or a question: https, a page of the site (/cgv, /formations#barbe) or empty; never '//host'
 *  nor '/\host' (browsers read both as another site), so no backslash at all */
export const SITE_LINK = /^(https:\/\/[^\s"'<>\\]+|\/(?![/\\])[^\s"'<>\\]*)?$/;
const siteLink = () => str({ max: 300, pattern: SITE_LINK });
/** an image the site may show: one shipped with it (/img/…) or one stored by /api/v1/uploads (an upload or a copy from
 *  the old site). Never another host: visitors' addresses would reach it, and the Comptoir (img-src 'self') could not show it. */
export const IMAGE = /^(\/img\/[\w.-]+|\/api\/public\/media\/[a-f0-9]{64}\.(jpg|png|webp))$/;
const image = () => str({ min: 1, max: 400, pattern: IMAGE });
/** a real calendar day ('2026-02-30' is not), or empty */
const dayOrEmpty = () => ({ parse(/** @type {any} */ x, /** @type {string} */ p) {
  if (x === '') return '';
  const v = day().parse(x, p);
  const t = new Date(v + 'T12:00:00Z');
  if (t.toISOString().slice(0, 10) !== v) throw new InvalidInput(p, 'date AAAA-MM-JJ attendue');
  return v;
} });
const monthOrEmpty = () => str({ max: 7, pattern: /^(\d{4}-(0[1-9]|1[0-2]))?$/ });
/** the Google rating as shown, 0 to 5 with one decimal; "4,9" as typed works too */
const rating = () => ({ parse(/** @type {any} */ x, /** @type {string} */ p) {
  const n = typeof x === 'string' && x.trim() ? Number(x.replace(',', '.')) : x;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 5 || Math.abs(Math.round(n * 10) - n * 10) > 1e-9) throw new InvalidInput(p, 'une note de 0 à 5, un chiffre après la virgule');
  return Math.round(n * 10) / 10;
} });

const photo = () => obj({ url: image(), alt: opt(str({ max: 160 })), caption: opt(str({ max: 60 })) });
/** a photo of the work: its title (caption), the line shown on zoom (tag), the service its button books (slug) */
const work = () => obj({ url: image(), alt: opt(str({ max: 160 })), caption: opt(str({ max: 60 })), tag: opt(str({ max: 60 })), service: opt(str({ max: 60, pattern: /^[a-z0-9-]*$/ })) });

export const LIMITS = { announce: 140, house: 600, faq: 12, quotes: 3, work: 8, heroTitle: 24 };

/** the banner: its end not before its start, whichever path saves it (Le site, or a settings patch) */
const announce = () => {
  const o = obj({ text: opt(str({ max: LIMITS.announce })), from: opt(dayOrEmpty()), to: opt(dayOrEmpty()), link: opt(siteLink()) });
  return { parse(/** @type {any} */ x, /** @type {string} */ p) {
    const v = o.parse(x, p);
    if (v.from && v.to && v.to < v.from) throw new InvalidInput(p + '.to', 'l’annonce doit finir après son début');
    return v;
  } };
};

export const siteSchema = obj({
  announce: opt(announce()),
  hero: opt(obj({ title: opt(str({ min: 1, max: LIMITS.heroTitle })), sub: opt(str({ max: 120 })) })),
  house: opt(str({ max: LIMITS.house })),
  faq: opt(arr(obj({ q: str({ min: 3, max: 140 }), a: str({ min: 2, max: 600 }), link: opt(siteLink()), linkLabel: opt(str({ max: 60 })) }), { max: LIMITS.faq })),
  reviews: opt(obj({
    rating: opt(rating()), count: opt(int({ min: 0, max: 100000 })), updatedAt: opt(dayOrEmpty()),
    quotes: opt(arr(obj({ text: str({ min: 2, max: 240 }), author: opt(str({ max: 40 })), date: opt(monthOrEmpty()) }), { max: LIMITS.quotes }))
  })),
  links: opt(obj({ instagram: opt(link()), facebook: opt(link()), youtube: opt(link()) })),
  photos: opt(obj({ hero: opt(photo()), salon: nullable(photo()), work: opt(arr(work(), { max: LIMITS.work })) }))
});
/** @typedef {ReturnType<typeof defaults>} Site */

function defaults() {
  return {
    announce: { text: '', from: '', to: '', link: '' },
    hero: { title: 'Frais.', sub: 'Barbier, place Pélabon.\nMarseille 13ᵉ.' },
    house: 'Ici, on prend le temps. On t’écoute, on regarde ce qui te va, on te conseille. Puis on construit ta coupe au millimètre, pour qu’elle tienne et que tu saches la coiffer chez toi.',
    faq: [
      { q: 'Combien coûte une coupe chez L’Architecte ?', a: 'La coupe classique est à {prix:cl}. Avec le contour de barbe, {prix:cc}. Avec la taille de barbe, {prix:ct}. La transformation complète est à {prix:tr}.' },
      { q: 'Quels sont les horaires du salon ?', a: '{horaires}. Le salon est fermé {fermeture}.' },
      { q: 'Où se trouve le salon ?', a: 'Au {adresse}.', link: 'https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY', linkLabel: 'Voir l’itinéraire' },
      { q: 'Comment réserver ?', a: 'En ligne, en moins d’une minute et sans créer de compte : tu choisis ta prestation, ton barbier et ton créneau.' },
      { q: 'Faites-vous les décolorations et le silver ?', a: 'Oui. Décoloration dès {prix:de}, coloration dès {prix:co}, silver (blanc ou gris) à {prix:si}, toujours après un avis sur la faisabilité.' },
      { q: 'Existe-t-il un abonnement ?', a: 'Oui : 5 coupes sur 5 semaines pour {prix:ab}, soit 16 € la coupe, hors barbe. Tu réserves la première, le salon fixe les suivantes avec toi.' },
      { q: 'Le salon forme-t-il des barbiers ?', a: 'Oui. L’Architecte est titulaire d’un agrément de formateur en coiffure et propose des stages, de l’entretien de la barbe à la coupe homme complexe.', link: '/formations', linkLabel: 'Les formations de L’Archi' },
      { q: 'Peut-on payer par carte ?', a: 'Oui, la carte bancaire est acceptée au salon.' }
    ],
    // *between stars* is underlined on the site, as the designer's quotes were. The author is the name the reviewer
    // signs publicly on Google, as the owner copies it ("Prénom et initiale"): it stays in the settings history.
    reviews: {
      rating: 5, count: 316, updatedAt: '',
      quotes: [
        { text: 'Ce n’est pas une simple coupe, c’est une réelle *construction au millimètre*.', author: 'Maï', date: '2026-02' },
        { text: '…accueil chaleureux… très bonne ambiance *amicale, convivial, et familiale*… je suis vraiment très satisfait.', author: 'Elias R.', date: '2026-03' },
        { text: 'Très sympa et *très à l’écoute*.', author: 'Un client', date: '2026-03' }
      ]
    },
    links: { instagram: 'https://www.instagram.com/barbershoplarchitecte/', facebook: 'https://www.facebook.com/pg/barbershop.larchitecte/', youtube: 'https://www.youtube.com/channel/UCi2oLstkv0IIucLyd211G8A' },
    photos: {
      hero: { url: '/img/fade.jpg', alt: 'Client de profil : cheveux décolorés, dégradé à blanc net sur les côtés', caption: '' },
      // the footer and the team's backdrop; 'La maison' shows it once the owner puts his own (until then: « à venir »)
      salon: /** @type {{ url: string, alt?: string, caption?: string } | null} */ ({ url: '/img/salon.jpg', alt: 'Le salon : long miroir bordé de LED rouge, canapés noir et rouge, fauteuils et bacs à shampooing', caption: '' }),
      work: /** @type {{ url: string, alt?: string, caption?: string, tag?: string, service?: string }[]} */ ([
        { url: '/img/sidepart.jpg', alt: 'Raie marquée sur le côté, dégradé bas, nuque tatouée', caption: 'La raie marquée', tag: 'Dégradé bas, raie tracée', service: 'cl' },
        { url: '/img/curls.jpg', alt: 'Boucles serrées sur le dessus, dégradé net et barbe taillée, face au miroir du salon', caption: 'Boucles et barbe', tag: 'Contour net, barbe taillée', service: 'ct' },
        { url: '/img/fade.jpg', alt: 'Cheveux décolorés et dégradé à blanc derrière l’oreille', caption: 'Décoloré, à blanc', tag: 'Dégradé à blanc, décoloré', service: 'cd' }
      ])
    }
  };
}

export default /** @type {const} */ ({ key: 'site', defaults, schema: siteSchema });

function isObj(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }
function merge(a, b) {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const o = { ...a };
  for (const k of Object.keys(b)) o[k] = merge(a[k], b[k]);
  return o;
}
/**
 * The site's content as saved, over the defaults: works whether or not the settings registry lists the section yet.
 * The salon's Instagram is one value, Réglages › Salon's (shop.instagram): Le site writes it there too (commands/site.js);
 * an empty one saved here hides the link.
 */
export function siteOf(/** @type {any} */ settings) {
  const x = /** @type {Site} */ (merge(defaults(), (settings && settings.site) || {}));
  const own = settings && settings.site && settings.site.links ? settings.site.links.instagram : undefined;
  const shop = settings && settings.shop && settings.shop.instagram;
  if (own !== '' && shop) x.links = { ...x.links, instagram: shop };
  return x;
}

/* ---------------- tokens ---------------- */

export const TOKENS = [
  { t: '{prix:cl}', d: 'le prix de la prestation de code cl, comme sur la carte (« 20 € »)' },
  { t: '{duree:cl}', d: 'sa durée (« 30 min »)' },
  { t: '{horaires}', d: 'les horaires de la semaine (« Du mardi au samedi, 9 h – 18 h 30 »)' },
  { t: '{fermeture}', d: 'les jours de fermeture (« le dimanche et le lundi »)' },
  { t: '{adresse}', d: 'l’adresse du salon' }
];
export const TOKEN_SOURCE = '\\{(prix|duree|horaires|fermeture|adresse)(?::([a-z0-9-]{1,60}))?\\}';
const TOKEN = new RegExp(TOKEN_SOURCE, 'g');
/** what is left that looks like a token once the real ones are replaced: {prix:}, {prix:CL}, {prixx:cl}, {Horaires} */
export const TOKEN_LIKE_SOURCE = '\\{\\s*[A-Za-zÀ-ÿ_-]+\\s*(:[^{}]*)?\\}';
const TOKEN_LIKE = new RegExp(TOKEN_LIKE_SOURCE, 'g');

const WEEK = [1, 2, 3, 4, 5, 6, 0];
/** @param {any} hours weekday → [[start, end], …] in minutes */
const ivOf = (hours, d) => (hours && (hours[d] || hours[String(d)])) || [];
const ivText = (iv) => iv.map(([a, b]) => fmtTime(a) + ' – ' + fmtTime(b)).join(' et ');
const andList = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' et ' + xs[xs.length - 1]);

/** "Du mardi au samedi, 9 h – 18 h 30" ; days with other hours get their own part ("… · le samedi, 9 h – 17 h"). */
export function hoursText(/** @type {any} */ hours) {
  /** @type {{ sig: string, iv: number[][], days: number[] }[]} */
  const groups = [];
  for (const d of WEEK) {
    const iv = ivOf(hours, d);
    if (!iv.length) continue;
    const sig = JSON.stringify(iv);
    const g = groups.find((x) => x.sig === sig);
    if (g) g.days.push(d); else groups.push({ sig, iv, days: [d] });
  }
  if (!groups.length) return '';
  const parts = groups.map((g) => {
    // consecutive days (in the week from Monday) read as "du mardi au samedi"
    const runs = [];
    for (const d of g.days) { const r = runs[runs.length - 1]; if (r && WEEK.indexOf(d) === WEEK.indexOf(r[r.length - 1]) + 1) r.push(d); else runs.push([d]); }
    // two days in a row are two items: "le lundi, le mardi et du jeudi au samedi", never "le lundi et le mardi et …"
    const label = andList(runs.flatMap((r) => (r.length >= 3 ? ['du ' + DAYS_FR[r[0]] + ' au ' + DAYS_FR[r[r.length - 1]]] : r.map((d) => 'le ' + DAYS_FR[d]))));
    return label + ', ' + ivText(g.iv);
  });
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** "le dimanche et le lundi"; empty when the salon opens every day */
export function closedText(/** @type {any} */ hours) {
  return andList([0, 1, 2, 3, 4, 5, 6].filter((d) => !ivOf(hours, d).length).map((d) => 'le ' + DAYS_FR[d]));
}

/**
 * Replace the tokens of a text. Pure: the services, hours and shop come in, the text and what could not be resolved go out.
 * @param {string} text
 * @param {{ services?: { slug?: string|null, price: number, dur: number, active?: boolean }[], hours?: any, shop?: { address?: string, zip?: string, city?: string } }} ctx
 * @returns {{ text: string, missing: string[] }}
 */
export function resolveTokens(text, ctx = {}) {
  /** @type {string[]} */
  const missing = [];
  const svc = (code) => (ctx.services || []).find((x) => x.active !== false && x.slug === code);
  const out = String(text || '').replace(TOKEN, (all, kind, code) => {
    let v = '';
    if (kind === 'prix' || kind === 'duree') { const x = code ? svc(code) : null; v = x ? (kind === 'prix' ? fmtEur(x.price) : fmtDur(x.dur)) : ''; }
    else if (kind === 'horaires') v = hoursText(ctx.hours);
    else if (kind === 'fermeture') v = closedText(ctx.hours);
    else if (kind === 'adresse') { const sh = ctx.shop || {}; v = [sh.address, [sh.zip, sh.city].filter(Boolean).join(' ')].filter(Boolean).join(', '); }
    if (!v) missing.push(all);
    return v;
  });
  for (const m of out.match(TOKEN_LIKE) || []) missing.push(m);
  return { text: out, missing };
}

/** Is the banner on today? Empty dates leave that side open. */
export function announceOn(/** @type {Site['announce']} */ a, /** @type {string} */ today) {
  return !!(a && a.text && (!a.from || a.from <= today) && (!a.to || a.to >= today));
}

/**
 * What /api/public/salon sends: the banner only while it runs, the FAQ with its tokens resolved (an answer left
 * incomplete stays off), and the hours in words for every place the page writes them.
 * @param {any} settings @param {any[]} services every active service (online or not: a price quoted is a price) @param {string} today
 */
export function publicSite(settings, services, today) {
  const x = siteOf(settings);
  const ctx = { services, hours: settings.hours, shop: settings.shop };
  const faq = x.faq.map((f) => ({ ...f, r: resolveTokens(f.a, ctx) })).filter((f) => !f.r.missing.length)
    .map((f) => ({ q: f.q, a: f.r.text, link: f.link || '', linkLabel: f.linkLabel || '' }));
  return {
    announce: announceOn(x.announce, today) ? { text: x.announce.text, link: x.announce.link || '' } : null,
    hero: x.hero, house: x.house, faq, reviews: x.reviews, links: x.links, photos: x.photos,
    hoursText: hoursText(settings.hours), closedText: closedText(settings.hours)
  };
}
