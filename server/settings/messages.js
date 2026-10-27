// @ts-check
// Messages: which automatic SMS go out, when, and the owner's version of each text.
import { str, int, bool, opt, obj, arr, record } from '../lib/validate.js';
import { TEMPLATES } from '../core/templates.js';

// France, Belgium, Switzerland, Luxembourg and French overseas (+262 La Réunion and Mayotte, +590 Guadeloupe and the
// Saint-Martin/Saint-Barthélemy islands, +594 Guyane, +596 Martinique, +508 Saint-Pierre-et-Miquelon, +681 Wallis-et-Futuna,
// +687 Nouvelle-Calédonie, +689 Polynésie): a number elsewhere is refused, so nobody can make the salon pay for texts to
// premium numbers abroad (SMS pumping). Not +269: that is the Comoros, Mayotte numbers are +262 269 / 639
export const COUNTRIES = ['+33', '+32', '+41', '+352', '+262', '+590', '+594', '+596', '+508', '+681', '+687', '+689'];

export default /** @type {const} */ ({
  key: 'messages',
  defaults: () => ({
    confirmation: true, reminder: true, reminderHour: 18, reminder2h: false, review: true, reviewDelayMin: 120, rebook: true, waitlist: true, templates: { ...TEMPLATES },
    // minutes after midnight: no quiet text between 20 h and 8 h, nor on Sunday or a public holiday (confirmations still leave)
    quiet: { from: 1200, to: 480, sunday: true, holidays: true },
    // the opt-out mention French law asks of every marketing text (number to confirm with Brevo)
    stopSuffix: ' STOP au 36173',
    countries: [...COUNTRIES]
  }),
  schema: obj({
    confirmation: opt(bool()), reminder: opt(bool()), reminderHour: opt(int({ min: 8, max: 21 })), reminder2h: opt(bool()), review: opt(bool()),
    reviewDelayMin: opt(int({ min: 30, max: 1440 })), rebook: opt(bool()), waitlist: opt(bool()),
    // only texts the server knows how to send; the key cap follows the registry as it grows
    templates: opt(record(new RegExp('^(' + Object.keys(TEMPLATES).join('|') + ')$'), str({ min: 10, max: 320 }), { max: Math.max(20, Object.keys(TEMPLATES).length) })),
    quiet: opt(obj({ from: int({ min: 0, max: 1439 }), to: int({ min: 0, max: 1439 }), sunday: bool(), holidays: opt(bool()) })),
    // it can be reworded, never removed
    stopSuffix: opt(str({ min: 6, max: 40, trim: false, pattern: /\bSTOP\b/ })),
    countries: opt(arr(str({ min: 2, max: 5, pattern: /^\+\d{1,4}$/ }), { min: 1, max: 40 }))
  })
});
