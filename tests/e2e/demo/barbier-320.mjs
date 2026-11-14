// FEATURE C · the barber's phone on the smallest screen (320×640): « Le client est là ? » for a client with a very long
// name keeps its three answers inside the screen (44 px each, no sideways scroll), on the band and as a card in Mon
// espace; « Mon planning » and a booking's sheet fit too. A late « Absent » from a second screen never turns the client
// who came into a no-show (the first answer stands, the second is told so in plain words).
export const name = 'Barber phone at 320 px: the question and Mon planning fit, a late second answer is refused';
export const viewport = { width: 320, height: 640 };

const SHOTS = '/tmp/claude-0/-home-user-L-architecte/ffbc9ce5-e010-50aa-89bd-fc3cb4b47b33/scratchpad/wf-shots/';
const must = (ok, what) => { if (!ok) throw new Error(what); };
const LONG = 'Maximilien-Alexandre';

async function pin(page, base, who, code) {
  await page.goto(base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: who }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
}
/** the page never scrolls sideways, and every button of the zone is inside the screen and 44 px or more */
async function fits(page, sel, what) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  must(wide <= 0, what + ': the page scrolls sideways by ' + wide + ' px');
  const bad = await page.locator(sel).evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => {
    const r = e.getBoundingClientRect();
    return { t: (e.textContent || '').trim().slice(0, 20), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), over: e.scrollWidth > e.clientWidth + 1 };
  }).filter((x) => x.l < 0 || x.r > window.innerWidth || x.w < 44 || x.h < 44 || x.over));
  must(!bad.length, what + ': ' + JSON.stringify(bad));
}

export default async ({ h, page }) => {
  await h.setup();
  const boot = (await h.api('/api/v1/bootstrap')).json;
  const jkut = boot.staff.find((x) => x.name === 'JKut');
  const cut = boot.services.find((x) => x.slug === 'cl') || boot.services[0];
  // 15:00 on the demo clock (15:10): just started, JKut is asked
  const r = await h.api('/api/v1/appointments', { headers: { origin: h.base }, body: { client: { first: LONG, last: 'de La Tour-Vieille', phone: '06 77 00 32 11' }, serviceIds: [cut.id], staffId: jkut.id, day: boot.today, start: 900, force: true } });
  must(r.ok, 'booking: ' + r.status + ' ' + r.text);
  const id = r.json.id;

  await pin(page, h.base, 'JKut', '2468');
  const band = page.locator('.es-askband [data-arrival="' + id + '"]');
  await band.waitFor({ timeout: 15000 });
  await fits(page, '.es-askband [data-arrival="' + id + '"] button', 'band');
  await page.screenshot({ path: SHOTS + 'barbier-320-bandeau.png' });

  await page.goto(h.base + '/comptoir/espace');
  const card = page.locator('.es-asks [data-arrival="' + id + '"]');
  await card.waitFor({ timeout: 10000 });
  await fits(page, '.es-asks button', 'Mon espace card');
  await page.screenshot({ path: SHOTS + 'barbier-320-carte.png' });

  // a second screen of his answered « Il est là » first: the late « Absent » here is refused, the client stays arrived
  must((await h.api('/api/v1/appointments/' + id + '/arrival', { headers: { origin: h.base }, body: { answer: 'here' } })).ok, 'here from the desk');
  page.expect.push(/409 \(Conflict\)/);
  await card.getByRole('button', { name: 'Absent' }).click();
  await page.getByText(/déjà arrivé/).first().waitFor({ timeout: 8000 });
  const a = (await h.api('/api/v1/agenda?day=' + boot.today)).json.appts.find((x) => x.id === id);
  must(a.status === 'arrived', 'the client who came was turned into ' + a.status);
  await card.waitFor({ state: 'detached', timeout: 10000 });

  // « Mon planning » and the booking's sheet at 320
  await page.getByRole('button', { name: 'Mon planning' }).click();
  const plan = page.locator('[data-guide="espace.planning"]');
  await plan.getByRole('heading', { name: 'Aujourd’hui' }).waitFor();
  await fits(page, '.es-plan-h button, .es-tl-appt button', 'planning');
  await plan.locator('.es-tl-appt button', { hasText: LONG }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Au fauteuil' }).waitFor();
  await page.waitForTimeout(500);
  await fits(page, '[role="dialog"] .es-acts button', 'sheet');
  await page.screenshot({ path: SHOTS + 'barbier-320-planning-rdv.png' });
};
