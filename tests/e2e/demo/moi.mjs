// /moi on a phone and on a computer (AC-03a): the demo's client signs in, sees his next appointment with its four
// gestures, moves and cancels it (simulated: the demo's client is everyone's showcase, the salon's bookings stay as they
// are), opens his carnet in « Mes avantages », reads his visits and a receipt, signs out. Then a visitor
// books on the site, « Ouvrir mon espace » on the done step (and on /r/) opens /moi with the masked number and the demo's
// code, and the booking he just made is the hero. No JavaScript error, no sideways scroll at 390 px, targets ≥ 44 px.
export const name = 'client space: sign in, next visit, move, carnet, history, receipt, sign out, « Ouvrir mon espace »';
export const viewport = { width: 390, height: 844 };

import { focusRing, textContrast } from '../ring.mjs';

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
  // the wait is counted once, by the greyed « Renvoyer le code dans 0:28 » below: the message above does not say it a second time
  if ((await page.getByText(/\d:\d\d/).count()) !== 1) throw new Error('the wait shows ' + (await page.getByText(/\d:\d\d/).count()) + ' times after a wrong code');
  if (await page.getByText('Tu pourras en demander un nouveau').count()) throw new Error('the wrong-code message counts the wait again');
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

  // a link that opens nothing (old, wrong): the number form with the reason on top, and the code step that follows has the
  // number behind it: its arrow comes back to the number, it does not leave /moi
  page.expect.push(/status of 404/);
  const toCode = async () => {
    await page.getByLabel('Ton numéro de mobile').fill('06 97 11 22 33');
    await page.getByRole('button', { name: 'Recevoir mon code par SMS' }).click();
    await page.getByRole('button', { name: /Renvoyer le code dans \d:\d\d/ }).waitFor();
  };
  // the arrow stays on the page (a window flag survives it, a trip to another page loses it) and shows the number
  const arrowBack = async (where) => {
    await page.evaluate(() => { window.__stays = true; });
    await page.getByRole('button', { name: 'Retour au numéro' }).click();
    await page.getByRole('heading', { name: 'Ouvre ton espace' }).waitFor();
    if (!/\/moi$/.test(page.url()) || !(await page.evaluate(() => window.__stays === true))) throw new Error('the arrow of the code step left /moi ' + where + ': ' + page.url());
  };
  // (another page before it, so that a Back that leaves /moi shows)
  await page.goto(h.base + '/mon-rendez-vous');
  await page.goto(h.base + '/moi?garder=ancien-lien');
  await h.expectText(page, 'Ce lien n’est pas (ou plus) valable.');
  if (/garder=/.test(page.url())) throw new Error('the used-up link stays in the address bar: ' + page.url());
  await toCode();
  await arrowBack('after a link that opens nothing');
  // the page reloaded on the code step keeps the mark the step left on its history entry: what follows pushes its own
  await toCode();
  await page.reload();
  await page.getByRole('heading', { name: 'Ouvre ton espace' }).waitFor();
  await toCode();
  await arrowBack('after a reload on the code step');

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
  // the title is focused by script for a screen reader: it shows no focus rectangle (it is not interactive)
  const ring = await desk.evaluate(() => { const e = document.querySelector('.ms-ok h1'); return e ? { focused: document.activeElement === e, outline: getComputedStyle(e).outlineStyle } : null; });
  if (ring && ring.focused && ring.outline !== 'none') throw new Error('the success title shows a focus rectangle (' + ring.outline + ')');
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

  /* ---------- the footer at 320 px, and the frame in the phone's dark mode, the site's own pages' way ---------- */
  const narrow = await h.newPage({ viewport: { width: 320, height: 640 } });
  const ready = (pg) => pg.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  const text = async (pg, sel) => (await pg.locator(sel).first().textContent()).replace(/\s+/g, ' ').trim();
  await narrow.goto(h.base + '/moi');
  await narrow.getByLabel('Ton numéro de mobile').waitFor();
  await narrow.waitForFunction(() => /SAS/.test((document.querySelector('.ms-ft-c') || {}).textContent || ''));
  await noSideScroll(narrow, '/moi sign-in at 320 px');
  await bigEnough(narrow, '.ms-ft a', '/moi footer at 320 px');
  // the main button keeps its words on one line, and the quiet sentence has no tall gap where its link wraps (the link's 44 px is padding)
  const btn = await narrow.getByRole('button', { name: 'Recevoir mon code par SMS' }).evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); return { h: e.getBoundingClientRect().height, lines: new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size, over: e.scrollWidth > e.clientWidth }; });
  if (btn.lines !== 1 || btn.over || btn.h < 44) throw new Error('the main button at 320 px: ' + JSON.stringify(btn));
  const quiet = await narrow.locator('.ms-quiet').evaluate((e) => { const a = e.querySelector('a').getBoundingClientRect(); return { h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight), link: a.height }; });
  if (quiet.h > 3 * quiet.lh + 1) throw new Error('« Reçois son lien » leaves a tall gap at 320 px: ' + JSON.stringify(quiet));
  if (quiet.link < 43.5) throw new Error('the quiet link is under 44 px: ' + JSON.stringify(quiet));
  // the first-name hint fits the field (the answers of the number and the code steps are staged: the server's codes are limited)
  await narrow.route('**/api/public/account/start', (r) => r.fulfill({ json: { ok: true, message: 'Si ce numéro est connu du salon, un code arrive par SMS.' } }));
  await narrow.route('**/api/public/account/verify', (r) => r.fulfill({ json: { ok: false, ask: 'first', message: 'Ton prénom ?' } }));
  await narrow.getByLabel('Ton numéro de mobile').fill('06 99 88 77 66');
  await narrow.getByRole('button', { name: 'Recevoir mon code par SMS' }).click();
  await narrow.locator('#m-code').waitFor();
  await narrow.locator('#m-code').focus();
  await narrow.keyboard.type('123456');
  await narrow.locator('#m-first').waitFor();
  // at every width from a 320 px phone to a big one (360 px, the commonest Android width, once clipped its last letter): the hint fits with room to spare
  const hintAt = () => narrow.locator('#m-first').evaluate((e) => {
    const f = getComputedStyle(e), p = getComputedStyle(e, '::placeholder');
    const c = document.createElement('canvas').getContext('2d');
    c.font = p.fontWeight + ' ' + p.fontSize + ' ' + p.fontFamily;
    const text = e.getAttribute('placeholder') || '';
    return { need: c.measureText(text).width + (parseFloat(p.letterSpacing) || 0) * text.length, room: e.clientWidth - parseFloat(f.paddingLeft) - parseFloat(f.paddingRight) };
  });
  for (let w = 320; w <= 430; w++) {
    await narrow.setViewportSize({ width: w, height: 640 });
    const hint = await hintAt();
    if (hint.need > hint.room - 8) throw new Error('the first-name hint is clipped or touches the edge at ' + w + ' px: ' + JSON.stringify(hint));
  }
  await narrow.setViewportSize({ width: 320, height: 640 });
  await narrow.unroute('**/api/public/account/start');
  await narrow.unroute('**/api/public/account/verify');
  await narrow.goto(h.base + '/moi');
  await narrow.getByLabel('Ton numéro de mobile').waitFor();
  // the focus ring of the skip link, the way to book and the main button, light: a ring the page's ink, 3:1 against what is behind it
  for (const sel of ['a.ms-skip', 'a.ms-btn', 'button.c-btn']) await focusRing(narrow, sel, 'light: /moi sign-in');
  // the phone and the e-mail never share a line with a separator that a break could strand: there is none, and each fits its line
  if ((await text(narrow, '.ms-ft address')).includes('·')) throw new Error('a separator in the footer’s address line');
  const ways = await narrow.locator('.ms-ft-ways a').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { right: r.right, t: e.textContent }; }));
  if (ways.length !== 2 || ways.some((w) => w.right > 320)) throw new Error('the footer’s phone and e-mail do not fit at 320 px: ' + JSON.stringify(ways));
  // the © line says what the static pages say (the legal name), word for word
  const ftMine = await text(narrow, '.ms-ft-c');
  await narrow.goto(h.base + '/confidentialite');
  await ready(narrow);
  const ftTheirs = await text(narrow, '.ft-c');
  // the static pages' footer wraps its phone and e-mail the same way: two items, no « · » between them, each inside the screen
  for (const path of ['/confidentialite', '/mon-rendez-vous', '/resilier']) {
    await narrow.goto(h.base + path);
    await ready(narrow);
    if ((await text(narrow, '.ft address')).includes('·')) throw new Error(path + ': a separator in the footer’s address line');
    const theirWays = await narrow.locator('.ft-ways a').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { right: r.right, h: r.height, t: e.textContent }; }));
    if (theirWays.length !== 2 || theirWays.some((w) => w.right > 320 || w.h < 44)) throw new Error(path + ': the footer’s phone and e-mail at 320 px: ' + JSON.stringify(theirWays));
    // the © line's dot is glued to the words after it: a no-break space, never a plain one
    if (!(await narrow.locator('.ft-c').first().textContent()).includes('·\u00a0Pas de pistage')) throw new Error(path + ': the © line can end on its dot');
  }
  await narrow.goto(h.base + '/confidentialite');
  await ready(narrow);
  if (ftMine !== ftTheirs) throw new Error('the footer’s © line is « ' + ftMine + ' », the static pages say « ' + ftTheirs + ' »');
  if (!/^© \d{4} L’Architecte SAS · Pas de pistage, pas de mesure d’audience\.$/.test(ftMine)) throw new Error('the © line: ' + ftMine);

  await narrow.emulateMedia({ colorScheme: 'dark' });
  const paint = (pg, sel) => pg.locator(sel).first().evaluate((e) => { const c = getComputedStyle(e); return c.backgroundColor + ' | ' + c.color; });
  await narrow.goto(h.base + '/mon-rendez-vous');
  await ready(narrow);
  const site = { page: await paint(narrow, 'body'), foot: await paint(narrow, '.ft'), link: await paint(narrow, '.ft-l a'), btn: await paint(narrow, '.tb .btn') };
  await narrow.goto(h.base + '/moi');
  await narrow.getByLabel('Ton numéro de mobile').waitFor();
  const frame = { page: await paint(narrow, '.ms'), foot: await paint(narrow, '.ms-ft'), link: await paint(narrow, '.ms-ft-l a'), btn: await paint(narrow, '.ms-btn') };
  for (const k of Object.keys(site)) if (site[k] !== frame[k]) throw new Error('dark: /moi ' + k + ' is ' + frame[k] + ', the static pages’ is ' + site[k]);
  if (!frame.page.startsWith('rgb(15, 14, 13)')) throw new Error('dark: the frame is not the site’s dark: ' + frame.page);
  if (!(await narrow.evaluate(() => getComputedStyle(document.documentElement).backgroundColor === 'rgb(15, 14, 13)'))) throw new Error('dark: the page behind the frame stays light');
  // the field, the cells and the buttons are drawn for it (dark text on the red button, light text on the dark field)
  const numberField = await paint(narrow, '.ms-inp');
  if (!numberField.startsWith('rgb(23, 21, 19)')) throw new Error('dark: the number field is ' + numberField);
  // and the focus ring is the light ink on the dark paper (it was the text colour of the control: the dark ink of the red button, invisible)
  for (const sel of ['a.ms-skip', 'a.ms-btn', 'button.c-btn']) await focusRing(narrow, sel, 'dark: /moi sign-in');
  // the signed-in space is dark with it: nothing flips between the sign-in, « C'est bon » and the home (the page behind, the body, every sample)
  await narrow.evaluate(() => {
    window.__paint = [];
    const t = setInterval(() => window.__paint.push(getComputedStyle(document.documentElement).backgroundColor + ' | ' + getComputedStyle(document.body).backgroundColor), 25);
    window.__stop = () => clearInterval(t);
  });
  await narrow.getByRole('button', { name: 'Essayer avec un client de démo' }).click();
  await narrow.getByRole('heading', { name: /^Salut / }).waitFor({ timeout: 10000 });
  const painted = await narrow.evaluate(() => { window.__stop(); return [...new Set(window.__paint)]; });
  if (painted.length !== 1 || painted[0] !== 'rgb(15, 14, 13) | rgb(15, 14, 13)') throw new Error('dark: the page changes colour on the way in: ' + JSON.stringify(painted));
  const home = await narrow.evaluate(() => {
    const c = (sel, p = 'backgroundColor') => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[p] : null; };
    return { lit: document.documentElement.classList.contains('m-lit'), page: c('.m-page'), card: c('.m-avs'), ticket: c('.m-hero'), ink: c('.m-hello h1', 'color'), book: c('.m-book', 'color'), bookBg: c('.m-book'), tabs: c('.m-tabs'), bars: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content + '@' + m.media) };
  });
  if (home.lit) throw new Error('dark: the page still carries the light-forcing mark');
  if (home.card !== 'rgb(23, 21, 19)') throw new Error('dark: a card of the home is ' + home.card);
  if (home.ticket !== 'rgb(34, 31, 28)') throw new Error('dark: the hero ticket is ' + home.ticket);
  if (home.ink !== 'rgb(236, 232, 224)') throw new Error('dark: the title is ' + home.ink);
  if (home.book !== 'rgb(15, 14, 13)' || home.bookBg !== 'rgb(235, 70, 57)') throw new Error('dark: the « Réserver » button is ' + home.book + ' on ' + home.bookBg);
  if (!/rgba\(23, 21, 19/.test(home.tabs)) throw new Error('dark: the tab bar is ' + home.tabs);
  if (home.bars.join(' ') !== '#ECE8E0@(prefers-color-scheme: light) #0F0E0D@(prefers-color-scheme: dark)') throw new Error('dark: the browser bar is ' + home.bars);
  for (const sel of ['a.m-book', '.m-hero .m-act', '.m-tabs a']) await focusRing(narrow, sel, 'dark: /moi home');
  await h.shot(narrow, 'moi-home-dark-320');
  // a sheet, the profile's fields and a switch are dark as well, and each field's border is the 3:1 grey
  await narrow.getByRole('button', { name: /Carnet/ }).first().click();
  await narrow.getByRole('dialog').waitFor();
  const dim = await narrow.getByRole('dialog').evaluate((e) => getComputedStyle(e).backgroundColor);
  if (dim !== 'rgb(15, 14, 13)') throw new Error('dark: the sheet is ' + dim);
  await h.shot(narrow, 'moi-sheet-dark-320');
  await narrow.keyboard.press('Escape');
  await narrow.goto(h.base + '/moi/profil');
  await narrow.locator('.mp-input').first().waitFor();
  const profileField = await narrow.locator('.mp-input').first().evaluate((e) => { const c = getComputedStyle(e); return c.backgroundColor + ' | ' + c.boxShadow; });
  if (!profileField.startsWith('rgb(31, 28, 25)') || !profileField.includes('rgb(122, 116, 108)')) throw new Error('dark: the profile field is ' + profileField);
  for (const sel of ['.mp-chip[aria-pressed="true"]', '.mp-chip[aria-pressed="false"]', '.mp-switch', '.lyr-sw']) await focusRing(narrow, sel, 'dark: /moi/profil');
  // the birthday's hint is the page's second ink, not the browser's grey (3.7:1 on the dark field); the loyalty switch sits in a card of its own
  await textContrast(narrow, '#mp-bday', 'dark: /moi/profil', { pseudo: '::placeholder' });
  if (!(await narrow.locator('.lyr-sw').evaluate((e) => !!e.closest('.c-card')))) throw new Error('dark: the loyalty switch sits on the bare page, outside a card');
  await h.shot(narrow, 'moi-profile-dark-320');
  // the pages reached by a link are dark too, and a printed receipt stays black on white whatever the phone says
  // (a cancelled visit staged among the real ones: the demo's client has none)
  await narrow.route('**/api/me/history**', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (body.items.length) body.items = [...body.items, { ...body.items[0], day: '2026-08-18', status: 'cancelled', receipt: null }];
    await route.fulfill({ response: res, json: body });
  });
  await narrow.goto(h.base + '/moi/historique');
  // a cancelled visit's date is dimmed with a colour of the page, not an opacity (4.2:1 on the light card): it reads as text
  await narrow.locator('.m-rows li.gone').first().waitFor();
  await textContrast(narrow, '.m-rows li.gone .m-rows-t b', 'dark: /moi/historique');
  const receipt = await narrow.locator('a.m-rec').first().getAttribute('href');
  await narrow.goto(receipt);
  await narrow.locator('.c-rec').waitFor();
  const onScreen = await narrow.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, card: getComputedStyle(document.querySelector('.c-rec')).backgroundColor, ink: getComputedStyle(document.querySelector('.c-rec h1')).color, bar: document.querySelector('meta[name="theme-color"][media*="dark"]').content }));
  if (onScreen.bg !== 'rgb(15, 14, 13)' || onScreen.card !== 'rgb(23, 21, 19)' || onScreen.ink !== 'rgb(236, 232, 224)') throw new Error('dark: the receipt is ' + JSON.stringify(onScreen));
  await narrow.emulateMedia({ colorScheme: 'dark', media: 'print' });
  const printed = await narrow.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.querySelector('.c-rec h1')).color }));
  if (printed.bg !== 'rgb(255, 255, 255)' || printed.ink !== 'rgb(15, 14, 13)') throw new Error('dark: the printed receipt is ' + JSON.stringify(printed));
  await narrow.emulateMedia({ colorScheme: 'light', media: 'screen' });
  // and light again with the phone: the same pages, the paper
  await narrow.goto(h.base + '/moi');
  await narrow.getByRole('heading', { name: /^Salut / }).waitFor({ timeout: 10000 });
  const lightHome = await narrow.evaluate(() => ({ page: getComputedStyle(document.body).backgroundColor, ticket: getComputedStyle(document.querySelector('.m-hero')).backgroundColor }));
  if (lightHome.page !== 'rgb(236, 232, 224)' || lightHome.ticket !== 'rgb(15, 14, 13)') throw new Error('light: the home is ' + JSON.stringify(lightHome));
  for (const sel of ['a.m-book', '.m-hero .m-act', '.m-tabs a']) await focusRing(narrow, sel, 'light: /moi home');
  await narrow.goto(h.base + '/moi/profil');
  await narrow.locator('.mp-chip').first().waitFor();
  for (const sel of ['.mp-chip[aria-pressed="true"]', '.mp-chip[aria-pressed="false"]', '.lyr-sw']) await focusRing(narrow, sel, 'light: /moi/profil');
  await textContrast(narrow, '#mp-bday', 'light: /moi/profil', { pseudo: '::placeholder' });
  await narrow.goto(h.base + '/moi/historique');
  await narrow.locator('.m-rows li.gone').first().waitFor();
  await textContrast(narrow, '.m-rows li.gone .m-rows-t b', 'light: /moi/historique');
  await narrow.unroute('**/api/me/history**');

  /* ---------- what the page's own rule does not reach, on a phone's default look (a mobile-emulated light context) ---------- */
  // the loyalty sheet is drawn outside the page (a portal in the body) and /r/ is a page of its own: neither may fall back on the browser's ring,
  // which on Android is thin and amber (2.2:1 on the card in the light theme)
  const phone = await h.newPage({ viewport: { width: 390, height: 844 }, mobile: true });
  await phone.emulateMedia({ colorScheme: 'light' });
  await phone.goto(manage);
  await phone.getByRole('link', { name: 'Ouvrir mon espace' }).waitFor({ timeout: 8000 });
  for (const sel of ['a.c-brand', '.c-espace a.c-btn', '.c-foot a']) await focusRing(phone, sel, 'light, phone: /r/');
  await phone.goto(h.base + '/moi');
  await phone.getByRole('button', { name: 'Essayer avec un client de démo' }).click();
  await phone.getByRole('heading', { name: /^Salut / }).waitFor({ timeout: 10000 });
  await phone.locator('.lyr').click();
  await phone.locator('.lyr-sheet').waitFor();
  for (const sel of ['.lyr-sheet .lyr-btn.ghost', '.lyr-sheet summary', '.lyr-sheet .lyr-close']) await focusRing(phone, sel, 'light, phone: the loyalty sheet');
  await h.shot(phone, 'moi-loyalty-sheet-light-390');
};
