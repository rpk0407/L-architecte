// /moi on a phone and on a computer (AC-03a): the demo's client signs in, sees his next appointment with its four
// gestures, moves it, opens his carnet in « Mes avantages », reads his visits and a receipt, signs out. Then a visitor
// books on the site, « Créer mon espace » on the done step (and on /r/) opens /moi with the masked number and the demo's
// code, and the booking he just made is the hero. No JavaScript error, no sideways scroll at 390 px, targets ≥ 44 px.
export const name = 'client space: sign in, next visit, move, carnet, history, receipt, sign out, « Créer mon espace »';
export const viewport = { width: 390, height: 844 };

const DESKTOP = { width: 1440, height: 900 };

async function noSideScroll(page, where) {
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(where + ': the page scrolls sideways');
}
/** Every visible button and link of the selector is at least 44 px high (and wide). */
async function bigEnough(page, selector, where) {
  const small = await page.locator(selector).evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), h: r.height, w: r.width }; }).filter((x) => x.h < 44 || x.w < 44));
  if (small.length) throw new Error(where + ': targets under 44 px: ' + JSON.stringify(small));
}
const heroWhen = (page) => page.locator('.m-hero .m-when').textContent();

export default async ({ h, page }) => {
  /* ---------- signed out: the sign-in, in the site's look ---------- */
  await page.goto(h.base + '/moi');
  await page.getByRole('heading', { name: 'Ton espace' }).waitFor();
  await page.getByLabel('Ton numéro').waitFor();
  await h.expectText(page, 'Démo : aucun SMS ne part.');
  await h.expectText(page, 'Pas encore venu ? Ton espace s’ouvre avec ta première réservation.');
  await noSideScroll(page, '/moi sign-in');
  await bigEnough(page, '.m-in button, .m-in a, .m-demo button, .m-first a', '/moi sign-in');
  await h.shot(page, 'moi-signin-phone');

  // a number the salon does not know: the same answer as any other, then the code field
  await page.getByLabel('Ton numéro').fill('06 99 88 77 66');
  await page.getByRole('button', { name: 'Recevoir mon code' }).click();
  await h.expectText(page, 'Si ce numéro est connu du salon, tu reçois un code par SMS.');
  const field = page.getByLabel('Le code reçu par SMS');
  if ((await field.getAttribute('autocomplete')) !== 'one-time-code' || (await field.getAttribute('inputmode')) !== 'numeric') throw new Error('the code field is not a one-time-code field');
  // (a wrong code is AC-01's tests: its 400 would count here as a console error)
  await page.getByRole('button', { name: /Pas reçu \? Renvoyer dans \d+ s/ }).waitFor();
  await h.shot(page, 'moi-code-phone');
  await page.getByRole('button', { name: 'Changer de numéro' }).click();

  /* ---------- the demo's client ---------- */
  await page.getByRole('button', { name: 'Essayer avec un client de démo' }).click();
  const hello = page.getByRole('heading', { name: /^Salut / });
  await hello.waitFor({ timeout: 10000 });
  const first = (await hello.textContent()).replace(/^Salut /, '').trim();
  if (!first) throw new Error('no first name in the greeting');
  const hero = page.locator('.m-hero');
  await hero.waitFor();
  const when0 = await heroWhen(page);
  if (!/\d+\s?h/.test(when0)) throw new Error('the hero has no time: ' + when0);
  if (!/avec \S+/.test(await hero.locator('.c-what').textContent())) throw new Error('the hero does not name the barber');
  for (const [role, label] of [['link', 'Agenda'], ['link', 'Itinéraire'], ['button', 'Déplacer'], ['button', 'Annuler']]) await hero.getByRole(role, { name: label }).waitFor();
  await h.expectText(page, 'Modifiable jusqu’à');
  await bigEnough(page, '.m-hero a, .m-hero button, .m-tabs a, .m-book', '/moi home');
  await noSideScroll(page, '/moi home');
  await h.shot(page, 'moi-home-phone');

  // Déplacer: the last day with free slots, so the booking stays movable; the hero follows
  await hero.getByRole('button', { name: 'Déplacer' }).click();
  await page.locator('.c-days button').first().waitFor({ timeout: 8000 });
  const days = page.locator('.c-days button:not(.full)');
  await days.nth((await days.count()) - 1).click();
  await page.locator('.c-slots button').first().click();
  await h.expectText(page, 'C’est déplacé');
  await page.waitForFunction((w) => { const e = document.querySelector('.m-hero .m-when'); return !!e && e.textContent !== w; }, when0, { timeout: 8000 });

  /* ---------- « Mes avantages »: the salon sells him a carnet ---------- */
  if (await page.locator('.m-avs').isVisible()) throw new Error('« Mes avantages » shows with nothing in it');
  const mine = await page.evaluate(async () => (await fetch('/api/me/home')).json());
  await h.setup();
  const found = await h.api('/api/v1/clients?q=' + encodeURIComponent(mine.first + ' ' + mine.last));
  const file = found.json.items.find((c) => c.first === mine.first && c.last === mine.last);
  if (!file) throw new Error('the demo client is not found at the salon: ' + found.text.slice(0, 200));
  const cat = await h.api('/api/v1/catalog');
  const pack = cat.json.services.find((s) => s.active && s.pack);
  const sale = await h.api('/api/v1/sales', { body: { clientId: file.id, lines: [{ kind: 'pack', ref: pack.id }], payments: [{ method: 'card', amount: pack.price }] }, headers: { 'x-request-id': 'e2e-moi-carnet-' + Date.now() } });
  if (sale.status !== 200) throw new Error('the carnet was not sold: ' + sale.text);
  await page.reload();
  const avs = page.locator('.m-avs');
  await avs.getByRole('heading', { name: 'Mes avantages' }).waitFor({ timeout: 8000 });
  const row = avs.getByRole('button', { name: /Carnet/ });
  await row.waitFor();
  await h.shot(page, 'moi-avantages-phone');
  if (!/5\srestantes/.test(await row.textContent())) throw new Error('the carnet row: ' + (await row.textContent()));
  if (/abonnement/i.test(await avs.textContent())) throw new Error('a carnet is called « abonnement »');
  await row.click();
  const sheet = page.getByRole('dialog', { name: /Carnet/ });
  await sheet.waitFor();
  await sheet.getByText('coupes restantes sur 5').waitFor();
  if (!(await sheet.evaluate((d) => d.contains(document.activeElement)))) throw new Error('the sheet does not take the focus');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  if (!(await sheet.evaluate((d) => d.contains(document.activeElement)))) throw new Error('the focus leaves the sheet');
  await h.shot(page, 'moi-carnet-phone');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  if (!(await row.evaluate((b) => b === document.activeElement))) throw new Error('the focus does not come back to the carnet row');

  /* ---------- Historique, a receipt ---------- */
  await page.getByRole('link', { name: 'Historique' }).click();
  await page.getByRole('heading', { name: 'Ton historique' }).waitFor();
  const visits = page.locator('.m-rows li');
  await visits.first().waitFor({ timeout: 8000 });
  if ((await visits.count()) < 2) throw new Error('the history lists ' + (await visits.count()) + ' visit(s)');
  await noSideScroll(page, '/moi/historique');
  await bigEnough(page, '.m-rows a, .m-more', '/moi/historique');
  await h.shot(page, 'moi-history-phone');
  await page.getByRole('link', { name: /^Reçu du / }).first().click();
  await page.waitForURL(/\/recu\//, { timeout: 8000 });
  await h.expectText(page, 'Ticket');
  await page.goBack();
  await page.getByRole('heading', { name: 'Ton historique' }).waitFor();

  /* ---------- Profil › Se déconnecter ---------- */
  await page.getByRole('link', { name: 'Profil' }).click();
  await page.getByRole('heading', { name: 'Ton profil' }).waitFor();
  if (!page.url().endsWith('/moi/profil')) throw new Error('the Profil tab is not at /moi/profil: ' + page.url());
  await h.shot(page, 'moi-profile-phone');
  await page.getByRole('button', { name: /Se déconnecter/ }).click();
  await page.getByRole('button', { name: 'Recevoir mon code' }).waitFor({ timeout: 8000 });
  if ((await page.evaluate(async () => (await fetch('/api/public/account')).json())).signedIn) throw new Error('still signed in after « Se déconnecter »');

  /* ---------- a visitor books on the site, then « Créer mon espace » (on a computer) ---------- */
  const desk = await h.newPage({ viewport: DESKTOP });
  await desk.goto(h.base + '/?reserver');
  await desk.locator('.bk button.so', { hasText: 'Coupe + taille de barbe' }).click();
  await desk.locator('.bk button.wh').nth(1).click();
  await desk.locator('.bk .dc').nth(3).click();
  await desk.locator('.bk button.sl').first().waitFor({ timeout: 8000 });
  await desk.locator('.bk button.sl').first().click();
  await desk.fill('#f-first', 'Yanis');
  await desk.fill('#f-phone', '0611223344');
  await desk.locator('.bk-foot .btn').click();
  await h.expectText(desk, 'C’est réservé, Yanis');
  const code = (await desk.locator('.ok-code b').textContent()).trim();
  const create = desk.getByRole('link', { name: 'Créer mon espace' });
  await create.waitFor({ timeout: 8000 });
  await h.expectText(desk, 'Tous tes rendez-vous et tes reçus au même endroit');
  await h.shot(desk, 'site-done-espace-desktop');
  const href = await create.getAttribute('href');
  if (!/^\/moi\?garder=[\w.-]+/.test(href)) throw new Error('« Créer mon espace » goes to ' + href);
  // the same way in from the booking's own page
  const manage = await desk.locator('.mg-l').first().getAttribute('href');
  await desk.goto(manage);
  await desk.getByRole('link', { name: 'Créer mon espace' }).waitFor({ timeout: 8000 });
  if ((await desk.getByRole('link', { name: 'Créer mon espace' }).getAttribute('href')) !== href) throw new Error('/r/ and the done step do not open the same space');
  await h.shot(desk, 'r-espace-desktop');

  // the code leaves at once: the page names the number (masked) and, in the demo, fills the code itself
  let release;
  const held = new Promise((done) => { release = done; });
  await desk.route('**/api/public/account/verify', async (route) => { await held; await route.continue(); });
  await desk.goto(h.base + href);
  await desk.getByText(/On t’a envoyé un code au 06 •• •• •• 44\./).waitFor({ timeout: 8000 });
  const typed = await desk.getByLabel('Le code reçu par SMS').inputValue();
  if (!/^\d{6}$/.test(typed)) throw new Error('the demo code is not filled: ' + typed);
  await desk.getByText('Code envoyé, vérification…').waitFor();
  await h.shot(desk, 'moi-garder-desktop');
  release();
  await desk.getByRole('heading', { name: 'Salut Yanis' }).waitFor({ timeout: 10000 });
  if (/garder=/.test(desk.url())) throw new Error('the link stays in the address bar: ' + desk.url());
  const heroCode = (await desk.locator('.m-hero .c-code b').textContent()).trim();
  if (heroCode !== code) throw new Error('the hero is ' + heroCode + ', not the booking just made (' + code + ')');
  await h.shot(desk, 'moi-home-desktop');
  await desk.getByRole('link', { name: 'Historique' }).click();
  await h.expectText(desk, 'Rien encore : ton historique s’écrit à ta première visite.');
  // signed in, the site and /r/ say so instead of offering a second space
  await desk.goto(manage);
  await desk.getByText('C’est dans ton espace.').waitFor({ timeout: 8000 });
  await desk.goto(h.base + '/');
  await desk.getByRole('link', { name: 'Mon espace' }).waitFor({ timeout: 8000 });
};
