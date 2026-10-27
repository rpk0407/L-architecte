// A barber who opens an owner page by its address gets a read-only view or a clear refusal, never an edit screen
// or a blank page, and no refused API call along the way (a 403 in the console fails the scenario). The desk tablet
// (TEAM-01): Inès sees the salon's counts and fill on the agenda, never an amount, and no refused call either.
export const name = 'a barber on owner pages: read-only or “Réservé au gérant”';

const PHONE = { width: 390, height: 844 };

/** JKut on a demo salon post (the demo enrolls the browser as a post, then the team keypad). */
async function barber(page, base, who = 'JKut', pin = '2468') {
  await page.goto(base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: who }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type(pin);
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
}
const title = async (page, text) => {
  await page.locator('#page-title h1', { hasText: text }).waitFor({ timeout: 8000 }).catch(() => { throw new Error('page title "' + text + '" not shown'); });
};
const none = async (page, what, where) => {
  const n = await page.getByText(what).locator('visible=true').count();
  if (n) throw new Error(where + ': "' + what + '" is shown to a barber');
};
const reserved = async (page, h, path) => {
  await page.goto(h.base + path);
  try { await h.expectText(page, 'Réservé au gérant'); } catch { throw new Error(path + ': "Réservé au gérant" not shown'); }
  await h.expectText(page, 'Demande-lui si tu as besoin de modifier ça.');
};

export default async ({ h, page }) => {
  await barber(page, h.base);

  // Catalogue: the prices and durations, nothing to edit
  await page.goto(h.base + '/comptoir/catalogue');
  await title(page, 'Catalogue');
  await h.expectText(page, 'Coupe classique');
  const prices = await page.locator('.ct-price').allTextContents();
  if (prices.length < 3 || !prices.every((p) => /\d+\s*€/.test(p))) throw new Error('the price list is not shown: ' + JSON.stringify(prices));
  if (!(await page.getByText(/\d+\s*min/).count())) throw new Error('the durations are not shown');
  await none(page, 'Nouvelle prestation', '/catalogue');
  if (await page.getByRole('button', { name: /Monter|Descendre/ }).count()) throw new Error('/catalogue: the order arrows are shown to a barber');
  await page.locator('.card .li').first().click();
  await page.waitForTimeout(300);
  if (await page.getByRole('dialog').count()) throw new Error('/catalogue: a click opens an edit sheet');
  await h.shot(page, 'barber-catalogue');

  await page.goto(h.base + '/comptoir/catalogue/produits');
  await page.locator('.ct-price').first().waitFor({ timeout: 8000 });
  for (const t of ['Nouveau produit', 'Inventaire', 'Valeur du stock']) await none(page, t, '/catalogue/produits');

  // Équipe: only my own card, schedule and absences
  await page.goto(h.base + '/comptoir/equipe');
  await title(page, 'Ma fiche');
  await h.expectText(page, 'Mes horaires');
  await h.expectText(page, 'Mes absences');
  await h.expectText(page, 'JKut');
  for (const t of ['Frank', 'Esteban', 'Le Soldat', 'Rémunération', 'Ajouter']) await none(page, t, '/equipe');
  await h.shot(page, 'barber-equipe');
  // someone else's card by its address: still mine
  await page.goto(h.base + '/comptoir/equipe/whoever');
  await title(page, 'Ma fiche');

  // owner pages: a clear refusal
  for (const path of ['/comptoir/reglages/salon', '/comptoir/reglages/messages', '/comptoir/reglages/donnees', '/comptoir/catalogue/cartes']) await reserved(page, h, path);
  await h.shot(page, 'barber-reserved');
  // Relances refuses its tabs itself: the waitlist stays open to a barber, the rest is the desk's
  await page.goto(h.base + '/comptoir/relances');
  await h.expectText(page, 'Réservé à l’accueil et au gérant');
  await page.goto(h.base + '/comptoir/relances/attente');
  await h.expectText(page, 'personnes sur la liste');
  // an address naming an Object.prototype key is just an unknown page, not a blank screen
  for (const path of ['/comptoir/constructor', '/comptoir/toString']) {
    await page.goto(h.base + path);
    await title(page, /Aujourd’hui|Agenda/);
  }
  // the refusal leads back to my own settings, which open
  await page.goto(h.base + '/comptoir/reglages/salon');
  await page.getByRole('link', { name: 'Mon compte' }).last().click();
  await h.expectText(page, 'Mes absences');
  if (!page.url().endsWith('/comptoir/reglages/compte')) throw new Error('“Mon compte” leads to ' + page.url());
  await none(page, 'Réservé au gérant', '/reglages/compte');

  // phone: the account menu leads to my own account, for a barber and for the owner
  const phone = await h.newPage({ viewport: PHONE });
  await barber(phone, h.base);
  await phone.getByRole('button', { name: 'Mon compte' }).last().click();
  await phone.getByRole('button', { name: 'Mon mot de passe et mon code' }).click();
  await phone.waitForURL(/\/comptoir\/reglages\/compte$/, { timeout: 8000 });
  await h.expectText(phone, 'Mes absences');
  await none(phone, 'Réservé au gérant', 'phone /reglages/compte');
  await h.shot(phone, 'barber-account-phone');
  await phone.goto(h.base + '/comptoir/reglages/salon');
  await h.expectText(phone, 'Réservé au gérant');
  if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the refusal scrolls sideways on a phone');
  await h.shot(phone, 'barber-reserved-phone');
  await phone.goto(h.base + '/comptoir/equipe');
  await h.expectText(phone, 'Mes horaires');
  if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('“Ma fiche” scrolls sideways on a phone');

  const owner = await h.newPage({ viewport: PHONE });
  await h.loginOwner(owner);
  await owner.getByRole('button', { name: 'Mon compte' }).last().click();
  await owner.getByRole('button', { name: 'Mon mot de passe et mon code' }).click();
  await owner.waitForURL(/\/comptoir\/reglages\/compte$/, { timeout: 8000 });
  await h.expectText(owner, 'Code PIN');
  // the owner still gets the full screens
  await owner.goto(h.base + '/comptoir/catalogue');
  await h.expectText(owner, 'Nouvelle prestation');
  await owner.goto(h.base + '/comptoir/reglages/salon');
  await h.expectText(owner, 'Coordonnées');
  await owner.goto(h.base + '/comptoir/reglages/constructor');
  await h.expectText(owner, 'Coordonnées');
  await none(owner, 'Réservé au gérant', 'owner /reglages/constructor');

  // JKut's agenda: his own figures, without the salon's month goal or warnings (bootstrap), and no refused call
  await page.goto(h.base + '/comptoir');
  await page.getByRole('region', { name: 'La journée en chiffres' }).getByText('Mon chiffre').waitFor({ timeout: 8000 });
  if (!(await page.getByRole('link', { name: 'Mes chiffres' }).count())) throw new Error('JKut: his « Mes chiffres » tab is missing');

  // the desk tablet, portrait: the whole salon's day in counts, never in euros
  const tablet = await h.newPage({ viewport: { width: 1024, height: 1366 } });
  await barber(tablet, h.base, 'Inès', '1470');
  await tablet.goto(h.base + '/comptoir');
  const kpis = tablet.getByRole('region', { name: 'La journée en chiffres' });
  await kpis.getByText('Remplissage salon').waitFor({ timeout: 8000 });
  for (const t of ['Rendez-vous', 'À encaisser']) if (!(await kpis.getByText(t, { exact: true }).count())) throw new Error('desk agenda: KPI "' + t + '" missing');
  await tablet.waitForTimeout(300);
  const words = await kpis.innerText();
  if (/€/.test(words)) throw new Error('desk agenda: an amount is shown: ' + JSON.stringify(words));
  for (const t of ['Mon chiffre', 'Encaissé', 'Mes rendez-vous']) if (await kpis.getByText(t, { exact: true }).count()) throw new Error('desk agenda: "' + t + '" is shown');
  await h.shot(tablet, 'desk-agenda');
  // no page of zeros: the desk has no figures of its own, so no « Mes chiffres » tab
  if (await tablet.getByRole('link', { name: 'Mes chiffres' }).count()) throw new Error('desk: a « Mes chiffres » tab is shown');
  // her other pages open without a refused call
  for (const path of ['/comptoir/caisse', '/comptoir/clients', '/comptoir/relances']) { await tablet.goto(h.base + path); await tablet.locator('#page-title h1').waitFor({ timeout: 8000 }); }
};
