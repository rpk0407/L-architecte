// A barber edits one client file at a time: the Clients list offers him no selection and no action on many files, the
// server refuses the bulk endpoint (403), and a single file's tags stay his to change.
export const name = 'a barber gets no bulk action on client files; one file at a time stays his';

export default async ({ h, page }) => {
  await page.goto(h.base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: 'JKut' }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type('2468');
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });

  await page.goto(h.base + '/comptoir/clients');
  await page.locator('.cl-row').first().waitFor({ timeout: 8000 });
  if (await page.getByRole('button', { name: 'Sélectionner' }).count()) throw new Error('« Sélectionner » is offered to a barber');
  if (await page.locator('.lk-bar').count()) throw new Error('the selection bar is shown to a barber');
  for (const t of ['Étiqueter', 'Envoyer un SMS', 'Exporter la sélection', 'Tout sélectionner']) if (await page.getByText(t).locator('visible=true').count()) throw new Error('« ' + t + ' » is shown to a barber');
  // a row opens the file, it does not tick it
  const first = page.locator('.cl-row').first();
  if ((await first.getAttribute('aria-pressed')) !== null) throw new Error('the rows are in selection mode');
  await first.click();
  await h.expectText(page, 'Fiche technique');
  await h.shot(page, 'barber-clients');

  // the server refuses the bulk endpoint, in plain words; nothing is tagged
  const ids = await page.evaluate(async () => (await (await fetch('/api/v1/clients?limit=3')).json()).items.map((c) => c.id));
  page.expect.push(/403/);
  const bulk = await page.evaluate(async (list) => {
    const r = await fetch('/api/v1/clients/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'tag', ids: list, tag: 'Essai' }) });
    return { status: r.status, json: await r.json() };
  }, ids);
  if (bulk.status !== 403) throw new Error('the bulk tag answered ' + bulk.status);
  if (!/une fiche à la fois/.test(bulk.json.error.message)) throw new Error('the refusal reads: ' + bulk.json.error.message);
  // one file at a time stays his
  const one = await page.evaluate(async (id) => {
    const r = await fetch('/api/v1/clients/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tags: ['Essai'] }) });
    const f = await (await fetch('/api/v1/clients/' + id)).json();
    return { status: r.status, tags: (f.client || f).tags };
  }, ids[0]);
  if (one.status !== 200 || !(one.tags || []).includes('Essai')) throw new Error('a single file edit was refused to the barber: ' + JSON.stringify(one));
  const other = await page.evaluate(async (id) => { const f = await (await fetch('/api/v1/clients/' + id)).json(); return (f.client || f).tags || []; }, ids[1]);
  if (other.includes('Essai')) throw new Error('the refused bulk tag was written');

  // on his phone, the avatar menu offers « Comment marche cette page ? » only where the page has guide steps for him
  const phone = await h.newPage({ viewport: { width: 390, height: 844 }, mobile: true });
  await phone.goto(h.base + '/comptoir');
  await phone.getByRole('button', { name: /poste du salon/ }).click();
  await phone.locator('.team button', { hasText: 'JKut' }).click();
  await phone.locator('.keypad').waitFor();
  await phone.keyboard.type('2468');
  await phone.keyboard.press('Enter');
  await phone.locator('#page-title h1').waitFor({ timeout: 10000 });
  const helpOn = async (path) => {
    await phone.goto(h.base + path);
    await phone.locator('#page-title h1').waitFor({ timeout: 8000 });
    await phone.waitForTimeout(600);
    await phone.getByRole('button', { name: 'Mon compte' }).click();
    await phone.getByRole('menu').getByText('Thème').waitFor({ timeout: 3000 });
    await phone.waitForTimeout(400);
    const n = await phone.getByRole('menu').getByText('Comment marche cette page ?').count();
    await phone.keyboard.press('Escape');
    return n;
  };
  if (await helpOn('/comptoir/agenda') !== 1) throw new Error('the help link is missing on the agenda, which has guide steps');
  if (await helpOn('/comptoir/catalogue') !== 0) throw new Error('the help link is offered on a page with no guide steps for a barber');
};
