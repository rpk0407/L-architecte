// « Au choix du client » on a phone (430 px): the salon asks no deposit, the last step offers « Payer au salon » (already
// chosen: confirming takes the same taps as ever) or « Payer maintenant » (the whole price, on the payment page). Paid,
// his page says so; left unpaid, the booking stands and he is told he will pay at the salon. The demo's seed asks a
// deposit from 50 €: the owner switches to « au choix du client » first, as the live salon runs by default.
import { shot } from '../harness.mjs';

export const name = 'site: payer au salon (default, same taps) or payer maintenant (full price), nothing lost when unpaid';
export const viewport = { width: 430, height: 932 };

const T = 10000;
const WF = process.env.WF_SHOTS || '';

export default async ({ h, page }) => {
  let at = 'start';
  try { await run(h, page, (x) => { at = x; }); } catch (e) { throw new Error(at + ': ' + e.message.split('\n')[0]); }
};

/** The booking sheet up to the details: the first service, the first barber, the first slot. Returns the taps it took. */
async function toDetails(h, page, first, phone) {
  await page.goto(h.base + '/');
  await page.locator('.cta').first().click();
  await page.locator('.bk button.so').first().click();
  await page.locator('.bk button.wh').first().click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.bk button.sl').first().click();
  await page.locator('#f-first').waitFor({ timeout: T });
  await page.fill('#f-first', first);
  await page.fill('#f-phone', phone);
  await page.waitForFunction(() => /gardé/.test(document.querySelector('.hold')?.textContent || ''), null, { timeout: T });
}

async function run(h, page, step) {
  step('the owner lets the client choose');
  await h.setup();
  const set = await h.api('/api/v1/settings', { method: 'PATCH', body: { deposits: { mode: 'choice' } } });
  if (!set.ok) throw new Error('settings: ' + set.status + ' ' + set.text);
  const pub = (await h.api('/api/public/salon', { session: false })).json;
  if (pub.deposits.mode !== 'choice' || !pub.payments.live) throw new Error('the site is not told about the choice');

  step('payer au salon: chosen already, one tap confirms');
  await toDetails(h, page, 'Samir', '0611220071');
  const group = page.getByRole('radiogroup', { name: 'Le paiement' });
  await group.waitFor({ timeout: T });
  const salon = page.getByRole('radio', { name: /Payer au salon/ });
  const now = page.getByRole('radio', { name: /Payer maintenant/ });
  if ((await salon.getAttribute('aria-checked')) !== 'true') throw new Error('« Payer au salon » is not the default');
  if ((await now.getAttribute('aria-checked')) !== 'false') throw new Error('« Payer maintenant » is chosen by default');
  const words = await now.innerText();
  for (const w of ['Carte (crédit ou débit)', 'Apple Pay', 'Google Pay']) if (!words.includes(w)) throw new Error('the way to pay is not said: ' + w);
  if (!/Payer maintenant · \d+/.test(words.replace(/\s/g, ' '))) throw new Error('no price on « Payer maintenant »: ' + words);
  // both rows fit the phone, a thumb's height each, and the page never scrolls sideways
  for (const r of [salon, now]) { const b = await r.boundingBox(); if (!b || b.height < 56 || b.x < 0 || b.x + b.width > 430) throw new Error('a choice does not fit the phone: ' + JSON.stringify(b)); }
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('the page scrolls sideways');
  const cta = page.locator('.bk-foot .btn');
  if ((await cta.innerText()).trim() !== 'Confirmer') throw new Error('the button is not the usual « Confirmer »: ' + (await cta.innerText()));
  await group.scrollIntoViewIfNeeded();
  await shot(page, 'site-paiement-choix-430');
  if (WF) { await page.waitForTimeout(400); await page.screenshot({ path: WF + '/site-paiement-choix-430.png' }); }
  await cta.click();
  await page.locator('.st.done').waitFor({ timeout: T });
  if (await page.locator('.pay-b').count()) throw new Error('a payment is asked after « payer au salon »');
  if (!/^https?:\/\/[^/]+\/(\?.*)?$/.test(page.url())) throw new Error('the page left the site: ' + page.url());

  step('payer maintenant: the whole price, then his page says paid');
  await toDetails(h, page, 'Nadir', '0611220072');
  await page.getByRole('radio', { name: /Payer maintenant/ }).click();
  if ((await page.getByRole('radio', { name: /Payer maintenant/ }).getAttribute('aria-checked')) !== 'true') throw new Error('the tap did not choose « Payer maintenant »');
  const label = (await cta.innerText()).replace(/\s/g, ' ').trim();
  if (!/^Réserver et payer \d+/.test(label)) throw new Error('the button does not say the payment: ' + label);
  await h.expectText(page, 'Tu paies sur la page sécurisée de Stripe.');
  if (WF) { await group.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await page.screenshot({ path: WF + '/site-paiement-choix-maintenant-430.png' }); }
  await cta.click();
  await page.waitForURL(/\/paiement\/py_/, { timeout: T });
  const amount = (await page.locator('.c-amount').innerText()).replace(/\s/g, ' ');
  if (!label.endsWith(amount)) throw new Error('the page asks ' + amount + ', the button said « ' + label + ' »');
  await page.getByRole('button', { name: /^Payer / }).click();
  await page.waitForURL(/\/r\//, { timeout: T });
  await h.expectText(page, 'Paiement reçu, merci. Ton rendez-vous est réglé.');
  await h.expectText(page, 'Rien à régler au salon.');
  await h.expectText(page, 'Confirmé');
  if (WF) { await page.waitForTimeout(400); await page.screenshot({ path: WF + '/site-paiement-choix-paye-430.png' }); }

  step('payer maintenant, then he gives up: the booking stands, he pays at the salon');
  await toDetails(h, page, 'Yanis', '0611220073');
  await page.getByRole('radio', { name: /Payer maintenant/ }).click();
  await cta.click();
  await page.waitForURL(/\/paiement\/py_/, { timeout: T });
  await page.getByRole('button', { name: 'Annuler' }).click();
  await page.waitForURL(/\/r\//, { timeout: T });
  await h.expectText(page, 'Paiement non abouti : ton rendez-vous est gardé, tu régleras au salon.');
  await h.expectText(page, 'Confirmé');
  if (WF) { await page.waitForTimeout(400); await page.screenshot({ path: WF + '/site-paiement-choix-abandon-430.png' }); }

  step('the Comptoir: three bookings, one paid online, none waiting for a payment');
  const day = (await h.api('/api/v1/agenda?day=' + pub.today)).json;
  const mine = [];
  for (let i = 0; i < 14 && mine.length < 3; i++) {
    const d = new Date(Date.parse(pub.today + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    const ag = i ? (await h.api('/api/v1/agenda?day=' + d)).json : day;
    for (const a of ag.appts || []) if (['Samir', 'Nadir', 'Yanis'].some((n) => String(a.name).startsWith(n)) && a.source === 'site' && a.createdAt >= pub.now) mine.push(a);
  }
  if (mine.length !== 3) throw new Error('expected the three bookings in the agenda, found ' + mine.length);
  if (mine.some((a) => a.status !== 'booked')) throw new Error('a booking is not confirmed: ' + mine.map((a) => a.name + ' ' + a.status).join(', '));
  const paid = mine.filter((a) => a.deposit && a.deposit.paid);
  if (paid.length !== 1 || !paid[0].deposit.full || paid[0].deposit.paid !== paid[0].price) throw new Error('the payment online is not on its booking alone: ' + JSON.stringify(mine.map((a) => a.deposit)));
}
