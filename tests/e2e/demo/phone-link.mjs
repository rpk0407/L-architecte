// TEAM-02: JKut links his own phone from the salon tablet (Mon compte › Mon téléphone, a QR), opens the link on a phone,
// types his code once and lands on his home page. Five idle minutes later (the phone's fake clock) he is still signed
// in: the tablet's 4-minute lock is not for his phone. A client booking Frank's chair raises no toast on it; one
// booking JKut's chair does.
export const name = 'a barber links his phone with a QR, his code once, his own toasts only';
export const viewport = { width: 1024, height: 1366 };

const PHONE = { width: 390, height: 844 };

export default async ({ h, page }) => {
  // the tablet: a demo salon post, JKut by his code
  await page.goto(h.base + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: 'JKut' }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type('2468');
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });

  await page.goto(h.base + '/comptoir/reglages/compte');
  await page.getByRole('heading', { name: 'Mon téléphone', exact: true }).waitFor({ timeout: 8000 });
  const issued = page.waitForResponse((r) => r.url().endsWith('/phone-link') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Lier mon téléphone' }).click();
  const link = await (await issued).json();
  if (!/\/comptoir\/lier\//.test(link.url || '')) throw new Error('no phone link: ' + JSON.stringify(link));
  await page.getByRole('img', { name: /QR code pour lier le téléphone de JKut/ }).waitFor();
  await h.expectText(page, 'Scanne avec ton téléphone');
  await page.getByRole('timer').waitFor();
  await h.shot(page, 'phone-link-tablet');

  // the phone: its own browser, its own fake clock (installed before the app's timers start)
  const phone = await h.newPage({ viewport: PHONE });
  await phone.clock.install();
  await phone.goto(link.url);
  await phone.getByRole('heading', { name: /Lier ce téléphone à JKut/ }).waitFor({ timeout: 8000 });
  if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the link page scrolls sideways');
  await h.shot(phone, 'phone-link-page');
  await phone.getByRole('button', { name: 'Lier mon téléphone' }).click();
  await phone.locator('.keypad').waitFor({ timeout: 8000 });
  await h.expectText(phone, 'Ton code une fois par jour. Téléphone perdu ? Retire-le depuis le poste du salon.');
  // his face alone: nobody else's on this phone
  for (const other of ['Frank', 'Esteban', 'Le Soldat']) if (await phone.getByText(other, { exact: true }).count()) throw new Error(other + ' is offered on JKut’s phone');
  await phone.keyboard.type('2468');
  await phone.keyboard.press('Enter');
  await phone.locator('#page-title h1').waitFor({ timeout: 10000 });
  await phone.waitForURL(/\/comptoir\/(espace|agenda)(\?|$)/, { timeout: 8000 });
  await h.shot(phone, 'phone-home');
  // the tablet's QR has done its job
  await page.getByRole('img', { name: /QR code pour lier/ }).waitFor({ state: 'detached', timeout: 15000 });
  await page.getByRole('listitem').filter({ hasText: /de JKut/ }).first().waitFor({ timeout: 8000 });

  // five idle minutes: a salon tablet would be back on the code pad, his phone is not
  await phone.clock.fastForward('05:00');
  await phone.waitForTimeout(1500);
  if (await phone.locator('.keypad').count()) throw new Error('the phone locked itself after 5 idle minutes');
  await phone.locator('#page-title h1').waitFor();
  const me = await phone.evaluate(async () => (await fetch('/api/v1/bootstrap')).status);
  if (me !== 200) throw new Error('the phone’s session ended: ' + me);

  // a client books online: Frank's chair, then JKut's
  await h.setup();
  const boot = (await h.api('/api/v1/bootstrap')).json;
  const id = (n) => boot.staff.find((x) => x.name === n).id;
  const svc = boot.services.find((x) => x.active && x.online && !x.pack && !x.from && x.price < boot.settings.deposits.thresholdCents);
  if (!svc) throw new Error('no service without a deposit');
  const av = (await h.api('/api/public/availability?services=' + svc.id + '&days=7&from=' + boot.today, { session: false })).json;
  const slotOf = (sid) => { for (const d of av.days) { const x = d.slots.find((s) => s.s === sid); if (x) return { day: d.day, start: x.m }; } return null; };
  const book = async (who, first, phoneNo) => {
    const at = slotOf(id(who));
    if (!at) throw new Error('no free slot for ' + who);
    const r = await h.api('/api/public/bookings', { session: false, headers: { origin: h.base }, body: { serviceIds: [svc.id], staffId: id(who), ...at, first, phone: phoneNo } });
    if (r.status !== 201) throw new Error('booking failed: ' + r.status + ' ' + r.text);
  };
  const toasts = (who) => phone.locator('.toasts .toast', { hasText: who + ' a réservé en ligne' });
  await book('Frank', 'Anatole', '0611223344');
  // two pulses at least (every 4 s)
  await phone.waitForTimeout(9000);
  if (await toasts('Anatole').count()) throw new Error('a booking on Frank’s chair toasts on JKut’s phone');
  await book('JKut', 'Basile', '0611223355');
  await toasts('Basile').waitFor({ timeout: 12000 }).catch(() => { throw new Error('no toast on JKut’s phone for his own client'); });

  // Mon compte on the phone: this phone is linked
  await phone.goto(h.base + '/comptoir/reglages/compte');
  await h.expectText(phone, 'Ce téléphone est lié');
  if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('Mon compte scrolls sideways on the phone');
  await h.shot(phone, 'phone-account');
};
