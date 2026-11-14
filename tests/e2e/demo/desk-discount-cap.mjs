// The front desk gives a discount at the till, up to 20 % of the ticket: the modal says the cap, offers nothing above
// it, refuses a typed amount over it with who can do more; the server refuses it too (403, plain words); 20 % passes.
export const name = 'front desk: a discount up to 20 %, refused above';

const pending = (a, min) => !a.saleId && (a.status === 'in_chair' || a.status === 'done' || (['booked', 'arrived'].includes(a.status) && a.start + a.dur <= min));

export default async ({ h, page }) => {
  await page.goto(h.base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: 'Inès' }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type('1470');
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
  const call = (path, body) => page.evaluate(async ([p, b]) => {
    const r = await fetch(p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body]);
  const pulse = (await call('/api/v1/pulse')).json;
  const ag = (await call('/api/v1/agenda?day=' + pulse.today)).json;
  const a = ag.appts.filter((x) => pending(x, pulse.min) && x.services.length === 1 && !x.services[0].from && !x.deposit?.paid && !x.client?.member).sort((x, y) => x.start - y.start)[0];
  if (!a) throw new Error('no appointment waiting to pay in the demo');
  const price = a.price, cap = Math.floor(price * 0.2);
  const eur = (c) => (c % 100 ? (c / 100).toFixed(2).replace('.', ',') : String(c / 100)) + ' €';

  await page.goto(h.base + '/comptoir/caisse?rdv=' + a.id);
  await page.locator('.ticket').waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Remise', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Remise' });
  await dlg.getByText('Jusqu’à 20 % pour ton rôle.').waitFor({ timeout: 3000 });
  if (!(await dlg.getByRole('button', { name: '20 %', exact: true }).count())) throw new Error('the 20 % chip is missing');
  if (await dlg.getByRole('button', { name: '50 %', exact: true }).count()) throw new Error('a 50 % chip is offered to the desk');
  // one euro over the cap: said, with who can, and nothing to apply
  await dlg.locator('#dc-a').pressSequentially(String((cap + 100) / 100).replace('.', ','));
  await dlg.getByText('C’est au-dessus de ta limite (20 %). Au-delà, c’est le gérant ou le responsable qui la fait.').waitFor({ timeout: 3000 });
  if (!(await dlg.getByRole('button', { name: /^Appliquer/ }).isDisabled())) throw new Error('« Appliquer » is not disabled above the cap');
  await h.shot(page, 'desk-discount-over');
  // the server holds the same line, whatever the screen says
  page.expect.push(/403/);
  const over = await call('/api/v1/sales', { apptId: a.id, lines: [{ kind: 'service', ref: a.services[0].id }], discount: { amount: cap + 100, reason: 'Fidélité' }, payments: [{ method: 'card', amount: price - cap - 100 }] });
  if (over.status !== 403 || over.json.error.code !== 'discount') throw new Error('a discount over the cap was not refused: ' + JSON.stringify(over));
  if (!/20 %/.test(over.json.error.message) || !/gérant ou le responsable/.test(over.json.error.message)) throw new Error('the refusal does not say the cap and who can: ' + over.json.error.message);
  // exactly 20 %: applied and rung up
  await dlg.getByRole('button', { name: '20 %', exact: true }).click();
  await dlg.getByRole('button', { name: 'Appliquer −' + eur(cap) }).click();
  await page.getByText('Remise · Fidélité').waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await page.getByRole('button', { name: /Valider l’encaissement/ }).click();
  await page.getByText('Encaissé').first().waitFor({ timeout: 8000 });
  const sale = (await call('/api/v1/sales?day=' + pulse.today)).json.items.find((x) => x.apptId === a.id);
  if (!sale || sale.totals.due !== price - cap) throw new Error('the ticket is not at the price less 20 %: ' + JSON.stringify(sale && sale.totals));
};
