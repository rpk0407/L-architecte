// Production, as the salon runs live: everything by e-mail, no SMS provider, nothing stored about the client space, and a `deposits`
// setting never stored (the code's default, « au choix du client »). On a phone, 430 px wide:
//   1. without a real way to pay online (no Stripe key on this server), the booking form shows no payment choice at
//      all: « Confirmer » books as it always did, in the same taps;
//   2. with one (the public answer says payments.live, as the server does with its Stripe keys: tests/api/pay-choice
//      checks that side over HTTP with a fake Stripe; no key is ever used here), both choices render, « Payer au salon »
//      is chosen already and books with the very same taps, and « Payer maintenant » leaves for the payment page;
//      back from it unpaid, his page says the booking stands and he pays at the salon.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h }), h = { base, setup(), loginOwner(page), api() }.

const PHONE = { viewport: { width: 430, height: 932 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 };
const T = 10000;
const WF = process.env.WF_SHOTS || '';
const seen = (page, text) => page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout: T });

/** Opens the sheet and goes to the details; every tap is counted (a tap: a click on the page). */
async function toDetails(page, site, mail) {
  let taps = 0;
  const tap = async (loc) => { await loc.click(); taps++; };
  await page.goto(site);
  await tap(page.locator('.cta').first());
  await tap(page.locator('.bk button.so', { hasText: 'Coupe du jour' }).first());
  await tap(page.locator('.bk button.wh').first());
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await tap(page.locator('.bk button.sl').first());
  await page.locator('#f-first').waitFor({ timeout: T });
  await page.fill('#f-first', 'Samir');
  await page.fill('#f-email', mail);
  await page.waitForFunction(() => /gardé/.test(document.querySelector('.hold')?.textContent || ''), null, { timeout: T });
  return { taps: () => taps, tap };
}

export default async ({ browser, h }) => {
  const base = h.base.replace(/\/$/, '');
  await h.setup();
  const post = async (path, body, method) => { const r = await h.api(path, { body, ...(method ? { method } : {}) }); if (!r.ok) throw new Error(path + ': ' + r.status + ' ' + r.text); return r.json; };
  await post('/api/v1/staff', { name: 'JKut', role: 'barber' });
  await post('/api/v1/services', { name: 'Coupe du jour', category: 'Coupes', price: 2500, dur: 30 });
  await post('/api/v1/settings', { booking: { contact: 'email', cancelUntilHours: 0, minNoticeMin: 0 } }, 'PATCH');
  const pub = (await h.api('/api/public/salon', { session: false })).json;
  if (pub.payments.live !== false || pub.deposits.mode !== 'none') throw new Error('without Stripe the site must be told there is nothing to pay online: ' + JSON.stringify([pub.payments, pub.deposits.mode]));
  if (pub.sms !== false || pub.booking.contact !== 'email') throw new Error('not the live salon’s shape: ' + JSON.stringify([pub.sms, pub.booking.contact]));
  const settings = (await h.api('/api/v1/bootstrap')).json.settings;
  if (settings.deposits.mode !== 'choice') throw new Error('the code default is not « au choix du client »: ' + settings.deposits.mode);

  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  /* 1 · no way to pay online: no choice, the usual taps */
  const a = await toDetails(page, base + '/', 'samir.un@exemple.fr');
  if (await page.getByRole('radiogroup', { name: 'Le paiement' }).count()) throw new Error('a payment choice shows without online payment');
  if (await page.getByText('Payer maintenant').count()) throw new Error('« Payer maintenant » shows without online payment');
  const cta = page.locator('.bk-foot .btn');
  if ((await cta.innerText()).trim() !== 'Confirmer') throw new Error('button: ' + (await cta.innerText()));
  await a.tap(cta);
  await page.locator('.st.done').waitFor({ timeout: T });
  const usual = a.taps();

  /* 2 · online payment live: the same server, its public answer saying what it says with Stripe keys */
  await ctx.route('**/api/public/salon', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    await route.fulfill({ response: res, json: { ...json, payments: { provider: 'stripe', live: true }, deposits: { ...json.deposits, mode: 'choice' } } });
  });
  const b = await toDetails(page, base + '/', 'samir.deux@exemple.fr');
  const group = page.getByRole('radiogroup', { name: 'Le paiement' });
  await group.waitFor({ timeout: T });
  const salon = page.getByRole('radio', { name: /Payer au salon/ }), now = page.getByRole('radio', { name: /Payer maintenant/ });
  if ((await salon.getAttribute('aria-checked')) !== 'true' || (await now.getAttribute('aria-checked')) !== 'false') throw new Error('« Payer au salon » is not the default');
  const words = (await now.innerText()).replace(/\s/g, ' ');
  for (const w of ['Payer maintenant · 25 €', 'Carte (crédit ou débit)', 'Apple Pay', 'Google Pay', 'Remboursé si tu annules avant ton rendez-vous.']) if (!words.includes(w)) throw new Error('« Payer maintenant » does not say: ' + w + ' (' + words + ')');
  for (const r of [salon, now]) { const box = await r.boundingBox(); if (!box || box.height < 56 || box.x < 0 || box.x + box.width > 430) throw new Error('a choice does not fit 430 px: ' + JSON.stringify(box)); }
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('the page scrolls sideways');
  if ((await cta.innerText()).trim() !== 'Confirmer') throw new Error('button with the choice shown: ' + (await cta.innerText()));
  await group.scrollIntoViewIfNeeded();
  if (WF) { await page.waitForTimeout(400); await page.screenshot({ path: WF + '/prod-paiement-choix-430.png' }); }
  await b.tap(cta);
  await page.locator('.st.done').waitFor({ timeout: T });
  if (b.taps() !== usual) throw new Error('« payer au salon » took ' + b.taps() + ' taps, a booking without the choice takes ' + usual);
  if (await page.locator('.pay-b').count()) throw new Error('a payment is asked after « payer au salon »');
  await seen(page, 'Elle part par e-mail à samir.deux@exemple.fr');

  /* « payer maintenant »: one more tap (the choice), the request says so, and the page leaves for the payment */
  let sent = null;
  await ctx.route('**/api/public/bookings', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    sent = route.request().postDataJSON();
    const res = await route.fetch();
    const json = await res.json();
    // what the server answers with Stripe: the booking confirmed and its payment page (here: the way back from one left unpaid)
    await route.fulfill({ response: res, json: res.status() === 201 ? { ...json, payNow: { amount: 2500, ok: true }, payment: { id: 'py_e2e', url: base + '/r/' + json.token + '?paiement=annule' } } : json });
  });
  const c = await toDetails(page, base + '/', 'samir.trois@exemple.fr');
  await c.tap(page.getByRole('radio', { name: /Payer maintenant/ }));
  if ((await cta.innerText()).replace(/\s/g, ' ').trim() !== 'Réserver et payer 25 €') throw new Error('button for « payer maintenant »: ' + (await cta.innerText()));
  await seen(page, 'Annulation gratuite jusqu’à l’heure du rendez-vous, remboursée sur ta carte.');
  if (WF) { await group.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await page.screenshot({ path: WF + '/prod-paiement-maintenant-430.png' }); }
  await c.tap(cta);
  await page.waitForURL(/\/r\/[^?]+/, { timeout: T });
  if (c.taps() !== usual + 1) throw new Error('« payer maintenant » took ' + c.taps() + ' taps, expected ' + (usual + 1));
  if (!sent || sent.pay !== 'now') throw new Error('the booking did not say « pay now »: ' + JSON.stringify(sent));
  await seen(page, 'Paiement non abouti : ton rendez-vous est gardé, tu régleras au salon.');
  await seen(page, 'Confirmé');
  if (WF) { await page.waitForTimeout(400); await page.screenshot({ path: WF + '/prod-paiement-non-abouti-430.png' }); }
  await ctx.unroute('**/api/public/bookings');
  // « payer au salon » never says « pay now »
  let plain = null;
  await ctx.route('**/api/public/bookings', async (route) => { if (route.request().method() === 'POST') plain = route.request().postDataJSON(); return route.continue(); });
  const d = await toDetails(page, base + '/', 'samir.quatre@exemple.fr');
  await d.tap(cta);
  await page.locator('.st.done').waitFor({ timeout: T });
  if (!plain || 'pay' in plain) throw new Error('« payer au salon » sent a payment wish: ' + JSON.stringify(plain));

  /* the Comptoir: Réglages offers the mode, by its name */
  await ctx.unroute('**/api/public/salon');
  const desk = await browser.newContext({ ...PHONE, viewport: { width: 1280, height: 900 } });
  const own = await desk.newPage();
  await h.loginOwner(own);
  await own.goto(base + '/comptoir/reglages/reservation');
  const chip = own.getByRole('button', { name: 'Au choix du client : maintenant en ligne, ou au salon' });
  await chip.waitFor({ timeout: T });
  if ((await chip.getAttribute('aria-pressed')) !== 'true') throw new Error('Réglages does not show « au choix du client » as the mode in force');
  await seen(own, 'Aucun acompte. En réservant, le client choisit');
  if (WF) { await chip.scrollIntoViewIfNeeded(); await own.waitForTimeout(300); await own.screenshot({ path: WF + '/prod-reglages-choix.png' }); }
  await desk.close();
  await ctx.close();
  if (errors.length) throw new Error(errors.slice(0, 3).join('\n'));
};
