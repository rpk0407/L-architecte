// @ts-check
// Messages: which automatic SMS go out, when, and the owner's version of each text.
import { str, int, bool, opt, obj, record } from '../lib/validate.js';
import { TEMPLATES } from '../core/templates.js';

export default /** @type {const} */ ({
  key: 'messages',
  defaults: () => ({ confirmation: true, reminder: true, reminderHour: 18, reminder2h: false, review: true, reviewDelayMin: 120, rebook: true, waitlist: true, templates: { ...TEMPLATES } }),
  schema: obj({
    confirmation: opt(bool()), reminder: opt(bool()), reminderHour: opt(int({ min: 8, max: 21 })), reminder2h: opt(bool()), review: opt(bool()),
    reviewDelayMin: opt(int({ min: 30, max: 1440 })), rebook: opt(bool()), waitlist: opt(bool()),
    // only texts the server knows how to send; the key cap follows the registry as it grows
    templates: opt(record(new RegExp('^(' + Object.keys(TEMPLATES).join('|') + ')$'), str({ min: 10, max: 320 }), { max: Math.max(20, Object.keys(TEMPLATES).length) }))
  })
});
