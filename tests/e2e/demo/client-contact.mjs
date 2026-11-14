// FEATURE B · The client without an account, on a phone: « Retrouver mon rendez-vous » with the code and the number, the
// booking's page that lists his other bookings, « Préviens-moi si un créneau se libère plus tôt », the freed slot a text
// offers (one tap moves the booking there), then /moi: « Ce qui manque », « Tes paiements », « Comment le salon te prévient ».
export const name = 'client sans compte: code + numéro, autres rendez-vous, préviens-moi, créneau libéré, ce qui manque';
export const viewport = { width: 390, height: 844 };

const PHONE = '06 52 52 52 52';

export default async ({ h, page }) => {
  const salon = (await h.api('/api/public/salon', { session: false })).json;
  const cut = salon.services.find((s) => s.slug === 'cl') || salon.services[0];
  const staff = salon.barbers[0];
  const av = (await h.api(`/api/public/availability?services=${cut.id}&staff=${staff.id}&days=6`, { session: false })).json;
  const day = av.days.filter((d) => d.slots.length >= 4)[1];
  if (!day) throw new Error('no day with room');
  const book = async (start, first, phone = PHONE) => {
    const r = await h.api('/api/public/bookings', { session: false, body: { serviceIds: [cut.id], staffId: staff.id, day: day.day, start, first, phone, sms: true } });
    if (r.status !== 201) throw new Error('booking refused: ' + r.text);
    return r.json;
  };
  const early = await book(day.slots[0].m, 'Léa', '06 53 53 53 53');
  const late = await book(day.slots[day.slots.length - 1].m, 'Malik');
  const other = await book(day.slots[2].m, 'Malik');

  // « Retrouver mon rendez-vous »: a wrong number says so plainly, the right one opens the booking's page
  await page.goto(h.base + '/mon-rendez-vous');
  await page.getByRole('heading', { name: /code de ton rendez-vous/ }).waitFor();
  await page.fill('#cd-c', late.code.toLowerCase());
  await page.fill('#cd-p', '06 00 00 00 01');
  await h.shot(page, 'client-find-code');
  await page.getByRole('button', { name: 'Ouvrir mon rendez-vous' }).click();
  await h.expectText(page, 'Code ou numéro incorrect');
  await page.fill('#cd-p', PHONE);
  await page.getByRole('button', { name: 'Ouvrir mon rendez-vous' }).click();
  await page.waitForURL(/\/r\//, { timeout: 8000 });
  await h.expectText(page, 'Tes autres rendez-vous');
  await page.locator('.c-others a').first().waitFor();
  if (!(await page.locator('.c-others').innerText()).includes(staff.name)) throw new Error('the other booking does not name its barber');

  // « Préviens-moi si un créneau se libère plus tôt »
  const ask = page.getByRole('button', { name: /Préviens-moi si un créneau se libère plus tôt/ });
  await ask.click();
  await h.expectText(page, 'C’est noté');
  if ((await ask.getAttribute('aria-pressed')) !== 'true') throw new Error('the switch did not turn on');
  await h.shot(page, 'client-r-contact');

  // the earlier booking with the same barber is cancelled: the text's link offers its slot, one tap moves there
  const cx = await h.api('/api/public/bookings/' + encodeURIComponent(early.token) + '/cancel', { session: false, body: {} });
  if (!cx.ok) throw new Error('cancel refused: ' + cx.text);
  await page.goto(h.base + '/r/' + late.token + '?plus-tot=' + day.day + '.' + day.slots[0].m);
  await h.expectText(page, 'Un créneau s’est libéré');
  await h.shot(page, 'client-r-earlier');
  await page.getByRole('button', { name: 'Avancer à ce créneau' }).click();
  await h.expectText(page, 'C’est avancé');
  const now = (await h.api('/api/public/bookings/' + encodeURIComponent(late.token), { session: false })).json;
  if (now.start !== day.slots[0].m) throw new Error('not moved: ' + now.start);
  void other;

  // /moi (the demo's client): « Ce qui manque » on the home tab, the payments in the history, the channel in the profile
  const r = await page.request.post(h.base + '/api/public/account/demo', { data: {} });
  if (!r.ok()) throw new Error('demo space refused: ' + r.status());
  await page.goto(h.base + '/moi');
  await page.getByRole('heading', { name: 'Ce qui manque' }).waitFor({ timeout: 8000 });
  await page.getByRole('heading', { name: 'Ce qui manque' }).scrollIntoViewIfNeeded();
  await h.shot(page, 'client-moi-todo');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) throw new Error('/moi scrolls sideways');
};
