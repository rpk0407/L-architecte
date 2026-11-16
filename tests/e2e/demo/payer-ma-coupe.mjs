// « Payer ma coupe »: the client pays his cut himself on his own page (/r/…), at the salon.
//  (a) the barber seats him, his page shows « À régler » with the amount; he adds a tip, pays on the payment page
//      (the demo's test page), reads « Payé · merci » with his receipt; the barber's phone, ticket open, turns to
//      « Payé en ligne » by itself and Mon espace says so: nobody charges twice.
//  (b) the barber adds a product and sends the payment link: his phone waits (« En attente du paiement du client… »),
//      « Annuler et encaisser autrement » gives the till back, the link sent again is paid from the client's phone and
//      the ticket carries the product.
// PAYER_SHOTS=<folder> also saves the screens of the feature there (390×844).
export const name = 'the client pays his cut on his own page, the barber sees « Payé en ligne »';
export const viewport = { width: 390, height: 844 };
export const mutates = true;

const PIN = '2468';
const DIR = process.env.PAYER_SHOTS || '';

async function barber(page, base, who = 'JKut') {
  await page.goto(base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: who }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type(PIN);
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
}
const noSideScroll = async (page, where) => {
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(where + ' scrolls sideways on a phone');
};

export default async ({ h, page }) => {
  await h.setup();
  const snap = async (p, n) => { if (DIR) await p.screenshot({ path: DIR + '/' + n + '.png' }); else await h.shot(p, 'payer-' + n); };
  const boot = (await h.api('/api/v1/bootstrap')).json;
  const jkut = boot.staff.find((s) => s.name === 'JKut');
  const salon = (await h.api('/api/public/salon', { session: false })).json;
  const svc = salon.services.slice().sort((a, b) => a.price - b.price).find((x) => !x.deposit && !x.from);
  if (!jkut || !svc) throw new Error('demo barber or service not found');
  const product = boot.products.find((p) => p.active !== false && p.stock > 0);
  // two clients book JKut today on the site, and come
  const av = (await h.api('/api/public/availability?services=' + svc.id + '&staff=' + jkut.id + '&from=' + boot.today + '&days=1&fresh=1', { session: false })).json.days[0];
  if (!av || av.slots.length < 2) throw new Error('JKut has no two free slots left today in the demo');
  const book = async (first, phone, start) => {
    const r = await h.api('/api/public/bookings', { session: false, headers: { origin: h.base }, body: { serviceIds: [svc.id], staffId: jkut.id, day: boot.today, start, first, phone, sms: true } });
    if (r.status !== 201) throw new Error('booking failed: ' + r.status + ' ' + r.text);
    const ag = (await h.api('/api/v1/agenda?day=' + boot.today)).json;
    return { token: r.json.token, id: ag.appts.find((a) => a.code === r.json.code).id };
  };
  const seat = async (id) => { const r = await h.api('/api/v1/appointments/' + id + '/status', { body: { status: 'in_chair' } }); if (!r.ok) throw new Error('could not seat the client: ' + r.status + ' ' + r.text); };
  const one = await book('Zinedine', '0611770011', av.slots[0].m);
  const two = await book('Yazid', '0611770022', av.slots[1].m);
  const price = svc.price / 100;

  /* ---------- (a) he pays by himself ---------- */
  const client = await h.newPage({ viewport, mobile: true });
  await client.goto(h.base + '/r/' + one.token);
  await client.getByText('Ton rendez-vous, Zinedine').waitFor({ timeout: 8000 });
  if (await client.locator('[data-guide="r.payer"]').count()) throw new Error('« À régler » shows before the client is at the salon');
  await barber(page, h.base);
  await seat(one.id);
  await page.goto(h.base + '/comptoir/espace');
  await page.locator('#page-title h1', { hasText: 'Mon espace' }).waitFor({ timeout: 8000 });
  const row = page.locator('.es-row', { hasText: 'Zinedine' });
  await row.locator('[data-guide="phone-pay"]').click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Sur ton téléphone' });
  await sheet.getByText('Comment paie-t-il ?').waitFor({ timeout: 8000 });
  await sheet.locator('[data-guide="tk-paylink"]').waitFor();
  // his page follows the till: the block comes without a reload
  await client.reload();
  const block = client.locator('[data-guide="r.payer"]');
  await block.getByText('À régler · ' + price + ' €').waitFor({ timeout: 12000 });
  await block.getByRole('button', { name: 'Payer maintenant · ' + price + ' €' }).waitFor();
  await noSideScroll(client, 'the client’s « À régler » block');
  await block.scrollIntoViewIfNeeded();
  await snap(client, '1-client-a-regler');
  // the tip: aucun · 2 € · 5 € · autre
  const tips = client.locator('[data-guide="r.pourboire"]');
  for (const t of ['Aucun', '2 €', '5 €', 'Autre']) await tips.getByRole('button', { name: t, exact: true }).waitFor();
  await tips.getByRole('button', { name: 'Autre', exact: true }).click();
  await tips.getByLabel('Montant du pourboire (€)').fill('3,50');
  await block.getByRole('button', { name: 'Payer maintenant · ' + String(price + 3.5).replace('.', ',') + '0 €' }).waitFor();
  await tips.getByRole('button', { name: '2 €', exact: true }).click();
  const payBtn = block.getByRole('button', { name: 'Payer maintenant · ' + (price + 2) + ' €' });
  await payBtn.waitFor();
  await payBtn.scrollIntoViewIfNeeded();
  await snap(client, '2-client-pourboire');
  await payBtn.click();
  // the demo's test payment page, as for a deposit
  await client.waitForURL(/\/paiement\//, { timeout: 10000 });
  await client.getByText('Page de paiement de test').waitFor({ timeout: 8000 });
  await client.getByRole('button', { name: 'Payer ' + (price + 2) + ' €' }).click();
  await client.waitForURL(/\/r\//, { timeout: 10000 });
  const done = client.locator('[data-guide="r.paye"]');
  await done.getByText('Payé · merci').waitFor({ timeout: 15000 });
  await done.getByText(new RegExp((price + 2) + '\\s€ réglés en ligne · ticket T\\d{6}')).waitFor();
  const receipt = await done.getByRole('link', { name: 'Voir mon reçu' }).getAttribute('href');
  if (!/\/recu\//.test(receipt || '')) throw new Error('no receipt link after paying: ' + receipt);
  await noSideScroll(client, '« Payé · merci »');
  await done.scrollIntoViewIfNeeded();
  await snap(client, '3-client-paye-merci');
  // the barber's phone, ticket still open: « Payé en ligne », by itself
  const paid = sheet.locator('[data-guide="tk-paid-online"]');
  await paid.getByText('Payé en ligne ✓').waitFor({ timeout: 15000 });
  await paid.getByText(/dont 2\s€ de pourboire/).waitFor();
  await noSideScroll(page, 'the barber’s « Payé en ligne »');
  await snap(page, '5-barbier-paye-en-ligne');
  await paid.getByRole('button', { name: 'Terminé' }).click();
  await sheet.waitFor({ state: 'detached', timeout: 4000 });
  // Mon espace says so on his row, and offers no « Encaisser » any more
  await row.locator('[data-guide="paid-online"]').waitFor({ timeout: 10000 });
  if (await row.locator('[data-guide="phone-pay"]').count()) throw new Error('« Encaisser » is still offered for a client who paid online');
  // the ticket is the till's: one sale, online, the tip apart
  const sales = (await h.api('/api/v1/sales')).json.items.filter((x) => x.apptId === one.id);
  if (sales.length !== 1) throw new Error('expected one ticket for the appointment, got ' + sales.length);
  if (sales[0].totals.total !== svc.price || sales[0].totals.tip !== 200 || sales[0].payments[0].method !== 'online') throw new Error('the ticket is not the till’s: ' + JSON.stringify(sales[0].totals) + ' ' + JSON.stringify(sales[0].payments));
  // the receipt opens
  await client.goto(h.base + receipt.replace(h.base, ''));
  await client.getByText(/Ticket T\d{6}/).waitFor({ timeout: 8000 });
  await client.getByText('Pourboire').waitFor();

  /* ---------- (b) the barber sends the link ---------- */
  await seat(two.id);
  await page.reload();
  await page.locator('#page-title h1', { hasText: 'Mon espace' }).waitFor({ timeout: 8000 });
  const row2 = page.locator('.es-row', { hasText: 'Yazid' });
  await row2.locator('[data-guide="phone-pay"]').click();
  await sheet.getByText('Comment paie-t-il ?').waitFor({ timeout: 8000 });
  let due = svc.price;
  if (product) {
    await sheet.getByRole('button', { name: 'Ajouter', exact: true }).click();
    const add = page.getByRole('dialog').filter({ hasText: 'Au ticket' });
    await add.getByRole('button', { name: 'Produit', exact: true }).click();
    await add.locator('.pick-r', { hasText: product.name }).first().click();
    await sheet.getByText(product.name).first().waitFor({ timeout: 6000 });
    due += product.price;
  }
  const eu = (c) => String(c / 100).replace('.', ',') + (c % 100 ? '0' : '') + ' €';
  await sheet.locator('[data-guide="tk-paylink"]').click();
  const wait = sheet.locator('[data-guide="tk-wait"]');
  await wait.getByText('En attente du paiement du client…').waitFor({ timeout: 8000 });
  await wait.getByText(/Lien envoyé par message/).waitFor();
  await noSideScroll(page, 'the barber’s « En attente »');
  await wait.scrollIntoViewIfNeeded();
  await snap(page, '4-barbier-en-attente');
  // the text left by the salon's channel, with the amount
  const sent = (await h.api('/api/v1/messages?limit=30')).json;
  const list = sent.items || sent.messages || [];
  if (!list.some((m) => m.template === 'payLink')) throw new Error('the payment link was not queued: ' + JSON.stringify(list.slice(0, 3)));
  // « Annuler et encaisser autrement » gives the till back; then he sends it again
  await wait.getByRole('button', { name: 'Annuler et encaisser autrement' }).click();
  await sheet.getByText('Comment paie-t-il ?').waitFor({ timeout: 8000 });
  await sheet.locator('[data-guide="tk-paylink"]').click();
  await wait.getByText('En attente du paiement du client…').waitFor({ timeout: 8000 });
  // the client opens the link of the text: the amount is the barber's ticket
  await client.goto(h.base + '/r/' + two.token + '?payer');
  const block2 = client.locator('[data-guide="r.payer"]');
  await block2.getByText('À régler · ' + eu(due)).waitFor({ timeout: 10000 });
  if (product) await block2.getByText(product.name).waitFor();
  await block2.getByRole('button', { name: 'Payer maintenant · ' + eu(due) }).click();
  await client.waitForURL(/\/paiement\//, { timeout: 10000 });
  // the barber's phone says where the client is
  await wait.getByText(/Il est sur la page de paiement/).waitFor({ timeout: 12000 });
  await client.getByRole('button', { name: 'Payer ' + eu(due) }).click();
  await client.waitForURL(/\/r\//, { timeout: 10000 });
  await client.locator('[data-guide="r.paye"]').getByText('Payé · merci').waitFor({ timeout: 15000 });
  await paid.getByText('Payé en ligne ✓').waitFor({ timeout: 15000 });
  const sales2 = (await h.api('/api/v1/sales')).json.items.filter((x) => x.apptId === two.id);
  if (sales2.length !== 1 || sales2[0].totals.due !== due || (product && !sales2[0].lines.some((l) => l.kind === 'product'))) throw new Error('the ticket of the link is not the barber’s: ' + JSON.stringify(sales2.map((x) => [x.totals, x.lines.map((l) => l.name)])));
  // the till that tries again is told, and nothing is rung up twice
  if (page.expect) page.expect.push(/409/);
  const again = await page.evaluate(async ([id, ref, amount]) => {
    const r = await fetch('/api/v1/sales', { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': crypto.randomUUID() }, body: JSON.stringify({ apptId: id, lines: [{ kind: 'service', ref }], payments: [{ method: 'card', amount }], phone: true }) });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [two.id, svc.id, svc.price]);
  if (again.status !== 409 || again.json?.error?.code !== 'paid_online') throw new Error('a client who paid online was rung up again: ' + again.status + ' ' + JSON.stringify(again.json));
  await paid.getByRole('button', { name: 'Terminé' }).click();
};
