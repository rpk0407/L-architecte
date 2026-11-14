// A booking of two people who each owe a deposit (a 50 € service): the confirmation keeps both payments at hand. Each
// one opens in a new tab, so paying the first never leaves the page holding the second (else that place lapses unpaid).
import { shot } from '../harness.mjs';

export const name = 'site: two people with a deposit each in one booking, both payments stay at hand';
export const viewport = { width: 390, height: 844 };

const T = 10000;
const WF = process.env.WF_SHOTS || '';

export default async ({ h, page }) => {
  let at = 'start';
  try { await run(h, page, (x) => { at = x; }); } catch (e) { throw new Error(at + ': ' + e.message.split('\n')[0]); }
};

async function pick(page) {
  await page.locator('.bk button.so', { hasText: 'Transformation' }).first().click();
  await page.locator('.bk button.wh').first().click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.bk button.sl').first().click();
  await page.locator('#f-first').waitFor({ timeout: T });
}

async function run(h, page, step) {
  step('the father');
  await page.goto(h.base + '/');
  await page.locator('.cta').first().click();
  await pick(page);
  await page.fill('#f-first', 'Samir');
  await page.fill('#f-phone', '0611220099');
  await page.waitForFunction(() => /gardé/.test(document.querySelector('.hold')?.textContent || ''), null, { timeout: T });

  step('his son');
  await page.getByRole('button', { name: /Ajouter une personne/ }).click();
  await pick(page);
  await page.getByRole('radio', { name: 'Mon enfant' }).click();
  await page.fill('#g-first', 'Ilyes');
  await page.locator('.bk-foot .btn').click();

  step('both deposits at hand');
  await page.locator('.st.done').waitFor({ timeout: T });
  await h.expectText(page, 'Le rendez-vous d’Ilyes (ton enfant)');
  const main = page.locator('.pay-b a.btn');
  if ((await main.getAttribute('target')) !== '_blank') throw new Error('the first deposit leaves the page holding the second');
  await h.expectText(page, 'garde cette page pour régler les autres');
  const second = page.getByRole('link', { name: /Régler l’acompte d’Ilyes/ });
  if ((await second.getAttribute('target')) !== '_blank') throw new Error('the son’s deposit leaves the page');
  if (!(await second.getAttribute('href'))) throw new Error('no page to pay the son’s deposit');
  // the main button at the bottom opens the father's payment beside this page, which stays
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: T }), page.locator('.bk-foot .btn').click()]);
  await popup.close();
  await second.waitFor({ timeout: T });
  await shot(page, 'site-pour-autrui-acomptes-390');
  if (WF) { await page.waitForTimeout(600); await page.screenshot({ path: WF + '/site-pour-autrui-acomptes-390.png' }); }
}
