// The carnet at the salon: the desk sells it in « Nouveau rendez-vous » and books its five dates in the same sheet;
// the agenda says « coupe 1 sur 5 »; at the first visit the till puts the carnet (80 €) and its first cut on the
// ticket; at the second visit the cut is covered, nothing to pay, and the carnet counts 2 of 5.
export const name = 'comptoir: the carnet sold with five dates, 80 € at the first visit, a credit at the second';

const T = 10000;
const OUT = process.env.OFFRE_SHOTS || '';

export default async ({ h, page }) => {
  let at = 'start';
  const step = (x) => { at = x; };
  try { await run(h, page, step); } catch (e) { throw new Error(at + ': ' + e.message.split('\n')[0]); }
};

async function run(h, page, step) {
  await h.loginOwner(page);
  const call = (path, body, method) => page.evaluate(async ([p, b, m]) => {
    const r = await fetch(p, b ? { method: m || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body, method]);
  const pulse = (await call('/api/v1/pulse')).json;

  step('the sheet: client, carnet, first date, the four others');
  await page.goto(h.base + '/comptoir/agenda?new=1');
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('heading', { name: 'Nouveau rendez-vous' }).waitFor({ timeout: T });
  await sheet.getByRole('button', { name: 'Nouveau client' }).click();
  await sheet.locator('#nc-f').fill('Walid');
  await sheet.locator('#nc-l').fill('Carnet');
  await sheet.locator('#nc-p').fill('0611000022');
  await sheet.getByRole('switch', { name: /Carnet 5 coupes/ }).click();
  await sheet.locator('.slot').first().waitFor({ timeout: T });
  await sheet.locator('.slot').first().click();
  const dates = sheet.locator('[data-guide="agenda-carnet-dates"]');
  await dates.locator('.pick-r').nth(3).waitFor({ timeout: T });
  if ((await dates.locator('.pick-r').count()) !== 4) throw new Error('not four other dates');
  await h.shot(page, 'comptoir-carnet-sheet');
  await sheet.getByRole('button', { name: 'Réserver les 5 dates' }).click();
  await page.getByText(/Carnet 5 coupes : 5 dates réservées/).first().waitFor({ timeout: T });

  step('five dates in the agenda, « coupe 1 sur 5 », nothing paid');
  const cl = (await call('/api/v1/clients?q=0611000022')).json.items[0];
  if (!cl) throw new Error('no file for the client');
  const file = (await call('/api/v1/clients/' + cl.id)).json;
  const mine = file.appts.filter((a) => a.status === 'booked').sort((a, b) => (a.day + String(a.start).padStart(4, '0')).localeCompare(b.day + String(b.start).padStart(4, '0')));
  if (mine.length !== 5) throw new Error(mine.length + ' dates, not five');
  if (mine[0].day !== pulse.today) throw new Error('the first date is not today: ' + mine[0].day);
  if (file.packs.length) throw new Error('a carnet exists before any ticket');
  const d1 = (await call('/api/v1/appointments/' + mine[0].id)).json.appt;
  if (!d1.formule || d1.formule.n !== 1 || d1.formule.of !== 5 || d1.formule.pay !== 'due' || !d1.formule.sell) throw new Error('the first date does not say « coupe 1 sur 5 », to pay: ' + JSON.stringify(d1.formule));
  await page.goto(h.base + '/comptoir/agenda?rdv=' + mine[0].id);
  await page.getByRole('dialog').getByText('Coupe 1 sur 5').first().waitFor({ timeout: T });
  await page.keyboard.press('Escape');

  step('first visit: the till asks for the 80 €');
  if ((await call('/api/v1/appointments/' + mine[0].id + '/status', { status: 'in_chair' })).status !== 200) throw new Error('could not seat the client');
  // on a phone too (the barber's checkout is the same ticket)
  const small = await h.newPage({ viewport: { width: 390, height: 844 } });
  await h.loginOwner(small);
  await small.goto(h.base + '/comptoir/caisse?rdv=' + mine[0].id);
  await small.locator('.ticket').waitFor({ timeout: T });
  await small.getByText('Coupe 1 sur 5').first().waitFor({ timeout: T });
  await small.getByText(/le carnet s’encaisse sur ce ticket/).waitFor({ timeout: T });
  if ((await small.evaluate(() => document.scrollingElement.scrollWidth)) > 390) throw new Error('the ticket scrolls sideways on a phone');
  await h.shot(small, 'comptoir-carnet-caisse-390');
  if (OUT) { await small.waitForTimeout(600); await small.screenshot({ path: OUT + '/comptoir-carnet-caisse-390.png' }); }
  await small.close();
  await page.goto(h.base + '/comptoir/caisse?rdv=' + mine[0].id);
  await page.locator('.ticket').waitFor({ timeout: T });
  await page.getByText('Couvert par le carnet').first().waitFor({ timeout: T });
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await page.getByRole('button', { name: /Valider l’encaissement · 80\s€/ }).click();
  await page.getByText('Encaissé').first().waitFor({ timeout: T });
  let sales = (await call('/api/v1/sales?day=' + pulse.today)).json.items;
  const s1 = sales.find((x) => x.apptId === mine[0].id);
  if (!s1 || s1.totals.due !== 8000 || s1.lines.map((l) => l.kind).join() !== 'pack,service') throw new Error('first ticket: ' + JSON.stringify(s1 && { due: s1.totals.due, lines: s1.lines.map((l) => l.kind) }));
  let packs = (await call('/api/v1/clients/' + cl.id)).json.packs;
  if (packs.length !== 1 || packs[0].used !== 1 || packs[0].total !== 5) throw new Error('the carnet is not 1 of 5: ' + JSON.stringify(packs));

  step('second visit: the cut is covered, nothing to pay');
  // the second date is brought to today (a client who comes back the same week is the salon's call)
  const mv = await call('/api/v1/appointments/' + mine[1].id + '/move', { day: pulse.today, start: mine[0].start + 30, staffId: mine[0].staffId, force: true });
  if (mv.status !== 200) throw new Error('could not move the second date: ' + JSON.stringify(mv.json));
  if ((await call('/api/v1/appointments/' + mine[1].id + '/status', { status: 'in_chair' })).status !== 200) throw new Error('could not seat the client again');
  const d2 = (await call('/api/v1/appointments/' + mine[1].id)).json.appt;
  if (d2.formule.n !== 2 || d2.formule.pay !== 'paid' || d2.formule.sell) throw new Error('the second date: ' + JSON.stringify(d2.formule));
  await page.goto(h.base + '/comptoir/caisse?rdv=' + mine[1].id);
  await page.locator('.ticket').waitFor({ timeout: T });
  await page.getByText(/Coupe 2 sur 5/).first().waitFor({ timeout: T });
  await page.getByText('Couvert par le carnet').first().waitFor({ timeout: T });
  await h.shot(page, 'comptoir-carnet-caisse-2');
  await page.getByRole('button', { name: /Valider l’encaissement · 0\s€/ }).click();
  await page.getByText('Encaissé').first().waitFor({ timeout: T });
  sales = (await call('/api/v1/sales?day=' + pulse.today)).json.items;
  const s2 = sales.find((x) => x.apptId === mine[1].id);
  if (!s2 || s2.totals.due !== 0) throw new Error('second ticket: ' + JSON.stringify(s2 && s2.totals));
  packs = (await call('/api/v1/clients/' + cl.id)).json.packs;
  if (packs[0].used !== 2) throw new Error('the carnet is not 2 of 5: ' + JSON.stringify(packs));
  // the month counts the 80 € once, the day they were paid
  const month = (await call('/api/v1/till/month?month=' + pulse.today.slice(0, 7))).json;
  if (month && typeof month.takings === 'number' && month.takings < 8000) throw new Error('the month does not count the carnet: ' + month.takings);
}
