// @ts-check
// Réservation en ligne: the slots the site offers, and how long a client may change their mind.
// 90 days ahead: the old WordPress site took bookings about 88 days out, and a 5-cut subscription spans 70 days.
import { int, bool, opt, obj, oneOf } from '../lib/validate.js';

export default /** @type {const} */ ({
  key: 'booking',
  // contact: what the site asks of a client before it books. 'phone' (a number, the e-mail if he likes) while the salon
  // texts; 'email' (an address, the number if he likes) when everything leaves by e-mail: without an address he would
  // get neither his confirmation nor his reminder.
  defaults: () => ({ enabled: true, stepMin: 30, minNoticeMin: 30, maxDaysAhead: 90, holdMin: 5, pendingPayMin: 15, cancelUntilHours: 12, waitlist: true, walkinWait: true, contact: 'phone' }),
  schema: obj({
    enabled: opt(bool()), stepMin: opt(oneOf(/** @type {const} */ ([15, 20, 30]))), minNoticeMin: opt(int({ min: 0, max: 2880 })), maxDaysAhead: opt(int({ min: 1, max: 180 })),
    holdMin: opt(int({ min: 2, max: 15 })), pendingPayMin: opt(int({ min: 5, max: 60 })), cancelUntilHours: opt(int({ min: 0, max: 72 })), waitlist: opt(bool()), walkinWait: opt(bool()),
    contact: opt(oneOf(/** @type {const} */ (['phone', 'email'])))
  })
});
