// A barber is sick: the front desk closes the rest of his day from his chair's header and reports his booked clients
// in ONE guided action. The plan lists each client with where he goes; one is unticked (left « à rappeler »); the
// apply moves the others at once (the agenda shows them on their new chair, the time they left stays closed); the
// client left behind sits in the « À rappeler » card with his number; « Annuler » puts everyone back.
export const name = 'front desk: a sick barber’s day reported in one go, then undone';

const OPEN = ['pending', 'booked', 'arrived'];

/** Inès on a demo salon post. */
async function desk(page, base) {
  await page.goto(base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: 'Inès' }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type('1470');
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
}

export default async ({ h, page }) => {
  await desk(page, h.base);
  const call = (path) => page.evaluate(async (p) => (await fetch(p)).json(), path);
  const pulse = await call('/api/v1/pulse');
  const agenda = () => call('/api/v1/agenda?day=' + pulse.today);
  const before = await agenda();
  const jk = before.lanes.find((l) => l.name === 'JKut');
  const mine = before.appts.filter((a) => a.staffId === jk.id && OPEN.includes(a.status) && a.start + a.dur > pulse.min).sort((a, b) => a.start - b.start);
  if (mine.length < 2) throw new Error('the demo gives JKut fewer than two clients to come: ' + mine.length);

  await page.goto(h.base + '/comptoir/agenda');
  await page.locator('.board').waitFor({ timeout: 8000 });
  if (await page.getByText('À rappeler').count()) throw new Error('« À rappeler » is shown while nobody is away');

  // his chair's header → « Absent aujourd'hui » → the same sheet goes on to the report
  await page.locator('.lh', { hasText: 'JKut' }).first().click();
  await page.getByRole('button', { name: /Absent aujourd’hui/ }).click();
  await page.getByRole('button', { name: 'Fermer et reporter ses rendez-vous' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('heading', { name: 'Reporter ses rendez-vous' }).waitFor({ timeout: 8000 });
  await sheet.locator('.rp-row').first().waitFor({ timeout: 8000 });
  const rows = sheet.locator('.rp-row');
  if (await rows.count() !== mine.length) throw new Error('the plan lists ' + await rows.count() + ' rows for ' + mine.length + ' appointments');
  await h.expectText(page, mine.length + ' rendez-vous chez JKut');
  // each line: the client, his service, from → to with whom; never back on the absent chair
  for (let i = 0; i < mine.length; i++) {
    const text = (await rows.nth(i).innerText()).replace(/\s+/g, ' ');
    if (!text.includes(mine[i].name.split(' ')[0])) throw new Error('row ' + i + ' does not name ' + mine[i].name + ': ' + text);
    if (!/avec (Frank|Le Soldat|Esteban)/.test(text)) throw new Error('row ' + i + ' proposes no colleague: ' + text);
    if (/avec JKut/.test(text)) throw new Error('row ' + i + ' proposes the absent barber: ' + text);
  }
  await h.shot(page, 'report-plan');
  // the last one is left to call: unticked, it says so and shows his number
  const last = mine[mine.length - 1];
  await rows.last().getByRole('checkbox').uncheck({ force: true });
  await rows.last().getByText('à rappeler').waitFor({ timeout: 3000 });
  if (!(await rows.last().locator('a[href^="tel:"]').count())) throw new Error('the client left to call shows no number');
  const n = mine.length - 1;
  await sheet.getByRole('button', { name: 'Déplacer ' + n + ' rendez-vous' }).click();
  await sheet.getByRole('heading', { name: new RegExp('^' + n + ' rendez-vous déplacé') }).waitFor({ timeout: 8000 });
  await h.expectText(page, 'À rappeler · 1');
  await h.shot(page, 'report-done');
  await sheet.getByRole('button', { name: 'Fermer', exact: true }).last().click();

  // the agenda shows the moves: each one on another chair, the one left behind still with JKut and listed to call
  const after = await agenda();
  const moved = mine.slice(0, n).map((a) => after.appts.find((x) => x.id === a.id));
  for (const a of moved) if (!a || a.staffId === jk.id) throw new Error('an appointment was not moved: ' + JSON.stringify(a && [a.name, a.staffId]));
  const kept = after.appts.find((x) => x.id === last.id);
  if (kept.staffId !== jk.id || kept.start !== last.start) throw new Error('the unticked appointment moved');
  // nobody is double-booked on the chairs that took them
  for (const a of moved) {
    const clash = after.appts.filter((x) => x.id !== a.id && x.staffId === a.staffId && OPEN.concat('in_chair').includes(x.status) && x.start < a.start + a.dur && a.start < x.start + x.dur);
    if (clash.length) throw new Error(a.name + ' was put on ' + clash[0].name);
  }
  // the time they left is closed too (the site must not offer it again)
  for (const a of mine.slice(0, n)) if (!after.blocks.some((b) => b.staffId === jk.id && b.start <= a.start && b.start + b.dur >= a.start + a.dur)) throw new Error('the slot left at ' + a.start + ' is open again');
  const card = page.locator('.ag-call');
  await card.waitFor({ timeout: 8000 });
  const cardText = (await card.innerText()).replace(/\s+/g, ' ');
  if (!cardText.includes('JKut est absent') || !cardText.includes(last.name.split(' ')[0])) throw new Error('« À rappeler » does not list the client left behind: ' + cardText);
  if (await card.locator('.ag-call-r').count() !== 1) throw new Error('« À rappeler » lists someone who was moved');
  const board = (await page.locator('.board').innerText()).replace(/\s+/g, ' ');
  if (!board.includes(moved[0].name.split(' ')[0])) throw new Error('the board does not show the moved client');
  await h.shot(page, 'report-agenda');

  // « Annuler »: everyone back with JKut at his time, the card lists them all again
  const banner = page.locator('.ag-reported');
  await banner.getByText(n + ' rendez-vous de JKut').waitFor({ timeout: 5000 });
  await banner.getByRole('button', { name: 'Annuler' }).click();
  await h.expectText(page, 'Report annulé');
  const undone = await agenda();
  for (const a of mine) {
    const x = undone.appts.find((y) => y.id === a.id);
    if (x.staffId !== jk.id || x.start !== a.start) throw new Error(a.name + ' was not put back');
  }
  await page.locator('.ag-call-r').nth(mine.length - 1).waitFor({ timeout: 8000 });
  if (await banner.count()) throw new Error('the « Annuler » line stays after the undo');
};
