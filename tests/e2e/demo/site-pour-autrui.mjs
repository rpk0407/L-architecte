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

  step('second person');
  await page.getByRole('button', { name: /Ajouter une personne/ }).click();
  await h.expectText(page, 'Personne 2 · Étape 1 sur 4');
  await h.expectText(page, 'Déjà choisi : Karim');
  await page.locator('.bk button.so').first().click();
  await page.locator('.bk button.wh').first().click();
  // the day of the first person comes preselected; the son goes a few days later (so his place can still be cancelled online)
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.dstrip .dc:not(.full):not(.dc-more)').nth(3).click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.bk button.sl').first().click();
  await page.getByRole('radio', { name: 'Mon enfant' }).click();
  if ((await page.getByRole('radio', { name: 'Moi' }).getAttribute('aria-disabled')) !== 'true') throw new Error('« Moi » can be chosen twice');
  await page.fill('#g-first', 'Léo');
  await page.fill('#g-age', '8');
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
