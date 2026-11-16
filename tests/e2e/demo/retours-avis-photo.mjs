// After the visit, on a phone: the page of the booking shows nothing about reviews or photos while the visit is to come;
// once it is done and paid, a discreet « Laisser un avis » (the salon's Google page: no question first, no reward) and
// « Ta coupe en photo »: a photo picked on the phone, put in the salon's frame in the browser (square, story), shared
// or saved, and never sent anywhere. The receipt texted from the till carries the review link: one message, not two.
import { deflateSync } from 'node:zlib';

export const name = 'after the visit: « Laisser un avis », the receipt carries the link, « Ta coupe en photo » stays in the browser';
export const viewport = { width: 390, height: 844 };

const T = 10000;
const OUT = process.env.RETOURS_SHOTS || '';
const snap = async (page, n) => { if (OUT) { await page.waitForTimeout(400); await page.screenshot({ path: OUT + '/' + n + '.png' }); } };

/** A small PNG made here (a portrait, two tones), so the scenario needs no file on disk. */
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const top = y < h / 2; raw[o] = top ? 200 : 60; raw[o + 1] = top ? 150 : 90; raw[o + 2] = top ? 110 : 160; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export default async ({ h, page }) => {
  let at = 'start';
  const step = (x) => { at = x; };
  try { await run(h, page, step); } catch (e) { throw new Error(at + ': ' + e.message.split('\n')[0]); }
};

async function run(h, page, step) {
  step('a booking to come: no review link, no photo');
  await page.goto(h.base + '/mon-rendez-vous');
  const pub = (path, body) => page.evaluate(async ([p, b]) => {
    const r = await fetch(p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body]);
  const salon = (await pub('/api/public/salon')).json;
  const sv = salon.services.slice().sort((a, b) => a.price - b.price).find((x) => !x.deposit && !x.pack) || salon.services[0];
  const av = (await pub('/api/public/availability?services=' + sv.id + '&staff=any&from=2026-10-28&days=6')).json;
  const day = av.days.find((d) => d.slots.length);
  const booked = await pub('/api/public/bookings', { serviceIds: [sv.id], staffId: 'any', day: day.day, start: day.slots[0].m, first: 'Sofiane', last: 'Photo', phone: '06 12 55 02 01', sms: true });
  if (booked.status !== 201) throw new Error('not booked: ' + JSON.stringify(booked.json));
  const url = h.base + '/r/' + encodeURIComponent(booked.json.token);
  await page.goto(url);
  await page.locator('.c-ticket').waitFor({ timeout: T });
  await page.waitForTimeout(500);
  if (await page.getByText('Laisser un avis').count()) throw new Error('« Laisser un avis » is shown before the visit');
  if (await page.locator('[data-guide="r.photo"]').count()) throw new Error('« Ta coupe en photo » is shown before the visit');

  step('the visit is done and paid; the receipt texted from the till carries the review link');
  await h.setup();
  const pulse = (await h.api('/api/v1/pulse')).json;
  const appt = ((await h.api('/api/v1/agenda?day=' + day.day)).json.appts || []).find((a) => a.code === booked.json.code);
  if (!appt) throw new Error('the booking is not in the agenda');
  const mv = await h.api('/api/v1/appointments/' + appt.id + '/move', { body: { day: pulse.today, start: 14 * 60, staffId: appt.staffId, force: true } });
  if (mv.status !== 200) throw new Error('could not bring the visit to today: ' + mv.text);
  const sale = await h.api('/api/v1/sales', { body: { apptId: appt.id, lines: [{ kind: 'service', ref: sv.id }], payments: [{ method: 'card', amount: sv.price }] } });
  if (sale.status !== 200 && sale.status !== 201) throw new Error('could not ring up the visit: ' + sale.text);
  const rc = await h.api('/api/v1/sales/' + sale.json.id + '/receipt', { body: {} });
  if (!rc.ok) throw new Error('the receipt did not leave: ' + rc.text);
  const sent = (await h.api('/api/v1/appointments/' + appt.id)).json.messages.filter((m) => m.template === 'receipt' || m.template === 'review');
  if (sent.length !== 1 || sent[0].template !== 'receipt') throw new Error('one message after the visit, the receipt: ' + JSON.stringify(sent.map((m) => m.template)));
  const file = (await h.api('/api/v1/reviews/client/' + appt.client.id)).json;
  if (file.count !== 1) throw new Error('the client file does not say a review was asked with the receipt: ' + JSON.stringify(file));

  step('« Laisser un avis » on the page of the visit');
  await page.goto(url);
  const avis = page.locator('[data-guide="r.avis"]');
  await avis.waitFor({ timeout: T });
  const href = await avis.getAttribute('href');
  if (!/^https:\/\/(search\.google\.com|g\.page|maps\.app\.goo\.gl)\//.test(String(href))) throw new Error('the review link is not the salon’s Google page: ' + href);
  if ((await avis.getAttribute('rel')) !== 'noopener' || (await avis.getAttribute('target')) !== '_blank') throw new Error('the review link does not open apart');
  const box = await avis.boundingBox();
  if (!box || box.height < 44) throw new Error('« Laisser un avis » is under 44 px');
  const words = await page.locator('.c-main').innerText();
  if (/étoile|note-nous|offert|réduction|cadeau|si tu as aimé/i.test(words)) throw new Error('the page gates or rewards the review');
  await avis.scrollIntoViewIfNeeded();
  await snap(page, '3-r-laisser-un-avis');

  step('« Ta coupe en photo »: picked, framed in the browser, never sent');
  const posts = [];
  page.on('request', (r) => { if (r.method() !== 'GET') posts.push(r.method() + ' ' + r.url()); });
  const photo = page.locator('[data-guide="r.photo"]');
  await photo.waitFor({ timeout: T });
  await photo.scrollIntoViewIfNeeded();
  await snap(page, '5-photo-avant');
  await photo.locator('input[type="file"]').setInputFiles({ name: 'ma-coupe.png', mimeType: 'image/png', buffer: png(600, 800) });
  const cv = photo.locator('canvas');
  await cv.waitFor({ timeout: T });
  const size = () => cv.evaluate((c) => [c.width, c.height]);
  if ((await size()).join('x') !== '1080x1080') throw new Error('the square is not 1080 × 1080: ' + (await size()));
  // the photo is in its window (its two tones, top and bottom), the band under it is the salon's dark
  const px = (x, y) => cv.evaluate((c, p) => [...c.getContext('2d').getImageData(p[0], p[1], 1, 1).data].slice(0, 3), [x, y]);
  const top = await px(540, 200), low = await px(540, 700), band = await px(1000, 1060);
  if (!(top[0] > 150 && low[2] > 120) || band.join() !== '15,14,13') throw new Error('the frame is not drawn as expected: ' + JSON.stringify([top, low, band]));
  await page.waitForTimeout(500);
  const logo = await cv.evaluate((c) => { const d = c.getContext('2d').getImageData(48, 880, 170, 170).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] > 170) n++; return n; });
  if (logo < 200) throw new Error('the salon’s logo is not on the frame (' + logo + ' light pixels)');
  await cv.scrollIntoViewIfNeeded();
  await snap(page, '5-photo-cadre-carre');
  await photo.getByRole('radio', { name: 'Story' }).click();
  await page.waitForTimeout(300);
  if ((await size()).join('x') !== '1080x1920') throw new Error('the story is not 1080 × 1920: ' + (await size()));
  await cv.scrollIntoViewIfNeeded();
  await snap(page, '5-photo-cadre-story');
  for (const b of ['Partager', 'Enregistrer']) { const bb = await photo.getByRole('button', { name: b }).boundingBox(); if (!bb || bb.height < 44) throw new Error('« ' + b + ' » is under 44 px'); }
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: T }), photo.getByRole('button', { name: 'Enregistrer' }).click()]);
  if (!/^larchitecte-coupe-\d{4}-\d{2}-\d{2}-story\.jpg$/.test(dl.suggestedFilename())) throw new Error('the saved file is named ' + dl.suggestedFilename());
  await page.waitForTimeout(400);
  if (posts.length) throw new Error('the photo page sent something: ' + posts.join(', '));
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) throw new Error('the page scrolls sideways at 390 px');
}
