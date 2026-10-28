// /moi on a phone and on a computer (AC-03a): the demo's client signs in, sees his next appointment with its four
// gestures, moves and cancels it (simulated: the demo's client is everyone's showcase, the salon's bookings stay as they
// are), opens his carnet in « Mes avantages », reads his visits and a receipt, signs out. Then a visitor
// books on the site, « Ouvrir mon espace » on the done step (and on /r/) opens /moi with the masked number and the demo's
// code, and the booking he just made is the hero. No JavaScript error, no sideways scroll at 390 px, targets ≥ 44 px.
export const name = 'client space: sign in, next visit, move, carnet, history, receipt, sign out, « Ouvrir mon espace »';
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
  await page.getByRole('heading', { name: 'Ouvre ton espace' }).waitFor();
  await page.getByLabel('Ton numéro de mobile').waitFor();
  // the promise, the reassurance and the legal line sit with the number, the way to the privacy page is one tap
  await h.expectText(page, 'Ton prochain rendez-vous, tes reçus et tes avantages au même endroit. C’est facultatif : tu peux toujours réserver sans.');
  await h.expectText(page, 'Un SMS avec un code, c’est tout : pas de mot de passe, pas de pub.');
  await h.expectText(page, 'Ce SMS ne sert qu’à te connecter. Rien n’est vendu ni partagé à des fins publicitaires.');
  if ((await page.getByRole('link', { name: 'Ta vie privée' }).getAttribute('href')) !== '/confidentialite#t-space') throw new Error('« Ta vie privée » does not lead to the privacy page’s space section');
  await h.expectText(page, 'Étape 1 sur 2 · Ton numéro');
  await h.expectText(page, 'Démo : aucun SMS ne part.');
  await h.expectText(page, 'Tu n’es encore jamais venu ? Ton espace s’ouvre avec ta première réservation.');
  await h.expectText(page, 'Tu veux seulement retrouver un rendez-vous ?');
  // the site's frame: skip link, the way to book, the whole footer (« Mon espace » in it, the demo's phone)
  if ((await page.getByRole('link', { name: 'Aller au contenu' }).getAttribute('href')) !== '#main') throw new Error('no skip link');
  await page.getByRole('link', { name: 'Mentions légales' }).waitFor();
  await page.getByRole('link', { name: 'Appeler le salon' }).count();
  await noSideScroll(page, '/moi sign-in');
  await bigEnough(page, '.ms-top a, .ms-card button, .ms-card a, .ms-demo button, .ms-first a, .ms-quiet a, .ms-ft a', '/moi sign-in');
  await h.shot(page, 'moi-signin-phone');
  // an empty number and a wrong one are told what to do, on the field
  await page.getByLabel('Ton numéro de mobile').fill('');
  await page.getByRole('button', { name: 'Recevoir mon code par SMS' }).click();
  await h.expectText(page, 'Donne ton numéro de mobile pour recevoir ton code.');
  await page.getByLabel('Ton numéro de mobile').fill('0612');
  await page.getByRole('button', { name: 'Recevoir mon code par SMS' }).click();
  await h.expectText(page, 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
  if ((await page.getByLabel('Ton numéro de mobile').getAttribute('aria-invalid')) !== 'true') throw new Error('a wrong number is not marked on the field');
  // typed, the number is set in pairs
  await page.getByLabel('Ton numéro de mobile').fill('');
  await page.getByLabel('Ton numéro de mobile').pressSequentially('0699887766');
  if ((await page.getByLabel('Ton numéro de mobile').inputValue()) !== '06 99 88 77 66') throw new Error('the number is not set in pairs: ' + (await page.getByLabel('Ton numéro de mobile').inputValue()));

  // a number the salon does not know: the same answer as any other. The same tap opens the code step and the code field has the focus
  await page.getByRole('button', { name: 'Recevoir mon code par SMS' }).click();
  await page.locator('#m-code').waitFor();
  if (!(await page.evaluate(() => document.activeElement && document.activeElement.id === 'm-code'))) throw new Error('the code field has no focus after « Recevoir mon code »');
  await page.getByRole('heading', { name: 'Entre ton code' }).waitFor({ timeout: 5000 });
  await h.expectText(page, 'Si ce numéro est connu du salon, un code arrive par SMS au 06 99 88 77 66, en quelques secondes.');
  await h.expectText(page, 'Étape 2 sur 2 · Ton code');
  await h.expectText(page, 'Le code est valable 10 minutes.');
  const field = page.getByLabel('Le code reçu par SMS');
  for (const [attr, want] of [['autocomplete', 'one-time-code'], ['inputmode', 'numeric'], ['name', 'code'], ['enterkeyhint', 'done']]) {
    if ((await field.getAttribute(attr)) !== want) throw new Error('the code field has ' + attr + '=' + (await field.getAttribute(attr)));
  }
  if ((await page.locator('.ms-prog i').count()) !== 2) throw new Error('the progress bar has not two segments');
  // (a wrong code is AC-01's tests: its 400 would count here as a console error; the answers below are made up)
  await page.getByRole('button', { name: /Renvoyer le code dans \d:\d\d/ }).waitFor();
  const cells = async () => (await page.locator('.ms-cell').allTextContents()).join('');
  // a code pasted or inserted as « 123 456 », « 123-456 », or in the middle of a sentence, keeps its six digits
  for (const [typed, want] of [['123 456', '123456'], ['123-456', '123456'], [' 654321 ', '654321']]) {
    let release;
    const held = new Promise((done) => { release = done; });
    await page.route('**/api/public/account/verify', async (route) => { await held; await route.fulfill({ json: { ok: false, ask: 'first', message: 'Ton prénom ?' } }); });
    await page.locator('#m-code').focus();
    await page.keyboard.insertText(typed);
    await page.waitForFunction((w) => [...document.querySelectorAll('.ms-cell')].map((c) => c.textContent).join('') === w, want, { timeout: 3000 }).catch(() => {});
    if ((await cells()) !== want) throw new Error('« ' + typed + ' » gives ' + (await cells()) + ', not ' + want);
    release(); // the sixth digit sent it: let the (made up) answer through, and see the name step
    await page.getByRole('heading', { name: 'Une petite vérification' }).waitFor({ timeout: 8000 });
    if (!(await page.evaluate(() => document.activeElement && document.activeElement.id === 'm-first'))) throw new Error('the first-name field has no focus');
    await h.expectText(page, 'Étape 3 sur 3 · Ton prénom');
    await h.expectText(page, 'Une seule fois, pour être sûr que ce numéro est bien le tien : quel prénom as-tu donné au salon ?');
    if ((await page.locator('.ms-prog i').count()) !== 3) throw new Error('the progress bar has not three segments at the name step');
    await page.getByRole('button', { name: 'Retour au code' }).click();
    await page.getByRole('heading', { name: 'Entre ton code' }).waitFor();
    await page.unroute('**/api/public/account/verify');
    await page.locator('#m-code').fill('');
  }
  await h.shot(page, 'moi-code-phone');
  // the browser's Back goes to the number, not out of /moi
  await page.goBack();
  await page.getByRole('heading', { name: 'Ouvre ton espace' }).waitFor();
  if (!/\/moi$/.test(page.url())) throw new Error('Back left /moi: ' + page.url());
  if (!(await page.evaluate(() => document.activeElement && document.activeElement.tagName === 'H1'))) throw new Error('the title has no focus after Back');
  await page.getByLabel('Ton numéro de mobile').fill('06 99 88 77 66');
  await page.getByRole('button', { name: 'Recevoir mon code par SMS' }).click();
  await page.getByRole('button', { name: 'Changer de numéro' }).click();
  await page.getByRole('heading', { name: 'Ouvre ton espace' }).waitFor();

  // a wrong code is said kindly (never « redemande-en un » while the button is greyed), the cells empty and the field keeps the focus
  await page.getByLabel('Ton numéro de mobile').fill('06 98 76 54 32');
  await page.getByRole('button', { name: 'Recevoir mon code par SMS' }).click();
  await page.locator('#m-code').waitFor();
  await page.getByRole('button', { name: /Renvoyer le code dans \d:\d\d/ }).waitFor();
  page.expect.push(/status of 400/);
  await page.keyboard.type('000000');
  await page.getByText('Ce code n’est pas le bon, ou il a expiré.').waitFor({ timeout: 8000 });
  await page.getByText(/Tu pourras en demander un nouveau dans \d:\d\d\./).waitFor();
  if ((await page.locator('.ms-otp').getAttribute('data-state')) !== 'bad') throw new Error('the cells do not show the wrong code');
  if ((await cells()) !== '') throw new Error('the wrong code stays in the cells: ' + (await cells()));
  if (!(await page.evaluate(() => document.activeElement && document.activeElement.id === 'm-code'))) throw new Error('the code field lost the focus after a wrong code');
  await h.shot(page, 'moi-code-wrong-phone');
  // the network failing keeps the right code typed and offers to try again
  page.expect.push(/ERR_FAILED/);
  await page.route('**/api/public/account/verify', (route) => route.abort());
  await page.keyboard.type('111111');
  await page.getByText('Pas de connexion. Vérifie ton réseau, puis réessaie.').waitFor({ timeout: 8000 });
  if ((await cells()) !== '111111') throw new Error('a network error cleared the code: ' + (await cells()));
  await page.unroute('**/api/public/account/verify');
  // too many wrong codes: the step locks, with the way to the salon
  page.expect.push(/status of 429/);
  await page.getByRole('button', { name: 'Réessayer' }).click();
  for (let i = 0; i < 6 && !(await page.getByRole('heading', { name: /^Trop d’essais pour le moment/ }).count()); i++) {
    await page.waitForTimeout(1300);
    if (await page.getByRole('heading', { name: /^Trop d’essais pour le moment/ }).count()) break;
    await page.locator('#m-code').focus();
    await page.keyboard.type('00000' + i);
  }
  await page.getByRole('heading', { name: /^Trop d’essais pour le moment/ }).waitFor({ timeout: 8000 });
  await h.expectText(page, 'Par sécurité, on fait une pause. Réessaie dans quelques minutes, ou appelle le salon.');
  if (!/^tel:/.test((await page.getByRole('link', { name: 'Appeler le salon' }).getAttribute('href')) || '')) throw new Error('no way to call the salon from the locked step');
  await page.getByRole('link', { name: 'Retour au site' }).waitFor();
  if (await page.locator('#m-code').count()) throw new Error('the code field stays live after too many tries');
  await bigEnough(page, '.ms-lock a', 'locked step');
  await h.shot(page, 'moi-locked-phone');
  await page.goto(h.base + '/moi');
  await page.getByRole('heading', { name: 'Ouvre ton espace' }).waitFor();

  /* ---------- the demo's client ---------- */
  await page.getByRole('button', { name: 'Essayer avec un client de démo' }).click();
  // a moment of « C'est bon, … » before the home
  await page.getByRole('heading', { name: /^C’est bon, / }).waitFor({ timeout: 10000 });
  await h.shot(page, 'moi-opened-phone');
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
  await bigEnough(page, '.m-hero a, .m-hero button, .m-tabs a, .m-book, .c-foot a', '/moi home');
  await noSideScroll(page, '/moi home');
  await h.shot(page, 'moi-home-phone');

  // what the salon holds for him before the visitor touches anything
  const atSalon = async () => (await page.evaluate(async () => (await fetch('/api/me/home')).json())).upcoming.map((u) => u.id + '@' + u.day + '/' + u.start).join(',');
  const held0 = await atSalon();
  if (!held0) throw new Error('the demo client has nothing booked at the salon');

  // Déplacer: the last day with free slots, so the booking stays movable; the hero follows
  await hero.getByRole('button', { name: 'Déplacer' }).click();
  await page.locator('.c-days button').first().waitFor({ timeout: 8000 });
  const days = page.locator('.c-days button:not(.full)');
  await days.nth((await days.count()) - 1).click();
  await page.locator('.c-slots button').first().click();
  await h.expectText(page, 'C’est déplacé');
  await page.waitForFunction((w) => { const e = document.querySelector('.m-hero .m-when'); return !!e && e.textContent !== w; }, when0, { timeout: 8000 });
  await h.expectText(page, 'Démo : rien n’est changé au salon.');
  // Annuler: the hero goes, the next visitor still finds the booking where it was
  await page.locator('.m-hero').getByRole('button', { name: 'Annuler' }).click();
  await page.getByRole('button', { name: 'Oui, annuler' }).click();
  await h.expectText(page, 'C’est annulé.');
  await h.shot(page, 'moi-cancel-demo-phone');
  if ((await atSalon()) !== held0) throw new Error('a visitor changed the demo client’s bookings at the salon: ' + held0 + ' → ' + (await atSalon()));
  await page.reload();
  await page.getByRole('heading', { name: /^Salut / }).waitFor({ timeout: 10000 });
  if ((await heroWhen(page)) !== when0) throw new Error('after a reload the hero is not the salon’s booking: ' + (await heroWhen(page)));

  /* ---------- « Mes avantages »: the seed sold him a carnet (or, the demo's client having changed since, the salon does now) ---------- */
  const mine = await page.evaluate(async () => (await fetch('/api/me/home')).json());
  if (!mine.wallet.carnets.length) {
    if (await page.locator('.m-avs').isVisible()) throw new Error('« Mes avantages » shows with nothing in it');
    await h.setup();
    const found = await h.api('/api/v1/clients?q=' + encodeURIComponent(mine.first + ' ' + mine.last));
    const file = found.json.items.find((c) => c.first === mine.first && c.last === mine.last);
    if (!file) throw new Error('the demo client is not found at the salon: ' + found.text.slice(0, 200));
    const cat = await h.api('/api/v1/catalog');
    const pack = cat.json.services.find((s) => s.active && s.pack);
    const sale = await h.api('/api/v1/sales', { body: { clientId: file.id, lines: [{ kind: 'pack', ref: pack.id }], payments: [{ method: 'card', amount: pack.price }] }, headers: { 'x-request-id': 'e2e-moi-carnet-' + Date.now() } });
    if (sale.status !== 200) throw new Error('the carnet was not sold: ' + sale.text);
    await page.reload();
  }
  const avs = page.locator('.m-avs');
  await avs.getByRole('heading', { name: 'Mes avantages' }).waitFor({ timeout: 8000 });
  const row = avs.getByRole('button', { name: /Carnet/ }).first();
  await row.waitFor();
  await h.shot(page, 'moi-avantages-phone');
  if (!/\d+\srestantes? · jusqu’au /.test(await row.textContent())) throw new Error('the carnet row: ' + (await row.textContent()));
  if (/abonnement/i.test(await avs.textContent())) throw new Error('a carnet is called « abonnement »');
  await row.click();
  const sheet = page.getByRole('dialog', { name: /Carnet/ });
  await sheet.waitFor();
  await sheet.getByText(/restantes? sur \d+/).waitFor();
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
  // .first(): AC-02's Profil card has its own « Se déconnecter » row (cards/Session.tsx goes when it lands)
  await page.getByRole('button', { name: /Se déconnecter/ }).first().click();
  await page.getByRole('button', { name: 'Recevoir mon code par SMS' }).waitFor({ timeout: 8000 });
  if ((await page.evaluate(async () => (await fetch('/api/public/account')).json())).signedIn) throw new Error('still signed in after « Se déconnecter »');

  /* ---------- a visitor books on the site, then « Ouvrir mon espace » (on a computer) ---------- */
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
  const create = desk.getByRole('link', { name: 'Ouvrir mon espace' });
  await create.waitFor({ timeout: 8000 });
  await h.expectText(desk, 'Garde tout au même endroit');
  await h.expectText(desk, 'Un code par SMS, pas de mot de passe.');
  await h.expectText(desk, 'Facultatif : ton rendez-vous est déjà confirmé.');
  // right under the ticket, in reach without scrolling the sheet and not under its « Fermer » bar
  const where = await desk.evaluate(() => { const c = document.querySelector('[data-guide="site.espace"]').getBoundingClientRect(), f = document.querySelector('.bk-foot').getBoundingClientRect(); return { bottom: c.bottom, foot: f.top }; });
  if (where.bottom > where.foot) throw new Error('the card is cropped by the sheet’s bar: ' + JSON.stringify(where));
  await h.shot(desk, 'site-done-espace-desktop');
  const href = await create.getAttribute('href');
  if (!/^\/moi\?garder=[\w.-]+/.test(href)) throw new Error('« Ouvrir mon espace » goes to ' + href);
  // the same way in from the booking's own page
  const manage = await desk.locator('.mg-l').first().getAttribute('href');
  await desk.goto(manage);
  await desk.getByRole('link', { name: 'Ouvrir mon espace' }).waitFor({ timeout: 8000 });
  await h.expectText(desk, 'Retrouve ce rendez-vous, tes reçus et tes avantages. Un code par SMS, pas de mot de passe.');
  if ((await desk.getByRole('link', { name: 'Ouvrir mon espace' }).getAttribute('href')) !== href) throw new Error('/r/ and the done step do not open the same space');
  await h.shot(desk, 'r-espace-desktop');
  // the way in is on the site's top bar and in the Sommaire, and on /mon-rendez-vous as a card
  await desk.goto(h.base + '/');
  await desk.locator('a.tb-me').waitFor({ timeout: 8000 });
  await desk.locator('.tb-ch').click();
  await desk.locator('a.mn-me').getByText('Tes rendez-vous et tes reçus').waitFor({ timeout: 8000 });
  await desk.goto(h.base + '/mon-rendez-vous');
  await desk.getByRole('heading', { name: 'Tu reviens souvent ?' }).waitFor({ timeout: 8000 });
  await desk.getByRole('link', { name: 'Ouvrir mon espace' }).waitFor();

  // the code leaves at once: the page opens on the code step (never the number form), names the number (masked) and, in
  // the demo, fills the code itself and says so for a moment before it goes in
  let release;
  const held = new Promise((done) => { release = done; });
  await desk.route('**/api/public/account/verify', async (route) => { await held; await route.continue(); });
  await desk.addInitScript(() => { new MutationObserver(() => { if (document.getElementById('m-phone')) window.__sawPhone = true; }).observe(document, { childList: true, subtree: true }); });
  await desk.goto(h.base + href);
  await desk.getByText(/Code envoyé au 06\s••\s••\s••\s44, en quelques secondes\./).waitFor({ timeout: 8000 });
  await desk.getByText('Code reçu', { exact: true }).waitFor({ timeout: 5000 });
  const typed = await desk.getByLabel('Le code reçu par SMS').inputValue();
  if (!/^\d{6}$/.test(typed)) throw new Error('the demo code is not filled: ' + typed);
  await h.expectText(desk, 'Étape 2 sur 2 · Ton code');
  await h.shot(desk, 'moi-garder-desktop');
  release();
  await desk.getByRole('heading', { name: 'C’est bon, Yanis.' }).waitFor({ timeout: 10000 });
  await h.shot(desk, 'moi-opened-desktop');
  if (await desk.evaluate(() => !!window.__sawPhone)) throw new Error('the number form showed while the code of a booking was on its way');
  await desk.getByRole('heading', { name: 'Salut Yanis' }).waitFor({ timeout: 10000 });
  // the welcome says what is there now, once on this phone
  await desk.getByRole('heading', { name: 'Bienvenue, Yanis' }).waitFor();
  await h.expectText(desk, 'Ton rendez-vous du ');
  await h.expectText(desk, 'Tes reçus arrivent après chaque visite');
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
  await desk.getByRole('link', { name: 'Mon espace' }).first().waitFor({ timeout: 8000 });
  // signed in, the top bar says whose space it is and the Sommaire greets him
  await desk.locator('a.tb-me[aria-label*="Yanis"]').waitFor({ timeout: 8000 });
  await desk.locator('.tb-ch').click();
  await desk.locator('a.mn-me').getByText('Salut Yanis').waitFor({ timeout: 8000 });
};
