// @ts-check
// Le salon: who and where the shop is, shown on the site, the tickets, the messages and the legal pages
// (/mentions-legales, /confidentialite, /cgv read these fields from /api/public/salon).
import { str, opt, obj, InvalidInput } from '../lib/validate.js';

/** The date of the text of public/cgv.html (its <html data-cgv-text>, kept equal by tests/unit/settings-legal.test.js).
 *  Bump both when that text changes: the CGV in force are then the newer of this and the salon's shop.cgvVersion. */
export const CGV_TEXT = '2026-10-28';

const url = () => str({ max: 300, pattern: /^https:\/\/[^\s]+$/ });
/** Empty clears the link (an optional page, unlike the review link the messages need). */
const urlOrEmpty = () => str({ max: 300, pattern: /^(https:\/\/[^\s]+)?$/ });
/** 14 digits, spaces allowed as typed ('512 923 475 00028'); empty until the owner fills it in.
 *  A SIRET pasted from a Kbis PDF carries non-breaking or narrow spaces: they count as plain ones. */
const siret = () => {
  const s = str({ max: 20, pattern: /^[\d ]*$/ });
  return { parse(/** @type {any} */ x, /** @type {string} */ p) { const v = s.parse(typeof x === 'string' ? x.replace(/\s/g, ' ') : x, p); if (v && v.replace(/ /g, '').length !== 14) throw new InvalidInput(p, '14 chiffres attendus'); return v; } };
};
/** A real calendar day ('2026-02-30' is not): the CGV version is shown as a date and recorded on bookings. */
const realDay = () => ({ parse(/** @type {any} */ x, /** @type {string} */ p) {
  const m = typeof x === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(x) : null;
  const t = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !t || t.getUTCMonth() !== +m[2] - 1 || t.getUTCDate() !== +m[3]) throw new InvalidInput(p, 'date AAAA-MM-JJ attendue');
  return /** @type {string} */ (x);
} });

/** The CGV in force: the salon's version, or the page's text when it is newer. GL-08 records this on each booking. */
export function cgvVersionOf(/** @type {{ cgvVersion?: string }} */ shop) { const v = (shop && shop.cgvVersion) || ''; return v > CGV_TEXT ? v : CGV_TEXT; }

/** The CGV version a settings patch leads to (updateSettings runs it): the deposit rules and the cancellation delay are part
 *  of the CGV, so changing them dates a new version today, on the server's clock, whatever screen sent it. The version never
 *  goes back (a stale screen resending an old one is ignored) and is never dated after today. */
export function cgvPatch(/** @type {any} */ settings, /** @type {any} */ patch, /** @type {string} */ today) {
  const cur = cgvVersionOf(settings.shop);
  const asked = patch.shop && patch.shop.cgvVersion;
  if (asked && asked > today) throw new InvalidInput('shop.cgvVersion', 'pas après aujourd’hui');
  const d = patch.deposits ? Object.keys(patch.deposits).some((k) => patch.deposits[k] !== settings.deposits[k]) : false;
  const c = patch.booking && patch.booking.cancelUntilHours !== undefined && patch.booking.cancelUntilHours !== settings.booking.cancelUntilHours;
  const next = [asked || '', d || c ? today : '', cur].reduce((a, b) => (b > a ? b : a), '');
  const shop = { ...(patch.shop || {}) };
  delete shop.cgvVersion;
  if (next !== settings.shop.cgvVersion) shop.cgvVersion = next;
  const out = { ...patch, shop };
  if (!Object.keys(shop).length) delete out.shop;
  return out;
}

export default /** @type {const} */ ({
  key: 'shop',
  defaults: () => ({
    name: 'Barber L’Architecte', address: '16, place Pélabon', zip: '13013', city: 'Marseille',
    phone: '', email: 'larchitectebarber@gmail.com', siret: '', vatNumber: '', legalName: '',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=L%27Architecte%20coiffeur&query_place_id=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
    reviewUrl: 'https://search.google.com/local/writereview?placeid=ChIJJSWkBLy_yRIRbgAQcMwb-JY',
    instagram: 'https://www.instagram.com/barbershoplarchitecte/',
    // mentions légales: an EI by default (the old site's form), registration is the RM or RNE number
    legalForm: 'Entrepreneur individuel', registration: '', ape: '', publicationDirector: '',
    mediator: { name: '', url: '' },
    // the host's phone too (LCEN art. 6-III): the number Vercel publishes for its legal notices
    host: { name: 'Vercel Inc.', address: '440 N Barranca Ave #4133, Covina, CA 91723, USA', phone: '+1 559 288 7060' }, dataHost: 'Neon (Union européenne)',
    // the CGV a client accepts when booking: dated by updateSettings when the deposit or cancellation rules change (cgvPatch);
    // a change of the page's own text bumps CGV_TEXT instead, since a stored version always wins over this default
    cgvVersion: CGV_TEXT
  }),
  schema: obj({
    name: opt(str({ min: 2, max: 80 })), legalName: opt(str({ max: 120 })), address: opt(str({ max: 120 })), zip: opt(str({ max: 10 })), city: opt(str({ max: 60 })),
    phone: opt(str({ max: 20 })), email: opt(str({ max: 120 })), siret: opt(siret()), vatNumber: opt(str({ max: 20 })),
    mapsUrl: opt(url()), reviewUrl: opt(url()), instagram: opt(url()),
    legalForm: opt(str({ max: 60 })), registration: opt(str({ max: 60 })), ape: opt(str({ max: 6, pattern: /^(\d{2}\.?\d{2}[A-Za-z])?$/ })), publicationDirector: opt(str({ max: 80 })),
    mediator: opt(obj({ name: opt(str({ max: 120 })), url: opt(urlOrEmpty()) })),
    host: opt(obj({ name: opt(str({ min: 1, max: 80 })), address: opt(str({ max: 160 })), phone: opt(str({ max: 30 })) })), dataHost: opt(str({ max: 120 })),
    cgvVersion: opt(realDay())
  })
});
