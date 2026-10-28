// @ts-check
// The providers' names as the owner reads them. Pure: the projections (projections/payments.js) read them too.

/** @param {string} name */
export const providerLabel = (name) => ({ stripe: 'Stripe', simulated: 'le paiement de test' }[name] || name || 'le prestataire');
