// A gift card sold at the till: whoever has no chair says who sold it, the voucher prints the full code (print
// emulation), the code goes by SMS; then the unused card is cancelled and refunded line by line, and the credit
// note prints as an avoir on its ticket.
export const name = 'gift card: voucher with the full code, SMS, refund by line, printed avoir';

export default async ({ h, page }) => {
  // window.print would open a dialog: count the calls, the page is checked under print media instead
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await h.loginOwner(page);
  await h.setup();
  const printed = async () => {
    await page.waitForFunction(() => window.__printed > 0, null, { timeout: 3000 });
    await page.evaluate(() => { window.__printed = 0; });
    await page.emulateMedia({ media: 'print' });
    // what the printer gets: the print-only blocks that are visible under print media
    const text = await page.evaluate(() => [...document.querySelectorAll('.print-only')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.innerText).join('\n---\n').replace(/[\u00a0\u202f]/g, ' '));
    const n = await page.evaluate(() => document.querySelectorAll('.print-only').length);
    await page.emulateMedia({ media: 'screen' });
    return { text, n };
  };

  await page.goto(h.base + '/comptoir/caisse?vente=1');
  await page.locator('.ticket').waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.getByRole('button', { name: 'Carte cadeau', exact: true }).click();
  await page.locator('#gc-to').fill('Pour Karim, joyeux anniversaire');
  await page.getByRole('button', { name: 'Ajouter la carte de 50 €' }).click();
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await page.getByRole('button', { name: /Valider l’encaissement/ }).click();
  // the owner has no chair: the sale is not credited to her without asking
  const who = page.getByRole('dialog', { name: 'Qui a fait la prestation ?' });
  await who.waitFor({ timeout: 4000 });
  await h.shot(page, 'till-who');
  await who.getByRole('button', { name: 'JKut' }).click();
  await page.locator('.done .gift code').waitFor({ timeout: 8000 });
  const code = (await page.locator('.done .gift code').textContent()).trim();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) throw new Error('no code shown: ' + code);
  await h.shot(page, 'till-gift-done');

  // the voucher: full code, amount, expiry, recipient, salon; and only the voucher goes to the printer
  await page.getByRole('button', { name: 'Imprimer la carte cadeau' }).click();
  const v = await printed();
  for (const want of [code, '50 €', 'Valable jusqu’au', 'Pour Karim, joyeux anniversaire', 'CARTE CADEAU', 'Architecte']) if (!v.text.includes(want)) throw new Error('the voucher misses "' + want + '":\n' + v.text);
  if (v.n !== 1) throw new Error(v.n + ' blocks would print at once');
  // the ticket prints its last four only
  await page.getByRole('button', { name: 'Imprimer le ticket' }).click();
  const tk = await printed();
  if (tk.text.includes(code) || !tk.text.includes('Carte cadeau ' + code.slice(-4))) throw new Error('the ticket should carry the last four only:\n' + tk.text);

  // the code by SMS, to whoever receives the card
  await page.getByLabel('Numéro de la personne qui reçoit la carte').fill('06 98 76 54 32');
  await page.getByRole('button', { name: 'Envoyer le code par SMS' }).click();
  await page.getByText('Code envoyé par SMS').first().waitFor({ timeout: 5000 });

  // refunded: the card is cancelled, the credit note prints against its ticket
  const pulse = await h.api('/api/v1/pulse');
  const sales = (await h.api('/api/v1/sales?day=' + pulse.json.today)).json.items;
  const sale = sales.find((x) => x.lines.some((l) => l.kind === 'giftcard' && l.name.endsWith(code.slice(-4))));
  if (!sale) throw new Error('no ticket for the card');
  await page.goto(h.base + '/comptoir/caisse/ventes?ticket=' + sale.id);
  await page.getByRole('button', { name: 'Rembourser' }).click();
  const dlg = page.getByRole('dialog', { name: 'Remboursement' });
  await dlg.getByRole('checkbox', { name: /Annuler la carte et rembourser/ }).click();
  await dlg.getByRole('button', { name: 'Erreur de caisse' }).click();
  await h.shot(page, 'refund-giftcard');
  await dlg.getByRole('button', { name: 'Rembourser 50 €' }).click();
  await dlg.getByRole('button', { name: 'Imprimer l’avoir' }).click();
  const note = await printed();
  if (!/AVOIR A\d{6} · ticket T\d{6}/.test(note.text) || !note.text.includes('carte cadeau (hors TVA)')) throw new Error('the credit note:\n' + note.text);
  const check = await h.api('/api/v1/giftcards/check?code=' + encodeURIComponent(code));
  if (check.json.status !== 'void') throw new Error('the card is still ' + check.json.status);
};
