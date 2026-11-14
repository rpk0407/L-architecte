// FEATURE C · the barber's phone (390×844). JKut opens « Mon planning » in Mon espace: the strip of 14 days, his day with
// its total, the next day by a tap and by a swipe, a booking opened in its sheet. Then « Le client est là ? »: a booking
// of his that just started asks him on every page (the band), « Pas encore » puts it away and the desk reads it on the
// agenda, « Il est là » marks the other one arrived. 44 px targets, no colleague's client.
export const name = 'Barber phone: Mon planning (today and the next days) and « Le client est là ? »';
export const viewport = { width: 390, height: 844 };

const SHOTS = '/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/wf-shots/';
const must = (ok, what) => { if (!ok) throw new Error(what); };

async function pin(page, base, who, code) {
  await page.goto(base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: who }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
}
const small = (page, sel) => page.locator(sel).evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44));

export default async ({ h, page }) => {
  await h.setup();
  const boot = (await h.api('/api/v1/bootstrap')).json;
  const jkut = boot.staff.find((x) => x.name === 'JKut');
  const cut = boot.services.find((x) => x.slug === 'cl') || boot.services[0];
  // two clients of his whose time has just come (15:00 and 15:05 on the demo clock, 15:10): the desk booked them
  const min = boot.now ? new Date(boot.now) : null;
  must(min, 'no clock');
  const ids = [];
  for (const [first, start] of [['Anatole', 900], ['Basile', 905]]) {
    const r = await h.api('/api/v1/appointments', { headers: { origin: h.base }, body: { client: { first, phone: '06 77 00 ' + (start - 880) + ' 11' }, serviceIds: [cut.id], staffId: jkut.id, day: boot.today, start, force: true } });
    must(r.ok, 'booking ' + first + ': ' + r.status + ' ' + r.text);
    ids.push(r.json.id);
  }

  await pin(page, h.base, 'JKut', '2468');
  // « Le client est là ? » on the page he is on (the Accueil), one band per client
  const band = page.locator('.es-askband');
  await band.waitFor({ timeout: 15000 });
  await band.getByText('Anatole est là ?').waitFor();
  await band.getByText('Basile est là ?').waitFor();
  must(!(await small(page, '.es-askband button')).length, 'band targets under 44 px');
  await page.screenshot({ path: SHOTS + 'barbier-client-est-la.png' });
  // « Pas encore » for Anatole: gone from the band, the desk reads it on the agenda
  await band.locator('[data-arrival="' + ids[0] + '"]').getByRole('button', { name: 'Pas encore' }).click();
  await page.getByText('On te redemande dans 10 min').waitFor();
  await band.getByText('Anatole est là ?').waitFor({ state: 'detached', timeout: 8000 });
  const ag = (await h.api('/api/v1/agenda?day=' + boot.today)).json;
  const a0 = ag.appts.find((x) => x.id === ids[0]);
  must(a0.arrival && a0.arrival.later != null && a0.arrival.due === false, 'the desk does not see « Pas encore »: ' + JSON.stringify(a0.arrival));

  // Mon espace: the question as a card at the top; « Il est là » for Basile marks him arrived
  await page.goto(h.base + '/comptoir/espace');
  await page.getByRole('heading', { name: 'Mon espace', level: 1 }).waitFor();
  const card = page.locator('.es-asks [data-arrival="' + ids[1] + '"]');
  await card.waitFor({ timeout: 10000 });
  must(!(await page.locator('.es-askband').count()), 'the band shows on Mon espace too (the cards are there)');
  await card.getByRole('button', { name: 'Il est là' }).click();
  await page.getByText('Basile est arrivé').waitFor();
  const a1 = (await h.api('/api/v1/agenda?day=' + boot.today)).json.appts.find((x) => x.id === ids[1]);
  must(a1.status === 'arrived', 'Basile is not arrived: ' + a1.status);

  // « Mon planning »: the strip of 14 days, today's total, his own bookings
  await page.getByRole('button', { name: 'Mon planning' }).click();
  const plan = page.locator('[data-guide="espace.planning"]');
  await plan.waitFor();
  await plan.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
  must((await plan.locator('.es-sd').count()) === 14, 'the strip does not hold 14 days');
  await plan.locator('.es-total').getByText(/rendez-vous/).waitFor();
  await plan.getByText('Basile').first().waitFor();
  const text = await plan.innerText();
  for (const other of ['Frank', 'Le Soldat', 'Esteban']) must(!text.includes(other), other + ' is on JKut’s planning');
  must(!(await small(page, '.es-plan button')).length, 'planning targets under 44 px: ' + JSON.stringify(await small(page, '.es-plan button')));
  await page.waitForTimeout(3500); // the toast goes away
  await page.screenshot({ path: SHOTS + 'barbier-planning.png' });
  // a booking opens in its sheet, with the gestures of the moment and the way to the agenda
  await plan.locator('.es-tl-appt button', { hasText: 'Anatole' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Il est là' }).waitFor();
  await sheet.getByRole('button', { name: 'Ouvrir dans l’agenda' }).waitFor();
  await page.waitForTimeout(500); // the sheet's slide-in
  await page.screenshot({ path: SHOTS + 'barbier-planning-rdv.png' });
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
  // Basile in the chair: his sheet offers « Encaisser » (the phone checkout, FEATURE D), which opens on the booking
  must((await h.api('/api/v1/appointments/' + ids[1] + '/status', { headers: { origin: h.base }, body: { status: 'in_chair' } })).ok, 'Basile not in the chair');
  await plan.locator('.es-tl-appt.live button', { hasText: 'Basile' }).waitFor({ timeout: 10000 });
  await plan.locator('.es-tl-appt button', { hasText: 'Basile' }).click();
  await sheet.getByRole('button', { name: 'Encaisser' }).click();
  await page.getByRole('dialog').filter({ hasText: 'Sur ton téléphone' }).or(page.getByRole('heading', { name: 'Caisse', level: 1 })).first().waitFor({ timeout: 8000 });
  await page.goto(h.base + '/comptoir/espace?vue=planning');
  await plan.waitFor();
  // the next day: by the arrow, then back by a swipe to the right
  await plan.getByRole('button', { name: 'Jour suivant' }).click();
  await plan.getByRole('heading', { name: 'Demain' }).waitFor();
  const zone = await plan.locator('.es-plan-zone').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const y = zone.y + 60;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 60, y }] });
  for (let x = 60; x <= 320; x += 26) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await plan.getByRole('heading', { name: 'Aujourd’hui' }).waitFor({ timeout: 4000 });
  // a day further in the strip
  await plan.locator('.es-sd').nth(6).click();
  await plan.locator('.es-plan-h h2').filter({ hasNotText: /Aujourd’hui|Demain/ }).waitFor();
};
