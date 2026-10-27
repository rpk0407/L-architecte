// @ts-check
// The one contract every payment provider meets (Stripe today, the simulated page in the demo, others later). Routes
// never ask "is it Stripe?": they ask the provider a payment went through (providerFor) and what money is real (moneyMode).
import { fail } from '../core/engine.js';
import { simulatedProvider } from './simulated.js';
import { providerLabel } from './labels.js';

export { providerLabel };

/**
 * What the provider can do. A feature that needs one checks it, so a provider without it is never asked.
 * @typedef {{ checkout: boolean, refund: boolean, setup: boolean, offSession: boolean, billing: boolean, portal: boolean, terminal: boolean, payouts: boolean }} ProviderCaps
 */

/**
 * A provider's notice, in our words (parseWebhook). kind: paid | expired | failed (a checkout), refunded (money given
 * back at the provider, from our server or its dashboard; amount is the charge's total refunded so far), dispute (a
 * chargeback opened, updated or closed), payout (money sent to the bank; reconciliation 'in_progress' while its lines
 * cannot be listed yet, the notice comes again once they can). PAY-03 adds sub.started | invoice.paid |
 * invoice.failed | invoice.action | sub.changed, a terminal adds terminal.*; each kind has its line in handlers.js.
 * @typedef {{
 *   kind: string, ref: string, amount?: number, chargeRef?: string, customer?: string, pm?: string, refundRef?: string,
 *   dispute?: { id: string, amount: number, reason: string, status: string, dueBy: number },
 *   arrival?: number, reconciliation?: string, [k: string]: any
 * }} ProviderEvent
 */

/**
 * @typedef {{ ref: string, status: 'succeeded'|'requires_action'|'failed', code?: string }} ChargeResult
 * @typedef {{ type: string, amount: number, fee: number, net: number, chargeRef: string|null, ref: string }} PayoutItem
 * @typedef {{
 *   name: string, live: boolean, caps: ProviderCaps, sigHeader?: string,
 *   createCheckout: (o: { id: string, amount: number, label: string, successUrl: string, cancelUrl: string, email?: string, mode?: 'payment'|'setup', metadata?: Record<string,string>, payMin?: number }) => Promise<{ ref: string, url: string, exp: number }>,
 *   refund: (chargeRef: string, amount: number, idem: string) => Promise<{ ref: string, status: string }>,
 *   chargeSaved: (o: { customer: string, pm: string, amount: number, label: string, idem: string }) => Promise<ChargeResult>,
 *   parseWebhook: (rawBody: string, sigHeader: string|null) => ProviderEvent|null,
 *   retrieveCharge: (ref: string) => Promise<{ chargeRef: string|null, subscription?: string|null }>,
 *   listRefunds?: (chargeRef: string) => Promise<{ ref: string, amount: number, ours: boolean, at: number }[]>,
 *   listPayout: (id: string) => Promise<{ amount: number, arrival: number, items: PayoutItem[], truncated?: boolean }>,
 *   ensurePrice?: (plan: { id: string, name: string }, price: number) => Promise<string>,
 *   createSubscription?: (o: { id: string, price: string, planId: string, name: string, email?: string, startNow: boolean, startAt?: number, sepa?: boolean, successUrl: string, cancelUrl: string, expiresMin?: number }) => Promise<{ ref: string, url: string, exp: number }>,
 *   getSubscription?: (sub: string) => Promise<Subscription>,
 *   getInvoice?: (inv: string) => Promise<Invoice>,
 *   cancelSubscription?: (sub: string, o?: { now?: boolean }) => Promise<{ ok: boolean }>,
 *   holdBilling?: (sub: string) => Promise<{ ok: boolean }>,
 *   releaseBilling?: (sub: string) => Promise<{ ok: boolean }>,
 *   portalUrl?: (customer: string, returnUrl: string, o?: { ref?: string }) => Promise<{ url: string }>
 * }} PaymentProvider
 */

/**
 * The billing objects as the membership reads them (PAY-03; caps.billing, caps.portal). Instants in ms.
 * @typedef {{ id: string, status: string, lx: string, customer: string, card: string, cancelAtPeriodEnd: boolean, cancelAt: number|null, pausedUntil: number|null, held: boolean, endReason: string, periodEnd: number, latestInvoice: string, trialEnd?: number|null }} Subscription
 * @typedef {{ id: string, subscription: string, status: string, amount: number, due: number, periodStart: number, periodEnd: number, chargeRef: string, hostedUrl: string, attempt: number, nextAt: number }} Invoice
 */

/**
 * The provider a payment went through, to refund or charge it again: the one plugged in when it is the same, the test
 * page for a demo payment; otherwise it is gone (keys removed, another provider), and nothing pretends to refund it.
 * @param {any} rt @param {string} name @returns {PaymentProvider}
 */
export function providerFor(rt, name) {
  if (rt.pay && rt.pay.name === name) return rt.pay;
  if (name === 'simulated') return /** @type {any} */ (simulatedProvider({ get baseUrl() { return rt.origin; } }));
  return fail(409, 'provider_gone', 'Ce paiement est passé par ' + providerLabel(name) + ', qui n’est plus branché. Rembourse-le depuis son tableau de bord, puis fais l’avoir en « remboursé hors caisse ».');
}

/**
 * What money the salon takes online right now: 'demo' (the demo, test page), 'live' (real money), 'test' (a Stripe
 * test key in production: test cards only), 'off' (production without a provider). New money features (PAY-02..06)
 * run only in demo and live; payLive (routes-public.js) keeps its own older meaning.
 * @returns {'demo'|'live'|'test'|'off'}
 */
export function moneyMode(r) {
  if (r.rt.cfg.mode === 'demo' && r.s.mode === 'demo') return 'demo';
  const p = r.rt.pay;
  if (p.live) return 'live';
  return p.name === 'simulated' ? 'off' : 'test';
}
