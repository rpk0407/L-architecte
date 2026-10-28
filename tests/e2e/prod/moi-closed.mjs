// A production salon keeps the client space closed until the owner opens it (accounts.enabled is false there): /moi
// says so and points to « Mon rendez-vous », and no page of the site leads to it (AC-03a).
export const name = 'client space closed in production: /moi says so, nothing leads to it';
export const viewport = { width: 390, height: 844 };

export default async ({ h, page }) => {
  await h.setup();
  const acc = await h.api('/api/public/account', { session: false });
  if (acc.json.enabled !== false) throw new Error('the space is open on a fresh production salon: ' + acc.text);
  for (const path of ['/moi', '/moi/historique']) {
    await page.goto(h.base + path);
    await page.getByRole('heading', { name: 'L’espace client n’est pas encore ouvert.' }).waitFor({ timeout: 8000 });
    await page.getByRole('link', { name: 'Retrouver mon rendez-vous' }).waitFor();
    if (await page.getByRole('button', { name: /client de démo/ }).count()) throw new Error(path + ': the demo button shows in production');
  }
  // a link with a booking token opens nothing either (the keep route is closed)
  await page.goto(h.base + '/moi?garder=LA-XXXX.abcdefghijkl');
  await page.getByRole('heading', { name: 'L’espace client n’est pas encore ouvert.' }).waitFor({ timeout: 8000 });
  await page.goto(h.base + '/mon-rendez-vous');
  await page.locator('html[data-ready="1"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(300);
  if (await page.locator('#lk-espace').isVisible()) throw new Error('/mon-rendez-vous offers a closed space');
  await page.goto(h.base + '/');
  await page.locator('.ft-links').waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  if (await page.getByRole('link', { name: 'Mon espace' }).count()) throw new Error('the site footer links to a closed space');
};
