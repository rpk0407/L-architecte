// The owner poses an absence over two days: the sheet lists every client it lands on with a proposal, one is left
// for later, the plan is applied in one tap, and the agenda's banner brings the owner back to what is left.
export const name = 'absence over two days: the conflict list, the plan applied, the banner for what is left';

export default async ({ h, page }) => {
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/equipe');
  await h.expectText(page, 'Absences à venir');
  await page.getByRole('button', { name: 'Poser une absence' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.locator('.chip', { hasText: 'Frank' }).click();
  await sheet.locator('#to-f').fill('2026-10-30');
  await sheet.locator('#to-t').fill('2026-10-31');

  // the conflict list: both days, one line per client, each with what happens to it
  await sheet.getByText(/\d+\s+rendez-vous chez Frank/).waitFor({ timeout: 8000 });
  const rows = sheet.locator('.eq-plan-row');
  const n = await rows.count();
  if (n < 20) throw new Error('expected the 26 appointments of Frank on Friday and Saturday, got ' + n);
  for (const d of ['Vendredi 30 octobre', 'Samedi 31 octobre']) await sheet.getByText(d).first().waitFor();
  const first = await sheet.locator('.eq-plan-pick').first().evaluate((el) => [...el.options].map((o) => o.textContent));
  if (!first.some((t) => /^Chez .+ à /.test(t)) || !first.some((t) => /choisir|appeler/.test(t))) throw new Error('the proposals are not offered: ' + JSON.stringify(first));
  await h.shot(page, 'absence-plan');

  // one client left for later, the rest applied and told
  await sheet.locator('.eq-plan-pick').first().selectOption('keep');
  await sheet.getByText(/1 laissé pour l’instant/).waitFor();
  await sheet.getByRole('button', { name: 'Appliquer et prévenir' }).click();
  await h.expectText(page, 'replacés');
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 8000 });

  // the list says one is left, and so does the agenda, with the way back to it
  // (one kept back, plus any client the plan asked to choose: they stay with Frank until they do)
  await page.getByText(/\d+\s+rdv à replacer/).first().waitFor({ timeout: 8000 });
  await page.goto(h.base + '/comptoir/agenda');
  await page.getByText(/\d+\s+rendez-vous chez Frank, absent vendredi/).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Traiter' }).click();
  await page.getByRole('dialog').getByText('Les clients de Frank').waitFor({ timeout: 8000 });
  const left = await page.getByRole('dialog').locator('.eq-plan-row').count();
  if (left < 1 || left >= n) throw new Error('the plan should list the clients left, got ' + left + ' of ' + n);
  await h.shot(page, 'absence-plan-left');
};
