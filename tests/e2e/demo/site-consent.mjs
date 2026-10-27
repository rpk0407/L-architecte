// The offers switch on the site: off by default, and once ticked the client file says yes (with where it came from).
// Then the footer link forgets what the phone remembered, and an old WordPress address lands on its section.
export const name = 'site: the offers switch reaches the client file, the phone forgets on request';
export const viewport = { width: 390, height: 844 };

export default async ({ h, page }) => {
  await page.goto(h.base + '/');
  await page.locator('.cta').first().click();
  await page.locator('.bk button.so', { hasText: 'Coupe + taille de barbe' }).click();
  await page.locator('.bk button.wh').first().click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: 8000 });
  await page.locator('.bk button.sl').first().click();
  await page.fill('#f-first', 'Malik');
  await page.fill('#f-phone', '0687654321');
  const sw = page.locator('#f-mkt');
  if ((await sw.getAttribute('aria-checked')) !== 'false') throw new Error('the offers switch is ticked by default');
  await h.expectText(page, 'STOP, comme indiqué dans chaque SMS');
  await h.expectText(page, 'aux bons plans seulement si tu coches');
  // the offers come by SMS: switching the reminder off takes the offers with it, switching the offers on brings it back
  const smsSw = page.getByRole('switch', { name: /Rappel par SMS la veille/ });
  await smsSw.click();
  await sw.click();
  if ((await sw.getAttribute('aria-checked')) !== 'true') throw new Error('the offers switch does not switch on');
  if ((await smsSw.getAttribute('aria-checked')) !== 'true') throw new Error('offers on, SMS off: a consent that could never be used');
  await smsSw.click();
  if ((await sw.getAttribute('aria-checked')) !== 'false') throw new Error('SMS off, offers still on');
  await sw.click();
  await h.shot(page, 'site-consent');
  await page.locator('.bk-foot .btn').click();
  await h.expectText(page, 'C’est réservé, Malik');

  await h.setup();
  const list = await h.api('/api/v1/clients?q=0687654321');
  const id = list.json && list.json.items[0] && list.json.items[0].id;
  if (!id) throw new Error('the client was not created: ' + list.text);
  const file = await h.api('/api/v1/clients/' + id);
  if (file.json.client.marketing !== true) throw new Error('the client file says no offers: ' + JSON.stringify(file.json.client));

  // the Comptoir shows it on the client file
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/clients/' + id);
  const toggle = page.getByRole('switch', { name: /Offres et nouveautés/ });
  await toggle.waitFor({ timeout: 8000 });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') throw new Error('the client file shows the offers off');

  // the site remembers Malik on this phone, until asked to forget
  await page.goto(h.base + '/');
  const forget = page.getByRole('button', { name: 'Oublier mes infos sur ce téléphone' });
  await forget.scrollIntoViewIfNeeded();
  await forget.click();
  await h.expectText(page, 'C’est oublié sur ce téléphone.');
  if (await page.evaluate(() => window.localStorage.getItem('lx-me')) !== null) throw new Error('lx-me is still stored');

  // /nos-services lands on #carte (a fresh load, as from the redirect): the page goes there once rendered
  await page.goto('about:blank');
  await page.goto(h.base + '/#carte');
  // the jump waits for the salon's answer, which can take a while on a loaded machine
  const inView = () => { const c = document.getElementById('carte'); return !!c && Math.abs(c.getBoundingClientRect().top) <= 120; };
  if (!(await page.waitForFunction(inView, null, { timeout: 10000 }).then(() => true, () => false))) {
    const top = await page.evaluate(() => document.getElementById('carte').getBoundingClientRect().top);
    throw new Error('#carte is not in view (top ' + Math.round(top) + ' px)');
  }
};
