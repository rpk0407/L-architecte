// PAY-04 · The membership from the client's side, on the demo: « Je m'abonne » on the site → the test checkout → the
// member page « 0/2 coupes ce mois-ci »; « Réserver ma coupe » books a covered cut with no deposit; the cancellation in
// at most 3 taps from the member page, from /resilier by number, by e-mail only, and without either (the fallback);
// a second member renounces on day 1 and sees his refund. Every screen: no sideways scroll at 390 px, final buttons
// at least 44 px high, roles found by name.
export const name = 'membership: subscribe, member page, covered cut, cancel in 3 taps (link, /resilier by number, by e-mail, fallback), renounce';
export const viewport = { width: 390, height: 844 };

const PHONE = { width: 390, height: 844 }, DESKTOP = { width: 1440, height: 900 };

export default async ({ h, page }) => {
  await h.setup();
  // deposits on every online booking, so « no deposit » means the membership
  const set = await h.api('/api/v1/settings', { method: 'PATCH', body: { deposits: { mode: 'all', percent: 30 } }, headers: { 'x-request-id': 'e2e-pay04-deposits' } });
  if (!set.ok) throw new Error('settings: ' + set.text);

  const narrow = async (p, where) => {
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (wide) throw new Error(where + ': the page scrolls sideways on a phone');
  };
  const tall = async (loc, what) => {
    const box = await loc.boundingBox();
    if (!box || box.height < 44) throw new Error(what + ' is under 44 px high (' + (box && box.height) + ')');
  };
  const messages = async () => (await h.api('/api/v1/messages?limit=300')).json.items;
  const linkIn = (body) => { const m = /(\/abo\/[^\s"]+)/.exec(body || ''); return m ? m[1] : null; };

  /** One visitor (his own browser: his own demo identity) subscribes to a plan and lands on his member page. */
  let k = 0;
  async function subscribe(p, plan = 'Essentiel') {
    k++;
    const email = 'e2e+' + k + '-' + Date.now().toString(36) + '@exemple.fr';
    await p.goto(h.base + '/');
    await p.locator('#abonnement').waitFor({ timeout: 15000 });
    const go = p.getByRole('button', { name: new RegExp('formule ' + plan) });
    await tall(go, '« Je m’abonne »');
    await go.click();
    const sheet = p.getByRole('dialog', { name: 'Je m’abonne' });
    await sheet.waitFor();
    // the demo hands an identity of its own, under its warning
    await h.expectText(p, 'Démo : n’entre pas tes vraies coordonnées, tout est visible.');
    if (!(await p.locator('#a-phone').inputValue()).startsWith('06 00 00')) throw new Error('no demo identity in the subscribe sheet');
    await p.getByLabel('E-mail').fill(email);
    const box = p.getByRole('checkbox', { name: /Commencer tout de suite/ });
    if (await box.isChecked()) throw new Error('the express request must start unticked');
    await h.expectText(p, 'Ton abonnement démarre le');
    await box.check();
    await h.expectText(p, 'Il démarre aujourd’hui');
    const cta = p.getByRole('button', { name: /Continuer vers le paiement · \d+\s€\/mois/ });
    await tall(cta, '« Continuer vers le paiement »');
    await narrow(p, 'subscribe sheet');
    await cta.click();
    await p.waitForURL(/\/paiement\/mb_/, { timeout: 10000 });
    await p.getByRole('button', { name: /^Payer/ }).click();
    await p.waitForURL(/\/abo\//, { timeout: 15000 });
    await p.locator('.mb-card').waitFor({ timeout: 15000 });
    const phone = await p.evaluate(() => JSON.parse(localStorage.getItem('lx-me') || '{}').phone);
    return { url: p.url(), email, phone };
  }

  /* ---------- 1 · site block, subscribe, member page, a covered cut ---------- */
  const a = await subscribe(page);
  await h.expectText(page, 'Merci, ton abonnement est actif');
  await page.getByText('0/2').first().waitFor();
  await h.expectText(page, 'coupes ce mois-ci');
  await page.getByText('actif', { exact: true }).waitFor();
  await h.expectText(page, 'Prochain prélèvement : 34');
  await narrow(page, 'member page');
  await h.shot(page, 'pay04-member-active');
  await page.getByRole('link', { name: 'Réserver ma coupe' }).click();
  await page.locator('.bk.open button.wh').first().waitFor({ timeout: 15000 });
  if (/mbr=/.test(page.url())) throw new Error('the member link stays in the address bar');
  await page.locator('.bk button.wh').nth(1).click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: 8000 });
  await page.locator('.bk button.sl').first().click();
  await h.expectText(page, 'Réservé avec ton abonnement');
  await page.getByRole('button', { name: /^(Confirmer|Réserver et régler l’acompte)$/ }).click();
  await h.expectText(page, 'Inclus dans ton abonnement · 1/2 ce mois', 15000);
  if (await page.getByRole('link', { name: 'Régler l’acompte' }).count()) throw new Error('a covered cut asks for a deposit');
  await h.shot(page, 'pay04-booked-covered');

  /* ---------- 2 · cancel from the member page: at most 3 taps ---------- */
  await page.goto(a.url);
  await page.locator('.mb-card').waitFor();
  let taps = 0;
  await page.getByRole('button', { name: 'Résilier mon abonnement' }).click(); taps++;
  await h.expectText(page, 'tes coupes restent incluses jusque-là. Aucun autre prélèvement.');
  await h.shot(page, 'pay04-cancel-recap');
  const confirm = page.getByRole('button', { name: 'Confirmer la résiliation' });
  await tall(confirm, '« Confirmer la résiliation »');
  await narrow(page, 'cancel recap');
  await confirm.click(); taps++;
  await page.getByRole('heading', { name: /^Résiliation enregistrée le \d{2}\/\d{2} à/ }).waitFor({ timeout: 10000 });
  await h.expectText(page, 'Confirmation envoyée par e-mail et SMS.');
  await h.expectText(page, 'Fin le ');
  await page.getByRole('link', { name: 'Télécharger la confirmation' }).waitFor();
  if (taps > 3) throw new Error('cancelling took ' + taps + ' taps');
  // the page now says when it stops
  await page.goto(a.url);
  await page.getByText(/^s’arrête le \d{2}\/\d{2}$/).waitFor({ timeout: 10000 });
  await h.shot(page, 'pay04-member-ending');

  /* ---------- 3 · /resilier by number: the link opens on the recap, one tap ---------- */
  const pb = await h.newPage({ viewport: PHONE });
  const b = await subscribe(pb);
  await pb.goto(h.base + '/resilier');
  await pb.getByLabel('Ton numéro ou ton e-mail').fill(b.phone);
  const ask = pb.getByRole('button', { name: 'Recevoir mon lien' });
  await tall(ask, '« Recevoir mon lien »');
  await narrow(pb, '/resilier');
  await h.shot(pb, 'pay04-resilier');
  await ask.click();
  await h.expectText(pb, 'Si un abonnement existe à ce numéro, tu reçois un SMS dans un instant.');
  const sms = (await messages()).find((m) => m.template === 'memberLink' && linkIn(m.body));
  if (!sms) throw new Error('no member link in the demo outbox');
  await pb.goto(h.base + linkIn(sms.body));
  taps = 0;
  await pb.getByRole('button', { name: 'Confirmer la résiliation' }).click(); taps++;
  await pb.getByRole('heading', { name: /^Résiliation enregistrée le/ }).waitFor({ timeout: 10000 });
  await h.expectText(pb, 'Fin le ');
  if (taps > 3) throw new Error('/resilier took ' + taps + ' taps after the link');

  /* ---------- 4 · by e-mail only ---------- */
  const pc = await h.newPage({ viewport: PHONE });
  const c = await subscribe(pc);
  await pc.goto(h.base + '/resilier');
  await pc.getByLabel('Ton numéro ou ton e-mail').fill(c.email);
  await pc.getByRole('button', { name: 'Recevoir mon lien' }).click();
  await h.expectText(pc, 'Si un abonnement existe à cette adresse, tu reçois ton lien dans un instant');
  // the newest e-mail with a member link is this one (the list comes newest first)
  const mine = (await messages()).find((m) => m.channel === 'email' && m.template === 'memberLinkMail' && linkIn(m.body));
  if (!mine || !mine.body.includes('?resilier')) throw new Error('no member link by e-mail: ' + (mine && mine.body));
  await pc.goto(h.base + linkIn(mine.body));
  await pc.getByRole('button', { name: 'Confirmer la résiliation' }).click();
  await pc.getByRole('heading', { name: /^Résiliation enregistrée le/ }).waitFor({ timeout: 10000 });

  /* ---------- 5 · neither the phone nor the mailbox: the fallback ---------- */
  const pd = await h.newPage({ viewport: PHONE });
  const d = await subscribe(pd);
  await pd.goto(h.base + '/resilier');
  await pd.getByRole('button', { name: 'Je n’ai plus accès à ce numéro ni à cet e-mail' }).click();
  await pd.getByLabel('Prénom').fill('Démo');
  await pd.getByLabel('E-mail de ton abonnement').fill(d.email);
  await pd.getByLabel(/Un e-mail où te répondre/).fill('reponse+' + k + '@exemple.fr');
  await narrow(pd, '/resilier fallback');
  await pd.getByRole('button', { name: 'Envoyer ma demande de résiliation' }).click();
  await pd.getByText(/^Demande de résiliation reçue le \d{2}\/\d{2} à/).waitFor({ timeout: 10000 });
  const list = (await h.api('/api/v1/memberships')).json.members;
  if (!list.some((m) => m.cancelVerified === false)) throw new Error('the fallback did not record a cancellation to confirm');

  /* ---------- 6 · a second member renounces on day 1 ---------- */
  const pe = await h.newPage({ viewport: PHONE });
  await subscribe(pe, 'Illimité');
  await pe.getByRole('button', { name: 'Renoncer au contrat ici' }).click();
  await h.expectText(pe, 'Tu n’as utilisé aucune coupe. On te rembourse 49');
  await h.shot(pe, 'pay04-withdraw-recap');
  const wd = pe.getByRole('button', { name: 'Confirmer la rétractation' });
  await tall(wd, '« Confirmer la rétractation »');
  await narrow(pe, 'withdraw recap');
  await wd.click();
  await pe.getByRole('heading', { name: /^Rétractation enregistrée le/ }).waitFor({ timeout: 10000 });
  await h.expectText(pe, 'Remboursement de 49');

  /* ---------- 7 · a member whose renewal failed: the card first ---------- */
  const grace = (await h.api('/api/v1/memberships')).json.members.find((m) => m.status === 'grace');
  if (grace) {
    const sent = await h.api('/api/v1/memberships/' + grace.id + '/card-link', { body: {}, headers: { 'x-request-id': 'e2e-pay04-card' } });
    if (!sent.ok) throw new Error('card link: ' + sent.text);
    const card = (await messages()).find((m) => m.template === 'memberCard' && linkIn(m.body));
    const pf = await h.newPage({ viewport: PHONE });
    await pf.goto(h.base + linkIn(card.body));
    await pf.getByRole('heading', { name: /^Le paiement de \d+\s€ n’est pas passé$/ }).waitFor({ timeout: 10000 });
    await pf.getByRole('button', { name: 'Mettre ma carte à jour' }).waitFor();
    await pf.getByText('paiement à régulariser', { exact: true }).waitFor();
    await narrow(pf, 'member page past due');
    await h.shot(pf, 'pay04-member-past-due');
  }

  /* ---------- 8 · the same screens on a desktop ---------- */
  const wide = await h.newPage({ viewport: DESKTOP });
  await wide.goto(h.base + '/');
  await wide.locator('#abonnement').waitFor({ timeout: 15000 });
  await wide.getByRole('button', { name: /formule Essentiel/ }).click();
  await wide.getByRole('dialog', { name: 'Je m’abonne' }).waitFor();
  await h.shot(wide, 'pay04-subscribe-desktop');
  await wide.keyboard.press('Escape');
  await wide.goto(a.url);
  await wide.locator('.mb-card').waitFor();
  await h.shot(wide, 'pay04-member-desktop');
  await wide.goto(h.base + '/resilier');
  await wide.getByLabel('Ton numéro ou ton e-mail').waitFor();
  await h.shot(wide, 'pay04-resilier-desktop');
  await wide.goto(h.base + '/cgv#abonnement');
  await wide.locator('#abonnement').waitFor({ state: 'visible', timeout: 10000 });
};
