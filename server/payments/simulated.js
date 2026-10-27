// @ts-check
// A stand-in for Stripe while no account is connected (the demo, local development).
// It behaves the same way end to end, on a clearly labelled test page, and never moves money.

/** @returns {import('./provider.js').PaymentProvider} */
export function simulatedProvider({ baseUrl }) {
  return {
    name: 'simulated',
    live: false,
    // no payouts: no money ever reaches a bank
    caps: { checkout: true, refund: true, setup: true, offSession: true, billing: true, portal: true, terminal: false, payouts: false },
    async createCheckout(o) {
      return { ref: 'sim_' + o.id, url: baseUrl + '/paiement/' + encodeURIComponent(o.id), exp: Date.now() + 31 * 60000 };
    },
    async refund(chargeRef, amount, idem) { return { ref: 'sim_rf_' + idem, status: 'succeeded' }; },
    async chargeSaved({ idem }) { return { ref: 'sim_pi_' + idem, status: 'succeeded' }; },
    // the test page confirms itself (POST /api/public/payments/:id/simulate): nothing comes by webhook
    parseWebhook() { return null; },
    async retrieveCharge(ref) { return { chargeRef: String(ref || '').startsWith('sim_') ? 'sim_ch_' + String(ref).slice(4) : null }; },
    async listRefunds() { return []; },
    async listPayout() { return { amount: 0, arrival: 0, items: [] }; },
    // the membership (PAY-03): the test page shows « Abonnement Essentiel · 34 €/mois » and its confirmation pays the
    // first month (POST /api/public/payments/:id/simulate); the demo's billing renews it (commands/steps/sim-billing.js)
    async ensurePrice(plan, price) { return 'sim_price_' + plan.id + '_' + price; },
    async createSubscription(o) {
      return { ref: 'sim_' + o.id, url: baseUrl + '/paiement/' + encodeURIComponent(o.id), exp: Date.now() + Math.max(31, o.expiresMin || 0) * 60000 };
    },
    async getSubscription(sub) {
      return { id: sub, status: 'active', lx: '', customer: '', card: 'Visa •• 4242', cancelAtPeriodEnd: false, cancelAt: null, pausedUntil: null, held: false, endReason: '', periodEnd: 0, latestInvoice: '' };
    },
    async getInvoice(inv) {
      return { id: inv, subscription: '', status: 'paid', amount: 0, due: 0, periodStart: 0, periodEnd: 0, chargeRef: '', hostedUrl: '', attempt: 0, nextAt: 0 };
    },
    async cancelSubscription() { return { ok: true }; },
    async holdBilling() { return { ok: true }; },
    async releaseBilling() { return { ok: true }; },
    /** the demo's card page: nothing to change, it says so */
    async portalUrl(customer, returnUrl, o = {}) { return { url: baseUrl + '/paiement/' + encodeURIComponent(o.ref || customer) + '?carte' }; }
  };
}
