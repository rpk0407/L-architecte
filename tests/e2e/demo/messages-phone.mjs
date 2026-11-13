// « Mode téléphone » on the salon's phone (390×844): the owner picks « WhatsApp, depuis le téléphone du salon » in
// Réglages, a client books on the site, the Messages screen shows the confirmation with one button that opens WhatsApp
// on that client's chat with the text ready (the wa.me link is read, never followed: no message leaves this test),
// « Envoyé » records it and the next one comes up. No sideways scroll, thumb-sized buttons, and the site's last step
// offers « Recevoir la confirmation sur WhatsApp » once the salon's number is set.
export const name = 'Messages on a phone: the queue, WhatsApp opened with the text ready, Envoyé brings the next one';
export const viewport = { width: 390, height: 844 };

const noSideScroll = async (page, what) => { if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(what + ' scrolls sideways'); };
/** wa.me must never be loaded by the test: every request to it is stopped, and counted. */
async function blockWhatsapp(ctx, seen) {
  await ctx.route(/^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//, (route) => { seen.push(route.request().url()); return route.abort(); });
}

export default async ({ h, page, ctx }) => {
  const opened = [];
  await blockWhatsapp(ctx, opened);
  await h.setup();
  // the owner chooses the phone mode and gives the salon's WhatsApp number, in Réglages, on the phone
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/reglages/messages');
  const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'Messages aux clients' }) });
  await card.waitFor({ timeout: 10000 });
  await card.getByRole('radio', { name: /WhatsApp, depuis le téléphone du salon/ }).check();
  await card.getByLabel('Numéro WhatsApp du salon').fill('06 12 34 56 78');
  await card.getByRole('button', { name: 'Enregistrer' }).click();
  await card.locator('.card-h .badge', { hasText: 'WhatsApp, à la main' }).waitFor({ timeout: 8000 });
  await noSideScroll(page, 'Réglages › Messages');
  await h.shot(page, 'messages-reglages-phone');
  const saved = (await h.api('/api/v1/settings')).json.settings.messages.whatsapp;
  if (saved.mode !== 'phone' || saved.number !== '+33612345678') throw new Error('not saved: ' + JSON.stringify(saved));

  // two clients book on the site (the API the site calls), each with a mobile number
  const salon = (await h.api('/api/public/salon', { session: false })).json;
  if (salon.whatsapp !== '33612345678') throw new Error('the site does not get the salon’s WhatsApp number: ' + salon.whatsapp);
  const svc = salon.services.find((s) => !s.deposit && s.slug === 'cl') || salon.services.find((s) => !s.deposit);
  const av = (await h.api('/api/public/availability?services=' + svc.id + '&staff=any&from=' + salon.today + '&days=8', { session: false })).json;
  const day = av.days.filter((d) => d.day > salon.today && d.slots.length >= 2)[0];
  const people = [['Zinedine', '06 55 01 02 03'], ['Youri', '07 55 04 05 06']];
  // Zinedine books on the site, on his phone: the last step offers « Recevoir la confirmation sur WhatsApp », a chat
  // with the salon's number, the message ready with the booking's code (read, never followed)
  const site = await h.newPage({ viewport });
  await blockWhatsapp(site.context(), opened);
  await site.goto(h.base + '/');
  await site.locator('.cta').first().click();
  await site.locator('.bk button.so', { hasText: 'Coupe + taille de barbe' }).click();
  await site.locator('.bk button.wh').first().click();
  await site.locator('.bk button.sl').first().waitFor({ timeout: 8000 });
  await site.locator('.bk button.sl').first().click();
  await site.fill('#f-first', people[0][0]);
  await site.fill('#f-phone', people[0][1]);
  await site.locator('.bk-foot .btn').click();
  await h.expectText(site, 'C’est réservé, Zinedine');
  const wa = site.getByRole('link', { name: 'Recevoir la confirmation sur WhatsApp' });
  await wa.waitFor({ timeout: 5000 });
  const waHref = await wa.getAttribute('href');
  if (!waHref.startsWith('https://wa.me/33612345678?text=')) throw new Error('the site’s button does not open the salon’s chat: ' + waHref);
  const said = decodeURIComponent(waHref.split('?text=')[1]);
  if (!/^Bonjour, je viens de réserver chez L’Architecte : .+ à \d+ h( \d\d)?\. Référence LA-[A-Z0-9]+\. Merci de me confirmer ici\.$/.test(said)) throw new Error('the prefilled message is not the expected one: ' + said);
  if ((await wa.boundingBox()).height < 44) throw new Error('the WhatsApp button on the site is too small for a thumb');
  await noSideScroll(site, 'the site’s confirmation step');
  await h.shot(site, 'site-done-whatsapp');
  // Youri books too (the API the site calls)
  {
    const [first, phone] = people[1];
    const free = (await h.api('/api/public/availability?services=' + svc.id + '&staff=any&from=' + day.day + '&days=1', { session: false })).json.days[0];
    const r = await h.api('/api/public/bookings', { session: false, body: { serviceIds: [svc.id], staffId: 'any', day: free.day, start: free.slots[free.slots.length - 1].m, first, phone } });
    if (r.status !== 201 || r.json.status !== 'booked') throw new Error('booking failed: ' + r.status + ' ' + r.text);
  }
  // the demo's own older texts are set aside through the API, so the screen holds exactly these two
  let q = (await h.api('/api/v1/messages/hand')).json;
  for (const x of q.items) if (!people.some(([first]) => x.client.name.startsWith(first))) await h.api('/api/v1/messages/hand/' + x.id + '/sent', { body: { skip: true } });
  q = (await h.api('/api/v1/messages/hand')).json;
  if (q.items.length !== 2) throw new Error('expected the two confirmations, got ' + q.items.length);

  // the Messages screen: in the menu, with its count
  await page.goto(h.base + '/comptoir/messages');
  await page.locator('#page-title h1', { hasText: 'Messages' }).waitFor({ timeout: 10000 });
  await page.locator('.mh-count', { hasText: '2 messages à envoyer' }).waitFor({ timeout: 8000 });
  const first = page.locator('.mh-card');
  const who = (await first.locator('.mh-who b').innerText()).trim();
  if (!people.some(([n]) => who.startsWith(n))) throw new Error('unexpected client on the card: ' + who);
  await first.locator('.badge', { hasText: 'Confirmation' }).waitFor();
  const text = (await first.locator('.mh-text p').innerText()).trim();
  if (!/c'est noté/.test(text) || !text.includes(who.split(' ')[0])) throw new Error('not the confirmation’s text: ' + text);
  // one button, thumb-sized, that opens WhatsApp on this client's chat with this very text
  const open = first.getByRole('link', { name: 'Ouvrir WhatsApp' });
  const href = await open.getAttribute('href');
  const phoneOf = people.find(([n]) => who.startsWith(n))[1].replace(/\D/g, '').replace(/^0/, '33');
  if (!href.startsWith('https://wa.me/' + phoneOf + '?text=')) throw new Error('not this client’s wa.me link: ' + href);
  if (decodeURIComponent(href.split('?text=')[1]) !== q.items.find((x) => x.client.name === who).text) throw new Error('the link does not carry the message');
  const box = await open.boundingBox();
  if (box.height < 48 || box.width < 300) throw new Error('the WhatsApp button is too small for a thumb: ' + JSON.stringify(box));
  if (await open.getAttribute('target') !== '_blank') throw new Error('WhatsApp must open beside the Comptoir, not in its place');
  await noSideScroll(page, 'Messages');
  await h.shot(page, 'messages-phone-queue');

  // tap: WhatsApp opens in another tab (stopped here), the card now asks what happened
  const popup = page.waitForEvent('popup');
  await open.click();
  await (await popup).close();
  await first.getByRole('link', { name: 'Envoyé, message suivant' }).waitFor({ timeout: 5000 });
  await first.getByRole('link', { name: /Pas parti : rouvrir WhatsApp/ }).waitFor();
  await h.shot(page, 'messages-phone-opened');
  // « Envoyé »: recorded, the next client's message comes up
  await first.getByRole('button', { name: 'Envoyé', exact: true }).click();
  await page.locator('.mh-count', { hasText: '1 message à envoyer' }).waitFor({ timeout: 8000 });
  const second = (await page.locator('.mh-card .mh-who b').innerText()).trim();
  if (second === who) throw new Error('the same message is still in hand');
  await h.expectText(page, '1 envoyé');
  // the last one: opened, then « Envoyé » again, and nothing is left
  const popup2 = page.waitForEvent('popup');
  await page.locator('.mh-card').getByRole('link', { name: 'Ouvrir WhatsApp' }).click();
  await (await popup2).close();
  await page.locator('.mh-card').getByRole('button', { name: 'Envoyé', exact: true }).click();
  await h.expectText(page, 'Tout est parti');
  await noSideScroll(page, 'Messages, empty');
  await h.shot(page, 'messages-phone-done');
  // the journal has both, sent by hand, once each; the outbox says so
  const out = (await h.api('/api/v1/messages?limit=300')).json.items.filter((m) => m.via === 'hand' && m.status === 'sent');
  if (out.length !== 2) throw new Error('expected two texts recorded as sent by hand, got ' + out.length);
  if ((await h.api('/api/v1/pulse')).json.badges.hand !== 0) throw new Error('the menu still shows messages to send');
  if (opened.some((u) => !/^https:\/\/wa\.me\/33[67]\d{8}\?text=/.test(u))) throw new Error('an unexpected WhatsApp address was opened: ' + opened.join(' '));
};
