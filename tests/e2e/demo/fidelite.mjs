// Fidélité (FID-03) on the demo salon: Réglages › Fidélité prices the programme while the owner types, a reward is applied
// at the till in one tap (the owner's and a barber's, no « Remise maximale »), the done screen and the client file say what
// happened, and the client's own card and referral link answer. /moi and the site's ?parrain= block are AC-03a's and
// AC-04's: their screens are checked here only once they exist in the build (the routes they call always are).
export const name = 'loyalty: the cost simulator, one tap at the till, the card on the file, /moi and the referral link';

const money = (t) => Number(String(t).replace(/[^\d,]/g, '').replace(',', '.')) * 100;
/** the figure of « : 1 371 €, soit 3,7 % » */
const simulated = (t) => { const m = /:\s*([\d\s  ]+)\s*€,\s*soit/.exec(t); if (!m) throw new Error('no figure in the simulator: ' + t); return Number(m[1].replace(/\D/g, '')); };

export default async ({ h, page }) => {
  await h.loginOwner(page);
  const call = (p, path, body) => p.evaluate(async ([u, b]) => {
    const r = await fetch(u, b ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': crypto.randomUUID() }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body]);

  // 1. Réglages › Fidélité: the sentence has a figure, and a longer card (12 passages instead of 9) lowers it
  await page.goto(h.base + '/comptoir/reglages/fidelite');
  const sim = page.locator('[data-guide="fidelite.simulator"]');
  await sim.getByText('Sur les 12 derniers mois').waitFor({ timeout: 10000 });
  const before = simulated(await sim.innerText());
  if (!(before > 0)) throw new Error('the simulator says ' + before);
  await h.shot(page, 'fidelite-reglages');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Un passage de plus' }).click();
  await page.getByText('Modifications non enregistrées').waitFor();
  await page.waitForFunction((b) => { const t = document.querySelector('[data-guide="fidelite.simulator"]')?.textContent || ''; const m = /:\s*([\d\s  ]+)\s*€,\s*soit/.exec(t); return !!m && Number(m[1].replace(/\D/g, '')) < b; }, before, { timeout: 8000 });
  const after = simulated(await sim.innerText());
  if (!(after < before)) throw new Error('12 passages did not lower the cost: ' + before + ' → ' + after);
  await page.getByRole('button', { name: 'Annuler' }).click();

  // 2. a booked regular, given a reward (a seeded one may already have it), at the till
  const pulse = (await call(page, '/api/v1/pulse')).json;
  const ag = (await call(page, '/api/v1/agenda?day=' + pulse.today)).json;
  const unpaid = ag.appts.filter((a) => !a.saleId && ['booked', 'arrived', 'in_chair'].includes(a.status) && a.client && a.client.loyalty && !a.client.loyalty.off && a.services.length === 1 && !a.client.packs.length && !(a.client.memberships || []).length);
  // a cut dear enough that what is left to pay (after up to 25 € off) still earns a stamp: 10 € or more
  const a = unpaid.find((x) => x.price >= 3500 && x.client.visits > 0) || unpaid.find((x) => x.price >= 3500);
  if (!a) throw new Error('no unpaid appointment of a client with a card in the demo');
  const gift = await call(page, '/api/v1/loyalty/gift', { clientId: a.client.id, reward: { kind: 'service', refs: [], cap: 2500 } });
  if (gift.status !== 200) throw new Error('gift refused: ' + JSON.stringify(gift.json));
  await page.goto(h.base + '/comptoir/caisse?rdv=' + a.id);
  await page.locator('.ticket').waitFor({ timeout: 8000 });
  const total = () => page.locator('.tk-total b').first().innerText().then(money);
  const due0 = await total();
  await page.getByRole('button', { name: /Appliquer/ }).click();
  await page.getByRole('button', { name: /Retirer/ }).first().waitFor();
  await page.getByText('· fidélité').first().waitFor();
  const off = Math.min(2500, a.price);
  if ((await total()) !== due0 - off) throw new Error('the total went from ' + due0 + ' to ' + (await total()) + ', expected −' + off);
  await h.shot(page, 'fidelite-ticket');
  // taken off again, then applied again
  await page.getByRole('button', { name: /Retirer/ }).first().click();
  await page.getByRole('button', { name: /Appliquer/ }).waitFor();
  if ((await total()) !== due0) throw new Error('the reward did not come off the ticket');
  await page.getByRole('button', { name: /Appliquer/ }).click();
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await page.getByRole('button', { name: /Valider l’encaissement/ }).click();
  await page.getByText('Encaissé').first().waitFor({ timeout: 8000 });
  await page.getByText(/Tampon ajouté|Carte complète/).first().waitFor({ timeout: 8000 });
  await h.shot(page, 'fidelite-done');

  // 3. the file shows the movement
  await page.goto(h.base + '/comptoir/clients/' + a.client.id);
  const card = page.locator('[data-guide="clients.loyalty"]');
  await card.getByText('coupe offerte').first().waitFor({ timeout: 8000 });
  await card.getByRole('button', { name: '+ 1 tampon' }).waitFor();
  await h.shot(page, 'fidelite-fiche');

  // 4. a barber on a salon device: the same tap, no « Remise maximale »
  const barber = await h.newPage();
  await barber.goto(h.base + '/comptoir');
  await barber.getByRole('button', { name: /poste du salon/ }).click();
  await barber.locator('.team button', { hasText: 'JKut' }).click();
  await barber.locator('.keypad').waitFor();
  await barber.keyboard.type('2468');
  await barber.keyboard.press('Enter');
  await barber.locator('#page-title h1').waitFor({ timeout: 10000 });
  const ag2 = (await call(page, '/api/v1/agenda?day=' + pulse.today)).json;
  const b = ag2.appts.find((x) => !x.saleId && ['booked', 'arrived', 'in_chair'].includes(x.status) && x.client && x.client.loyalty && !x.client.loyalty.off && x.services.length === 1 && x.price >= 3500 && x.id !== a.id && !x.client.packs.length && !(x.client.memberships || []).length);
  if (!b) throw new Error('no second appointment to ring up as a barber');
  await call(page, '/api/v1/loyalty/gift', { clientId: b.client.id, reward: { kind: 'service', refs: [], cap: 2500 } });
  await barber.goto(h.base + '/comptoir/caisse?rdv=' + b.id);
  await barber.locator('.ticket').waitFor({ timeout: 8000 });
  await barber.getByRole('button', { name: /Appliquer/ }).click();
  await barber.getByRole('button', { name: /Retirer/ }).first().waitFor();
  await barber.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await barber.getByRole('button', { name: /Valider l’encaissement/ }).click();
  await barber.getByText('Encaissé').first().waitFor({ timeout: 8000 });
  if (await barber.getByText('Remise maximale').count()) throw new Error('a barber was refused the reward: « Remise maximale »');
  const sale = (await call(page, '/api/v1/sales?day=' + pulse.today)).json.items.find((x) => x.apptId === b.id);
  if (!sale || !sale.lines[0].reward) throw new Error('the barber\'s ticket carries no reward');

  // 5. the client's own card (the demo's client) and the referral link
  const me = await h.newPage({ viewport: { width: 390, height: 844 } });
  await me.goto(h.base + '/mon-rendez-vous');
  const signed = await call(me, '/api/public/account/demo', {});
  if (signed.status !== 200) throw new Error('demo sign-in: ' + signed.status);
  const mine = (await call(me, '/api/me/loyalty')).json;
  if (!mine.enabled || mine.card.goal !== 9 || mine.rule !== '9 passages = la 10e coupe offerte') throw new Error('/api/me/loyalty: ' + JSON.stringify(mine));
  const token = new URL(mine.referral.link).searchParams.get('parrain');
  const friend = await call(me, '/api/public/parrain/' + encodeURIComponent(token));
  if (friend.status !== 200 || !/offerts/.test(friend.json.offer) || !friend.json.first) throw new Error('the referral link says: ' + JSON.stringify(friend));
  // /moi itself comes with AC-03a: once it is in the build, the card is on its home
  const res = await me.goto(h.base + '/moi');
  if (res && res.ok()) {
    await h.expectText(me, 'Ma carte fidélité');
    if (!(await me.getByRole('img', { name: /tampons? sur 9/ }).count())) throw new Error('/moi: no stamp card');
    await h.shot(me, 'fidelite-moi');
  }
};
