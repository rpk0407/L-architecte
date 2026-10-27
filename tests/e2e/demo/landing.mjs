// On the demo salon the landing page lives at /demo (and stays there), / is the site, and the Comptoir links to /.
export const name = 'the demo landing at /demo, the site at /';

export default async ({ h, page }) => {
  // the page asks the salon's mode first, and only leaves when it is not a demo
  const seen = page.waitForResponse((r) => r.url().endsWith('/api/public/salon'), { timeout: 10000 });
  await page.goto(h.base + '/demo');
  await seen;
  await page.waitForTimeout(300);
  if (!page.url().endsWith('/demo')) throw new Error('the demo page left for ' + page.url());
  await h.expectText(page, 'Architecte13');
  if ((await page.locator('.pc-nav a').first().getAttribute('href')) !== '/') throw new Error('“Le site” does not point at /');

  await page.goto(h.base + '/');
  await page.locator('.lp').first().waitFor({ timeout: 8000 });
  if (await page.getByText('Architecte13').count()) throw new Error('/ shows the demo credentials');

  await h.loginOwner(page);
  const href = await page.locator('a.nav-site').getAttribute('href');
  if (href !== '/') throw new Error('“Voir le site client” points at ' + href);
};
