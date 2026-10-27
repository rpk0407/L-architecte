// Production: Le Comptoir is a management till, not the certified one. Every tab of the Caisse says so; « En savoir
// plus » explains why in French and links to the full fiscal note (docs/security.md), on the desktop and on a phone
// without widening the page.
// Run by tests/e2e/prod.mjs on its own fresh salon; tests/e2e/demo/till-no-fiscal-banner.mjs checks the demo has none.
export const name = 'till: the « caisse de gestion » banner on every tab';

const TEXT = 'Caisse de gestion : le ticket légal sort de ta caisse certifiée.';

export default async ({ h, page }) => {
  await h.loginOwner(page);
  for (const path of ['/comptoir/caisse', '/comptoir/caisse/ventes', '/comptoir/caisse/cloture']) {
    await page.goto(h.base + path);
    await page.getByText(TEXT).waitFor({ timeout: 8000 });
    if (!(await page.getByRole('button', { name: 'En savoir plus' }).count())) throw new Error(path + ': no « En savoir plus »');
  }
  await h.shot(page, 'till-fiscal-banner');
  await why(h, page, 'till-fiscal-sheet');

  const phone = await h.newPage({ viewport: { width: 390, height: 844 } });
  await h.loginOwner(phone);
  await phone.goto(h.base + '/comptoir/caisse');
  await phone.getByText(TEXT).waitFor({ timeout: 8000 });
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (wide > 0) throw new Error('the banner widens the phone page by ' + wide + ' px');
  await h.shot(phone, 'till-fiscal-banner-phone');
  await why(h, phone, 'till-fiscal-sheet-phone');
};

/** « En savoir plus » opens the French explanation, with the full note one link away, and closes again. */
async function why(h, page, shot) {
  await page.getByRole('button', { name: 'En savoir plus' }).click();
  const sheet = page.getByRole('dialog', { name: 'Caisse de gestion' });
  await sheet.waitFor({ timeout: 5000 });
  for (const what of ['ticket légal', 'Z fiscal', 'organisme accrédité', '7\u00a0500\u00a0€']) if (!(await sheet.getByText(what).count())) throw new Error('the sheet does not say « ' + what + ' »');
  const href = await sheet.getByRole('link', { name: 'La note complète (en anglais)' }).getAttribute('href');
  if (!/docs\/security\.md#fiscal-note-france$/.test(href || '')) throw new Error('the full note points at ' + href);
  await page.waitForTimeout(500); // the sheet's entrance
  await h.shot(page, shot);
  await sheet.getByRole('button', { name: 'Compris' }).click();
  await sheet.waitFor({ state: 'detached', timeout: 5000 });
}
