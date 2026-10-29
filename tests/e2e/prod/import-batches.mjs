// Production: an export longer than one batch (150 rows). A customer who changed number between two upcoming bookings keeps the number of
// his newest booking in every batch the wizard cuts the export into: the plugin lists the newest first, so the older booking comes in a
// later batch, and neither the first pass nor the final sync (the same export again) takes the file back to its number. The preview then
// says there is nothing new, the sync leaves a report without a line about the number, and a number corrected on the old site afterwards
// is carried exactly once.
// Run by tests/e2e/prod.mjs: export default async ({ h, page }), h = { base, setup(), loginOwner(page), api() }.
import { Buffer } from 'node:buffer';

export const name = 'Réglages › Reprendre WordPress: a long export (three batches), the number of the newest booking holds';

const seen = (page, text, timeout = 10000) => page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout });
const call = (page, path, body) => page.evaluate(async ([p, b]) => {
  const r = await fetch(p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'e2e-' + Math.random().toString(36).slice(2) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body]);
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ': ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A day the plugin prints ("14 Nov 2026"), n days from today: the bookings stay to come whenever the test runs. */
const stamp = (n, hh) => { const d = new Date(Date.now() + n * 86400000); return String(d.getUTCDate()).padStart(2, '0') + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + hh; };
const HEAD = 'ID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"NOMBRE DE POUR CHAQUE SERVICE","PRIX TOTAL",ÉTAT\n';
const day = (n) => stamp(n, '00:00').slice(0, 11);

/**
 * 320 other customers and Karim, whose older booking (40010) has the old number and whose newest (40400) the new one. The plugin lists the newest
 * first; the two bookings are the first and the last of the list whether it is read by number or by date, so they never share a batch.
 */
function exportOf(karim2) {
  const rows = [];
  for (let i = 0; i < 320; i++) rows.push({ wp: 40020 + i, first: 'Client' + i, last: 'Test', phone: '06' + String(20000000 + i * 101).slice(0, 8), email: 'client' + i + '@exemple.fr', at: stamp(6 + (i % 20), String(9 + (i % 8)).padStart(2, '0') + ':00') });
  rows.push({ wp: 40010, first: 'Karim', last: 'Benali', phone: '0600000001', email: 'karim@exemple.fr', at: stamp(40, '10:00') });
  rows.push({ wp: 40400, first: 'Karim', last: 'Benali', phone: karim2, email: 'karim@exemple.fr', at: stamp(3, '10:00') });
  rows.sort((a, b) => b.wp - a.wp);
  return 'Réservations,de,à\n,"' + day(-30) + '","' + day(400) + '"\n\n' + HEAD
    + rows.map((r) => `${r.wp},"${r.at}","${stamp(-2, '08:00')}",${r.first},${r.last},${r.email},${r.phone},Coupe,JKut,1,"20 €",Confirmé\n`).join('');
}

export default async ({ h, page }) => {
  const base = h.base.replace(/\/$/, '');
  await h.loginOwner(page);
  must(await call(page, '/api/v1/staff', { name: 'JKut', role: 'barber' }), 'add JKut');
  must(await call(page, '/api/v1/services', { name: 'Coupe classique', short: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }), 'add cl');
  const drop = (text, name = 'export.csv') => page.setInputFiles('.wp-drop input[type=file]', [{ name, mimeType: 'text/csv', buffer: Buffer.from(text) }]);
  const ready = async () => {
    await page.waitForFunction(() => !document.body.textContent.includes('Vérification des fiches') && !document.body.textContent.includes('Lecture de'), null, { timeout: 30000 });
    await page.waitForFunction(() => { const b = document.querySelector('.wp-go button'); return b && !b.disabled; }, null, { timeout: 30000 });
  };
  const karim = async () => {
    const r = must(await call(page, '/api/v1/clients?q=Karim'), 'clients');
    return (r.items || []).filter((c) => /^Karim/.test(c.first || c.name || '')).map((c) => c.phone);
  };

  // the first pass: 322 bookings, three batches; the older booking of Karim comes in the last one
  const first = exportOf('0600000002');
  await page.goto(base + '/comptoir/reglages/wordpress');
  await seen(page, 'Exporte depuis WordPress');
  await drop(first);
  await seen(page, 'Ce qui va être repris');
  await ready();
  await page.getByRole('button', { name: /^Importer 322 rendez-vous/ }).click();
  await seen(page, 'Tout est compté', 60000);
  let phones = await karim();
  if (phones.length !== 1 || !/00 00 00 02/.test(phones[0])) throw new Error('Karim should have one file with the number of his newest booking: ' + JSON.stringify(phones));

  // the final sync: the same export again, nothing new, and the report says nothing about a number
  await page.goto(base + '/comptoir/reglages/wordpress');
  await drop(first);
  await seen(page, 'Tout est déjà repris');
  await ready();
  await page.getByRole('button', { name: 'Enregistrer la vérification (rien de nouveau)' }).click();
  await seen(page, 'Tout est compté', 60000);
  if (await page.getByText('numéro', { exact: false }).locator('visible=true').filter({ hasText: /Autre numéro|numéro gardé|Nouveau numéro/ }).count()) throw new Error('the sync of an unchanged export talks about a number');
  phones = await karim();
  if (phones.length !== 1 || !/00 00 00 02/.test(phones[0])) throw new Error('the sync took the file back to the older number: ' + JSON.stringify(phones));

  // the old site then corrects the newest booking: counted by the preview, carried once, and the same export again has nothing new
  const fixed = exportOf('0600000003');
  await page.goto(base + '/comptoir/reglages/wordpress');
  await drop(fixed);
  await seen(page, 'Modifié sur l’ancien site depuis le premier import (numéro)');
  if (await page.getByText('Tout est déjà repris').count()) throw new Error('the preview says « rien de nouveau » over a corrected number');
  await ready();
  await page.getByRole('button', { name: 'Importer 1 changement' }).click();
  await seen(page, 'Tout est compté', 60000);
  await seen(page, 'Autre numéro sur l’ancien site pour Karim Benali');
  phones = await karim();
  if (phones.length !== 1 || !/00 00 00 03/.test(phones[0])) throw new Error('the file did not follow the corrected number: ' + JSON.stringify(phones));
  await page.goto(base + '/comptoir/reglages/wordpress');
  await drop(fixed);
  await seen(page, 'Tout est déjà repris');
};
