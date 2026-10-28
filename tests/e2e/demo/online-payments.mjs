// Caisse › Paiements en ligne (PAY-01): a client books a service that takes a deposit, pays it on the test checkout,
// and the owner finds the payment in the sheet, on a desktop and on a phone, with the demo's note and no fee line.
// Then « À traiter » above the till: no webhook reaches the demo, so its lines are mocked around a real QR payment;
// three lines show, the rest are in the sheet, and a line's action opens the till at the top with the block gone.

export const name = 'a deposit paid online is in Caisse › Paiements en ligne (desktop and phone)';

const PHONE = { width: 390, height: 844 };

export default async ({ h, page }) => {
  await h.setup();
  const boot = (await h.api('/api/v1/bootstrap')).json;
  // a service the site sells with a deposit (the demo asks one from the threshold up), on a day with a free slot
  const svc = boot.services.filter((x) => x.active && x.online && !x.pack && !x.from && x.price >= boot.settings.deposits.thresholdCents).sort((a, b) => a.price - b.price)[0];
  if (!svc) throw new Error('no service with a deposit in the demo');
  const av = (await h.api('/api/public/availability?services=' + svc.id + '&days=7&from=' + boot.today, { session: false })).json;
  const day = av.days.find((d) => d.day > boot.today && d.slots.length);
  if (!day) throw new Error('no free slot this week');
  const b = await h.api('/api/public/bookings', { session: false, headers: { origin: h.base }, body: { serviceIds: [svc.id], staffId: day.slots[0].s, day: day.day, start: day.slots[0].m, first: 'Anatole', phone: '0611778899' } });
  if (b.status !== 201 || !b.json.payment) throw new Error('booking without a deposit: ' + b.status + ' ' + b.text);
  const amount = b.json.deposit;
  const euros = (c) => (c / 100).toFixed(c % 100 ? 2 : 0).replace('.', ',') + '\\s€';

  // the test checkout, as the client sees it
  await page.goto(h.base + '/paiement/' + b.json.payment.id);
  await page.getByRole('button', { name: /^Payer / }).click();
  await page.waitForURL(/\/r\//, { timeout: 8000 });

  const check = async (p, label) => {
    await h.loginOwner(p);
    await p.goto(h.base + '/comptoir/caisse?enligne=1');
    const sheet = p.getByRole('dialog', { name: 'Paiements en ligne' });
    await sheet.waitFor({ timeout: 8000 });
    await sheet.getByRole('heading', { name: 'Paiements', exact: true }).waitFor();
    await sheet.getByRole('heading', { name: 'Virements', exact: true }).waitFor();
    // the row names its kind, amount and state in words, not only in colour
    const row = sheet.getByRole('listitem', { name: new RegExp('^Acompte ' + euros(amount) + ', payé$') });
    await row.waitFor({ timeout: 8000 });
    await sheet.getByText('Démo : les paiements en ligne sont simulés').waitFor();
    // the demo has no payout: no fee will ever come, so none is announced
    if (await sheet.getByText('frais au virement').count()) throw new Error(label + ': « frais au virement » in the demo');
    await sheet.getByText('Aucun virement').waitFor();
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (wide) throw new Error(label + ': the page scrolls sideways');
    await p.waitForTimeout(400); // the sheet's entrance, for the screenshot
    await h.shot(p, 'online-payments-' + label);
    // the sheet closes from its button and gives the query back
    await sheet.getByRole('button', { name: 'Fermer' }).click();
    await p.waitForURL((u) => !u.searchParams.has('enligne'), { timeout: 5000 });
  };
  await check(page, 'desktop');
  await check(await h.newPage({ viewport: PHONE }), 'phone');

  // and from Réglages › Paiements: the webhook to declare, with every event, and the way to this sheet
  await page.goto(h.base + '/comptoir/reglages/paiements');
  const events = page.getByLabel('Événements à cocher');
  await events.waitFor({ timeout: 8000 });
  const list = await events.inputValue();
  for (const e of ['checkout.session.completed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed', 'payout.paid']) if (!list.includes(e)) throw new Error('event missing in Réglages: ' + e);
  if (!(await page.getByLabel('Adresse du webhook').inputValue()).endsWith('/api/pay/stripe/webhook')) throw new Error('webhook address');
  await page.getByRole('button', { name: 'Voir les paiements et virements' }).click();
  await page.getByRole('dialog', { name: 'Paiements en ligne' }).waitFor({ timeout: 8000 });

  // « À traiter »: a real QR paid on no ticket, around it the lines only a webhook writes, as the route answers them
  const qr = await h.api('/api/v1/payments/qr', { body: { amount: 2500, label: 'Coupe' }, headers: { origin: h.base } });
  if (!qr.ok) throw new Error('QR: ' + qr.text);
  if ((await h.api('/api/public/payments/' + qr.json.id + '/simulate', { session: false, body: {}, headers: { origin: h.base } })).status !== 200) throw new Error('QR not paid');
  const real = (await h.api('/api/v1/payments/online')).json;
  const now = Date.now(), D = 86400000;
  const todo = [
    { kind: 'dispute', id: 'du_e2e', paymentId: b.json.payment.id, amount, reason: 'fraude déclarée par la banque', dueBy: now + 9 * D, label: 'Acompte · ' + svc.name, payKind: 'deposit', first: 'Anatole', day: day.day, apptId: null },
    { kind: 'unused', id: 'un_qr', paymentId: qr.json.id, amount: 2500, paidAt: now - 3 * D, label: 'Coupe', payKind: 'qr', apptStatus: null, cancelBy: null, first: '', day: null, apptId: null },
    { kind: 'unused', id: 'un_cx', paymentId: 'py_e2e_cx', amount: 1500, paidAt: now - 2 * D, label: 'Acompte · Transformation', payKind: 'deposit', apptStatus: 'cancelled', cancelBy: 'salon', first: 'Eloi', day: boot.today, apptId: 'ap_e2e_cx' },
    { kind: 'unused', id: 'un_ns', paymentId: 'py_e2e_ns', amount: 1500, paidAt: now - 2 * D, label: 'Acompte · Transformation', payKind: 'deposit', apptStatus: 'no_show', cancelBy: null, first: 'Malik', day: boot.today, apptId: 'ap_e2e_ns' },
    { kind: 'outside', id: 'out_e2e', paymentId: 'py_e2e_out', amount: 1000, saleId: 'sa_e2e', ticket: 'T-0042', day: boot.today, label: 'QR code', payKind: 'qr', at: now - D }
  ];
  const mock = (p) => p.route('**/api/v1/payments/online*', (route) => route.request().method() === 'GET' ? route.fulfill({ json: { ...real, todo } }) : route.continue());
  const block = async (p, label) => {
    await mock(p);
    await p.goto(h.base + '/comptoir/caisse');
    const sec = p.getByRole('region', { name: /En ligne · à traiter/ });
    await sec.waitFor({ timeout: 8000 });
    const rows = await sec.getByRole('listitem').count();
    if (rows !== 3) throw new Error(label + ': ' + rows + ' lines above the till, 3 expected');
    await sec.getByText('Litige').first().waitFor();
    await sec.getByText(/Anatole/).first().waitFor();
    await sec.getByRole('button', { name: 'Garder l’acompte' }).waitFor();
    await sec.getByRole('button', { name: 'Rembourser' }).waitFor();
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (wide) throw new Error(label + ': the page scrolls sideways');
    await h.shot(p, 'online-todo-' + label);
    // the rest is in the sheet, with the payments
    await sec.getByRole('button', { name: 'Voir les 2 autres' }).click();
    const sheet = p.getByRole('dialog', { name: 'Paiements en ligne' });
    await sheet.getByRole('heading', { name: 'À traiter', exact: true }).waitFor({ timeout: 8000 });
    await sheet.getByText('Remboursé chez Stripe sans avoir').waitFor();
    await sheet.getByText(/Acompte de Malik/).waitFor();
    await p.waitForTimeout(400);
    await h.shot(p, 'online-todo-sheet-' + label);
    await sheet.getByRole('button', { name: 'Fermer' }).click();
    await p.waitForURL((u) => !u.searchParams.has('enligne'), { timeout: 5000 });
    // the QR's line: a free sale already paid by it, the till at the top of the page, the block out of its way
    await p.evaluate(() => window.scrollTo(0, 400));
    await sec.getByRole('button', { name: 'Encaisser sur un ticket' }).click();
    await p.waitForURL((u) => u.searchParams.get('vente') === '1' && u.searchParams.get('paiement') === qr.json.id, { timeout: 5000 });
    await p.getByText('Payé en ligne').first().waitFor({ timeout: 8000 });
    if (await sec.count()) throw new Error(label + ': the block stays above an open ticket');
    if (await p.evaluate(() => window.scrollY) !== 0) throw new Error(label + ': the till is not at the top');
    await h.shot(p, 'online-todo-till-' + label);
  };
  await block(page, 'desktop');
  const phone = await h.newPage({ viewport: PHONE });
  await h.loginOwner(phone);
  await block(phone, 'phone');
};
