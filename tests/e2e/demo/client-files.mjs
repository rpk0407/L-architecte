// The owner's side of a client file: ⋯ › Exporter ses données downloads the JSON, a probable duplicate is merged
// from its segment after the side-by-side preview, and erasing a file with a booking to come cancels it first.
import { readFile } from 'node:fs/promises';

export const name = 'client files: export, duplicates merged, erasure that cancels first';

export default async ({ h, page }) => {
  await h.setup();
  const mk = async (body) => { const r = await h.api('/api/v1/clients', { body }); if (!r.ok) throw new Error('client not created: ' + r.text); return r.json.id; };
  const y1 = await mk({ first: 'Yanis', last: 'Benali', phone: '0611002200', email: 'yanis.b@exemple.fr' });
  const y2 = await mk({ first: 'Yanis', last: 'Benali', phone: '0755443322' });
  await h.loginOwner(page);

  // export: a client with history, from the ⋯ menu
  const list = (await h.api('/api/v1/clients?limit=50')).json;
  const c = list.items.find((x) => x.visits > 1);
  await page.goto(h.base + '/comptoir/clients/' + c.id);
  await h.expectText(page, 'Fiche technique');
  await h.expectText(page, 'SMS bons plans');
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Exporter ses données' }).click()]);
  if (!/^larchitecte-donnees-.+\.json$/.test(dl.suggestedFilename())) throw new Error('unexpected file name ' + dl.suggestedFilename());
  const data = JSON.parse(await readFile(await dl.path(), 'utf8'));
  if (data.fiche.prenom !== c.first) throw new Error('the export is not ' + c.first + '’s: ' + JSON.stringify(data.fiche));
  if (data.rendezVous.length < c.visits) throw new Error('the export misses appointments: ' + data.rendezVous.length);
  if (!data.tickets.length) throw new Error('the export has no ticket');

  // duplicates: the segment shows the pair, one tap opens the preview, the merge leaves one file
  await page.goto(h.base + '/comptoir/clients?segment=doublons');
  await h.expectText(page, '1 doublon probable');
  await page.getByRole('button', { name: 'Fusionner', exact: true }).click();
  await h.expectText(page, 'Fiche gardée');
  await h.expectText(page, 'yanis.b@exemple.fr');
  await h.shot(page, 'client-merge-preview');
  await page.getByRole('button', { name: 'Fusionner (irréversible)' }).click();
  await h.expectText(page, 'Fiches fusionnées');
  const left = (await h.api('/api/v1/clients?q=yanis%20benali')).json;
  if (left.total !== 1) throw new Error('still ' + left.total + ' Yanis Benali files');
  const kept = left.items[0].id;
  if (![y1, y2].includes(kept)) throw new Error('an unknown file was kept');

  // erasure: a booking to come is listed, cancelled with a text, then the file is gone
  const boot = (await h.api('/api/v1/bootstrap')).json;
  const svc = boot.services.find((x) => x.active && !x.pack), barber = boot.staff.find((x) => x.chair && x.active);
  const booked = await h.api('/api/v1/appointments', { body: { clientId: kept, serviceIds: [svc.id], staffId: barber.id, day: '2026-11-04', start: 600, force: true } });
  if (!booked.ok) throw new Error('booking failed: ' + booked.text);
  await page.goto(h.base + '/comptoir/clients/' + kept);
  await h.expectText(page, 'Fiche technique');
  await page.getByRole('button', { name: 'Plus d’actions' }).click();
  await page.getByRole('menuitem', { name: 'Effacer (RGPD)' }).click();
  await h.expectText(page, 'Encore ouvert sur sa fiche');
  // the dialog names what leaves: the text, and the mail with its calendar file when the merged file has an address
  const mailed = !!(await h.api('/api/v1/clients/' + kept + '/open')).json.email;
  const box = page.getByRole('checkbox', { name: 'Annuler ses rendez-vous et le prévenir par SMS' + (mailed ? ' et par e-mail' : '') + ' avant l’effacement' });
  if (!(await box.isChecked())) throw new Error('the cancellation is not checked by default');
  await h.shot(page, 'client-erase');
  await page.getByRole('button', { name: 'Effacer définitivement' }).click();
  await h.expectText(page, 'Fiche effacée');
  if (!(await h.api('/api/v1/clients/' + kept)).json.client.erased) throw new Error('the file was not erased');
  const after = (await h.api('/api/v1/clients/' + kept)).json;
  if (after.appts.some((a) => ['booked', 'pending'].includes(a.status))) throw new Error('a booking of the erased client is still to come');
  if (!after.messages.some((m) => m.template === 'cancelled')) throw new Error('no cancellation text was sent');
};
