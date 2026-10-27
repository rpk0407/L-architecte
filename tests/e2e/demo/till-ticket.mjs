// The till on the demo salon: a booked client keeps his booked price after a price change, a discount
// is typed like an amount ("2,50"), with euro chips and a free reason, and a barber credits only himself
// or the appointment's barber.
export const name = 'till: booked price, typed discount, who gets credited';

const pending = (a, min) => !a.saleId && (a.status === 'in_chair' || a.status === 'done' || (['booked', 'arrived'].includes(a.status) && a.start + a.dur <= min));

export default async ({ h, page }) => {
  await h.loginOwner(page);
  const call = (path, body, method) => page.evaluate(async ([p, b, m]) => {
    const r = await fetch(p, b ? { method: m || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body, method]);

  // the first client waiting to pay, booked before today's price change
  const pulse = (await call('/api/v1/pulse')).json;
  const ag = (await call('/api/v1/agenda?day=' + pulse.today)).json;
  const a = ag.appts.filter((x) => pending(x, pulse.min) && x.services.length === 1 && !x.services[0].from && !x.deposit?.paid).sort((x, y) => x.start - y.start)[0];
  if (!a) throw new Error('no appointment waiting to pay in the demo');
  const svc = a.services[0];
  const raised = svc.price + 200;
  const up = await call('/api/v1/services/' + svc.id, { price: raised }, 'PATCH');
  if (up.status !== 200) throw new Error('price change refused: ' + JSON.stringify(up.json));
  const eur = (c) => (c % 100 ? (c / 100).toFixed(2).replace('.', ',') : String(c / 100)) + ' €';

  await page.goto(h.base + '/comptoir/caisse?rdv=' + a.id);
  await page.locator('.ticket').waitFor({ timeout: 8000 });
  await page.getByText('Réservé à ' + eur(svc.price) + ' (prix actuel ' + eur(raised) + ')').waitFor({ timeout: 5000 });
  await h.shot(page, 'till-booked-price');

  // the discount: typed as it is said, never rewritten under the fingers
  await page.getByRole('button', { name: 'Remise', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Remise' });
  await dlg.locator('#dc-a').pressSequentially('2,50');
  if ((await dlg.locator('#dc-a').inputValue()) !== '2,50') throw new Error('the amount field rewrote what was typed: ' + await dlg.locator('#dc-a').inputValue());
  await dlg.getByRole('button', { name: 'Appliquer −2,50 €' }).waitFor({ timeout: 3000 });
  // euro chips, and a reason of one's own
  await dlg.getByRole('button', { name: '2 €', exact: true }).click();
  await dlg.getByRole('button', { name: 'Appliquer −2 €' }).waitFor({ timeout: 3000 });
  await dlg.locator('#dc-a').fill('');
  await dlg.locator('#dc-a').pressSequentially('2,50');
  await dlg.getByRole('button', { name: 'Autre raison' }).click();
  await dlg.locator('#dc-r').fill('Coupe du petit frère');
  await h.shot(page, 'till-discount');
  await dlg.getByRole('button', { name: 'Appliquer −2,50 €' }).click();
  await page.getByText('Remise · Coupe du petit frère').waitFor({ timeout: 3000 });

  // paid at the booked price, less the discount: the server agrees with the screen
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await page.getByRole('button', { name: /Valider l’encaissement/ }).click();
  await page.getByText('Encaissé').first().waitFor({ timeout: 8000 });
  const sales = (await call('/api/v1/sales?day=' + pulse.today)).json.items;
  const sale = sales.find((x) => x.apptId === a.id);
  if (!sale) throw new Error('no ticket for the appointment');
  if (sale.lines[0].unit !== svc.price) throw new Error('line at ' + sale.lines[0].unit + ', booked at ' + svc.price);
  if (sale.totals.due !== svc.price - 250) throw new Error('paid ' + sale.totals.due + ', expected ' + (svc.price - 250));
  await h.shot(page, 'till-done');

  // a barber on a salon device: "Réalisé par" offers himself and the appointment's barber, nobody else
  const barber = await h.newPage();
  await barber.goto(h.base + '/comptoir');
  await barber.getByRole('button', { name: /poste du salon/ }).click();
  await barber.locator('.team button', { hasText: 'JKut' }).click();
  await barber.locator('.keypad').waitFor();
  await barber.keyboard.type('2468');
  await barber.keyboard.press('Enter');
  await barber.locator('#page-title h1').waitFor({ timeout: 10000 });
  const ag2 = (await call('/api/v1/agenda?day=' + pulse.today)).json;
  const b = ag2.appts.filter((x) => pending(x, pulse.min)).sort((x, y) => x.start - y.start)[0];
  if (!b) throw new Error('nobody else waiting to pay in the demo');
  await barber.goto(h.base + '/comptoir/caisse?rdv=' + b.id);
  await barber.locator('.tk-line .tk-main').first().click();
  const chips = (await barber.locator('.tk-line .ed .chips').filter({ has: barber.locator('.dot') }).first().locator('button').allTextContents()).map((x) => x.trim());
  const owner = ag2.lanes.find((x) => x.id === b.staffId);
  const allowed = new Set(['JKut', owner ? owner.name : '']);
  if (!chips.length || chips.some((c) => !allowed.has(c)) || chips.length > 2) throw new Error('a barber is offered to credit: ' + chips.join(', ') + ' (appointment of ' + (owner ? owner.name : b.staffId) + ')');
};
