// A gift card bought on /carte-cadeau (IN-01): 30 € for Karim, texted on Christmas Eve, paid on the test checkout,
// then its page shows the code, the till takes that code, and the Comptoir's Cartes cadeaux marks it "en ligne".
export const name = 'gift card online: /carte-cadeau → payment → /cadeau/<token> shows the code, the till takes it';

export default async ({ h, page }) => {
  await page.goto(h.base + '/carte-cadeau');
  await page.locator('#cc').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('label.chip', { hasText: '30 €' }).click();
  await page.fill('#cc-to', 'Karim');
  await page.fill('#cc-tp', '06 98 76 54 32');
  await page.fill('#cc-msg', 'Joyeux Noël frérot');
  await page.fill('#cc-bf', 'Sofiane');
  await page.fill('#cc-bp', '06 11 22 33 44');
  // Christmas Eve is one tap away once it is within the 120 days a text can be planned; otherwise a week from now
  const xmas = await page.locator('#cc-xmas').isVisible();
  if (xmas) await page.locator('label.chip', { hasText: 'Le 24/12' }).click();
  else {
    await page.locator('label.chip', { hasText: 'Choisir le moment' }).click();
    await page.fill('#cc-day', await page.evaluate(() => { const d = new Date(Date.now() + 7 * 86400000); return d.toISOString().slice(0, 10); }));
  }
  await h.expectText(page, 'Le code arrive par SMS au moment que tu choisis.');
  await h.shot(page, 'giftshop-order');
  await page.getByRole('button', { name: 'Payer 30 €' }).click();

  // the test checkout, then back to the card's own page
  await page.waitForURL(/\/paiement\/py_/, { timeout: 8000 });
  await page.getByRole('button', { name: 'Payer 30 €' }).click();
  await page.waitForURL(/\/cadeau\/py_/, { timeout: 8000 });
  await page.locator('.g-code b').waitFor({ timeout: 15000 });
  const code = (await page.locator('.g-code b').textContent()).trim();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) throw new Error('no code on the card: ' + code);
  for (const want of ['30 €', 'Pour Karim', 'Joyeux Noël frérot', 'De la part de Sofiane', 'Valable jusqu’au', xmas ? 'jeudi 24 décembre à 19' : 'Le code part par SMS']) await h.expectText(page, want);
  await h.shot(page, 'giftshop-card');

  // the till: the code is known, worth 30 €, and pays a ticket
  await h.setup();
  const check = await h.api('/api/v1/giftcards/check?code=' + encodeURIComponent(code));
  if (check.status !== 200 || check.json.status !== 'active' || check.json.balance !== 3000) throw new Error('the till does not know the card: ' + check.text);
  const cat = await h.api('/api/v1/catalog');
  const cut = cat.json.services.find((s) => s.active && !s.pack && !s.from && s.price <= 3000);
  const sale = await h.api('/api/v1/sales', { body: { lines: [{ kind: 'service', ref: cut.id }], payments: [{ method: 'giftcard', amount: cut.price, ref: code }] }, headers: { 'x-request-id': 'e2e-giftshop-' + Date.now() } });
  if (sale.status !== 200) throw new Error('the till refused the code: ' + sale.text);
  const after = await h.api('/api/v1/giftcards/check?code=' + encodeURIComponent(code));
  if (after.json.balance !== 3000 - cut.price) throw new Error('balance after the cut: ' + after.text);

  // the Comptoir: the card is marked as bought online, with its planned text and the resend
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/catalogue/cartes');
  const row = page.locator('.li', { hasText: '•••• ' + code.slice(-4) });
  await row.waitFor({ timeout: 8000 });
  if (!(await row.innerText()).includes('en ligne')) throw new Error('no "en ligne" badge:\n' + (await row.innerText()));
  await row.click();
  await h.expectText(page, 'Achetée en ligne');
  await h.expectText(page, 'SMS à la personne');
  await h.expectText(page, xmas ? 'Prévu jeu. 24 déc.' : 'Prévu ');
  await page.getByRole('button', { name: 'Renvoyer le code par SMS' }).click();
  await page.getByText('Code renvoyé par SMS').first().waitFor({ timeout: 5000 });
  await h.shot(page, 'giftshop-comptoir');
};
