// @ts-check
// Messages: which automatic SMS go out, when, and the owner's version of each text; whether clients also get e-mails;
// which way the texts to clients leave (SMS, WhatsApp by hand from the salon's phone, WhatsApp automatic through Meta),
// and for the automatic way, which approved template each one uses (MSG-02).
import { str, int, bool, opt, obj, arr, record, nullable, oneOf, InvalidInput } from '../lib/validate.js';
import { TEMPLATES, classOf } from '../core/templates.js';
import { waMobile } from '../messaging/whatsapp.js';

/** The ways the service texts to clients leave. 'sms': a provider's SMS; 'phone': WhatsApp, by hand, from the Comptoir's
 *  Messages screen (one tap per message, no account); 'auto': WhatsApp through Meta's API, with approved templates. */
export const WA_MODES = /** @type {const} */ (['sms', 'phone', 'auto']);
/**
 * The way chosen in Réglages. A salon set up before the choice existed only has `enabled` (true: automatic).
 * @returns {'sms'|'phone'|'auto'}
 */
export function waMode(M) {
  const w = (M && M.whatsapp) || {};
  return WA_MODES.includes(w.mode) ? w.mode : w.enabled ? 'auto' : 'sms';
}
/** The salon's own WhatsApp number as wa.me takes it (digits, country code), or '': the site's button needs it. */
export const salonWhatsapp = (M) => waMobile((M && M.whatsapp && M.whatsapp.number) || '');
/** The keys a WhatsApp template can be given for: the texts the server sends, and 'moved' (a confirmation after a move). */
const WA_KEYS = () => [...Object.keys(TEMPLATES), 'moved'];

// France, Belgium, Switzerland, Luxembourg and French overseas (+262 La Réunion and Mayotte, +590 Guadeloupe and the
// Saint-Martin/Saint-Barthélemy islands, +594 Guyane, +596 Martinique, +508 Saint-Pierre-et-Miquelon, +681 Wallis-et-Futuna,
// +687 Nouvelle-Calédonie, +689 Polynésie): a number elsewhere is refused, so nobody can make the salon pay for texts to
// premium numbers abroad (SMS pumping). Not +269: that is the Comoros, Mayotte numbers are +262 269 / 639
export const COUNTRIES = ['+33', '+32', '+41', '+352', '+262', '+590', '+594', '+596', '+508', '+681', '+687', '+689'];

// MSG-02 · WhatsApp, for service texts only (FID-01): Meta files them as Utility (about a booking or a purchase the
// client made). A review request or an offer would be Marketing there and needs the client's own yes to WhatsApp, which
// the salon does not collect (CNIL: a separate opt-in per channel): those keep leaving by SMS (classOf, core/templates.js).
export const WA_SMS_ONLY = 'Ce message part par SMS : WhatsApp demande un accord à part du client.';
// the variables a template can hand on: every {name} of the default texts, and what apptVars gives besides
const EXTRA_VARS = ['prestation', 'prix', 'salon'];
/** The variable names a WhatsApp mapping may list, read from the texts (so a package adding a text adds its words). */
export function waVarNames() {
  const out = new Set();
  for (const t of Object.values(TEMPLATES)) for (const m of String(t).matchAll(/\{(\w+)\}/g)) out.add(m[1]);
  for (const v of EXTRA_VARS) out.add(v);
  return [...out];
}
/** One variable of a mapping: a name the server fills in, never free text. */
const waVar = () => ({
  parse(x, p) {
    if (typeof x !== 'string' || !waVarNames().includes(x)) throw new InvalidInput(p, 'variable inconnue (' + waVarNames().join(', ') + ')');
    return x;
  }
});

/** The mapping, one entry per text the server sends: a service text's template, or null to take one out (a relation or
 *  marketing text can only be taken out, never mapped). */
const waTemplates = () => {
  // name: the template's name at Meta (lowercase letters, digits, underscores); lang: its language there (fr, fr_FR…)
  const entry = obj({ name: str({ min: 1, max: 120, pattern: /^[a-z0-9_]+$/ }), lang: opt(str({ min: 2, max: 10, pattern: /^[a-z]{2,3}(_[A-Z]{2})?$/ })), params: arr(waVar(), { max: 10 }) });
  const rec = record(new RegExp('^(' + WA_KEYS().join('|') + ')$'), nullable(entry), { max: Math.max(20, WA_KEYS().length) });
  return {
    parse(x, p) {
      const out = rec.parse(x, p);
      for (const [k, v] of Object.entries(out)) if (v && classOf(k) !== 'service') throw new InvalidInput('', WA_SMS_ONLY);
      return out;
    }
  };
};

/** The salon's WhatsApp number as typed ("06 12 34 56 78", "+33 6…"), kept as "+33612345678"; '' clears it. */
const waSalonNumber = () => ({
  parse(x, p) {
    if (typeof x !== 'string' || x.length > 30) throw new InvalidInput(p, 'numéro attendu');
    if (!x.trim()) return '';
    const n = waMobile(x);
    if (!n) throw new InvalidInput('', 'Ce numéro n’est pas un portable WhatsApp. Exemple : 06 12 34 56 78.');
    return '+' + n;
  }
});

export default /** @type {const} */ ({
  key: 'messages',
  defaults: () => ({
    confirmation: true, reminder: true, reminderHour: 18, reminder2h: false, review: true, reviewDelayMin: 120, rebook: true, waitlist: true, templates: { ...TEMPLATES },
    // minutes after midnight: no quiet text between 20 h and 8 h, nor on Sunday or a public holiday (confirmations still leave)
    quiet: { from: 1200, to: 480, sunday: true, holidays: true },
    // the opt-out mention French law asks of every marketing text (number to confirm with Brevo)
    stopSuffix: ' STOP au 36173',
    countries: [...COUNTRIES],
    // WP-02: the confirmation (with the calendar file) and the cancellation also by e-mail, to clients who gave one
    email: true,
    // the reminder of the evening before also by e-mail, to clients who gave an address (with the « Gérer mon rendez-vous »
    // link). Off until the owner decides. Whatever it says, a confirmation or a reminder whose SMS failed for good goes
    // once by e-mail when `email` is on, and a booking that missed the evening reminder gets the 2-hours one (system.js)
    reminderEmail: false,
    // MSG-02: by WhatsApp when switched on and the text has an approved template here ({ name: the template's name at
    // Meta, lang: its language, params: the variables in the template's order}); a text without one goes by SMS, or
    // waits for a person on the Messages screen. null takes a mapping out. `mode` ('sms', 'phone', 'auto': waMode above)
    // and `number` (the salon's own WhatsApp number, for the site's button) are absent until the owner chooses.
    whatsapp: { enabled: false, templates: /** @type {Record<string, { name: string, lang?: string, params: string[] } | null>} */ ({}) }
  }),
  schema: obj({
    confirmation: opt(bool()), reminder: opt(bool()), reminderHour: opt(int({ min: 8, max: 21 })), reminder2h: opt(bool()), review: opt(bool()),
    reviewDelayMin: opt(int({ min: 30, max: 1440 })), rebook: opt(bool()), waitlist: opt(bool()),
    // only texts the server knows how to send; the key cap follows the registry as it grows
    templates: opt(record(new RegExp('^(' + Object.keys(TEMPLATES).join('|') + ')$'), str({ min: 10, max: 320 }), { max: Math.max(20, Object.keys(TEMPLATES).length) })),
    quiet: opt(obj({ from: int({ min: 0, max: 1439 }), to: int({ min: 0, max: 1439 }), sunday: bool(), holidays: opt(bool()) })),
    // it can be reworded, never removed
    stopSuffix: opt(str({ min: 6, max: 40, trim: false, pattern: /\bSTOP\b/ })),
    countries: opt(arr(str({ min: 2, max: 5, pattern: /^\+\d{1,4}$/ }), { min: 1, max: 40 })),
    email: opt(bool()), reminderEmail: opt(bool()),
    whatsapp: opt(obj({
      enabled: opt(bool()),
      mode: opt(oneOf(WA_MODES)),
      // '' takes it out; else a mobile a chat can be opened with (a landline is refused: the button would open nothing)
      number: opt(waSalonNumber()),
      templates: opt(waTemplates())
    }))
  })
});
