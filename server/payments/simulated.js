// @ts-check
// A stand-in for Stripe while no account is connected (the demo, local development).
// It behaves the same way end to end, on a clearly labelled test page, and never moves money.

/** @returns {import('./provider.js').PaymentProvider} */
export function simulatedProvider({ baseUrl }) {
  return {
    name: 'simulated',
    live: false,
    // no payouts: no money ever reaches a bank
    caps: { checkout: true, refund: true, setup: true, offSession: true, billing: false, portal: false, terminal: false, payouts: false },
    async createCheckout(o) {
      return { ref: 'sim_' + o.id, url: baseUrl + '/paiement/' + encodeURIComponent(o.id), exp: Date.now() + 31 * 60000 };
    },
    async refund(chargeRef, amount, idem) { return { ref: 'sim_rf_' + idem, status: 'succeeded' }; },
    async chargeSaved({ idem }) { return { ref: 'sim_pi_' + idem, status: 'succeeded' }; },
    // the test page confirms itself (POST /api/public/payments/:id/simulate): nothing comes by webhook
    parseWebhook() { return null; },
    async retrieveCharge(ref) { return { chargeRef: String(ref || '').startsWith('sim_') ? 'sim_ch_' + String(ref).slice(4) : null }; },
    async listRefunds() { return []; },
    async listPayout() { return { amount: 0, arrival: 0, items: [] }; }
  };
}
