// @ts-check
// Me prévenir: what the owner hears about without opening the Comptoir. An e-mail for each online booking or
// cancellation, the evening summary (with the day's Z and its seal) and Monday's weekly report (commands/steps/digest.js).
import { str, bool, opt, obj } from '../lib/validate.js';

export default /** @type {const} */ ({
  key: 'notify',
  defaults: () => ({
    // empty: the owner account's own e-mail. Both name a person: saved in the event's pii, never in the chain
    to: '',
    // the evening summary also by SMS, when set (a number normPhone reads, checked by commands/shop.js)
    phone: '',
    newBooking: true, cancel: true,
    // 'HH:MM' Paris time, from noon: the summary tells a day that is done; '' for none
    evening: '20:00',
    // Monday at 8 h, the week before
    weekly: true
  }),
  schema: obj({
    to: opt(str({ max: 120, lower: true, pattern: /^([^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,})?$/ })),
    phone: opt(str({ max: 24, pattern: /^[\d +().-]*$/ })),
    newBooking: opt(bool()), cancel: opt(bool()),
    evening: opt(str({ max: 5, pattern: /^((1[2-9]|2[0-3]):[0-5]\d)?$/ })),
    weekly: opt(bool())
  })
});
