// Production: the legal pages say what the owner saved. Réglages › Le salon takes the old site's mentions over in one tap,
// /mentions-legales then shows the EI, its SIRET and the host, /cgv the cancellation delay from Réservation (and a new
// version when it changes), /confidentialite the browser storage and how to clear it. Every page fits a 390 px phone,
// light and dark. The demo page never carries the demo access in its HTML.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h, page }), h = { base, setup(), loginOwner(page), api(), shot() }.
export const name = 'legal pages generated from the settings';

const ctxOf = (viewport, colorScheme = 'light') => ({ viewport, colorScheme, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 });
const PHONE = { width: 390, height: 844 }, DESK = { width: 1440, height: 900 };

function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)|fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
  return () => { if (errors.length) throw new Error(errors.slice(0, 3).join('\n')); };
}
const toastSaid = (page, title, timeout = 10000) => page.locator('.toast .t', { hasText: new RegExp('^' + title) }).first().waitFor({ timeout });
/** The page's visible text, with every kind of space (the pages use non-breaking ones) as a plain space. */
const textOf = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));

/** Opens a legal page once pages.js has filled it in, checks it fits the width, and returns its text. */
async function open(browser, h, path, viewport, scheme) {
  const ctx = await browser.newContext(ctxOf(viewport, scheme));
  try {
    const page = await ctx.newPage();
    const ok = watch(page);
    const res = await page.goto(h.base + path);
    if (!res || res.status() !== 200) throw new Error(path + ' answered ' + (res && res.status()));
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ready') === '1', null, { timeout: 10000 });
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth, bg: getComputedStyle(document.body).backgroundColor, ft: !!document.querySelector('footer.ft a[href="/cgv"]') }));
    if (m.sw > m.w) throw new Error(path + ' scrolls sideways at ' + viewport.width + ' px (' + m.sw + ' px wide)');
    const dark = scheme === 'dark';
    if ((m.bg === 'rgb(15, 14, 13)') !== dark) throw new Error(path + ' in ' + scheme + ' mode has the background ' + m.bg);
    if (!m.ft) throw new Error(path + ' has no shared footer');
    await h.shot(page, 'legal' + path.replace(/\//g, '-') + '-' + viewport.width + '-' + scheme);
    const text = await textOf(page);
    ok();
    return { text, page, ctx };
  } catch (e) { await ctx.close(); throw e; }
}
async function read(browser, h, path, viewport = PHONE, scheme = 'light') {
  const r = await open(browser, h, path, viewport, scheme);
  await r.ctx.close();
  return r.text;
}
const expect = (text, what, where) => { if (!text.includes(what)) throw new Error(where + ' does not show « ' + what + ' »'); };

export default async ({ browser, h, page }) => {
  await h.loginOwner(page);
  const ok = watch(page);

  /* the owner takes the old site's mentions over, adds the phone and the mediator, saves */
  await page.goto(h.base + '/comptoir/reglages/salon');
  await page.getByText('Site et mentions légales').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Reprendre les infos de l’ancien site' }).click();
  for (const [id, v] of [['#sh-legalName', 'Frank Mariani EI'], ['#sh-siret', '51292347500028'], ['#sh-ape', '9602A'], ['#sh-publicationDirector', 'Frank Mariani']]) {
    if ((await page.inputValue(id)) !== v) throw new Error(id + ' was not taken over: ' + (await page.inputValue(id)));
  }
  if (await page.getByRole('button', { name: 'Reprendre les infos de l’ancien site' }).count()) throw new Error('the take-over button stays once everything is filled');
  // a SIRET of the wrong length cannot be saved
  await page.fill('#sh-siret', '512 923 475');
  await page.getByText('14 chiffres, comme 512 923 475 00028.').waitFor({ timeout: 5000 });
  if (!(await page.getByRole('button', { name: 'Enregistrer' }).isDisabled())) throw new Error('a short SIRET can be saved');
  await page.fill('#sh-siret', '51292347500028');
  await page.fill('#sh-phone', '06 12 34 56 78');
  await page.fill('#sh-mediator-name', 'CM2C');
  await page.fill('#sh-mediator-url', 'https://www.cm2c.net');
  // only what changed goes out, never the CGV version: a screen loaded before a Réservation change would put an old one back
  const sent = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/api/v1/settings'));
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  const body = JSON.parse((await sent).postData() || '{}');
  if (!body.shop || 'cgvVersion' in body.shop || 'reviewUrl' in body.shop) throw new Error('Le salon sent more than what changed: ' + JSON.stringify(body.shop));
  await toastSaid(page, 'Réglages enregistrés');
  const saved = (await h.api('/api/public/salon')).json.shop;
  if (saved.legalName !== 'Frank Mariani EI' || saved.siret !== '51292347500028' || saved.mediator.name !== 'CM2C') throw new Error('not saved: ' + JSON.stringify(saved));
  ok();

  /* /mentions-legales, at both widths and in both themes */
  for (const [vp, scheme] of [[DESK, 'light'], [PHONE, 'light'], [PHONE, 'dark']]) {
    const t = await read(browser, h, '/mentions-legales', vp, scheme);
    for (const w of ['Frank Mariani EI', '512 923 475 00028', 'Vercel Inc.', '+1 559 288 7060', '9602A', 'Entrepreneur individuel', 'Frank Mariani', '06 12 34 56 78', 'Neon (Union européenne)', 'CM2C']) expect(t, w, '/mentions-legales');
    if (t.includes('IONOS') || t.includes('1&1')) throw new Error('/mentions-legales still names the old host');
  }

  /* /cgv: the delay comes from Réservation */
  for (const [vp, scheme] of [[DESK, 'light'], [PHONE, 'dark']]) {
    const t = await read(browser, h, '/cgv', vp, scheme);
    expect(t, 'Annulation gratuite jusqu’à 12 h avant', '/cgv');
    expect(t, 'Aujourd’hui, aucun acompte n’est demandé en ligne.', '/cgv (production without Stripe)');
    expect(t, 'valable 1 an', '/cgv');
    expect(t, 'Frank Mariani EI', '/cgv');
    expect(t, 'Le prix applicable est celui affiché au moment de la réservation', '/cgv');
    // production without Stripe nor SMS: no fee for a card nobody can save, no SMS promised
    for (const w of ['Frais d’absence', 'et par SMS']) if (t.includes(w)) throw new Error('/cgv announces « ' + w + ' » without the feature');
  }
  await page.goto(h.base + '/comptoir/reglages/reservation');
  await page.getByText('Les acomptes s’activeront dès que Stripe sera branché. En attendant, les clients réservent sans payer.').waitFor({ timeout: 10000 });
  await page.getByText('Sans Stripe, aucun acompte n’est demandé en ligne.').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '24 h avant' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await toastSaid(page, 'Réglages enregistrés, CGV mises à jour');
  const boot = (await h.api('/api/v1/bootstrap')).json;
  if (boot.settings.shop.cgvVersion !== boot.today) throw new Error('the CGV version was not dated today: ' + boot.settings.shop.cgvVersion);
  expect(await read(browser, h, '/cgv'), 'Annulation gratuite jusqu’à 24 h avant', '/cgv after the change');
  await page.goto(h.base + '/comptoir/reglages/paiements');
  await page.getByText('Paiement en ligne non branché : aucun acompte n’est demandé et le QR est désactivé. Branche Stripe pour les activer.').waitFor({ timeout: 10000 });
  if (await page.locator('.badge', { hasText: 'Simulé' }).count()) throw new Error('Paiements still says « Simulé » in production');
  ok();

  /* /confidentialite: the storage it names is the one the button clears */
  for (const [vp, scheme] of [[DESK, 'dark'], [PHONE, 'light']]) {
    const t = await read(browser, h, '/confidentialite', vp, scheme);
    for (const w of ['lx-me', '3 ans après ta dernière visite', '10 ans', '6 ans', 'Vercel Inc.', 'Brevo', 'Stripe', 'cnil.fr']) expect(t, w, '/confidentialite');
  }
  const conf = await open(browser, h, '/confidentialite', PHONE, 'dark');
  try {
    await conf.page.evaluate(() => localStorage.setItem('lx-me', JSON.stringify({ first: 'Yanis', phone: '06 12 34 56 78' })));
    await conf.page.reload();
    await conf.page.waitForFunction(() => document.documentElement.getAttribute('data-ready') === '1');
    await conf.page.getByRole('button', { name: 'Oublier mes infos sur ce téléphone' }).click();
    await conf.page.getByText('C’est fait : ce téléphone ne garde plus rien du salon.').waitFor({ timeout: 5000 });
    if (await conf.page.evaluate(() => localStorage.getItem('lx-me'))) throw new Error('lx-me is still there');
  } finally { await conf.ctx.close(); }

  /* the demo page served in production carries no demo access, not even hidden */
  const demo = await fetch(h.base + '/demo', { redirect: 'manual' }).then((r) => r.text());
  for (const secret of ['Architecte13', 'gerant@larchitecte.fr', '2468']) if (demo.includes(secret)) throw new Error('/demo ships « ' + secret + ' » in its HTML');
};
