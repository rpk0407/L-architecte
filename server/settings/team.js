// @ts-check
// Équipe et accès: what barbers may do beyond their own chair (the server turns these into capabilities).
// timeoffApproval (DO-05): an absence a barber posts for himself waits for the owner (timeoff.requested) instead of
// closing his slots at once.
import { int, bool, opt, obj } from '../lib/validate.js';

export default /** @type {const} */ ({
  key: 'team',
  defaults: () => ({ barberCheckout: true, barberAllAgenda: true, barberMaxDiscountPct: 10, barberSeeRevenue: false, timeoffApproval: true }),
  schema: obj({ barberCheckout: opt(bool()), barberAllAgenda: opt(bool()), barberMaxDiscountPct: opt(int({ min: 0, max: 50 })), barberSeeRevenue: opt(bool()), timeoffApproval: opt(bool()) })
});
