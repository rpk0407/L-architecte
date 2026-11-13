// The agenda and the Accueil on the manager's phone (390 × 844, touch). The agenda: a week strip with the load of each
// day, « Salon » (every chair side by side, nothing scrolls sideways), « Barbier », « Liste », the choice remembered;
// a swipe changes day (a vertical drag does not), a free stretch reads « Libre … » and books there with the barber and
// the hour already chosen, an appointment opens its sheet with its actions. The Accueil: what waits for a gesture comes
// before the rest of the day, a busy chair opens its client, the three quick gestures sit above the tabs.
export const name = 'phone agenda: week strip, Salon / Barbier / Liste, swipe a day, book in a free stretch, open a sheet; Accueil: quick gestures';
export const viewport = { width: 390, height: 844 };

const must = (ok, what) => { if (!ok) throw new Error(what); };
const TODAY = '2026-10-27';

/** A finger dragged across the screen (real touch events, as a phone sends them). */
async function drag(page, x0, y0, x1, y1, steps = 8) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  // Chromium drops a tap made in the 300 ms that follow a fast flick (it reads it as stopping the flick)
  await page.waitForTimeout(600);
}
/** A touch on a day of the week strip (once more if the browser took the first one for the end of a flick). */
async function tapDay(page, i, day) {
  for (let n = 0; n < 2 && dayOf(page) !== day; n++) {
    await page.locator('.agp-d').nth(i).tap();
    await page.waitForFunction((d) => (new URL(location.href).searchParams.get('day') || '2026-10-27') === d, day, { timeout: 1500 }).catch(() => {});
  }
  await waitDay(page, day);
}
const dayOf = (page) => new URL(page.url()).searchParams.get('day') || TODAY;
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
/** a height of the screen where the planning is, clear of the sticky head and of the quick gestures */
async function inPlanning(page) {
  const head = await page.locator('.agp-sticky').boundingBox();
  const dock = await page.locator('.dock').boundingBox();
  const y = Math.round((head.y + head.height + dock.y) / 2);
  must(await page.evaluate((py) => !!document.elementFromPoint(200, py)?.closest('.agp-zone'), y), 'the planning is not under the finger at ' + y);
  return y;
}
async function waitDay(page, day) {
  await page.waitForFunction((d) => (new URL(location.href).searchParams.get('day') || '2026-10-27') === d, day, { timeout: 4000 }).catch(() => {});
  must(dayOf(page) === day, 'expected the day ' + day + ', the agenda shows ' + dayOf(page));
  await page.locator('.agp-d[aria-pressed="true"]').waitFor();
}

export default async ({ h }) => {
  const page = await h.newPage({ viewport, mobile: true });
  await h.loginOwner(page);

  /* ---------- the Accueil: order, a busy chair, the quick gestures ---------- */
  await page.locator('.hm-chair').first().waitFor({ timeout: 8000 });
  const yOf = async (sel) => (await page.locator(sel).first().boundingBox()).y;
  const order = [await yOf('[data-guide="accueil.prochain"]'), await yOf('[data-guide="accueil.fauteuils"]'), await yOf('[data-guide="accueil.cartes"]'), await yOf('[data-guide="accueil.jour"]')];
  must(order.every((y, i) => i === 0 || y > order[i - 1]), 'on a phone: Prochain, Fauteuils, À traiter, then Aujourd’hui: ' + JSON.stringify(order));
  must(await page.locator('.hm-appts > li').count() <= 6, 'a phone shows six rows of « Aujourd’hui » at most');
  const dock = page.locator('.dock');
  for (const label of ['Rendez-vous', 'Passage', 'Encaisser']) {
    const b = await dock.locator('button', { hasText: label }).boundingBox();
    must(b && b.height >= 44 && b.y > 844 - 220 && b.y + b.height < 844 - 56, '« ' + label + ' » is not under the thumb, above the tabs: ' + JSON.stringify(b));
  }
  must(!(await sideways(page)), 'the Accueil scrolls sideways');
  // a busy chair names its client and opens his appointment
  const busy = page.locator('.hm-chair-o').first();
  must(/avec /.test(await busy.innerText()), 'a busy chair does not say with whom: ' + JSON.stringify(await busy.innerText()));
  await busy.tap();
  const sheet = page.getByRole('dialog');
  await sheet.getByText('Au fauteuil').first().waitFor({ timeout: 8000 });
  must(/\/comptoir\/accueil$/.test(page.url()), 'a touch on a chair left the Accueil');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  // « Rendez-vous » opens the booking sheet in place
  await dock.locator('button', { hasText: 'Rendez-vous' }).tap();
  await sheet.getByRole('heading', { name: 'Nouveau rendez-vous' }).waitFor({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  await h.shot(page, 'phone-accueil');

  /* ---------- the agenda: the whole salon on one screen ---------- */
  await page.goto(h.base + '/comptoir/agenda');
  await page.locator('.agp[data-view="salon"] .agp-lane').first().waitFor({ timeout: 8000 });
  must(await page.locator('.agp-lane').count() === 4, 'the four chairs side by side');
  const lanes = await page.locator('.agp-lane').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
  must(lanes.every(([l, r]) => l >= 0 && r <= 390 && r - l >= 70), 'a chair is off the screen or too narrow: ' + JSON.stringify(lanes));
  must(!(await sideways(page)), 'the agenda scrolls sideways with four chairs');
  const heads = await page.locator('.agp-h').allInnerTexts();
  for (const n of ['JKut', 'Frank', 'Le Soldat', 'Esteban']) must(heads.some((t) => t.includes(n)), n + ' has no column head: ' + JSON.stringify(heads));
  must(heads.some((t) => /Libre|Occupé/.test(t)), 'no chair says whether it is free: ' + JSON.stringify(heads));
  // the week strip: seven days, today marked and chosen, each open day with its load in words
  const strip = page.locator('.agp-d');
  must(await strip.count() === 7, 'the week strip has seven days');
  must((await page.locator('.agp-d[aria-current="date"]').getAttribute('aria-pressed')) === 'true', 'today is not the day chosen');
  await page.waitForFunction(() => [...document.querySelectorAll('.agp-d')].some((b) => /rempli à|complet/.test(b.getAttribute('aria-label') || '')), null, { timeout: 8000 });
  const labels = await strip.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  must(/fermé/.test(labels[0]) && /aujourd’hui, (rempli à \d+ %|complet)/.test(labels[1]), 'the strip does not say how full the days are: ' + JSON.stringify(labels));
  const box = await strip.nth(3).boundingBox();
  must(box.height >= 44 && box.width >= 44, 'a day of the strip is under 44 px: ' + JSON.stringify(box));
  // the line of the hour, what is free in words, and the head that stays in sight
  must(await page.locator('.agp-now').count() === 1, 'no line of the hour today');
  const free = page.locator('.agp-lane .fr');
  must(await free.count() >= 2 && /^Libre /.test((await free.first().innerText()).trim()), 'a free stretch does not read « Libre … »');
  const head = await page.locator('.agp-sticky').boundingBox();
  must(head.y >= 40 && head.y < 80 && (await page.evaluate(() => scrollY)) > 100, 'the planning did not open on the hour, its head under the title bar: ' + JSON.stringify(head));
  await h.shot(page, 'phone-agenda-salon');

  /* ---------- a swipe changes day; up and down is the page ---------- */
  const y = await inPlanning(page);
  await drag(page, 330, y, 60, y + 8);
  await waitDay(page, '2026-10-28');
  must((await page.locator('.agp-d[aria-pressed="true"]').innerText()).includes('28'), 'the strip did not follow the swipe');
  must(await page.locator('.agp-now').count() === 0, 'a line of the hour on another day');
  const before = await page.evaluate(() => scrollY);
  await drag(page, 200, y + 40, 205, y - 50, 16);
  await page.waitForTimeout(500);
  must(dayOf(page) === '2026-10-28', 'a vertical drag changed the day');
  must((await page.evaluate(() => scrollY)) > before, 'a vertical drag did not scroll the page');
  const y2 = await inPlanning(page);
  await drag(page, 60, y2, 330, y2 + 8);
  await waitDay(page, TODAY);
  // a touch on the strip jumps; « Aujourd’hui » comes back
  await tapDay(page, 4, '2026-10-30');
  await page.getByRole('button', { name: 'Aujourd’hui', exact: true }).tap();
  await waitDay(page, TODAY);
  // a closed day can be left by a swipe too
  await tapDay(page, 0, '2026-10-26');
  await h.expectText(page, 'Fermé ce jour-là');
  await drag(page, 330, 500, 60, 506);
  await waitDay(page, TODAY);

  /* ---------- Liste and Barbier, the choice remembered ---------- */
  await page.getByRole('button', { name: 'Liste', exact: true }).tap();
  await page.locator('.agp[data-view="liste"] .agp-row').first().waitFor();
  must(await page.locator('.agp-hour').count() >= 5, 'the list is not grouped by hour');
  const states = (await page.locator('.agp-st').allInnerTexts()).join(' | ');
  must(/Terminé/.test(states) && /Au fauteuil/.test(states) && /À venir/.test(states), 'the list does not say the state of each appointment: ' + states.slice(0, 200));
  const row = await page.locator('.agp-row').first().boundingBox();
  must(row.height >= 44, 'a row of the list is under 44 px');
  await h.shot(page, 'phone-agenda-liste');
  await page.reload();
  await page.locator('.agp[data-view="liste"] .agp-row').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Barbier', exact: true }).tap();
  await page.locator('.agp[data-view="barbier"] .agp-lane').first().waitFor();
  must(await page.locator('.agp-lane').count() === 1, '« Barbier » shows one chair');
  const picked = () => page.locator('.lane-pick .chip[aria-pressed="true"]').innerText();
  const first = await picked();
  const yb = await inPlanning(page);
  await drag(page, 330, yb, 60, yb + 8);
  await page.waitForFunction((n) => document.querySelector('.lane-pick .chip[aria-pressed="true"]')?.textContent !== n, first, { timeout: 4000 }).catch(() => {});
  must((await picked()) !== first && dayOf(page) === TODAY, 'in « Barbier » a swipe changes barber, not day: ' + first + ' → ' + (await picked()) + ', ' + dayOf(page));
  await h.shot(page, 'phone-agenda-barbier');
  await page.getByRole('button', { name: 'Salon', exact: true }).tap();
  await page.locator('.agp[data-view="salon"] .agp-lane').first().waitFor();

  /* ---------- a free stretch books there: the barber and the hour are chosen ---------- */
  // the longest free stretch of the afternoon, touched at its top: its first quarter
  const pick = await free.evaluateAll((els) => { let best = -1, h0 = 0; els.forEach((e, i) => { const r = e.getBoundingClientRect(); if (r.height > h0) { h0 = r.height; best = i; } }); return best; });
  const slot = free.nth(pick);
  const said = await slot.getAttribute('aria-label');
  const who = /chez (.+?), de (\d+ h(?: \d+)?)/.exec(said.replace(/[  ]/g, ' '));
  must(who, 'a free stretch does not name its barber and its hours: ' + said);
  await slot.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, -160));
  await slot.tap({ position: { x: 30, y: 6 } });
  await sheet.getByRole('heading', { name: 'Nouveau rendez-vous' }).waitFor({ timeout: 8000 });
  const kicker = (await sheet.locator('.k').first().innerText()).replace(/[  ]/g, ' ').toLowerCase();
  must(kicker.includes(who[1].toLowerCase()) && kicker.includes(who[2]), 'the new booking does not start on ' + who[1] + ' at ' + who[2] + ': ' + kicker);
  await sheet.getByRole('button', { name: 'Sans fiche' }).tap();
  await sheet.locator('#nc-n').fill('Client Pouce');
  await sheet.locator('.chip', { hasText: /^Coupe/ }).first().tap();
  await h.shot(page, 'phone-agenda-book');
  await sheet.getByRole('button', { name: 'Réserver' }).tap();
  await h.expectText(page, 'Rendez-vous réservé');
  // the sheet of the new appointment opens, with the gestures of the day
  await sheet.getByRole('heading', { name: 'Client Pouce' }).waitFor({ timeout: 8000 });
  for (const b of ['Arrivé', 'Installer', 'Déplacer', 'Absent', 'Annuler']) await sheet.getByRole('button', { name: b, exact: true }).waitFor({ timeout: 4000 });
  await h.shot(page, 'phone-agenda-sheet');
  await sheet.getByRole('button', { name: 'Arrivé', exact: true }).tap();
  await h.expectText(page, 'Client est arrivé');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  await page.locator('.agp-ap.st-arrived', { hasText: 'Client Pouce' }).waitFor({ timeout: 8000 }).catch(() => { throw new Error('the planning does not show him arrived'); });
  // a touch on an appointment opens its sheet; a client with a number can be called from it
  await page.locator('.agp-ap.st-booked').first().tap();
  await sheet.getByRole('button', { name: 'Déplacer', exact: true }).waitFor({ timeout: 8000 });
  must(await sheet.getByRole('link', { name: 'Appeler' }).count() === 1, 'no « Appeler » for a client with a number');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  // the quick gestures are the same as on the Accueil
  await page.locator('.dock button', { hasText: 'Passage' }).tap();
  await sheet.getByRole('button', { name: 'Ajouter à la file' }).waitFor({ timeout: 8000 });
  await page.keyboard.press('Escape');

  /* ---------- reduced motion: the day still changes, nothing slides ---------- */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const yr = await inPlanning(page);
  await drag(page, 330, yr, 60, yr + 8);
  await waitDay(page, '2026-10-28');
  must((await page.locator('.agp-body').evaluate((e) => e.style.transform)) === '', 'something still slides under reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  /* ---------- 320 px: nothing wider than the screen ---------- */
  const small = await h.newPage({ viewport: { width: 320, height: 640 }, mobile: true });
  await h.loginOwner(small);
  await small.locator('.hm-chair').first().waitFor({ timeout: 8000 });
  must(!(await sideways(small)), '320 px: the Accueil scrolls sideways');
  for (const v of ['Salon', 'Liste', 'Barbier']) {
    await small.goto(h.base + '/comptoir/agenda');
    await small.getByRole('button', { name: v, exact: true }).tap();
    await small.locator('.agp[data-view="' + v.toLowerCase() + '"]').waitFor();
    await small.waitForTimeout(250);
    must(!(await sideways(small)), '320 px: the agenda scrolls sideways in « ' + v + ' »');
  }
  await h.shot(small, 'phone-agenda-320');

  /* ---------- a barber on his phone starts on his own chair ---------- */
  const barber = await h.newPage({ viewport, mobile: true });
  await barber.goto(h.base + '/comptoir');
  await barber.getByRole('button', { name: /poste du salon/ }).click();
  await barber.locator('.team button', { hasText: 'JKut' }).click();
  await barber.locator('.keypad').waitFor();
  await barber.keyboard.type('2468');
  await barber.keyboard.press('Enter');
  await barber.locator('#page-title h1').waitFor({ timeout: 10000 });
  await barber.goto(h.base + '/comptoir/agenda');
  await barber.locator('.agp .agp-lane').first().waitFor({ timeout: 8000 });
  must((await barber.locator('.agp').getAttribute('data-view')) === 'barbier' && (await barber.locator('.agp-lane').count()) === 1, 'a barber does not start on one chair');
  must(/JKut/.test(await barber.locator('.agp-h').first().innerText()), 'a barber does not start on his own chair: ' + (await barber.locator('.agp-h').first().innerText()));
  must(!(await sideways(barber)), 'the barber’s agenda scrolls sideways');
};
