// FEATURE B (review) · A friend booked with his own number gets his own link: on a small phone (320 px), his /r/ page
// shows his booking only, never the bookings of the friend who booked him; « Retrouver mon rendez-vous » opens it with
// his number and not with the booker's; the booker's own page still lists the place he booked « pour Adam ».
export const name = 'client sans compte: un proche avec son numéro ne voit que ses rendez-vous (320 px)';
export const viewport = { width: 320, height: 640 };

const BOOKER = '06 54 54 54 54', FRIEND = '06 55 55 55 55';

export default async ({ h, page }) => {
  const salon = (await h.api('/api/public/salon', { session: false })).json;
  const cut = salon.services.find((s) => s.slug === 'cl') || salon.services[0];
  const av = (await h.api(`/api/public/availability?services=${cut.id}&staff=any&days=6`, { session: false })).json;
  const day = av.days.filter((d) => d.slots.length >= 4)[2];
  if (!day) throw new Error('no day with room');
  const post = (body) => h.api('/api/public/bookings', { session: false, body: { serviceIds: [cut.id], staffId: 'any', day: day.day, first: 'Malik', phone: BOOKER, sms: true, ...body } });
  const own = await post({ start: day.slots[0].m });
  if (own.status !== 201) throw new Error('booking refused: ' + own.text);
  const forAdam = await post({ start: day.slots[3].m, guest: { kind: 'other', first: 'Adam', phone: FRIEND } });
  if (forAdam.status !== 201) throw new Error('booking for Adam refused: ' + forAdam.text);
  const noSideways = async (where) => { if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(where + ' scrolls sideways at 320 px'); };

  // the booker's number on Adam's code: the usual words, nothing opens
  await page.goto(h.base + '/mon-rendez-vous');
  await page.fill('#cd-c', forAdam.json.code);
  await page.fill('#cd-p', BOOKER);
  await page.getByRole('button', { name: 'Ouvrir mon rendez-vous' }).click();
  await h.expectText(page, 'Code ou numéro incorrect');
  await noSideways('/mon-rendez-vous');
  await h.shot(page, 'client-guest-find-320');

  // Adam's own number opens his page: his booking, no « autres rendez-vous », nothing of Malik's
  await page.fill('#cd-p', FRIEND);
  await page.getByRole('button', { name: 'Ouvrir mon rendez-vous' }).click();
  await page.waitForURL(/\/r\//, { timeout: 8000 });
  await page.getByRole('button', { name: /Préviens-moi si un créneau se libère plus tôt/ }).waitFor({ timeout: 8000 });
  const text = await page.locator('body').innerText();
  if (text.includes('Tes autres rendez-vous')) throw new Error('Adam sees other bookings');
  if (text.includes(own.json.code)) throw new Error('Adam sees Malik\'s booking');
  await noSideways('/r/ (Adam)');
  await h.shot(page, 'client-guest-r-320');

  // Malik's page lists the place he booked for Adam
  const mine = await h.api('/api/public/find', { session: false, body: { code: own.json.code, phone: BOOKER } });
  if (!mine.ok) throw new Error('Malik\'s code refused: ' + mine.text);
  await page.goto(h.base + '/r/' + mine.json.token);
  await h.expectText(page, 'Tes autres rendez-vous');
  if (!(await page.locator('.c-others').innerText()).includes('Pour Adam')) throw new Error('the place for Adam is not said « Pour Adam »');
  await noSideways('/r/ (Malik)');
};
