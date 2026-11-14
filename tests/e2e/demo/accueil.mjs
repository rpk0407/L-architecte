// WP5: the Accueil, the page every role opens on (/comptoir alone). The owner lands on it with the sentence of the moment,
// « Prochain », every chair and at least one card to deal with; a barber on a salon device (his code) sees his own chair
// only and no amount in euros; the front desk sees no amount either; « Prendre un passage » opens the walk-in sheet when a
// chair has room (the suite makes room by cancelling the next appointments of one chair, as the Agenda would).
export const name = 'Accueil: every role opens on it, the sentence, Prochain, the chairs, the cards, no amount for a barber or the desk, a walk-in';

const must = (ok, what) => { if (!ok) throw new Error(what); };

/** A person on the demo salon post, by his code (the demo enrolls the browser as a post, then the team keypad). */
async function pin(page, base, who, code) {
  await page.goto(base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: who }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
}
const onAccueil = async (page, who) => {
  await page.getByRole('heading', { name: 'Accueil', level: 1 }).waitFor({ timeout: 10000 });
  must(/\/comptoir\/accueil$/.test(page.url()), who + ' does not land on /comptoir/accueil: ' + page.url());
  await page.locator('.hm-head').waitFor({ timeout: 8000 });
  await page.locator('.hm-chair').first().waitFor({ timeout: 8000 });
};
const noEuro = async (page, who) => {
  await page.waitForTimeout(300);
  const text = await page.locator('.hm').innerText();
  must(!/€/.test(text), who + ': an amount in euros is shown on the Accueil: ' + JSON.stringify(text.match(/.{0,30}€.{0,10}/)?.[0]));
};

export default async ({ h, page }) => {
  // the owner: the sentence, « Prochain », the chairs, a card
  await h.loginOwner(page);
  await onAccueil(page, 'the owner');
  const head = (await page.locator('.hm-head').innerText()).replace(/\s+/g, ' ');
  must(/Mardi 27 octobre/.test(head) && /ouvert jusqu’à 18 h 30/.test(head), 'the sentence of the moment is missing: ' + JSON.stringify(head));
  must(await page.locator('.hm-facts > div').count() >= 1, 'the sentence has no figure');
  await page.getByRole('heading', { name: 'Prochain', exact: true }).waitFor();
  must(await page.locator('.hm-next').count() === 1, 'no next client under « Prochain »');
  await page.getByRole('heading', { name: 'Fauteuils', exact: true }).waitFor();
  const chairs = await page.locator('.hm-chair').allInnerTexts();
  must(chairs.length === 4, 'the owner should see the four chairs: ' + JSON.stringify(chairs));
  for (const n of ['JKut', 'Frank', 'Le Soldat', 'Esteban']) must(chairs.some((c) => c.includes(n)), n + '’s chair is not listed: ' + JSON.stringify(chairs));
  must(await page.locator('.hm-card').count() >= 1, 'no card under « À traiter »');
  await h.shot(page, 'accueil-owner');

  // make room: JKut is free for 20 minutes only, his next appointments hold the chair; cancel them until a walk-in fits
  await h.setup();
  const home = async () => (await h.api('/api/v1/home')).json;
  const jk = (await home()).day.chairs.find((c) => c.name === 'JKut');
  for (let i = 0; i < 6; i++) {
    const cur = await home();
    if (cur.day.chairs.find((c) => c.staffId === jk.staffId).canTake.length) break;
    const a = cur.day.appts.find((x) => x.staffId === jk.staffId && x.status === 'booked');
    must(a, 'JKut’s chair cannot be freed');
    const r = await h.api('/api/v1/appointments/' + a.id + '/cancel', { body: {} });
    must(r.ok, 'cancel failed: ' + r.status + ' ' + r.text);
  }
  must((await home()).day.chairs.find((c) => c.staffId === jk.staffId).canTake.length, 'no chair has room for a walk-in');
  await page.reload();
  await onAccueil(page, 'the owner');
  await page.getByRole('button', { name: 'Prendre un passage chez JKut' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByText('Un passage', { exact: true }).first().waitFor({ timeout: 8000 });
  await sheet.getByRole('button', { name: 'Ajouter à la file' }).waitFor();
  must(/\/comptoir\/accueil$/.test(page.url()), '« Prendre un passage » left the Accueil: ' + page.url());
  await h.shot(page, 'accueil-walkin');
  await page.keyboard.press('Escape');

  // a barber (his code on the salon device): only his own chair, no euro
  const barber = await h.newPage();
  await pin(barber, h.base, 'JKut', '2468');
  await onAccueil(barber, 'JKut');
  await barber.getByRole('heading', { name: 'Mon fauteuil', exact: true }).waitFor();
  const mine = await barber.locator('.hm-chair').allInnerTexts();
  must(mine.length === 1 && mine[0].includes('JKut'), 'a barber should see his own chair only: ' + JSON.stringify(mine));
  for (const n of ['Frank', 'Le Soldat', 'Esteban']) must(!(await barber.locator('.hm-chair').getByText(n).count()), n + '’s chair is shown to JKut');
  await noEuro(barber, 'JKut');
  await h.shot(barber, 'accueil-barber');

  // the front desk: no amount in euros
  const desk = await h.newPage();
  await pin(desk, h.base, 'Inès', '1470');
  await onAccueil(desk, 'the desk');
  await noEuro(desk, 'the desk');
  await h.shot(desk, 'accueil-desk');
};
