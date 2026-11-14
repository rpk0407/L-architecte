// Booking for someone else on the site, on a phone: a father books his own cut, adds his son (« Ajouter une personne »,
// « Mon enfant »), confirms both at once; the agenda reads « Léo (enfant de Karim Z.) », the child has a file without a
// phone, and the son's place is cancelled on its own page while the father's stays.
import { shot } from '../harness.mjs';

export const name = 'site: a parent books for himself and his child in one go';
export const viewport = { width: 390, height: 844 };

const T = 10000;
const WF = process.env.WF_SHOTS || '';

export default async ({ h, page }) => {
  let at = 'start';
  try { await run(h, page, (x) => { at = x; }); } catch (e) { throw new Error(at + ': ' + e.message.split('\n')[0]); }
};

const eur = (c) => (c % 100 ? (c / 100).toFixed(2).replace('.', ',') : String(c / 100)) + ' €';
/** a service of the list: its name and its price in cents */
async function priceOf(so) {
  const name = (await so.locator('.so-n').innerText()).split('\n')[0].trim();
  const p = (await so.locator('.so-r b').innerText()).replace(/[^0-9,]/g, '').replace(',', '.');
  return { name, cents: Math.round(Number(p) * 100) };
}

async function run(h, page, step) {
  step('first person');
  await page.goto(h.base + '/');
  await page.locator('.cta').first().click();
  await page.locator('.bk button.so').first().click();
  await page.locator('.bk button.wh').first().click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.bk button.sl').first().click();
  await page.locator('#f-first').waitFor({ timeout: T });
  const me = page.getByRole('radio', { name: 'Moi' });
  if ((await me.getAttribute('aria-checked')) !== 'true') throw new Error('« Moi » is not the default');
  await page.fill('#f-first', 'Karim');
  await page.fill('#f-last', 'Zerbib');
  await page.fill('#f-phone', '0611223344');
  // the slot is kept before the next person chooses
  await page.locator('.hold:not(.gone)').waitFor({ timeout: T });
  await page.waitForFunction(() => /gardé/.test(document.querySelector('.hold')?.textContent || ''), null, { timeout: T });

  step('second person: his own service, nothing chosen for him');
  await page.getByRole('button', { name: /Ajouter une personne/ }).click();
  await h.expectText(page, 'Personne 2 · Étape 1 sur 4');
  await h.expectText(page, 'Déjà choisi : Karim');
  if (await page.locator('.bk button.so.on').count()) throw new Error('a service is already chosen for the added person');
  if (await page.locator('.bk button.so-pack').count()) throw new Error('the carnet is offered to an added person');
  // who he is, from the first step: the steps then name him
  await h.expectText(page, 'Quelle coupe pour cette personne ?');
  await page.getByRole('radio', { name: 'Mon enfant' }).click();
  await page.fill('#g-first', 'Léo');
  await h.expectText(page, 'Quelle coupe pour Léo ?');
  // another service than his father's, at another price
  const mine = await priceOf(page.locator('.bk button.so').first());
  const his = await priceOf(page.locator('.bk button.so').nth(1));
  if (his.name === mine.name || his.cents === mine.cents) throw new Error('the two services are the same: ' + JSON.stringify([mine, his]));
  await page.locator('.bk button.so').nth(1).click();
  await h.expectText(page, 'Avec qui pour Léo ?');
  await page.locator('.bk button.wh').first().click();
  await h.expectText(page, 'Quand pour Léo ?');
  // the day of the first person comes preselected; the son goes a few days later (so his place can still be cancelled online)
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.dstrip .dc:not(.full):not(.dc-more)').nth(3).click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.bk button.sl').first().click();
  // asked again with the details, already answered
  await page.locator('#g-first').waitFor({ timeout: T });
  if ((await page.getByRole('radio', { name: 'Mon enfant' }).getAttribute('aria-checked')) !== 'true') throw new Error('« Mon enfant » was forgotten between the steps');
  if ((await page.inputValue('#g-first')) !== 'Léo') throw new Error('his first name was forgotten between the steps');
  if ((await page.getByRole('radio', { name: 'Moi' }).getAttribute('aria-disabled')) !== 'true') throw new Error('« Moi » can be chosen twice');
  await page.fill('#g-age', '8');
  // each one with his own service and price, and what it comes to
  const flat = async (loc) => (await loc.innerText()).replace(/[\u00a0\u202f]/g, ' ');
  const row = await flat(page.locator('.pty-r').first());
  if (!row.includes(mine.name + ' · ' + eur(mine.cents))) throw new Error('the father’s line does not show his service and price: ' + row);
  const recap = await flat(page.locator('.recap'));
  if (!recap.includes(his.name) || !recap.includes(eur(his.cents))) throw new Error('the son’s recap does not show his own service and price: ' + recap);
  await h.expectText(page, 'Total pour 2 personnes : ' + eur(mine.cents + his.cents) + '.');

  step('« Modifier » on the father: another service, the son kept');
  await page.locator('.hold:not(.gone)').waitFor({ timeout: T });
  await page.waitForFunction(() => /gardé/.test(document.querySelector('.hold')?.textContent || ''), null, { timeout: T });
  await page.getByRole('button', { name: 'Modifier la prestation, le barbier ou le créneau de Karim' }).click();
  await h.expectText(page, 'Déjà dans cette réservation');
  if (!(await flat(page.locator('.pty-r').first())).includes('Léo (ton enfant)')) throw new Error('the son is no longer in the booking');
  await page.getByRole('button', { name: 'Modifier la prestation', exact: true }).click();
  await h.expectText(page, 'Étape 1 sur 4');
  if ((await page.locator('.bk button.so.on').count()) !== 1) throw new Error('his own service is not the one shown as chosen');
  const third = await priceOf(page.locator('.bk button.so').nth(2));
  await page.locator('.bk button.so').nth(2).click();
  // same barber, same slot: straight back to the details, with the new service and the new total
  await page.locator('#f-first').waitFor({ timeout: T });
  if (!(await flat(page.locator('.recap'))).includes(third.name)) throw new Error('the father’s service did not change');
  if (!(await flat(page.locator('.pty-r').first())).includes(his.name + ' · ' + eur(his.cents))) throw new Error('the son’s line lost his service or his price');
  await h.expectText(page, 'Total pour 2 personnes : ' + eur(third.cents + his.cents) + '.');
  // back to the son, as before (once the father's slot is kept again)
  await page.waitForFunction(() => /gardé/.test(document.querySelector('.hold')?.textContent || ''), null, { timeout: T });
  await page.getByRole('button', { name: 'Modifier la prestation, le barbier ou le créneau de Léo' }).click();
  await page.locator('#g-first').waitFor({ timeout: T });
  await h.expectText(page, 'Tu restes le contact pour chaque message');
  await h.expectText(page, 'Déjà dans cette réservation');
  // touch targets: the three choices and the remove button are 44 px at least
  const small = await page.evaluate(() => [...document.querySelectorAll('.fo, .pty-x, .pty-t, .add-p')].filter((e) => e.getBoundingClientRect().height < 44).length);
  if (small) throw new Error(small + ' touch target(s) under 44 px');
  const wide = await page.evaluate(() => document.scrollingElement.scrollWidth);
  if (wide > 390) throw new Error('the page scrolls sideways: ' + wide);
  await page.locator('#g-first').scrollIntoViewIfNeeded();
  await shot(page, 'site-pour-autrui-390');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(900);
  if (WF) await page.screenshot({ path: WF + '/site-pour-autrui-390.png' });

  step('confirm');
  const cta = page.locator('.bk-foot .btn');
  if (!/Confirmer les 2 rendez-vous/.test(await cta.textContent())) throw new Error('the button says « ' + (await cta.textContent()) + ' »');
  await cta.click();
  await h.expectText(page, 'C’est réservé, Karim');
  await h.expectText(page, 'Le rendez-vous de Léo (ton enfant)');
  await page.waitForTimeout(900);
  if (WF) await page.screenshot({ path: WF + '/site-pour-autrui-done-390.png' });
  const link = await page.getByRole('link', { name: /Sa page : déplacer ou annuler pour Léo/ }).getAttribute('href');
  const token = decodeURIComponent(String(link).split('/r/')[1] || '');
  if (!token) throw new Error('no page for Léo: ' + link);

  step('the agenda and the child file');
  await h.setup();
  const today = '2026-10-27';
  let found = null;
  for (let i = 0; i < 8 && !found; i++) {
    const d = new Date(Date.parse(today + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10);
    const ag = await h.api('/api/v1/agenda?day=' + d);
    found = (ag.json.appts || []).find((a) => a.name === 'Léo (enfant de Karim Z.)');
  }
  if (!found) throw new Error('the agenda does not read « Léo (enfant de Karim Z.) »');
  // each one booked with his own service at its own price
  const all = [];
  for (let i = 0; i < 8; i++) { const d = new Date(Date.parse(today + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10); all.push(...((await h.api('/api/v1/agenda?day=' + d)).json.appts || [])); }
  const dad = all.find((a) => a.name === 'Karim Z.' && a.status === 'booked' && a.client && a.client.phone && a.source === 'site');
  if (!dad) throw new Error('the father is not in the agenda');
  if (dad.services[0].id === found.services[0].id || dad.price === found.price) throw new Error('father and son were booked with the same service or price: ' + JSON.stringify([dad.services[0].name, dad.price, found.services[0].name, found.price]));
  if (!found.client || found.client.first !== 'Karim') throw new Error('the contact is not the parent: ' + JSON.stringify(found.client));
  const kids = await h.api('/api/v1/clients?q=' + encodeURIComponent('Léo Zerbib'));
  const kid = (kids.json.items || []).find((c) => c.first === 'Léo' && c.last === 'Zerbib');
  if (!kid) throw new Error('no file for Léo');
  if (kid.phone) throw new Error('the child has a phone on his file: ' + kid.phone);

  step('cancel the child only');
  const res = await page.evaluate(async (t) => { const r = await fetch('/api/public/bookings/' + encodeURIComponent(t) + '/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return { s: r.status, j: await r.json() }; }, token);
  if (res.s !== 200 || res.j.status !== 'cancelled') throw new Error('Léo’s place is not cancelled: ' + JSON.stringify(res));
  if (res.j.first !== 'Léo') throw new Error('his page shows « ' + res.j.first + ' »');
  const ag = await h.api('/api/v1/agenda?day=' + found.day);
  const karim = (ag.json.appts || []).find((a) => a.name === 'Karim Z.' && a.status === 'booked');
  const leo = (ag.json.appts || []).find((a) => a.id === found.id);
  if (!leo || leo.status !== 'cancelled') throw new Error('Léo is not cancelled in the agenda');
  if (!karim) {
    // the father may be on another day than his son: he is still booked somewhere
    const all = await h.api('/api/v1/clients?q=0611223344');
    if (!(all.json.items || []).length) throw new Error('the father’s booking is gone');
  }
}
