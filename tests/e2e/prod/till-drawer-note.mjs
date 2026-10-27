// Production without Stripe: the till's QR is off, so the closed-drawer note says only the card works.
// Run by tests/e2e/prod.mjs on its own fresh salon (no STRIPE_SECRET_KEY).
export const name = 'till: the closed-drawer note promises no QR without Stripe';

export default async ({ h, page }) => {
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/caisse');
  await page.getByText(/Tiroir fermé\s*: la carte fonctionne, les espèces demandent d’ouvrir la caisse\./).waitFor({ timeout: 8000 });
  if (await page.getByText(/QR fonctionnent/).count()) throw new Error('the note promises the QR code without Stripe');
};
