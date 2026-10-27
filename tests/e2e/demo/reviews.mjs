// Google reviews (REV-02) on the demo salon: Rapports › Avis Google shows the requests sent and the links opened, by barber,
// on a desktop and on a phone; Réglages › Messages › Avis Google sends the owner a test whose tracked link records one
// opening and goes on to Google; the client file says « Avis Google demandé le … · ouvert ».
export const name = 'Google reviews: the Rapports card, the test from Réglages, the tracked link, the client file';

const PHONE = { width: 390, height: 844 };

export default async ({ h, page }) => {
  await h.setup();
  await h.loginOwner(page);

  /* the figures, desktop then phone */
  await page.goto(h.base + '/comptoir/rapports');
  const card = page.locator('.av-card');
  await card.getByText('demandes envoyées').waitFor({ timeout: 10000 });
  const figs = await card.locator('.av-figs b').allTextContents();
  const [sent, opened] = figs.map(Number);
  if (!(sent > 0 && opened > 0 && opened < sent)) throw new Error('the card should show requests sent and some opened: ' + figs.join(' / '));
  if ((await card.locator('.av-staff li').count()) < 2) throw new Error('the card should list the barbers');
  await card.scrollIntoViewIfNeeded();
  await h.shot(page, 'avis-rapports');
  const phone = await h.newPage({ viewport: PHONE });
  await h.loginOwner(phone);
  await phone.goto(h.base + '/comptoir/rapports');
  const pcard = phone.locator('.av-card');
  await pcard.getByText('demandes envoyées').waitFor({ timeout: 10000 });
  await pcard.scrollIntoViewIfNeeded();
  const box = await pcard.boundingBox();
  if (!box || box.x < 0 || box.x + box.width > PHONE.width) throw new Error('the card overflows the phone: ' + JSON.stringify(box));
  await h.shot(phone, 'avis-rapports-phone');

  /* the owner's test, from Réglages › Messages */
  await page.goto(h.base + '/comptoir/reglages/messages');
  const av = page.locator('section.card', { has: page.getByRole('heading', { name: 'Avis Google' }) });
  await av.waitFor();
  await h.expectText(page, 'Ouvre le formulaire d’avis de ta fiche');
  await av.getByLabel('Ton portable, pour le test').fill('06 12 34 56 78');
  await av.getByRole('button', { name: 'Envoyer un test' }).click();
  await h.expectText(page, 'SMS de test simulé vers');
  await h.shot(page, 'avis-reglages');

  /* its link: one opening recorded, then Google; a forged one goes to Google too */
  const google = (await h.api('/api/v1/bootstrap')).json.settings.shop.reviewUrl;
  const msgs = (await h.api('/api/v1/messages?limit=50')).json.items;
  const test = msgs.find((m) => m.template === 'review' && m.id.startsWith('msg_revtest_'));
  const token = test && /\/avis\/(\S+)$/.exec(test.body)?.[1];
  if (!token) throw new Error('no tracked link in the test: ' + (test && test.body));
  const r = await h.api('/avis/' + token, { session: false });
  if (r.status !== 302 || r.location !== google) throw new Error('/avis should redirect to Google: ' + r.status + ' ' + r.location);
  if (!/noindex/.test(r.headers.get('x-robots-tag') || '')) throw new Error('/avis must not be indexed');
  const forged = await h.api('/avis/' + token.slice(0, -2) + 'xx', { session: false });
  if (forged.status !== 302 || forged.location !== google) throw new Error('a forged token still goes to Google: ' + forged.status);

  /* a client file with an opened request */
  const list = (await h.api('/api/v1/clients?limit=60')).json.items;
  let cid = null;
  for (const c of list) { const x = (await h.api('/api/v1/reviews/client/' + c.id)).json; if (x.last && x.last.opened) { cid = c.id; break; } }
  if (!cid) throw new Error('no demo client with an opened request');
  await page.goto(h.base + '/comptoir/clients/' + cid);
  await page.locator('.cl-review').getByText('ouvert').waitFor();
  await h.expectText(page, 'Avis Google demandé le');
};
