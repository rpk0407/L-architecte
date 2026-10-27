// AC-02 · What the salon sees of a client's space: the « Espace client » card of the client file (closed at first, a header
// that says what is true, then the lines and the actions), the invite that texts the way in, and Réglages › Réservation's
// switch with its figure. On a phone too: no sideways scroll.
export const name = 'espace client: the card in the client file, the invite, the Réglages switch';

const PHONE = { width: 390, height: 844 };

export default async ({ h, page, ctx }) => {
  await h.setup();
  await h.loginOwner(page);
  // the demo's persona has a space; a file made now has none
  const persona = await h.api('/api/public/account/demo', { body: {}, session: true });
  if (!persona.ok) throw new Error('no demo persona: ' + persona.text);
  const first = (await h.api('/api/me')).json.first;
  // two clients may share his first name: the one the salon sees a space on
  let hit = null;
  for (const c of (await h.api('/api/v1/clients?q=' + encodeURIComponent(first))).json.items) if (!hit && (await h.api('/api/v1/clients/' + c.id + '/account')).json.has) hit = c;
  if (!hit) throw new Error('no client with a space for ' + first);
  const plain = await h.api('/api/v1/clients', { body: { first: 'Sofiane', last: 'Test', phone: '0677889900' } });
  if (!plain.ok) throw new Error('client not created: ' + plain.text);

  // the file of a client with a space: closed at first, « Ouvert » says what is true
  await page.goto(h.base + '/comptoir/clients/' + hit.id);
  const head = page.getByRole('button', { name: /Espace client/ });
  await head.waitFor({ timeout: 8000 });
  if ((await head.getAttribute('aria-expanded')) !== 'false') throw new Error('the card starts open');
  await h.expectText(page, 'Ouvert');
  if (await page.getByText('Ouvert le').count()) throw new Error('the details show while the card is closed');
  await head.click();
  await h.expectText(page, 'Ouvert le');
  await h.expectText(page, 'connexion');
  await page.getByRole('button', { name: 'Déconnecter ses appareils' }).waitFor();
  await page.getByRole('button', { name: /Détacher ce numéro/ }).waitFor();
  await h.shot(page, 'client-account-open');

  // the invite: one tap, the way it is said
  await page.getByRole('button', { name: 'Envoyer le lien de son espace' }).click();
  await h.expectText(page, 'Envoyé · 3 liens au plus par jour');
  const sent = (await h.api('/api/v1/clients/' + hit.id)).json.messages.filter((m) => m.template === 'accesInvite');
  if (sent.length !== 1) throw new Error('one invite expected, got ' + sent.length);

  // signing his devices out asks first, and says what happens
  await page.getByRole('button', { name: 'Déconnecter ses appareils' }).click();
  await h.expectText(page, 'Son espace se ferme sur tous ses téléphones');
  await page.getByRole('button', { name: 'Annuler' }).click();

  // a client with no space: said in a faint line, only the invite to offer
  await page.goto(h.base + '/comptoir/clients/' + plain.json.id);
  await h.expectText(page, 'Pas d’espace client');
  await page.getByRole('button', { name: /Espace client/ }).click();
  await page.getByRole('button', { name: 'Envoyer le lien de son espace' }).waitFor();
  if (await page.getByRole('button', { name: 'Déconnecter ses appareils' }).count()) throw new Error('sign-out offered on a client with no space');

  // Réglages › Réservation: the switch, its sentence, the figure
  await page.goto(h.base + '/comptoir/reglages/reservation');
  const sw = page.getByRole('switch', { name: /Espace client sur le site/ });
  await sw.waitFor({ timeout: 8000 });
  if ((await sw.getAttribute('aria-checked')) !== 'true') throw new Error('the space is not open in the demo');
  await h.expectText(page, 'Un compte se crée en un geste après la première réservation, ou depuis la fiche au salon');
  await h.expectText(page, 'a un espace');
  await sw.click();
  await h.expectText(page, 'Espace client fermé');
  await page.waitForFunction(() => document.querySelector('[role=switch][aria-checked=false]'));
  await sw.click();
  await h.expectText(page, 'Espace client ouvert');
  await h.shot(page, 'reglages-espace-client');

  // a phone: the same, without a sideways scroll
  const phone = await h.newPage({ viewport: PHONE });
  await h.loginOwner(phone);
  await phone.goto(h.base + '/comptoir/clients/' + hit.id);
  await phone.getByRole('button', { name: /Espace client/ }).click();
  await h.expectText(phone, 'Ouvert le');
  if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('sideways scroll on the phone');
  await h.shot(phone, 'client-account-phone');
};
