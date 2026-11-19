// AC-01 by e-mail · A salon that asks an address and not a number (Réglages › Réservation: contact 'email'), on a phone:
// « Créer mon compte » in the site's Sommaire and footer, /moi?creer (a first name, an address, the code: the demo shows
// the code of a visitor's own fresh account on the page, no mail leaves), the space that opens, the sign-in that asks an
// address and promises an e-mail, and the Formule's account step by e-mail down to the five dates paid.
// Also what the live salon needs while it sells no monthly membership: the chapter « La formule » alone (never the
// plans), every chapter still on the page, « Déjà un rendez-vous ? » near the booking area, and in /moi the appointment
// booked with that address, cancelled from there.
export const name = 'espace client par e-mail: créer mon compte (menu, pied de page, /moi), connexion, compte de la Formule';
export const viewport = { width: 430, height: 932 };

const T = 10000;
const MAIL = 'nadia.e2e@exemple.fr';
const MAIL2 = 'karim.e2e@exemple.fr';

export default async ({ h, page }) => {
  await h.setup();
  const set = await h.api('/api/v1/settings', { method: 'PATCH', body: { booking: { contact: 'email', cancelUntilHours: 0 }, accounts: { enabled: true }, membership: { enabled: false } } });
  if (!set.ok) throw new Error('settings: ' + set.text);
  const acc = (await h.api('/api/public/account', { session: false })).json;
  if (!acc.enabled || acc.contact !== 'email') throw new Error('the space does not say it signs in by e-mail: ' + JSON.stringify(acc));

  /* ---------- the site: the entries ---------- */
  await page.goto(h.base + '/');
  const foot = page.locator('.ft-links a[href="/moi?creer"]');
  await foot.waitFor({ state: 'attached', timeout: T });
  if ((await foot.innerText()).trim() !== 'Créer mon compte') throw new Error('the footer does not offer « Créer mon compte »');
  if (!(await page.locator('.ft-links a[href="/moi"]').count())) throw new Error('the footer lost « Mon espace »');
  // every chapter is on the page, and the membership's is the formule's alone: its card and its button, no plan to subscribe to
  const chapters = await page.evaluate(() => [...document.querySelectorAll('section[id], footer[id]')].filter((e) => e.getBoundingClientRect().height > 100).map((e) => e.id));
  if (chapters.join(' ') !== 'frais barbiers reserver preuve coupes carte abonnement questions venir') throw new Error('the chapters on the page: ' + chapters.join(' '));
  const chap = page.locator('#abonnement');
  await chap.getByRole('button', { name: 'Prendre la formule' }).waitFor({ state: 'attached', timeout: T });
  const chapText = (await chap.innerText()).replace(/\s+/g, ' ');
  if (!/La formule/i.test(chapText) || !/Formule Entretien 5 semaines/.test(chapText) || !/80\s€/.test(chapText)) throw new Error('the formule is not offered in its chapter: ' + chapText);
  if (/abonne|par mois|\/mois|Résilier/i.test(chapText)) throw new Error('the chapter speaks of a membership the salon does not sell: ' + chapText);
  // near the booking area and in the footer: the way to an appointment already taken is the space (no number to look it up with)
  const mine = page.locator('#reserver .now-me a[href="/moi"]');
  await mine.waitFor({ state: 'attached', timeout: T });
  if (!/annuler/.test(await mine.innerText())) throw new Error('« Déjà un rendez-vous ? » does not say it can be cancelled');
  if ((await page.locator('.ft-links a[data-guide="site.rdv"]').getAttribute('href')) !== '/moi') throw new Error('the footer’s « Mon rendez-vous » still asks a number');
  await page.locator('.tb-menu, button[aria-controls="menu"]').first().click();
  const join = page.locator('#menu a.mn-join');
  await join.waitFor({ timeout: T });
  await page.locator('#menu a.mn-me').getByText('Tes rendez-vous et tes reçus').waitFor({ timeout: T });
  await page.locator('#menu').getByText('La formule', { exact: true }).waitFor({ timeout: T });
  const box = await join.boundingBox();
  if (!box || box.height < 44) throw new Error('« Créer mon compte » is under 44 px in the Sommaire');
  if ((await page.evaluate(() => document.scrollingElement.scrollWidth)) > 430) throw new Error('the page scrolls sideways');
  await h.shot(page, 'espace-email-menu-430');
  await join.click();

  /* ---------- /moi?creer ---------- */
  await page.waitForURL(/\/moi\?creer/, { timeout: T });
  await page.getByRole('heading', { name: 'Crée ton compte' }).waitFor({ timeout: T });
  if (await page.locator('#m-phone').count()) throw new Error('the page asks a number in e-mail mode');
  const said = (await page.locator('.ms').innerText()).replace(/[  ]/g, ' ');
  if (/SMS/.test(said)) throw new Error('the page promises an SMS in e-mail mode: ' + (said.match(/.{0,40}SMS.{0,40}/) || [''])[0]);
  await h.shot(page, 'espace-email-creer-430');
  // nothing typed, then an address that is not one: said under the fields
  await page.getByRole('button', { name: 'Recevoir mon code par e-mail' }).click();
  await h.expectText(page, 'Écris ton prénom.');
  await page.fill('#m-join', 'Nadia');
  await page.fill('#m-email', 'nadia@');
  await page.getByRole('button', { name: 'Recevoir mon code par e-mail' }).click();
  await h.expectText(page, 'Vérifie ton adresse');
  await page.fill('#m-email', MAIL);
  // (the code is checked about a second after it shows: wait for that answer, not for a word of the page)
  const verified = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/public/account/verify' && r.status() === 200, { timeout: T });
  await page.getByRole('button', { name: 'Recevoir mon code par e-mail' }).click();
  await page.getByText('Le code reçu par e-mail').waitFor({ timeout: T });
  await h.expectText(page, 'Un code arrive par e-mail à ' + MAIL);
  // the demo sends no mail: the code of this visitor's own fresh account shows, then goes in; no name is asked again
  await page.getByText('Code reçu', { exact: true }).waitFor({ timeout: T });
  if (!(await (await verified).json()).ok) throw new Error('the code shown by the demo did not open the space');
  await h.expectText(page, 'Salut Nadia', T);
  await h.expectText(page, 'Ton espace est ouvert', T);
  await h.shot(page, 'espace-email-ouvert-430');
  const me = await page.evaluate(async () => (await fetch('/api/me')).json());
  if (me.first !== 'Nadia' || me.via !== 'email') throw new Error('the session is not the new account’s: ' + JSON.stringify(me));
  // the salon has one file for that address, without a number
  const cl = await h.api('/api/v1/clients?q=Nadia&limit=200');
  const files = (cl.json.items || []).filter((c) => c.first === 'Nadia' && c.hasEmail && !c.hasPhone);
  if (files.length !== 1) throw new Error(files.length + ' file(s) for the new account');

  /* ---------- her appointment, booked on the site with that address: seen in the space, cancelled from it ---------- */
  const booked = await page.evaluate(async (email) => {
    const sal = await (await fetch('/api/public/salon')).json();
    const sv = sal.services.find((x) => !x.pack && x.dur === 30);
    const av = await (await fetch('/api/public/availability?services=' + sv.id + '&from=' + sal.today + '&days=14')).json();
    for (const d of av.days.slice(2)) for (const x of d.slots.slice(0, 4)) {
      const r = await fetch('/api/public/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceIds: [sv.id], staffId: x.s, day: d.day, start: x.m, first: 'Nadia', email }) });
      if (r.status === 201) return (await r.json()).code;
    }
    return null;
  }, MAIL);
  if (!booked) throw new Error('no booking could be made with the address');
  await page.goto(h.base + '/moi');
  await h.expectText(page, booked, T);
  await page.getByRole('button', { name: 'Annuler' }).first().click();
  await h.shot(page, 'espace-email-annuler-430');
  await page.getByRole('button', { name: 'Oui, annuler' }).click();
  await h.expectText(page, 'C’est annulé', T);
  const left = await page.evaluate(async () => (await (await fetch('/api/me/home')).json()).upcoming.length);
  if (left !== 0) throw new Error('the appointment is still there after « Oui, annuler »');

  /* ---------- signed out: the sign-in asks the address ---------- */
  await page.evaluate(async () => { await fetch('/api/me/signout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); });
  await page.goto(h.base + '/moi');
  await page.getByRole('heading', { name: 'Ouvre ton espace' }).waitFor({ timeout: T });
  await page.getByText('Pas encore de compte ?').first().waitFor({ timeout: T });
  await page.getByRole('button', { name: 'Créer mon compte' }).waitFor({ timeout: T });
  await page.fill('#m-email', MAIL);
  await h.shot(page, 'espace-email-connexion-430');
  await page.getByRole('button', { name: 'Recevoir mon code par e-mail' }).click();
  await h.expectText(page, 'Si cette adresse est connue du salon, un code arrive par e-mail à ' + MAIL);
  await page.getByText('Le code reçu par e-mail').waitFor({ timeout: T });
  await page.getByRole('button', { name: 'Changer d’adresse' }).waitFor({ timeout: T });
  if ((await page.evaluate(() => document.scrollingElement.scrollWidth)) > 430) throw new Error('/moi scrolls sideways');
  await h.shot(page, 'espace-email-code-430');
  // a wrong code says so (the mail never left in the demo: nobody can guess it); its 400 is the one console line expected
  page.expect.push(/status of 400/);
  await page.locator('#m-code').fill('000000');
  await h.expectText(page, 'Ce code n’est pas le bon, ou il a expiré.', T);

  /* ---------- the Formule: the account it asks for, by e-mail ---------- */
  // taken from its chapter: « Prendre la formule » opens the booking on it
  await page.goto(h.base + '/');
  const take = page.locator('#abonnement').getByRole('button', { name: 'Prendre la formule' });
  await take.waitFor({ state: 'attached', timeout: T });
  await take.scrollIntoViewIfNeeded();
  await take.click();
  await h.expectText(page, 'Formule Entretien 5 semaines');
  await page.locator('.bk button.wh:not(.any)').first().click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.dstrip .dc:not(.full):not(.dc-more)').nth(3).click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.bk button.sl').first().click();
  await h.expectText(page, 'Tes 4 autres rendez-vous');
  await page.locator('.ser-r').nth(3).waitFor({ timeout: T });
  await page.locator('.bk-foot .btn').click();
  await h.expectText(page, 'Cette formule demande un compte');
  await h.expectText(page, 'Ton prénom et ton e-mail : tu reçois un code par e-mail, sans mot de passe.');
  await page.fill('#f-first', 'Karim');
  await page.fill('#f-email', MAIL2);
  await page.locator('.acc').scrollIntoViewIfNeeded();
  await h.shot(page, 'espace-email-formule-compte-430');
  await page.getByRole('button', { name: 'Recevoir mon code par e-mail' }).click();
  await page.locator('#f-code').waitFor({ timeout: T });
  await page.locator('label[for="f-code"]', { hasText: 'Code reçu par e-mail' }).waitFor({ timeout: T });
  await h.expectText(page, 'Tape le code reçu par e-mail à ' + MAIL2);
  await page.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#f-code').value), null, { timeout: T });
  await page.getByRole('button', { name: 'Valider mon code' }).click();
  await h.expectText(page, 'Connecté à ton espace, Karim');
  if ((await page.locator('.ser-list .pty-r').count()) !== 5) throw new Error('the five dates were lost while the code was typed');
  const cta = page.locator('.bk-foot .btn');
  if (!/Confirmer et régler 80\s€/.test(await cta.textContent())) throw new Error('the button says « ' + (await cta.textContent()) + ' »');
  await cta.click();
  await h.expectText(page, 'Presque réservé, Karim');
  await page.locator('.pay-b .btn').click();
  await page.locator('.c-pay .c-btn').click();
  await page.waitForURL(/\/r\//, { timeout: T });
  await h.expectText(page, 'Confirmé', 12000);
  await h.expectText(page, 'visite 1 sur 5');
  await page.goto(h.base + '/moi');
  await h.expectText(page, 'Formule Entretien 5 semaines');
};
