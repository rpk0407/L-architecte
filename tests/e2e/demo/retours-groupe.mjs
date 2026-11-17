// A booking of several people seen as one, on a phone: Karim books for himself, Adam (who has his own number) and Yanis.
// His page says he is the organiser, lists each person, service and price with the total, and « Envoyer à mes amis » carries
// a private link per friend. A friend's link opens his own place only. In the Comptoir the sheet and the till read
// « Groupe de Karim · 3 personnes », and the whole group is rung up on one ticket.
export const name = 'group: the organiser’s recap and share, a friend’s private link, the group on one ticket';
export const viewport = { width: 390, height: 844 };

const T = 10000;
const OUT = process.env.RETOURS_SHOTS || '';
const snap = async (page, n) => { if (OUT) { await page.waitForTimeout(400); await page.screenshot({ path: OUT + '/' + n + '.png' }); } };

export default async ({ h, page }) => {
  let at = 'start';
  const step = (x) => { at = x; };
  try { await run(h, page, step); } catch (e) { throw new Error(at + ': ' + e.message.split('\n')[0]); }
};

async function run(h, page, step) {
  step('three people booked together on the site');
  await page.goto(h.base + '/mon-rendez-vous');
  const pub = (path, body) => page.evaluate(async ([p, b]) => {
    const r = await fetch(p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body]);
  const salon = (await pub('/api/public/salon')).json;
  const sv = salon.services.slice().sort((a, b) => a.price - b.price).find((x) => !x.deposit && !x.pack) || salon.services[0];
  const av = (await pub('/api/public/availability?services=' + sv.id + '&staff=any&from=2026-10-28&days=6')).json;
  const day = av.days.find((d) => d.slots.length >= 4);
  if (!day) throw new Error('no day with room for three');
  const m = day.slots[1].m;
  const booked = await pub('/api/public/bookings', {
    serviceIds: [sv.id], staffId: 'any', day: day.day, start: m, first: 'Karim', last: 'Groupe', phone: '06 12 55 01 01', sms: true,
    others: [{ serviceIds: [sv.id], staffId: 'any', day: day.day, start: m, guest: { kind: 'other', first: 'Adam', phone: '06 12 55 01 02' } }, { serviceIds: [sv.id], staffId: 'any', day: day.day, start: day.slots[2].m, guest: { kind: 'other', first: 'Yanis' } }]
  });
  if (booked.status !== 201 || (booked.json.people || []).length !== 3) throw new Error('the group is not booked: ' + JSON.stringify(booked.json).slice(0, 200));
  if (!booked.json.group || !/^Karim a réservé pour 3 chez /.test(booked.json.group.share.text)) throw new Error('the booking answer has no text to share');

  step('the organiser’s page: one recap, the total, « Envoyer à mes amis »');
  await page.goto(h.base + '/r/' + encodeURIComponent(booked.json.token));
  const card = page.locator('[data-guide="r.groupe"]');
  await card.waitFor({ timeout: T });
  await card.getByText('Tu es l’organisateur').waitFor({ timeout: T });
  await card.getByText('Ton groupe · 3 personnes').waitFor({ timeout: T });
  for (const who of ['Karim (toi)', 'Adam', 'Yanis']) await card.getByText(who, { exact: true }).waitFor({ timeout: T });
  if ((await card.locator('.c-group-l li').count()) !== 3) throw new Error('not three people in the recap');
  const total = (await card.locator('.c-group-t b').innerText()).replace(/\s/g, ' ');
  const want = String(sv.price * 3 / 100).replace('.', ',') + ' €';
  if (total.replace(/ | /g, ' ') !== want) throw new Error('the total says « ' + total + ' », not « ' + want + ' »');
  // no share sheet in this browser: WhatsApp and « Copier le message », with the same text
  const share = card.locator('[data-guide="r.partager"]');
  const wa = await share.getByRole('link', { name: 'Envoyer à mes amis par WhatsApp' }).getAttribute('href');
  const text = decodeURIComponent(String(wa).split('?text=')[1] || '');
  const links = [...text.matchAll(/Ta place \(voir, déplacer, annuler\) : (\S+)/g)].map((x) => x[1]);
  if (links.length !== 2) throw new Error('not one link per friend: ' + text);
  for (const w of ['• Karim : ' + sv.name, '• Adam : ' + sv.name, '• Yanis : ' + sv.name, 'Adresse : ']) if (!text.includes(w)) throw new Error('the text does not say « ' + w + ' »');
  if (/06 ?12 ?55|0612550|\+33612/.test(text)) throw new Error('a phone number is in the text to share');
  for (const b of ['Envoyer à mes amis', 'Copier le message']) {
    const box = await share.getByText(b, { exact: true }).boundingBox();
    if (!box || box.height < 44) throw new Error('« ' + b + ' » is under 44 px');
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) throw new Error('the page scrolls sideways at 390 px');
  await card.scrollIntoViewIfNeeded();
  await snap(page, '4-r-organisateur-groupe');
  await share.scrollIntoViewIfNeeded();
  await snap(page, '4-r-envoyer-a-mes-amis');

  step('a friend’s link: his place, and only his');
  const friend = await h.newPage({ viewport, mobile: true });
  const seen = [];
  friend.on('response', (r) => { if (/\/api\/public\//.test(r.url())) seen.push(r.url().replace(h.base, '') + ' ' + r.status()); });
  friend.expect.push(/404/);
  await friend.goto(links[1]);
  await friend.locator('.c-ticket').waitFor({ timeout: T });
  await friend.getByText('Ton rendez-vous, Yanis').waitFor({ timeout: T });
  await friend.getByText(/Réservé par Karim · groupe de 3/).waitFor({ timeout: T });
  await friend.waitForTimeout(600);
  const body = await friend.locator('.c-main').innerText();
  for (const leak of ['Adam', 'Ton groupe', 'Tes autres rendez-vous', 'Envoyer à mes amis', booked.json.people[0].code, booked.json.people[1].code, '06 12 55']) if (body.includes(leak)) throw new Error('the friend’s page shows « ' + leak + ' »');
  if (seen.some((x) => /\/api\/public\/contact\//.test(x))) throw new Error('the friend’s page asked for the contact’s bookings: ' + seen.join(', '));
  await friend.getByRole('button', { name: 'Déplacer' }).waitFor({ timeout: T });
  await friend.getByRole('button', { name: 'Annuler' }).waitFor({ timeout: T });
  await snap(friend, '4-r-lien-ami');
  // his link is no key to the organiser's bookings
  const peek = await friend.evaluate(async (t) => (await fetch('/api/public/contact/' + encodeURIComponent(t))).status, links[1].split('/r/')[1]);
  if (peek !== 404) throw new Error('a friend’s link opens the contact page: ' + peek);

  step('the Comptoir: « Groupe de Karim · 3 personnes », one ticket for the three');
  const desk = await h.newPage({ viewport, mobile: true });
  await h.loginOwner(desk);
  const call = (path, body, method) => desk.evaluate(async ([p, b, mth]) => {
    const r = await fetch(p, b ? { method: mth || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body, method]);
  const pulse = (await call('/api/v1/pulse')).json;
  let appts = (await call('/api/v1/agenda?day=' + day.day)).json.appts.filter((a) => a.group && a.group.by === 'Karim');
  if (appts.length !== 3 || appts.some((a) => a.group.size !== 3)) throw new Error('the agenda does not read the group: ' + JSON.stringify(appts.map((a) => a.group)));
  // the three come today (the salon's call): each place is brought to this afternoon, with its own barber
  for (const [i, a] of appts.entries()) {
    const mv = await call('/api/v1/appointments/' + a.id + '/move', { day: pulse.today, start: 16 * 60 + i * 30, staffId: a.staffId, force: true });
    if (mv.status !== 200) throw new Error('could not bring the place to today: ' + JSON.stringify(mv.json));
  }
  const head = appts.find((a) => a.name.startsWith('Karim'));
  await desk.goto(h.base + '/comptoir/caisse?rdv=' + head.id);
  await desk.locator('.ticket').waitFor({ timeout: T });
  const note = desk.locator('[data-guide="tk-groupe"]');
  await note.getByText('Groupe de Karim · 3 personnes').waitFor({ timeout: T });
  await snap(desk, '4-caisse-groupe');
  await note.getByRole('button', { name: /Encaisser tout le groupe · / }).click();
  await desk.getByText('pour Adam', { exact: false }).first().waitFor({ timeout: T });
  await desk.getByText('pour Yanis', { exact: false }).first().waitFor({ timeout: T });
  await note.getByText('tout le groupe est sur ce ticket', { exact: false }).waitFor({ timeout: T });
  await snap(desk, '4-caisse-groupe-un-ticket');
  await desk.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await desk.getByRole('button', { name: /Valider l’encaissement/ }).click();
  await desk.getByRole('button', { name: 'Ticket suivant' }).waitFor({ timeout: T });
  const sales = (await call('/api/v1/sales?day=' + pulse.today)).json.items.filter((x) => x.apptId === head.id);
  if (sales.length !== 1 || sales[0].totals.due !== sv.price * 3 || sales[0].lines.length !== 3) throw new Error('the group ticket: ' + JSON.stringify(sales.map((x) => [x.totals.due, x.lines.length])));
  appts = (await call('/api/v1/agenda?day=' + pulse.today)).json.appts.filter((a) => a.group && a.group.by === 'Karim');
  if (appts.length !== 3 || appts.some((a) => a.status !== 'done' || a.saleId !== sales[0].id)) throw new Error('the three places are not closed by the one ticket: ' + JSON.stringify(appts.map((a) => [a.status, a.saleId])));
  if (new Set(sales[0].lines.map((l) => l.staffId)).size !== new Set(appts.map((a) => a.staffId)).size) throw new Error('each line is not credited to its own barber');
}
