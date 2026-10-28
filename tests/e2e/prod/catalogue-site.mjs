// Production: the site shows and books whatever the owner puts in the Catalogue, and nothing else.
// A fresh salon takes over the old site's menu in one tap, adds a 'Coupe junior', a client books it on the
// site, the appointment lands in the Agenda, and a deep link (?reserver&barbier=…&prestation=…) opens step 3.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h }), h = { base, setup(), loginOwner(page), api() }.

const PHONE = { viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 };
const DESK = { ...PHONE, viewport: { width: 1440, height: 900 } };

function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push('console: ' + m.text()); });
  return () => { if (errors.length) throw new Error(errors.slice(0, 3).join('\n')); };
}
const seen = (page, text, timeout = 10000) => page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout });
/** The Comptoir's toast with exactly this title (the page itself says 'visible sur le site' on every row). */
const toastSaid = (page, title, timeout = 10000) => page.locator('.toast .t', { hasText: new RegExp('^' + title) }).first().waitFor({ timeout });
const until = async (what, fn, timeout = 10000) => {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise((r) => setTimeout(r, 200))) { const v = await fn(); if (v) return v; }
  throw new Error('timed out waiting for ' + what);
};
/** Same-origin JSON call from the signed-in page, so it carries the owner's session like the Comptoir does. */
const call = (page, path, body, method) => page.evaluate(async ([p, b, m]) => {
  const r = await fetch(p, b === undefined ? {} : { method: m || 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'e2e-' + Math.random().toString(36).slice(2) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body, method]);

export default async ({ browser, h }) => {
  const base = h.base.replace(/\/$/, '');
  try { await h.setup(); } catch { /* an earlier scenario already created the owner */ }
  // the site answers at / once the domain switch is in (GL-04), at /site before
  const root = await fetch(base + '/').then((r) => r.text()).catch(() => '');
  const SITE = base + (root.includes('class="bk {{bkCls}}"') ? '/' : '/site');

  /* the owner: a barber to book with, the old menu, then a new service */
  const ctx = await browser.newContext(DESK);
  const page = await ctx.newPage();
  const ok = watch(page);
  await h.loginOwner(page);
  const boot = await call(page, '/api/v1/bootstrap');
  if (!boot.json || !(boot.json.staff || []).some((x) => x.name === 'JKut' && x.bookable)) {
    const r = await call(page, '/api/v1/staff', { name: 'JKut', role: 'barber' });
    if (r.status >= 300) throw new Error('could not add a barber: ' + JSON.stringify(r.json));
  }
  await page.goto(base + '/comptoir/catalogue');
  const takeOver = page.getByRole('button', { name: 'Reprendre la carte de l’ancien site' });
  await page.locator('.ct-bar').waitFor({ timeout: 10000 });
  if (await takeOver.isVisible()) {
    await seen(page, 'Ta carte de l’ancien site, prête en un geste');
    await takeOver.click();
    await seen(page, 'Ta carte est reprise');
    await seen(page, 'Silver');
    const cat = await call(page, '/api/v1/catalog');
    const slugs = cat.json.services.map((x) => x.slug).sort().join(',');
    if (slugs !== 'ab,cb,cc,cl,co,ct,de,eb,si,tb,tr') throw new Error('old menu taken over with slugs ' + slugs);
    const ab = cat.json.services.find((x) => x.slug === 'ab');
    const cl = cat.json.services.find((x) => x.slug === 'cl');
    if (!ab.pack || ab.pack.credits !== 5 || ab.pack.days !== 70 || String(ab.pack.serviceIds) !== cl.id) throw new Error('the subscription is not 5 cuts / 70 days on the classic cut');
    // the carnet is sold at the salon, never booked online (PAY-04: « Abonnement » is the monthly plan only)
    if (ab.name !== 'Carnet 5 coupes' || ab.category !== 'Carnet' || ab.online !== false) throw new Error('the pack is not the « Carnet », off the site: ' + JSON.stringify([ab.name, ab.category, ab.online]));
    if ((await page.locator('.badge', { hasText: 'visible sur le site' }).count()) !== 10) throw new Error('every taken-over service but the carnet should say it is visible on the site');
    if ((await page.locator('.badge', { hasText: 'pas sur le site (hors ligne)' }).count()) !== 1) throw new Error('the carnet should say it is off the site');
  }
  // a second run on the same journal (a retry, a shared server) adds its own junior cut, deduplicated by name
  const before = (await call(page, '/api/v1/catalog')).json.services;
  const NAME = before.some((x) => x.slug === 'coupe-junior') ? 'Coupe junior ' + Math.random().toString(36).slice(2, 6) : 'Coupe junior';
  const SLUG = NAME.toLowerCase().replace(/ /g, '-');
  await page.getByRole('button', { name: 'Nouvelle prestation' }).click();
  // the sheet focuses its first field a moment after opening: typing before that would land in the wrong input
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'sv-n', null, { timeout: 5000 });
  await page.fill('#sv-n', NAME);
  await page.fill('#sv-p', '15');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await toastSaid(page, 'Visible sur le site');
  const junior = await until(NAME + ' in the catalogue', async () => (await call(page, '/api/v1/catalog')).json.services.find((x) => x.name === NAME));
  if (junior.slug !== SLUG) throw new Error(NAME + ' got slug ' + junior.slug);
  ok();

  /* a client books it on the site, on a phone */
  const cctx = await browser.newContext(PHONE);
  const site = await cctx.newPage();
  const ok2 = watch(site);
  await site.goto(SITE + '?reserver');
  const card = site.locator('.bk button.so').filter({ has: site.locator('.so-n', { hasText: new RegExp('^' + NAME + '$') }) });
  await card.waitFor({ timeout: 10000 });
  if (await site.locator('.bk button.so', { hasText: 'Coupe + décoloration' }).count()) throw new Error('the demo placeholder is still listed in production');
  if (await site.locator('a[href^="https://barberlarchitecte.com"]').count()) throw new Error('the site still links to the WordPress pages');
  if (await site.getByText('Disponibilités de démonstration').locator('visible=true').count()) throw new Error('the demo line shows in production');
  await card.click();
  await site.locator('.bk button.wh:not(.any)', { hasText: 'JKut' }).click();
  await site.locator('.bk button.sl').first().waitFor({ timeout: 10000 });
  await site.locator('.bk button.sl').first().click();
  await site.fill('#f-first', 'Lina');
  await site.fill('#f-phone', '0611223344');
  if (await site.locator('a[href="/#donnees"]').count()) throw new Error('the privacy link still points at the demo page');
  await site.locator('.bk-foot .btn').click();
  await seen(site, 'C’est réservé, Lina');
  const code = (await site.locator('.ok-code b').textContent()).trim();
  const salon = await site.evaluate(() => fetch('/api/public/salon').then((r) => r.json()));
  if (salon.sms === false && await site.locator('.sms-k').locator('visible=true').count()) throw new Error('the SMS preview shows although the salon sends no SMS');
  const me = await site.evaluate(() => JSON.parse(localStorage.getItem('lx-me') || '{}'));
  const day = me.bookings && me.bookings[me.bookings.length - 1] && me.bookings[me.bookings.length - 1].day;
  ok2();
  await cctx.close();

  /* the salon sees it in the Agenda */
  await page.goto(base + '/comptoir?day=' + day);
  await seen(page, 'Lina');
  const ag = await call(page, '/api/v1/agenda?day=' + day);
  const appt = (ag.json.appts || []).find((a) => a.code === code || JSON.stringify(a).includes(code));
  if (!appt || !JSON.stringify(appt).includes(NAME)) throw new Error('booking ' + code + ' is not in the Agenda of ' + day);
  ok();
  await ctx.close();

  /* a deep link lands on step 3 with the barber and the service chosen */
  const dctx = await browser.newContext(PHONE);
  const deep = await dctx.newPage();
  const ok3 = watch(deep);
  await deep.goto(SITE + '?reserver&barbier=jkut&prestation=' + SLUG);
  await deep.locator('.bk.open').waitFor({ timeout: 10000 });
  await seen(deep, 'Étape 3 sur 4');
  await seen(deep, 'Quand ?');
  const sum = await deep.locator('.bk-sum').textContent();
  if (!sum.includes(NAME) || !/JKut/.test(sum) || !/15/.test(sum)) throw new Error('step 3 summary: ' + sum);
  ok3();
  await dctx.close();
};
