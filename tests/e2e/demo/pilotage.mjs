// TEAM-05a: Pilotage, the owner's cockpit, on his phone (390×844). He signs in with his password and lands on it with the
// day's Encaissé in view without scrolling; Semaine changes the deltas and the comparison; a tap on a barber opens his
// sheet with « Relevé du mois »; the abonnés' income is the demo members' MRR; a tile whose route is refused or missing is gone;
// no horizontal scroll at 1440×900 or on the phone.
export const name = 'Pilotage: lands on it, the day in view, Semaine, a barber’s sheet and statement, the MRR, a refused tile is hidden';
export const viewport = { width: 390, height: 844 };

const must = (ok, what) => { if (!ok) throw new Error(what); };
const flat = (t) => t.replace(/[\s  ]/g, '');
const wide = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

export default async ({ h, page }) => {
  await h.loginOwner(page);
  await page.getByRole('heading', { name: 'Pilotage', level: 1 }).waitFor({ timeout: 8000 });
  must(/\/comptoir\/pilotage$/.test(page.url()), 'the owner does not land on /comptoir/pilotage: ' + page.url());
  must(await page.getByRole('button', { name: 'Aujourd’hui', pressed: true }).count() === 1, 'Aujourd’hui is not the period shown');
  await page.getByRole('group', { name: 'Encaissé' }).waitFor();

  // the phone's tab bar starts with Pilotage
  const tabs = await page.locator('.tabbar > *').allTextContents();
  must(/Pilotage/.test(tabs[0]), 'the first tab is not Pilotage: ' + JSON.stringify(tabs));

  // Encaissé and the till are in view without scrolling, above the tab bar
  const bar = await page.locator('.tabbar').boundingBox();
  const enc = await page.getByRole('group', { name: 'Encaissé' }).boundingBox();
  must(bar && enc && enc.y >= 0 && enc.y + 120 <= bar.y, 'Encaissé is not in view: ' + JSON.stringify(enc) + ' tab bar ' + (bar && bar.y));
  await page.getByRole('region', { name: 'La caisse' }).waitFor();
  await h.shot(page, 'pilotage-phone');

  // no horizontal scroll, and every control is a real target (44 px)
  must(!(await wide(page)), 'the page scrolls sideways on the phone');
  const small = await page.locator('.pl button, .pl a').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44));
  must(!small.length, 'targets under 44 px: ' + JSON.stringify(small));

  // the tiles say what they are compared with, in words
  const day = await page.getByRole('group', { name: 'Encaissé' }).innerText();
  const dayLabel = await page.locator('.pl-label').innerText();
  must(/mardi dernier/.test(dayLabel), 'the day is not compared with last Tuesday: ' + dayLabel);

  // Semaine: the period, the comparison and the deltas change
  await page.getByRole('button', { name: 'Semaine', exact: true }).click();
  await page.getByText('Semaine du', { exact: false }).first().waitFor();
  await page.waitForFunction(() => /la semaine dernière/.test(document.querySelector('.pl-label')?.textContent || ''), null, { timeout: 5000 });
  const week = await page.getByRole('group', { name: 'Encaissé' }).innerText();
  must(week !== day, 'Encaissé does not change from the day to the week');
  const deltas = (await page.locator('.pl-d .vh').allTextContents()).join(' ');
  must(/la semaine dernière/.test(deltas) && !/mardi dernier/.test(deltas), 'the deltas still compare with the day before: ' + deltas);
  // the arrow back moves a week, the arrow forward is off on the current one
  must(await page.getByRole('button', { name: 'Avancer d’une semaine' }).isDisabled(), 'forward is on the current week');
  await page.getByRole('button', { name: 'Reculer d’une semaine' }).click();
  await page.waitForFunction(() => /terminé/.test(document.querySelector('.pl-label')?.textContent || ''), null, { timeout: 5000 });
  await page.getByRole('button', { name: 'Revenir à aujourd’hui' }).click();
  await page.waitForFunction(() => /en cours/.test(document.querySelector('.pl-label')?.textContent || ''), null, { timeout: 5000 });

  // the team, in chair order, a tap opens the barber's sheet with his statement
  const names = await page.locator('.pl-team .pl-row-main b').allTextContents();
  must(names.join(',') === 'JKut,Frank,Le Soldat,Esteban', 'the team is not in chair order: ' + names);
  await page.getByRole('button', { name: 'Le détail de Frank' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Relevé du mois' }).waitFor();
  await dlg.getByText('Commission estimée').waitFor();
  await h.shot(page, 'pilotage-barber');
  await dlg.getByRole('button', { name: 'Relevé du mois' }).click();
  await page.getByText('Détail du chiffre réalisé', { exact: false }).first().waitFor({ state: 'attached', timeout: 8000 });
  await page.keyboard.press('Escape');

  // the abonnés' income is the demo members' MRR
  const summary = await page.evaluate(async () => (await fetch('/api/v1/memberships/summary')).json());
  must(summary.mrr > 0, 'the demo has no MRR');
  const abo = await page.getByRole('group', { name: 'Chaque mois' }).first().innerText().catch(() => '');
  const section = flat(await page.locator('[data-guide="pilotage.abonnes"]').innerText());
  must(section.includes(flat(String(summary.mrr / 100)) + '€'), 'the MRR ' + summary.mrr / 100 + ' € is not on the page: ' + section + abo);

  // a tile whose route is refused or missing is hidden, the others stay (a 404: the harness counts any other failed load as an
  // error; a 403 takes the same path, a tile shows nothing without an answer: tests/unit/guide-team05a.test.js)
  await page.route('**/api/v1/accounts/stats', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'Introuvable.' } }) }));
  await page.route('**/api/v1/memberships/summary', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'Introuvable.' } }) }));
  await page.reload();
  await page.getByRole('group', { name: 'Encaissé' }).waitFor();
  await page.getByRole('group', { name: 'Avis Google' }).waitFor();
  must(await page.getByRole('group', { name: 'Espace client' }).count() === 0, 'the Espace client tile is still there');
  must(await page.locator('[data-guide="pilotage.abonnes"]').count() === 0, 'the Abonnés block is still there without its route');
  await page.unroute('**/api/v1/accounts/stats'); await page.unroute('**/api/v1/memberships/summary');

  // the desktop: no horizontal scroll, the tiles on four columns
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByRole('group', { name: 'Encaissé' }).waitFor();
  must(!(await wide(page)), 'the page scrolls sideways at 1440×900');
  await page.getByRole('button', { name: 'Mois', exact: true }).click();
  await page.waitForFunction(() => /le mois dernier/.test(document.querySelector('.pl-label')?.textContent || ''), null, { timeout: 5000 });
  must(!(await wide(page)), 'the month scrolls sideways at 1440×900');
  const cols = await page.locator('.pl-tiles').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  must(cols === 4, 'the tiles are on ' + cols + ' columns on a desktop');
  await h.shot(page, 'pilotage-desktop');
};
