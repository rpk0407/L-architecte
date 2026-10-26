// @ts-check
// A stand-in for Stripe while no account is connected (the demo, local development).
// It behaves the same way end to end, on a clearly labelled test page, and never moves money.

export function simulatedProvider({ baseUrl }) {
  return {
    name: 'simulated',
    live: false,
    async createCheckout(o) {
      return { ref: 'sim_' + o.id, url: baseUrl + '/paiement/' + encodeURIComponent(o.id), exp: Date.now() + 31 * 60000 };
    },
    async refund(chargeRef, amount, idem) { return { ref: 'sim_rf_' + idem, status: 'succeeded' }; },
    async chargeSaved({ idem }) { return { ref: 'sim_pi_' + idem, status: 'succeeded' }; },
    parseWebhook() { return null; }
  };
}
