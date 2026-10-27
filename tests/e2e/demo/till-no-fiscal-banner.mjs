// The demo salon is not anyone's till: the production « caisse de gestion » banner (tests/e2e/prod/till-fiscal-banner.mjs)
// does not show there.
export const name = 'till: no « caisse de gestion » banner in the demo';

export default async ({ h, page }) => {
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/caisse');
  await page.getByText('Vente libre').waitFor({ timeout: 8000 });
  if (await page.getByText('Caisse de gestion').count()) throw new Error('the demo shows the production fiscal banner');
};
