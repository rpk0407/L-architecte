// A ticket of a sealed day is corrected today: « Rembourser » is offered on it (the credit note is dated today and goes
// into today's Z, the old Z does not move), on a phone and on the counter's tablet. Once today's own Z is sealed, the
// ticket says when the credit note can be made instead of hiding the way silently, and the server refuses in words.
export const name = 'till: a ticket of a sealed day gets its credit note today; after today’s Z, tomorrow';
export const viewport = { width: 390, height: 844 };

const OLD = '2026-10-24'; // the Saturday before the demo's Tuesday: sealed by its Z

export default async ({ h, page }) => {
  const call = (pg, path, body) => pg.evaluate(async ([p, b]) => {
    const r = await fetch(p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body]);
  const refundOld = async (pg, amount) => {
    await pg.goto(h.base + '/comptoir/caisse/ventes?jour=' + OLD);
    await pg.getByText('Journée clôturée').waitFor({ timeout: 8000 });
    await pg.locator('.sale-row').first().click();
    const sheet = pg.getByRole('dialog').first();
    await sheet.getByRole('button', { name: 'Rembourser' }).click();
    const rf = pg.getByRole('dialog').last();
    const chip = rf.getByRole('button', { name: 'Erreur de caisse' });
    await chip.click();
    const box = await chip.boundingBox();
    if (!box || box.height < 40) throw new Error('the reason chips are ' + (box ? Math.round(box.height) : 0) + ' px high: too small for a finger');
    await rf.locator('#rf-a').fill(String(amount));
    await rf.getByRole('button', { name: new RegExp('^Rembourser ' + amount) }).click();
    await pg.getByText(/Avoir A0/).first().waitFor({ timeout: 8000 });
  };

  await h.loginOwner(page);
  const today = (await call(page, '/api/v1/pulse')).json.today;
  const z0 = (await call(page, '/api/v1/closures?limit=10')).json.items.find((z) => z.day === OLD);
  if (!z0) throw new Error('the demo has no Z for ' + OLD);
  await refundOld(page, 3);
  await h.shot(page, 'till-sealed-day-refund-phone');

  // the counter's tablet, with a finger
  const tablet = await h.newPage({ viewport: { width: 1024, height: 768 }, mobile: true });
  await h.loginOwner(tablet);
  await refundOld(tablet, 2);
  await h.shot(tablet, 'till-sealed-day-refund-tablet');

  // both credit notes are today's; the sealed Z is what it was
  const t = (await call(page, '/api/v1/sales?day=' + today)).json.totals;
  if (t.refundsTotal !== 500) throw new Error('today shows ' + t.refundsTotal + ' c of credit notes, expected 500');
  const z1 = (await call(page, '/api/v1/closures?limit=10')).json.items.find((z) => z.day === OLD);
  if (z1.netTtc !== z0.netTtc || z1.refundsTotal !== z0.refundsTotal || z1.seal !== z0.seal) throw new Error('the sealed Z of ' + OLD + ' moved');

  // today sealed too: no button, the reason in words, and the server says the same
  const dr = (await call(page, '/api/v1/drawer')).json;
  let left = dr.open.expected;
  const counts = {};
  for (const c of [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]) { const n = Math.floor(left / c); if (n) { counts[c] = n; left -= n * c; } }
  if ((await call(page, '/api/v1/drawer/close', { counts })).status !== 200) throw new Error('the drawer count was refused');
  if ((await call(page, '/api/v1/closures', { early: true })).status !== 200) throw new Error('the Z was refused');
  await page.goto(h.base + '/comptoir/caisse/ventes?jour=' + OLD);
  await page.locator('.sale-row').nth(2).click();
  await page.getByText('La journée d’aujourd’hui est clôturée : l’avoir se fera demain, daté de demain.').waitFor({ timeout: 8000 });
  if (await page.getByRole('dialog').first().getByRole('button', { name: 'Rembourser' }).count()) throw new Error('« Rembourser » is offered although today is sealed');
  const id = (await call(page, '/api/v1/sales?day=' + OLD)).json.items[2].id;
  page.expect.push(/409 \(Conflict\)/);
  const no = await call(page, '/api/v1/sales/' + id + '/refund', { amount: 100, method: 'card', reason: 'Après le Z' });
  if (no.status !== 409 || !/demain/.test(no.json.error.message)) throw new Error('after the Z the server answered ' + no.status + ' ' + JSON.stringify(no.json));
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the page scrolls sideways on a phone');
};
