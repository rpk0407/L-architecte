// Deposits by history: the owner turns on « Aussi pour les clients qui ont déjà manqué » in Réglages › Réservation,
// a demo client who missed books a cheap cut on the site and owes a deposit, the agenda card says « 2 absences »,
// and « Ne plus demander d’acompte » on the file lets him book without one.

export const name = 'deposit for clients who already missed: the switch, the card, the trusted file';

export default async ({ h, page }) => {
  await h.setup();
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/reglages/reservation');
  const sw = page.getByRole('switch', { name: /Aussi pour les clients qui ont déjà manqué/ });
  await sw.click();
  await h.shot(page, 'risk-deposit-settings');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await h.expectText(page, 'CGV mises à jour');
  const boot = (await h.api('/api/v1/bootstrap')).json;
  if (boot.settings.deposits.riskBased !== true) throw new Error('riskBased not saved: ' + JSON.stringify(boot.settings.deposits));

  // a client the demo shows with absences, nothing booked yet, and the cheapest service sold online
  const list = (await h.api('/api/v1/clients?segment=absents&limit=200')).json.items;
  const c = list.find((x) => x.badges.includes('absences') && x.hasPhone && !x.next && x.noShows >= 2);
  if (!c) throw new Error('no demo client with two absences and nothing booked');
  const svc = boot.services.filter((x) => x.active && x.online && !x.pack && x.deposit == null && x.price < boot.settings.deposits.thresholdCents).sort((a, b) => a.price - b.price)[0];
  const free = async () => {
    const av = (await h.api('/api/public/availability?services=' + svc.id + '&days=7&from=' + boot.today, { session: false })).json;
    for (const d of av.days) if (d.day > boot.today && d.slots.length) return { day: d.day, start: d.slots[0].m, staffId: d.slots[0].s };
    throw new Error('no free slot this week');
  };
  const book = async () => {
    const at = await free();
    const r = await h.api('/api/public/bookings', { session: false, headers: { origin: h.base }, body: { serviceIds: [svc.id], ...at, first: c.first, phone: c.phone } });
    if (r.status !== 201) throw new Error('booking refused: ' + r.status + ' ' + r.text);
    return { ...r.json, ...at };
  };
  const want = Math.min(svc.price, Math.max(500, Math.round((svc.price * boot.settings.deposits.percent) / 10000) * 100));
  const r = await book();
  if (r.status !== 'pending' || r.deposit !== want) throw new Error('expected a ' + want + ' deposit, got ' + r.status + ' ' + r.deposit);

  // the card says it in words
  await page.goto(h.base + '/comptoir?day=' + r.day);
  // on a phone the agenda shows one chair at a time: pick the one that got the booking
  await page.locator('.board .ap').first().waitFor({ timeout: 8000 });
  const lane = page.locator('.lane-pick button', { hasText: boot.staff.find((x) => x.id === r.staffId).name });
  if (await lane.count()) await lane.first().click();
  const card = page.locator('.ap', { hasText: c.first }).filter({ hasText: c.noShows + ' absences' }).first();
  await card.waitFor({ timeout: 8000 });
  await card.scrollIntoViewIfNeeded();
  await h.shot(page, 'risk-deposit-card');

  // trusted from the file: the next booking takes no deposit
  await page.goto(h.base + '/comptoir/clients/' + c.id);
  const trust = page.getByRole('switch', { name: /Ne plus demander d’acompte/ });
  await trust.scrollIntoViewIfNeeded();
  await trust.click();
  // the header names the tag (a trusted client still pays from the threshold up), the hint says what changed
  await page.locator('.badge', { hasText: /^confiance$/ }).first().waitFor({ timeout: 8000 });
  await h.expectText(page, 'Le site ne lui demande plus l’acompte prévu pour les absences');
  await h.shot(page, 'risk-deposit-file');
  const again = await book();
  if (again.status !== 'booked' || again.deposit !== 0) throw new Error('trusted, yet ' + again.status + ' ' + again.deposit);
};
