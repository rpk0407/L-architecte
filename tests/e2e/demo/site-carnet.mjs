// The carnet bought on the site, on a phone: its own entry in the services list, the standard steps, « Tes 4 autres
// rendez-vous » after the first slot (one line changed), the account it asks for (a code, typed back, without losing
// the selection), the 80 € paid on the demo's test page, one confirmation with the five dates, « coupe 1 sur 5 » on the
// booking's page and the card of /moi.
import { shot } from '../harness.mjs';

export const name = 'site: the carnet bought with an account, five dates, the confirmation, the card of /moi';
export const viewport = { width: 390, height: 844 };

const T = 10000;
const OUT = process.env.OFFRE_SHOTS || '';
const snap = async (page, n) => { await shot(page, n); if (OUT) { await page.mouse.move(0, 0); await page.waitForTimeout(700); await page.screenshot({ path: OUT + '/' + n + '.png' }); } };

export default async ({ h, page }) => {
  let at = 'start';
  try { await run(h, page, (x) => { at = x; }); } catch (e) {
    // what the sheet says, when it says something: the reason is usually there
    const said = (await page.locator('.bk-err').first().innerText({ timeout: 500 }).catch(() => '')) + (process.env.E2E_DEBUG ? ' [' + (await page.locator('.bk-t').first().innerText({ timeout: 500 }).catch(() => '')) + ' | ' + (await page.locator('.bk-foot .btn').first().innerText({ timeout: 500 }).catch(() => '')) + ']' : '');
    throw new Error(at + ': ' + e.message.split('\n')[0] + (said ? ' · the page says « ' + said + ' »' : ''));
  }
};

async function run(h, page, step) {
  step('the offer in the services list');
  await page.goto(h.base + '/');
  await page.locator('.cta').first().click();
  const offer = page.locator('.bk button.so-pack');
  await offer.waitFor({ timeout: T });
  const words = (await offer.innerText()).replace(/[  ]/g, ' ');
  for (const w of ['Carnet 5 coupes', '5 coupes · 5 semaines · 16 € la coupe', 'Sans la barbe', 'Un rendez-vous par semaine pendant 5 semaines : une semaine sans coupe est perdue.', '80 €']) if (!words.includes(w)) throw new Error('the offer does not say « ' + w + ' »: ' + words);
  await offer.scrollIntoViewIfNeeded();
  await snap(page, 'site-carnet-offre-390');
  await offer.click();

  step('barber, then the first slot');
  await h.expectText(page, 'Étape 2 sur 4');
  await page.locator('.bk button.wh:not(.any)').first().click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.dstrip .dc:not(.full):not(.dc-more)').nth(3).click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.bk button.sl').first().click();

  step('the four other dates');
  await h.expectText(page, 'Tes 4 autres rendez-vous');
  await h.expectText(page, 'Étape 3 sur 4');
  await page.locator('.ser-r').nth(3).waitFor({ timeout: T });
  if ((await page.locator('.ser-r').count()) !== 4) throw new Error('not four lines');
  // one line changed: another hour of that week
  await page.locator('.ser-r').nth(1).getByRole('button', { name: /Modifier le rendez-vous de la semaine 3/ }).click();
  await page.locator('.ser-e .sl').first().waitFor({ timeout: T });
  const before = await page.locator('.ser-r').nth(1).locator('.ser-t b').innerText();
  await page.locator('.ser-e .sl:not(.on)').first().click();
  await page.waitForFunction((b) => { const x = document.querySelectorAll('.ser-r')[1]; return x && !x.querySelector('.ser-e') && x.querySelector('.ser-t b').textContent !== b; }, before, { timeout: T });
  const small = await page.evaluate(() => [...document.querySelectorAll('.ser-r .pty-x, .ser-t, .bk-foot .btn')].filter((e) => e.getBoundingClientRect().height < 44).length);
  if (small) throw new Error(small + ' touch target(s) under 44 px');
  if ((await page.evaluate(() => document.scrollingElement.scrollWidth)) > 390) throw new Error('the page scrolls sideways');
  await snap(page, 'site-carnet-4-autres-390');
  await page.locator('.bk-foot .btn').click();

  step('the account');
  await h.expectText(page, 'Étape 4 sur 4');
  await h.expectText(page, 'Cette formule demande un compte : c’est ce qui garde tes 5 coupes.');
  await h.expectText(page, 'Tes 5 rendez-vous');
  if (await page.getByRole('radio', { name: 'Une autre personne' }).getAttribute('aria-disabled') !== 'true') throw new Error('the carnet can be taken for another adult');
  await page.fill('#f-first', 'Karim');
  await page.fill('#f-last', 'Zerbib');
  await page.fill('#f-phone', '0611224455');
  await page.getByRole('button', { name: 'Recevoir mon code par SMS' }).click();
  await page.locator('#f-code').waitFor({ timeout: T });
  // the demo sends no text: the code of this visitor's own number is on the page
  await page.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#f-code').value), null, { timeout: T });
  await page.locator('.acc').scrollIntoViewIfNeeded();
  await snap(page, 'site-carnet-compte-390');
  await page.getByRole('button', { name: 'Valider mon code' }).click();
  await h.expectText(page, 'Connecté à ton espace, Karim');
  // the selection is still there
  if ((await page.locator('.ser-list .pty-r').count()) !== 5) throw new Error('the five dates were lost while the code was typed');

  step('confirm and pay');
  const cta = page.locator('.bk-foot .btn');
  if (!/Confirmer et régler 80\s€/.test(await cta.textContent())) throw new Error('the button says « ' + (await cta.textContent()) + ' »');
  await cta.click();
  await h.expectText(page, 'Presque réservé, Karim');
  await h.expectText(page, 'Tes 5 rendez-vous');
  if ((await page.locator('.ser-done .pty-r').count()) !== 5) throw new Error('the confirmation does not list five dates');
  await snap(page, 'site-carnet-confirmation-390');
  await page.locator('.pay-b .btn').click();
  await page.locator('.c-pay .c-btn').click();
  await page.waitForURL(/\/r\//, { timeout: T });
  await h.expectText(page, 'Confirmé', 12000);
  await h.expectText(page, 'coupe 1 sur 5');

  step('the five dates in the agenda, nothing given before a ticket');
  await h.setup();
  const cl = await h.api('/api/v1/clients?q=0611224455');
  const me = (cl.json.items || [])[0];
  if (!me) throw new Error('no file for the buyer');
  const file = await h.api('/api/v1/clients/' + me.id);
  const mine = (file.json.appts || []).filter((a) => a.status === 'booked');
  if (mine.length !== 5) throw new Error(mine.length + ' dates booked, not five');
  if ((file.json.packs || []).length) throw new Error('a carnet exists before any ticket took the money');

  step('the card of /moi');
  await page.goto(h.base + '/moi');
  await h.expectText(page, 'Carnet 5 coupes');
  await page.locator('[data-guide="moi-carnet"]').waitFor({ timeout: T });
  if ((await page.locator('[data-guide="moi-carnet"] .fo-dot').count()) !== 5) throw new Error('not five dots');
  if ((await page.locator('[data-guide="moi-carnet"] .fo-dot.booked').count()) !== 5) throw new Error('the five dates are not « réservées »');
  await h.expectText(page, 'Payé en ligne');
  await page.locator('[data-guide="moi-carnet"]').scrollIntoViewIfNeeded();
  await snap(page, 'moi-carnet-390');
}
