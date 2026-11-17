// The day before the opening, the owner on his phone: Réglages › Mise en route (the salon's preset, and the old
// « Carnet 5 coupes » renamed « Formule Entretien 5 semaines » once he confirms), Connexion IONOS, Paiements (card, Apple
// Pay, Google Pay, no PayPal; Stripe in three steps with their live state and no secret on the page) and Messages
// (« Lien pour laisser un avis Google »). Run by tests/e2e/prod.mjs on its own fresh salon.
export const name = 'réglages before opening: the formule renamed by the preset, Stripe in three steps, the review link';

const PHONE = { width: 390, height: 844 };
const OUT = process.env.RETOURS_SHOTS || '';
const T = 10000;
const snap = async (page, n) => { if (OUT) { await page.waitForTimeout(350); await page.screenshot({ path: OUT + '/' + n + '.png' }); } };
// the whole page, for a read-through of every word (RETOURS_FULL: a folder)
const FULL = process.env.RETOURS_FULL || '';
const full = async (page, n) => { if (FULL) { await page.waitForTimeout(350); await page.screenshot({ path: FULL + '/' + n + '.png', fullPage: true }); (await import('node:fs')).writeFileSync(FULL + '/' + n + '.txt', await page.locator('main, #root').first().innerText()); } };

export default async ({ h }) => {
  await h.setup();
  const page = await h.newPage({ viewport: PHONE, mobile: true });
  await h.loginOwner(page);
  const call = (path, body, method) => h.api(path, body === undefined ? {} : { method: method || 'POST', body });

  // the preset, then the salon of the first days: the formule still called « Carnet 5 coupes », without the beard
  if ((await call('/api/v1/preset/apply', {})).status !== 200) throw new Error('the preset did not apply');
  const cat = async () => (await h.api('/api/v1/catalog')).json;
  let list = await cat();
  const items = list.items || list.services || list;
  const ab = items.find((x) => x.slug === 'ab'), cl = items.find((x) => x.slug === 'cl');
  if (!ab || ab.name !== 'Formule Entretien 5 semaines') throw new Error('the preset does not create the formule: ' + JSON.stringify(ab && ab.name));
  const old = await call('/api/v1/services/' + ab.id, { name: 'Carnet 5 coupes', short: 'Carnet', category: 'Carnet', tag: '16 € la coupe', includes: ['5 coupes, une par semaine', 'Sans la barbe'], pack: { credits: 5, days: 35, serviceIds: [cl.id], weekly: true, missed: 'lost' } }, 'PATCH');
  if (old.status !== 200) throw new Error('could not put the old name back: ' + JSON.stringify(old.json));

  await page.goto(h.base + '/comptoir/reglages/mise-en-route');
  const preset = page.locator('[data-guide="mer-preset"]');
  await preset.waitFor({ timeout: T });
  await preset.getByText('1 ligne à mettre à jour').waitFor({ timeout: T });
  await preset.getByText(/remplace « Carnet 5 coupes »/).waitFor({ timeout: T });
  await preset.getByText('à mettre à jour', { exact: true }).first().scrollIntoViewIfNeeded();
  await snap(page, '6-mise-en-route-formule-a-mettre-a-jour');
  await preset.getByRole('button', { name: 'Mettre à jour', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByText(/« Carnet 5 coupes » devient « Formule Entretien 5 semaines »/).waitFor({ timeout: T });
  await snap(page, '1-preset-confirmation-formule');
  await dlg.getByRole('button', { name: 'Mettre à jour' }).click();
  await preset.getByText('en place', { exact: true }).waitFor({ timeout: T });
  list = await cat();
  const now = (list.items || list.services || list).find((x) => x.slug === 'ab');
  if (now.name !== 'Formule Entretien 5 semaines' || now.short !== 'Entretien 5 sem.' || (now.pack.withIds || []).length !== 1 || now.pack.serviceIds.length !== 2) throw new Error('the formule after the update: ' + JSON.stringify(now));
  if (now.includes.join() !== 'Shampooing,Coupe,Coiffage,Entretien de barbe') throw new Error('what the formule holds: ' + now.includes.join());
  await page.goto(h.base + '/comptoir/reglages/mise-en-route');
  await page.locator('.mr-step').first().waitFor({ timeout: T });
  await snap(page, '6-mise-en-route');
  await full(page, 'mise-en-route');

  // Paiements: plain words, three steps, each « À faire » while nothing is plugged in; names to copy, never a value
  await page.goto(h.base + '/comptoir/reglages/paiements');
  await h.expectText(page, 'Carte, Apple Pay, Google Pay. Pas de PayPal.');
  const steps = page.locator('[data-guide="paiements-etapes"] .pay-steps > li');
  await steps.nth(2).waitFor({ timeout: T });
  if ((await steps.count()) !== 3) throw new Error('not three steps');
  for (const [i, title] of ['1. Ton compte Stripe', '2. Deux clés dans Vercel', '3. L’adresse où Stripe prévient le salon'].entries()) {
    await steps.nth(i).getByText(title).waitFor({ timeout: T });
    if ((await steps.nth(i).getAttribute('data-state')) !== 'todo') throw new Error('step ' + (i + 1) + ' is not « À faire » on a salon without Stripe');
    await steps.nth(i).getByText('À faire', { exact: true }).waitFor({ timeout: T });
  }
  if ((await page.locator('#pay-wh').inputValue()) !== h.base + '/api/pay/stripe/webhook') throw new Error('the webhook address is not this site’s');
  if (!(await page.locator('#pay-ev').inputValue()).includes('checkout.session.completed')) throw new Error('the events to tick are missing');
  for (const b of ['Copier l’adresse', 'Copier les événements', 'Copier STRIPE_SECRET_KEY', 'Copier STRIPE_WEBHOOK_SECRET']) {
    const box = await page.getByRole('button', { name: b }).boundingBox();
    if (!box || box.height < 44 || box.width < 44) throw new Error('« ' + b + ' » is under 44 px: ' + JSON.stringify(box));
  }
  const html = await page.content();
  if (/sk_(live|test)_|whsec_/.test(html) || (await page.locator('input[type="password"]').count())) throw new Error('a secret is shown or asked on the page');
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) throw new Error('Paiements scrolls sideways at 390 px');
  await page.getByText('Carte, Apple Pay, Google Pay. Pas de PayPal.').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await snap(page, '2-paiements-sans-paypal');
  await full(page, 'paiements');
  await steps.nth(1).scrollIntoViewIfNeeded();
  await snap(page, '2-paiements-stripe-3-etapes');
  await steps.nth(2).scrollIntoViewIfNeeded();
  await snap(page, '2-paiements-stripe-webhook');

  // Messages: the review link, in the owner's words; a link that is not a Google review page asks before it is kept
  await page.goto(h.base + '/comptoir/reglages/messages');
  const avis = page.locator('[data-guide="messages-avis"]');
  await avis.waitFor({ timeout: T });
  await avis.getByLabel('Lien pour laisser un avis Google').fill('https://example.org/avis');
  await avis.scrollIntoViewIfNeeded();
  await avis.getByText(/n’ouvre pas le formulaire d’avis/).waitFor({ timeout: T });
  await avis.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('dialog').getByText('Ce n’est pas une page d’avis Google reconnue.', { exact: false }).waitFor({ timeout: T });
  await snap(page, '3-reglages-lien-avis-a-confirmer');
  await page.getByRole('dialog').getByRole('button', { name: /Annuler|Non|Retour/ }).first().click();
  await avis.getByLabel('Lien pour laisser un avis Google').fill('https://g.page/r/CW4AEHDMG_iWEBM/review');
  await avis.getByText('Ouvre le lien court de Google Business Profile.').waitFor({ timeout: T });
  await avis.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForTimeout(600);
  const st = (await h.api('/api/v1/settings')).json;
  const shop = (st.settings || st).shop;
  if (shop.reviewUrl !== 'https://g.page/r/CW4AEHDMG_iWEBM/review') throw new Error('the review link was not saved: ' + shop.reviewUrl);
  await snap(page, '3-reglages-lien-avis');
  await page.goto(h.base + '/comptoir/reglages/messages');
  await page.locator('.rg-h, h1').first().waitFor({ timeout: T });
  await snap(page, '6-messages');
  await full(page, 'messages');

  // Connexion IONOS: the page opens, reads without a sideways scroll
  await page.goto(h.base + '/comptoir/reglages/ionos');
  await page.locator('.rg-h, h1').first().waitFor({ timeout: T });
  await page.waitForTimeout(500);
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) throw new Error('Connexion IONOS scrolls sideways at 390 px');
  await snap(page, '6-connexion-ionos');
  await full(page, 'ionos');
};
