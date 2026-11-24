// The formule sold on the spot, the client standing at the counter. Two ways in, both a tap from where the barber is:
//   - the agenda's « Formule » button opens « Vendre la formule » with the formule already switched on: the client, the
//     first slot, the four other dates proposed, « Réserver les 5 dates »; the sheet says where the 80 € are taken (the
//     till, on the ticket of his first cut), and the first date opens with « Encaisser » when it is today;
//   - after a plain cut, the till's done screen offers « Lui vendre la formule »: the same sheet, on his file.
export const name = 'comptoir: the formule sold on the spot (agenda button, till offer), paid at the till';

const T = 10000;
const WF = process.env.WF_SHOTS || '';

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

  step('the agenda’s « Formule » button: the sheet opens on the formule');
  await page.goto(h.base + '/comptoir/agenda');
  await page.locator('[data-guide="ag-formule"]').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('heading', { name: 'Vendre la formule' }).waitFor({ timeout: T });
  const sw = sheet.getByRole('switch', { name: /Formule Entretien 5 semaines/ });
  if ((await sw.getAttribute('aria-checked')) !== 'true') throw new Error('the formule is not switched on already');
  await sheet.getByText(/s’encaissent à la caisse, à sa première coupe/).waitFor({ timeout: T });
  await sheet.getByRole('button', { name: 'Nouveau client' }).click();
  await sheet.locator('#nc-f').fill('Ilyes');
  await sheet.locator('#nc-l').fill('Surplace');
  await sheet.locator('#nc-p').fill('0611000033');
  await sheet.locator('.slot').first().waitFor({ timeout: T });
  await sheet.locator('.slot').first().click();
  const dates = sheet.locator('[data-guide="agenda-carnet-dates"]');
  await dates.locator('.pick-r').nth(3).waitFor({ timeout: T });
  // where the money is taken, said before the tap
  const pay = sheet.locator('[data-guide="agenda-carnet-pay"]');
  await pay.waitFor({ timeout: T });
  const words = (await pay.innerText()).replace(/\s/g, ' ');
  if (!/^80 € à la caisse, aujourd’hui\./.test(words)) throw new Error('the sheet does not say where the 80 € are taken: ' + words);
  if (WF) { await pay.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await page.screenshot({ path: WF + '/comptoir-formule-vente.png' }); }
  await sheet.getByRole('button', { name: 'Réserver les 5 dates' }).click();
  await page.getByText(/Formule Entretien 5 semaines : 5 dates réservées/).first().waitFor({ timeout: T });
  await page.getByText(/80\s€ à encaisser aujourd’hui : ouvre son rendez-vous, « Encaisser »/).first().waitFor({ timeout: T });

  step('his first date opens by itself; the till takes the 80 €');
  const cl = (await call('/api/v1/clients?q=0611000033')).json.items[0];
  const file = (await call('/api/v1/clients/' + cl.id)).json;
  const mine = file.appts.filter((a) => a.status === 'booked').sort((a, b) => (a.day + String(a.start).padStart(4, '0')).localeCompare(b.day + String(b.start).padStart(4, '0')));
  if (mine.length !== 5 || mine[0].day !== pulse.today) throw new Error('not five dates from today: ' + JSON.stringify(mine.map((a) => a.day)));
  await page.getByRole('dialog').getByText('Visite 1 sur 5').first().waitFor({ timeout: T });
  await page.goto(h.base + '/comptoir/caisse?rdv=' + mine[0].id);
  await page.locator('.ticket').waitFor({ timeout: T });
  await page.getByText(/la formule s’encaisse sur ce ticket/).waitFor({ timeout: T });
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await page.getByRole('button', { name: /Valider l’encaissement · 80\s€/ }).click();
  await page.getByText('Encaissé').first().waitFor({ timeout: T });
  // he holds a formule now: nothing more is offered to him
  if (await page.locator('[data-guide="till-formule"]').count()) throw new Error('the formule is offered to a client who just bought it');
  const packs = (await call('/api/v1/clients/' + cl.id)).json.packs;
  if (packs.length !== 1 || packs[0].used !== 1 || packs[0].total !== 5) throw new Error('the formule is not 1 of 5: ' + JSON.stringify(packs));

  step('after a plain cut, the till offers the formule on his file');
  const cat = (await call('/api/v1/catalog')).json;
  const cut = cat.services.find((x) => x.slug === 'cl');
  const agenda = (await call('/api/v1/agenda?day=' + pulse.today)).json;
  const lane = agenda.lanes.find((l) => l.id === mine[0].staffId) || agenda.lanes[0];
  const made = await call('/api/v1/appointments', { client: { first: 'Rayan', last: 'Coupe', phone: '0611000044' }, serviceIds: [cut.id], staffId: lane.id, day: pulse.today, start: mine[0].start + 60, source: 'salon', force: true });
  if (made.status !== 200) throw new Error('could not book the plain cut: ' + JSON.stringify(made.json));
  if ((await call('/api/v1/appointments/' + made.json.id + '/status', { status: 'in_chair' })).status !== 200) throw new Error('could not seat him');
  await page.goto(h.base + '/comptoir/caisse?rdv=' + made.json.id);
  await page.locator('.ticket').waitFor({ timeout: T });
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await page.getByRole('button', { name: /Valider l’encaissement/ }).click();
  await page.getByText('Encaissé').first().waitFor({ timeout: T });
  const offer = page.locator('[data-guide="till-formule"]');
  await offer.waitFor({ timeout: T });
  await offer.getByText(/Formule Entretien 5 semaines : 5 coupes pour 80\s€, une par semaine\./).waitFor({ timeout: T });
  if (WF) { await offer.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await page.screenshot({ path: WF + '/comptoir-formule-offre-caisse.png' }); }
  await offer.getByRole('button', { name: 'Lui vendre la formule' }).click();
  const again = page.getByRole('dialog');
  await again.getByRole('heading', { name: 'Vendre la formule' }).waitFor({ timeout: T });
  await again.getByText('Rayan Coupe').first().waitFor({ timeout: T });
  if ((await again.getByRole('switch', { name: /Formule Entretien 5 semaines/ }).getAttribute('aria-checked')) !== 'true') throw new Error('the formule is not switched on from the till’s offer');
}
