// « Renvoyer » on the salon's phone (390×844): a client books on the site with an e-mail; on the appointment's sheet
// the owner taps « Renvoyer la confirmation par e-mail » and reads where it went; the list of the sheet then offers
// « Renvoyer » on the e-mail that left, and so does Relances › Messages envoyés. A client without an address: the
// button is off and says why. No sideways scroll.
export const name = 'Renvoyer: the confirmation again by e-mail from the appointment sheet, and from the outbox';
export const viewport = { width: 390, height: 844 };

const noSideScroll = async (page, what) => { if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(what + ' scrolls sideways'); };

export default async ({ h, page }) => {
  await h.setup();
  const salon = (await h.api('/api/public/salon', { session: false })).json;
  const svc = salon.services.find((s) => !s.deposit && s.slug === 'cl') || salon.services.find((s) => !s.deposit);
  const av = (await h.api('/api/public/availability?services=' + svc.id + '&staff=any&from=' + salon.today + '&days=8', { session: false })).json;
  const day = av.days.filter((d) => d.day > salon.today && d.slots.length >= 2)[0];
  const book = async (first, phone, email, i) => {
    const r = await h.api('/api/public/bookings', { session: false, body: { serviceIds: [svc.id], staffId: 'any', day: day.day, start: day.slots[i].m, first, phone, ...(email ? { email } : {}) } });
    if (r.status !== 201) throw new Error('booking failed: ' + r.text);
    return r.json.code;
  };
  const withMail = await book('Zinedine', '06 55 01 02 03', 'zinedine@exemple.fr', 0);
  const without = await book('Youri', '07 55 04 05 06', '', 1);
  const appts = (await h.api('/api/v1/agenda?day=' + day.day)).json.appts;
  const idOf = (code) => { const a = appts.find((x) => x.code === code); if (!a) throw new Error('appointment ' + code + ' not in the agenda'); return a.id; };

  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/agenda?day=' + day.day + '&rdv=' + idOf(withMail));
  const again = page.getByRole('button', { name: 'Renvoyer la confirmation par e-mail' });
  await again.waitFor({ timeout: 10000 });
  if (await again.isDisabled()) throw new Error('the button is off for a client with an address');
  const before = (await h.api('/api/v1/appointments/' + idOf(withMail))).json.messages.length;
  await again.click();
  await h.expectText(page, 'Renvoyé par e-mail');
  await h.expectText(page, 'À z•••@');
  const after = (await h.api('/api/v1/appointments/' + idOf(withMail))).json.messages;
  if (after.length !== before + 1) throw new Error('one new message expected, got ' + (after.length - before));
  // the list of the sheet: each e-mail that left can be sent again
  await page.locator('.msgs [data-resend]').first().waitFor({ timeout: 8000 });
  await noSideScroll(page, 'the appointment sheet');
  await h.shot(page, 'renvoyer-fiche-rdv');
  await page.locator('.msgs [data-resend]').first().click();
  await page.locator('.toast', { hasText: 'Renvoyé par e-mail' }).last().waitFor({ timeout: 8000 });

  // no address on the file: the button is off, with the reason under it
  await page.goto(h.base + '/comptoir/agenda?day=' + day.day + '&rdv=' + idOf(without));
  const off = page.getByRole('button', { name: 'Renvoyer la confirmation par e-mail' });
  await off.waitFor({ timeout: 10000 });
  if (!(await off.isDisabled())) throw new Error('the button must be off without an address');
  await h.expectText(page, 'Pas d’adresse e-mail sur sa fiche.');

  // the outbox: « Renvoyer par e-mail » on an e-mail that left
  await page.goto(h.base + '/comptoir/relances/envoyes');
  const row = page.locator('[data-resend]').first();
  await row.waitFor({ timeout: 10000 });
  await noSideScroll(page, 'Messages envoyés');
  await h.shot(page, 'renvoyer-envoyes');
  await row.click();
  await page.locator('.toast').filter({ hasText: /Renvoyé par e-mail|Déjà renvoyé/ }).last().waitFor({ timeout: 8000 });
};
