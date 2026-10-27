// Production: the owner opens on days the salon is usually closed (Réglages › Horaires › Ouvertures exceptionnelles).
// The 'Lundis de décembre' chip adds the last two Mondays of December at 9 h – 18 h 30; the site gets them. Then a
// Monday within two weeks, 10 h – 17 h, from the form: the site's hero says 'Ouvert exceptionnellement …' (LX_FAKE_NOW
// is ignored in production, so the December dates themselves are covered by tests/unit/openings.test.js).
// The footer's 'Écrire au salon' goes to /contact.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h, page }), h = { base, setup(), loginOwner(page), api(), shot() }.
export const name = 'Exceptional openings: the December chip, the site’s banner';

const PHONE = { viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 };
const sp = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });
  return () => { if (errors.length) throw new Error(errors.slice(0, 3).join('\n')); };
}
const toastSaid = (page, title, timeout = 10000) => page.locator('.toast .t', { hasText: new RegExp('^' + title) }).first().waitFor({ timeout });
const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wd = (day) => new Date(day + 'T12:00:00Z').getUTCDay();
/** As Réglages › Horaires does: the last two Mondays of this December still to come (one from the 22nd, none after the 28th). */
function decemberMondays(today) {
  let d = today.slice(0, 4) + '-12-31';
  while (wd(d) !== 1) d = addDays(d, -1);
  return [addDays(d, -7), d].filter((x) => x >= today);
}

export default async ({ browser, h, page }) => {
  const base = h.base.replace(/\/$/, '');
  const root = await fetch(base + '/').then((r) => r.text()).catch(() => '');
  const SITE = base + (root.includes('class="bk {{bkCls}}"') ? '/' : '/site');
  await h.loginOwner(page);
  const ok = watch(page);

  await page.goto(base + '/comptoir/reglages/horaires');
  const card = page.locator('section.card', { has: page.locator('h2', { hasText: 'Ouvertures exceptionnelles' }) });
  await card.waitFor({ timeout: 10000 });
  if (!sp(await card.textContent()).includes('Aucune ouverture exceptionnelle prévue.')) throw new Error('a fresh salon already has openings');

  /* the chip: the last two Mondays of December (the salon's today: the server's clock) */
  let salon = await h.api('/api/public/salon');
  const want = decemberMondays(salon.json.today);
  const chip = card.getByRole('button', { name: /^\+ Lundis? de décembre · / });
  let dec = [];
  if (want.length) {
    const label = sp(await chip.textContent());
    const exp = '+ ' + (want.length > 1 ? 'Lundis' : 'Lundi') + ' de décembre · ' + want.map((x) => Number(x.slice(8))).join(' et ') + ' déc.';
    if (label !== exp) throw new Error('the chip said « ' + label + ' », expected « ' + exp + ' »');
    await chip.click();
    await toastSaid(page, want.length > 1 ? 'Ouvertures ajoutées' : 'Ouverture ajoutée');
    salon = await h.api('/api/public/salon');
    dec = salon.json.openings;
    if (JSON.stringify(dec.map((o) => o.day)) !== JSON.stringify(want) || !dec.every((o) => JSON.stringify(o.intervals) === '[[540,1110]]')) throw new Error('the site got ' + JSON.stringify(dec));
    await card.locator('li', { hasText: 'Lundis de décembre' }).nth(want.length - 1).waitFor({ timeout: 5000 });
    const items = (await card.locator('li .li-main').allTextContents()).map(sp);
    if (!items[0].includes('Lundi ' + Number(dec[0].day.slice(8)) + ' décembre · 9 h – 18 h 30 · Toute l’équipe')) throw new Error('the list reads ' + items.join(' | '));
    if (await chip.count()) throw new Error('the chip is still offered once added');
  } else if (await chip.count()) throw new Error('after the 28th, no December Monday is left to offer');
  await h.shot(page, 'openings-reglages');

  /* a Monday within two weeks, from the form */
  const today = salon.json.today;
  let mon = addDays(today, 1);
  while (wd(mon) !== 1 || dec.some((o) => o.day === mon)) mon = addDays(mon, 1);
  await card.getByLabel('Motif de l’ouverture').fill('Inventaire terminé');
  await card.getByLabel('Jour de l’ouverture').fill(mon);
  await card.locator('#rg-op-from').selectOption('600');
  await card.locator('#rg-op-to').selectOption('1020');
  await card.getByRole('button', { name: 'Ouvrir', exact: true }).click();
  await toastSaid(page, 'Ouverture ajoutée');
  await card.locator('li', { hasText: 'Inventaire terminé' }).waitFor({ timeout: 5000 });
  // the form starts again, on another day
  if ((await card.getByLabel('Motif de l’ouverture').inputValue()) !== 'Ouverture exceptionnelle' || (await card.getByLabel('Jour de l’ouverture').inputValue()) === mon) throw new Error('the form was not reset after the save');
  if (!(await card.getByLabel('Ouvre à').count()) || !(await card.getByLabel('Ferme à').count())) throw new Error('the hours have no accessible name');
  ok();

  /* the site, on a phone */
  const cctx = await browser.newContext(PHONE);
  const site = await cctx.newPage();
  const ok2 = watch(site);
  await site.goto(SITE);
  const ban = site.locator('.hero .ann-h').first();
  await ban.waitFor({ timeout: 10000 });
  const d = Number(mon.slice(8)), m = MONTHS[Number(mon.slice(5, 7)) - 1];
  const banner = 'Ouvert exceptionnellement ' + (mon === today ? 'aujourd’hui' : 'lundi ' + (d === 1 ? '1er' : d) + ' ' + m) + ', 10 h – 17 h';
  // in late December the chip's Mondays may come first: then they are the banner
  const first = !!dec.length && dec[0].day < mon;
  if (first ? !sp(await ban.textContent()).startsWith('Ouvert exceptionnellement') : sp(await ban.textContent()) !== banner) throw new Error('the banner says « ' + sp(await ban.textContent()) + ' », expected « ' + banner + ' »');
  if (!(await ban.evaluate((el) => el.classList.contains('ann-op')))) throw new Error('an opening is not marked as one');
  const contact = site.locator('.ft-links a', { hasText: 'Écrire au salon' });
  if ((await contact.getAttribute('href')) !== '/contact') throw new Error('« Écrire au salon » goes to ' + (await contact.getAttribute('href')));
  const ld = await site.evaluate(() => document.getElementById('lx-ld').textContent);
  if (!ld.includes('"specialOpeningHoursSpecification"') || !ld.includes('"validFrom":"' + mon + '"')) throw new Error('structured data: no special hours for ' + mon);
  await h.shot(site, 'openings-site');
  ok2();
  await cctx.close();
};
