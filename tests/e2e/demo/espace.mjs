// TEAM-04: Mon espace on a barber's phone (390×844). JKut types his code on the demo tablet and lands on his own page:
// his next client with « La dernière fois » in view without scrolling, four rows of his day above the fold, the cards he
// orders himself (still in that order after a reload), the amounts hidden on a shared post until he asks (from the
// keyboard too), a cut note written in the chair that shows on the client's file, and the desk without a page of its own.
export const name = 'Mon espace: next client, my day, my cards in my order, amounts hidden on the tablet, a cut note';
export const viewport = { width: 390, height: 844 };

/** A person on the demo salon post, by his code. */
async function pin(page, base, who, code) {
  await page.goto(base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: who }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
}
const must = (ok, what) => { if (!ok) throw new Error(what); };
/** Run a tap and wait for the prefs it saves (registered first: the answer can beat the wait). */
async function saves(page, tap) {
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/prefs') && r.request().method() === 'PATCH', { timeout: 8000 });
  await tap();
  await saved;
}

export default async ({ h, page }) => {
  await pin(page, h.base, 'JKut', '2468');
  // the home of a chair is Mon espace
  await page.getByRole('heading', { name: 'Mon espace', level: 1 }).waitFor({ timeout: 8000 });
  must(/\/comptoir\/espace$/.test(page.url()), 'JKut does not land on /comptoir/espace: ' + page.url());
  await page.getByRole('heading', { name: 'Salut JKut' }).waitFor();
  await page.getByRole('heading', { name: 'Prochain client' }).waitFor();
  await page.getByRole('status').filter({ hasText: /Au fauteuil|Libre jusqu|attendu|arrivé|Occupé|journée/ }).first().waitFor();
  await page.waitForTimeout(4500); // the sign-in toast goes away

  // « Prochain client » and « La dernière fois » are in view without scrolling, above the tab bar
  const tabs = await page.locator('.tabbar').boundingBox();
  must(tabs, 'no tab bar on a phone');
  const next = page.locator('[data-guide="espace.prochain"]');
  const nb = await next.boundingBox();
  must(nb && nb.y >= 0 && nb.y + nb.height <= tabs.y, 'the next client is not fully in view: ' + JSON.stringify(nb) + ' tab bar at ' + tabs.y);
  const last = next.getByText('La dernière fois');
  const lb = await last.boundingBox();
  must(lb && lb.y + lb.height <= tabs.y, '« La dernière fois » is not in view');
  // the demo's clients about to sit down have a real note on their last cut, not the « rien de noté » fallback
  const lastLine = await next.locator('.es-last').first().innerText();
  must(/La dernière fois/.test(lastLine) && !/rien de noté/.test(lastLine), 'the next client has no note in the demo: ' + lastLine);

  // « Ma journée »: at least four of his rows above the fold
  const rows = await page.locator('.es-row').evaluateAll((els, limit) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= limit; }).length, tabs.y);
  must(rows >= 4, 'only ' + rows + ' rows of « Ma journée » above the fold');
  must((await page.locator('[data-guide="espace.journee"] .es-row').count()) >= 4, 'his day has fewer than four rows');
  await h.shot(page, 'espace-phone');

  // every button of the page is a real target: 44 px
  const small = await page.locator('.es button, .es summary, .es a').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44));
  must(!small.length, 'targets under 44 px: ' + JSON.stringify(small));

  // the tab bar: Mon espace first, one tab per page he can open, then Plus (no gap for a barber who does not ring up)
  const tabNames = await page.locator('.tabbar > *').allTextContents();
  must(/Mon espace/.test(tabNames[0]) && /Plus/.test(tabNames.at(-1)), 'the tab bar reads ' + JSON.stringify(tabNames));
  must(tabNames.length === 5, 'JKut has four tabs and Plus: ' + JSON.stringify(tabNames));

  // his own appointments only: no colleague's name anywhere on the page
  const text = await page.locator('.es').innerText();
  for (const other of ['Frank', 'Le Soldat', 'Esteban']) must(!text.includes(other), other + ' is on JKut’s page');

  // the amounts of a shared post start hidden; the button shows them, from the keyboard too, and hides them again
  const hidden = (on) => page.waitForFunction((want) => { const m = document.querySelector('[data-guide="espace.chiffres"] .money'); return !!m && /blur/.test(getComputedStyle(m).filter) === want; }, on, { timeout: 4000 });
  await hidden(true).catch(() => { throw new Error('the amounts are not hidden on the salon post'); });
  const eye = page.getByRole('button', { name: /Afficher les montants de mon espace/ });
  await eye.focus();
  await page.keyboard.press('Enter');
  await hidden(false).catch(() => { throw new Error('the amounts stay hidden after the tap'); });
  await page.getByRole('button', { name: 'Masquer les montants de mon espace' }).click();
  await hidden(true).catch(() => { throw new Error('the amounts are not hidden again'); });

  // Mes chiffres: the period, the goal ring in words
  await page.getByRole('button', { name: 'Mois' }).click();
  await page.getByRole('img', { name: /de ton objectif du mois/ }).waitFor();

  // a cut note, written in the chair (JKut has Sofiane in the chair at 15:10: if the next one is only booked, he sits first)
  const seat = next.getByRole('button', { name: 'Au fauteuil' });
  if (await seat.count()) await seat.click();
  await page.getByRole('button', { name: /Note de coupe|Corriger la note/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByLabel('Note de coupe').fill('Dégradé 1,5');
  await dialog.getByRole('button', { name: 'Plus court' }).click();
  must((await dialog.getByLabel('Note de coupe').inputValue()) === 'Dégradé 1,5, plus court', 'the shortcut does not add its words');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Note de coupe enregistrée').waitFor();
  await page.getByText('Ta note du jour').waitFor();
  const who = await page.evaluate(async () => (await (await fetch('/api/v1/espace')).json()).next.client.id);
  await page.goto(h.base + '/comptoir/clients/' + who);
  await page.getByRole('heading', { name: 'Notes de coupe' }).waitFor({ timeout: 8000 });
  await h.expectText(page, 'Dégradé 1,5, plus court');
  await h.shot(page, 'espace-client-notes');
  await page.goto(h.base + '/comptoir/espace');
  await page.getByRole('heading', { name: 'Prochain client' }).waitFor();

  // Encaisser opens the till on his appointment
  await page.getByRole('button', { name: 'Encaisser' }).click();
  await page.waitForURL(/\/comptoir\/caisse\?rdv=/, { timeout: 8000 });
  await page.goto(h.base + '/comptoir/espace');
  await page.getByRole('heading', { name: 'Prochain client' }).waitFor();

  // Personnaliser: « Mes chiffres » to the top, saved, still there after a reload
  const titles = () => page.locator('.es-card .card-h h2').allTextContents();
  must((await titles())[0].trim() === 'Prochain client', 'the default order starts with the next client: ' + JSON.stringify(await titles()));
  await page.getByRole('button', { name: 'Personnaliser' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.waitFor();
  for (let i = 0; i < 3; i++) {
    await saves(page, () => sheet.getByRole('button', { name: 'Monter Mes chiffres' }).click());
    await page.waitForTimeout(150);
  }
  await h.shot(page, 'espace-personnaliser');
  // the arrows are real targets: 44 px
  const arrow = await sheet.getByRole('button', { name: 'Descendre Mes chiffres' }).boundingBox();
  must(arrow && arrow.width >= 44 && arrow.height >= 44, 'the arrows are under 44 px: ' + JSON.stringify(arrow));
  await sheet.getByRole('button', { name: 'Terminé' }).click();
  must((await titles())[0].trim() === 'Mes chiffres', 'Mes chiffres is not first: ' + JSON.stringify(await titles()));
  await page.reload();
  await page.getByRole('heading', { name: 'Mes chiffres' }).waitFor({ timeout: 8000 });
  must((await titles())[0].trim() === 'Mes chiffres', 'after a reload the order is lost: ' + JSON.stringify(await titles()));
  // a card hidden stays hidden; the default order comes back with one button
  await page.getByRole('button', { name: 'Personnaliser' }).click();
  await page.getByRole('dialog').waitFor();
  await saves(page, () => page.getByRole('dialog').getByRole('switch', { name: 'Le salon' }).click());
  await page.waitForFunction(() => ![...document.querySelectorAll('.es-card .card-h h2')].some((e) => e.textContent?.trim() === 'Le salon'), null, { timeout: 5000 });
  await saves(page, () => page.getByRole('dialog').getByRole('button', { name: 'Remettre par défaut' }).click());
  await page.getByRole('dialog').getByRole('button', { name: 'Terminé' }).click();
  await page.waitForFunction(() => document.querySelector('.es-card .card-h h2')?.textContent?.trim() === 'Prochain client', null, { timeout: 5000 });
  must((await titles()).includes('Le salon'), 'the default shows every card again: ' + JSON.stringify(await titles()));

  // no horizontal scroll at 390 px
  must(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the page scrolls sideways');

  // a barber with few rows left (Frank, mid-afternoon): what is open now is in view, the finished ones are folded
  const fr = await h.newPage({ viewport: { width: 390, height: 844 } });
  await pin(fr, h.base, 'Frank', '1357');
  await fr.getByRole('heading', { name: 'Prochain client' }).waitFor({ timeout: 8000 });
  const ftabs = await fr.locator('.tabbar').boundingBox();
  const open = await fr.locator('.es-row:not(.past)').first().boundingBox();
  must(open && ftabs && open.y + open.height <= ftabs.y, 'Frank’s first open row is under the tab bar: ' + JSON.stringify(open));
  must((await fr.locator('.es-row .es-note').count()) <= 1, 'more than one « + note » while the day is folded');

  // the desk has no chair: no tab, and the page says why
  const desk = await h.newPage({ viewport: { width: 390, height: 844 } });
  await pin(desk, h.base, 'Inès', '1470');
  must(!(await desk.locator('.tabbar').innerText()).includes('Mon espace'), 'the desk has a Mon espace tab');
  must(/\/comptoir\/agenda$/.test(desk.url()), 'the desk lands on ' + desk.url());
  // a client file opened before Mon espace was ever loaded: the notes block is styled by its own stylesheet
  await desk.goto(h.base + '/comptoir/clients/' + who);
  await desk.getByRole('heading', { name: 'Notes de coupe' }).waitFor({ timeout: 8000 });
  must((await desk.locator('.cn-list li').first().evaluate((e) => getComputedStyle(e).flexDirection)) === 'column', 'the notes of the client file are unstyled');
  await desk.goto(h.base + '/comptoir/espace');
  await h.expectText(desk, 'Mon espace est pour ceux qui ont un fauteuil.');
  // the bar follows the number of tabs: Agenda, Caisse, Clients and Plus, in four equal columns
  const cols = await desk.locator('.tabbar').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
  must(cols === 4, 'the desk’s tab bar has ' + cols + ' columns');
};
