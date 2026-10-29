// Production: the owner takes over the WordPress salon. Réglages › Reprendre WordPress, the French bookings export and
// the WXR dropped at once, the preview, the import; the agenda shows an imported booking on its date, and an old
// e-mail link (/ancien-lien) opens that booking's own page. Then the cut-over day: the export again, with a booking
// cancelled on the old site since and a new one; only those are carried over, and a third drop has nothing new.
// Run by tests/e2e/prod.mjs: export default async ({ h, page }), h = { base, setup(), loginOwner(page), api() }.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { ROOT } from '../harness.mjs';

export const name = 'Réglages › Reprendre WordPress: preview, import, the agenda, old e-mail links';

const FIX = join(ROOT, 'tests', 'fixtures');
const seen = (page, text, timeout = 10000) => page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout });
const call = (page, path, body) => page.evaluate(async ([p, b]) => {
  const r = await fetch(p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'e2e-' + Math.random().toString(36).slice(2) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body]);
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ': ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };

export default async ({ h, page }) => {
  const base = h.base.replace(/\/$/, '');
  await h.loginOwner(page);
  // the new salon: the old site's barbers and the cuts its bookings name
  for (const name of ['JKut', 'Le Soldat']) must(await call(page, '/api/v1/staff', { name, role: 'barber' }), 'add ' + name);
  must(await call(page, '/api/v1/services', { name: 'Coupe classique', short: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }), 'add cl');
  must(await call(page, '/api/v1/services', { name: 'Coupe + contour de barbe', category: 'Coupes', price: 2500, dur: 30, slug: 'cc' }), 'add cc');
  await page.goto(base + '/comptoir');
  await page.locator('#page-title h1').waitFor();

  // Réglages › Reprendre WordPress, from the menu
  await page.goto(base + '/comptoir/reglages');
  await page.getByRole('link', { name: /Reprendre WordPress/ }).click();
  await seen(page, 'Exporte depuis WordPress');
  await page.setInputFiles('.wp-drop input[type=file]', [join(FIX, 'wp-bookings-fr.csv'), join(FIX, 'wp-bookings.wxr.xml')]);
  await seen(page, 'Ce qui va être repris');
  const tile = async (k) => (await page.locator('.wp-kpis .kpi', { hasText: k }).locator('.kpi-v').textContent()).trim();
  const go = page.getByRole('button', { name: /^Importer \d+ rendez-vous/ });
  await go.waitFor();
  // the server has said who already has a file
  await page.waitForFunction(() => !document.body.textContent.includes('Vérification des fiches'), null, { timeout: 10000 });
  // Hugo's booking is in error: seven people, none known yet in a new salon
  if (await tile('Nouveaux clients') !== '7') throw new Error('preview: ' + await tile('Nouveaux clients') + ' new clients, expected 7');
  if (await tile('Fusionnés') !== '0') throw new Error('preview: nobody should be merged in a new salon');
  if (await page.locator('.wp-row select').first().inputValue() === '') throw new Error('the old site’s « Coupe » was not matched to a service');
  if (!(await page.getByRole('combobox', { name: 'Barbier pour « Soldat »' }).locator('option:checked').textContent()).includes('Le Soldat')) throw new Error('Soldat → Le Soldat not matched');
  // John left the salon: his history goes to the archived profile, but an upcoming booking of his needs a chair
  const john = page.getByRole('combobox', { name: 'Barbier pour « John »' });
  if (await john.inputValue() === '') {
    if (await go.isEnabled()) throw new Error('Importer is enabled while John’s upcoming booking has no chair');
    await john.selectOption({ label: 'JKut' });
  } else if (await john.inputValue() !== 'legacy') throw new Error('John should default to the archived profile (history only) or to no choice');
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('.wp-go button')][0]; return b && !b.disabled; }, null, { timeout: 10000 });
  await go.click();
  await seen(page, 'Tout est compté', 20000);

  // an imported booking on its date: Karim's cut of 12 August with JKut
  const day = '2026-08-12';
  const ag = must(await call(page, '/api/v1/agenda?day=' + day), 'agenda');
  const karim = (ag.appts || []).find((a) => a.name.startsWith('Karim'));
  if (!karim || karim.source !== 'import' || karim.status !== 'done') throw new Error('Karim’s imported visit is not in the agenda of ' + day + ': ' + JSON.stringify(ag.appts));
  await page.goto(base + '/comptoir?day=' + day);
  await seen(page, 'Karim');

  // the old e-mail link of Yanis's booking: the secret matches, his appointment page opens; a wrong one does not
  await page.goto(base + '/ancien-lien?sln-api=cancel_booking&booking_id=1350-7f3a9c1e2b4d6f8091a2b3c4d5e6f708');
  await page.waitForURL(/\/r\/[^/?#]+$/, { timeout: 10000 });
  await seen(page, 'Yanis');
  await page.goto(base + '/ancien-lien?sln_booking_id=1350-0000000000000000000000000000dead');
  await seen(page, 'Ton rendez-vous a déménagé avec nous.');
  if (/\/r\//.test(page.url())) throw new Error('a wrong secret opened the booking');

  // the cut-over day: the export again, Karim's 15 Dec booking cancelled on the old site since, and one new booking
  const csv = readFileSync(join(FIX, 'wp-bookings-fr.csv'), 'utf8');
  const was = csv.split('\n').find((l) => l.startsWith('1360,'));
  const cutover = csv.replace(was, was.replace(/Confirmé$/, 'Annulé')) + '1395,"16 Déc 2026 10:00","01 Nov 2026 09:00",Sami,Kaci,sami.kaci@exemple.fr,0644556677,Coupe,Soldat,1,"20 €",Confirmé\n';
  const drop = () => page.setInputFiles('.wp-drop input[type=file]', [{ name: 'wp-bookings-fr.csv', mimeType: 'text/csv', buffer: Buffer.from(cutover) }, { name: 'wp-bookings.wxr.xml', mimeType: 'text/xml', buffer: readFileSync(join(FIX, 'wp-bookings.wxr.xml')) }]);
  await page.goto(base + '/comptoir/reglages/wordpress');
  await drop();
  await seen(page, 'depuis le premier import');
  const delta = page.getByRole('button', { name: 'Importer 1 rendez-vous, 1 changement' });
  await delta.waitFor({ timeout: 10000 });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('.wp-go button')][0]; return b && !b.disabled; }, null, { timeout: 10000 });
  await delta.click();
  await seen(page, 'Tout est compté', 20000);
  const dec = must(await call(page, '/api/v1/agenda?day=2026-12-15'), 'agenda 15 Dec');
  const k = (dec.appts || []).find((a) => a.name.startsWith('Karim'));
  if (!k || k.status !== 'cancelled') throw new Error('Karim’s booking cancelled on the old site is still ' + (k && k.status));
  const dec16 = must(await call(page, '/api/v1/agenda?day=2026-12-16'), 'agenda 16 Dec');
  if (!(dec16.appts || []).some((a) => a.name.startsWith('Sami') && a.status === 'booked')) throw new Error('the new booking of the cut-over export is missing');

  // the same files once more: everything is already there, nothing to import
  await page.goto(base + '/comptoir/reglages/wordpress');
  await drop();
  await seen(page, 'Tout est déjà repris');
  await page.getByRole('button', { name: 'Enregistrer la vérification (rien de nouveau)' }).waitFor();

  // Jour J on a production salon: the sends are held until the switch, the old addresses are tried on this server's own
  // address, and the DNS and the parked site wait for a domain (the card asks for it)
  await page.goto(base + '/comptoir/reglages/wordpress');
  await page.getByRole('heading', { name: 'Jour J' }).waitFor({ timeout: 10000 });
  await seen(page, 'Avant la bascule, le salon n’envoie aucun SMS ni e-mail à un client');
  const step = (id) => page.locator('.jj-step[data-step="' + id + '"]');
  const waitState = async (id, want) => { for (const t0 = Date.now(); Date.now() - t0 < 20000; await page.waitForTimeout(200)) if ((await step(id).getAttribute('data-state')) === want) return; throw new Error(id + ' is ' + (await step(id).getAttribute('data-state')) + ', expected ' + want); };
  await waitState('first-run', 'ok');
  // the old addresses answer on this server's own address, but without a domain pointing here they are still « à faire »
  await waitState('redirects', 'todo');
  await seen(page, 'redirigent comme prévu sur');
  await seen(page, 'ton domaine n’est pas encore indiqué');
  await waitState('dns', 'todo');
  if (await page.getByLabel('Ton domaine').count() !== 1) throw new Error('the card does not ask for the domain');
  // a typed domain is checked as a name, not as an address
  const bad = await h.api('/api/v1/bascule?domain=127.0.0.1');
  if (bad.status !== 400) throw new Error('an IP address was accepted as a domain: ' + bad.status);
  const card = must(await call(page, '/api/v1/bascule'), 'bascule');
  if (!card.hold.on || card.demo) throw new Error('the hold is not on in production: ' + JSON.stringify(card.hold));
  // the switch is refused before the freeze and a sync after it
  const early = await h.api('/api/v1/bascule/switch', { body: {} });
  if (early.status !== 409 || early.json.error.code !== 'not_ready') throw new Error('the switch before the freeze: ' + early.status + ' ' + JSON.stringify(early.json));
  if (!(await page.getByRole('button', { name: 'Ouvrir les envois' }).isDisabled())) throw new Error('« Ouvrir les envois » is open before the freeze');
  await page.locator('.jj').evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-bascule-prod-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await step('dns').scrollIntoViewIfNeeded();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('Jour J scrolls sideways on a phone');
  await h.shot(page, 'wp-bascule-prod-phone');
};
