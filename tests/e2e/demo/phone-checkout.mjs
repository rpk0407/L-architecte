// FEATURE D: a barber cashes his client on his own phone (Mon espace › Encaisser: the till's ticket in a bottom sheet),
// in cash; the owner then sees on the Caisse home what came in by method and by barber, the cash JKut holds, hands it
// to the drawer, and reads the month. A barber can never cash a colleague's client (403 own).
export const name = 'a barber cashes his client on his phone, the owner sees and collects the cash';
export const viewport = { width: 390, height: 844 };
export const mutates = true;

const PIN = '2468';

async function barber(page, base, who = 'JKut') {
  await page.goto(base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: who }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type(PIN);
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
}
const api = (page, path, body) => page.evaluate(async ([p, b]) => {
  const r = await fetch(p, b ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': crypto.randomUUID() }, body: JSON.stringify(b) } : {});
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body]);
const noSideScroll = async (page, where) => {
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(where + ' scrolls sideways on a phone');
};

export default async ({ h, page, browser }) => {
  await h.setup();
  // JKut's appointments today, his first unpaid one put in the chair; a colleague's for the refusal
  const me = await h.api('/api/v1/bootstrap');
  const staff = (me.json && me.json.staff) || [];
  const jkut = staff.find((s) => s.name === 'JKut');
  const other = staff.find((s) => s.chair && s.name !== 'JKut');
  if (!jkut || !other) throw new Error('demo barbers not found');
  const ag = await h.api('/api/v1/agenda?day=' + me.json.today);
  const open = (a) => !a.saleId && !a.legacy && ['booked', 'arrived', 'in_chair'].includes(a.status);
  const mine = ag.json.appts.filter((a) => a.staffId === jkut.id && open(a)).sort((a, b) => a.start - b.start)[0];
  const theirs = ag.json.appts.find((a) => a.staffId === other.id && open(a));
  if (!mine) throw new Error('JKut has no open appointment today in the demo');
  if (mine.status !== 'in_chair') {
    const r = await h.api('/api/v1/appointments/' + mine.id + '/status', { body: { status: 'in_chair' } });
    if (!r.ok) throw new Error('could not seat the client: ' + r.status + ' ' + r.text);
  }

  await barber(page, h.base);
  await page.goto(h.base + '/comptoir/espace');
  await page.locator('#page-title h1', { hasText: 'Mon espace' }).waitFor({ timeout: 8000 });
  // the server refuses a colleague's client on the phone, whatever the screen shows
  if (theirs) {
    if (page.expect) page.expect.push(/403/);
    const r = await api(page, '/api/v1/sales', { apptId: theirs.id, lines: theirs.services.map((s) => ({ kind: 'service', ref: s.id })), payments: [{ method: 'card', amount: theirs.price }], phone: true });
    if (r.status !== 403 || r.json?.error?.code !== 'own') throw new Error('a colleague’s client was not refused: ' + r.status + ' ' + JSON.stringify(r.json));
  }
  const pay = page.locator('[data-guide="phone-pay"]').first();
  await pay.waitFor({ timeout: 8000 });
  await pay.click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Sur ton téléphone' });
  await sheet.waitFor();
  await sheet.getByText('Comment paie-t-il ?').waitFor({ timeout: 8000 });
  await noSideScroll(page, 'the phone checkout');
  await h.shot(page, 'phone-checkout');
  // the smallest phones: the ticket still fits, then back to 390
  await page.setViewportSize({ width: 320, height: 640 });
  await noSideScroll(page, 'the phone checkout at 320 px');
  await page.setViewportSize(viewport);
  await sheet.getByRole('button', { name: /Espèces/ }).click();
  const cash = page.getByRole('dialog', { name: 'Paiement en espèces' });
  await cash.waitFor();
  await cash.getByRole('button', { name: 'Le compte' }).click();
  await cash.getByRole('button', { name: /^Valider/ }).click();
  await sheet.getByRole('button', { name: /Valider l’encaissement/ }).click();
  await sheet.getByText(/Encaissé ·/).waitFor({ timeout: 8000 });
  for (const s of ['whatsapp', 'email']) await sheet.locator('[data-share="' + s + '"]').waitFor({ timeout: 8000 }).catch(() => { throw new Error('no ' + s + ' receipt link'); });
  const wa = await sheet.locator('[data-share="whatsapp"]').getAttribute('href');
  if (!/wa\.me\/\?text=.*recu/.test(wa || '')) throw new Error('the WhatsApp link carries no receipt link: ' + wa);
  await h.shot(page, 'phone-checkout-done');
  // Mon espace reads itself again every minute (the paid row loses its button, « Prochain client » moves on): the receipt stays
  const before = await page.locator('[data-guide="phone-pay"]').count();
  if (page.context().clock) await page.clock.fastForward(65000).catch(() => {});
  await page.waitForFunction((n) => document.querySelectorAll('[data-guide="phone-pay"]').length < n, before, { timeout: 5000 }).catch(() => { throw new Error('Mon espace did not read itself again (' + before + ' buttons)'); });
  await sheet.locator('[data-share="whatsapp"]').waitFor({ timeout: 4000 }).catch(() => { throw new Error('the receipt left the screen when Mon espace refreshed'); });
  await sheet.getByRole('button', { name: 'Terminé' }).click();
  await sheet.waitFor({ state: 'detached', timeout: 4000 });
  // and a booking still to come today is not rung up on the phone (the client must be there)
  const later = ag.json.appts.filter((a) => a.staffId === jkut.id && a.status === 'booked' && !a.saleId && a.start > 15 * 60 + 30).sort((a, b) => a.start - b.start)[0];
  if (later) {
    if (page.expect) page.expect.push(/409/);
    const r = await api(page, '/api/v1/sales', { apptId: later.id, lines: later.services.map((s) => ({ kind: 'service', ref: s.id })), payments: [{ method: 'card', amount: later.price }], phone: true });
    if (r.status !== 409 || r.json?.error?.code !== 'not_yet') throw new Error('a client still to come was rung up on the phone: ' + r.status + ' ' + JSON.stringify(r.json));
  }

  // the owner: the day by method and by barber, JKut's cash apart, handed to the drawer, then the month
  const owner = h.newPage ? await h.newPage({ viewport }) : await (await browser.newContext({ viewport, locale: 'fr-FR', timezoneId: 'Europe/Paris' })).newPage();
  try {
    await h.loginOwner(owner);
    const day = await api(owner, '/api/v1/caisse/jour');
    const held = day.json.held.find((x) => x.id === jkut.id);
    if (!held || held.amount < mine.price) throw new Error('JKut’s cash is not held: ' + JSON.stringify(day.json.held));
    if (!day.json.staff.some((x) => x.id === jkut.id && x.cash >= mine.price)) throw new Error('JKut’s cash is not on his row');
    await owner.goto(h.base + '/comptoir/caisse');
    await owner.getByText('Encaissé aujourd’hui').first().waitFor({ timeout: 8000 });
    const block = owner.locator('[data-guide="cs-held"]');
    await block.getByText('JKut').waitFor();
    await noSideScroll(owner, 'the Caisse home');
    await block.scrollIntoViewIfNeeded();
    await h.shot(owner, 'caisse-home-day');
    if (!(await api(owner, '/api/v1/drawer')).json.open) {
      const r = await api(owner, '/api/v1/drawer/open', { float: 15000 });
      if (r.status !== 200) throw new Error('drawer open: ' + r.status);
      await owner.reload();
    }
    await block.getByRole('button', { name: 'Remis à la caisse' }).click();
    await owner.getByRole('dialog').getByRole('button', { name: 'Remis à la caisse' }).click();
    await block.waitFor({ state: 'detached', timeout: 8000 });
    const after = await api(owner, '/api/v1/caisse/jour');
    if (after.json.held.some((x) => x.id === jkut.id)) throw new Error('the handed cash is still held');
    await owner.goto(h.base + '/comptoir/caisse/mois');
    await owner.getByText('Par barbier').first().waitFor({ timeout: 8000 });
    await owner.getByText('JKut').first().waitFor();
    await noSideScroll(owner, 'the month');
    await h.shot(owner, 'caisse-month');
  } finally { if (!h.newPage) await owner.context().close(); }
};
