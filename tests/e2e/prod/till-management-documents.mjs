// Production: whatever the Comptoir prints or exports says it is a management till, so nothing from it is taken for the
// certified till's ticket or Z: the printed ticket, the printed Z, and the exports of Rapports. (The banner of the Caisse
// page is tests/e2e/prod/till-fiscal-banner.mjs; the demo shows none of it.) Also the first day with nothing plugged in:
// a sale by card with the drawer closed, the drawer opened from the till, the Z.
export const name = 'till: tickets, Z and exports say « document de gestion »';
export const viewport = { width: 390, height: 844 };

export default async ({ h, page }) => {
  await h.loginOwner(page);
  const call = (path, body) => page.evaluate(async ([p, b]) => {
    const r = await fetch(p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body]);
  const all = { 0: [[540, 1200]], 1: [[540, 1200]], 2: [[540, 1200]], 3: [[540, 1200]], 4: [[540, 1200]], 5: [[540, 1200]], 6: [[540, 1200]] };
  if ((await call('/api/v1/staff', { name: 'JKut', role: 'barber', pin: '2468', schedule: all, commission: { service: 4000, product: 1000 } })).status !== 200) throw new Error('no barber');
  if ((await call('/api/v1/services', { name: 'Coupe classique', category: 'Coupes', price: 2000, dur: 30 })).status !== 200) throw new Error('no service');

  await page.goto(h.base + '/comptoir/caisse?vente=1');
  await page.locator('.ticket').waitFor({ timeout: 8000 });
  const later = page.getByRole('button', { name: 'Plus tard' });
  if (await later.count()) await later.click();
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByRole('button', { name: /Coupe classique/ }).click();
  // nothing online is plugged in: the QR says why, the card works, cash opens the drawer on the spot
  await page.getByText('Branche Stripe pour le QR').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: /^Espèces/ }).click();
  const cash = page.getByRole('dialog', { name: 'Paiement en espèces' });
  await cash.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await cash.getByRole('button', { name: 'Le compte', exact: true }).click();
  await cash.getByRole('button', { name: /^Valider/ }).click();
  await page.getByRole('button', { name: /Valider l’encaissement/ }).click();
  const who = page.getByRole('dialog', { name: /Qui a fait/ });
  await who.getByRole('button', { name: /JKut/ }).first().click();
  // the done screen (« Encaissé · 25 € »), not the Caisse home's « Encaissé aujourd’hui » card behind it
  await page.getByRole('heading', { name: /^Encaissé ·/ }).first().waitFor({ timeout: 8000 });
  const ticket = await page.locator('.receipt [data-gestion]').first().textContent();
  if (!/Document de gestion/.test(ticket || '') || !/caisse certifiée/.test(ticket || '')) throw new Error('the printed ticket does not say it is a management document: ' + ticket);

  if ((await call('/api/v1/drawer/close', { counts: { 5000: 3, 2000: 1 } })).status !== 200) throw new Error('the count was refused');
  if ((await call('/api/v1/closures', { early: true })).status !== 200) throw new Error('the Z was refused');
  await page.goto(h.base + '/comptoir/caisse/cloture');
  await page.getByText('Le tiroir').first().waitFor({ timeout: 8000 });
  await page.evaluate(() => { window.print = () => {}; });
  await page.getByRole('button', { name: 'Imprimer le Z' }).click();
  const z = await page.locator('.receipt [data-gestion]').first().textContent({ timeout: 5000 });
  if (!/sans valeur fiscale/.test(z || '') || !/Z fiscal est celui de la caisse certifiée/.test(z || '')) throw new Error('the printed Z does not say it is not the fiscal one: ' + z);

  await page.goto(h.base + '/comptoir/rapports');
  const exp = await page.locator('[data-guide="rapports-exports"] [data-gestion]').textContent({ timeout: 8000 });
  if (!/Chiffres de gestion/.test(exp || '')) throw new Error('the exports do not say they are management figures: ' + exp);
  await h.shot(page, 'till-management-documents');
};
