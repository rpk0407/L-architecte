// CPT-01a: Caisse › Clôture lists the month closures under the Z, the last month « ✓ signée »; one prints as a month
// report (the Z layout, the period's grand total and the perpetual totals). Desktop, then a phone without sideways scroll.
export const name = 'month closures: the last month signed, printed as a month report';

export default async ({ h, page }) => {
  // window.print would open a dialog: count the calls, the page is checked under print media instead
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/caisse/cloture');
  const block = page.getByRole('region', { name: 'Clôtures mensuelles' });
  await block.getByRole('heading', { name: 'Clôtures mensuelles' }).waitFor({ timeout: 10000 });
  // the demo's clock is 27 October: September is the last month closed, signed the morning after
  const last = block.getByRole('row').nth(1);
  const text = (await last.innerText()).replace(/\s+/g, ' ');
  if (!/Septembre 2026/.test(text) || !/M0002/.test(text) || !/✓ signée/.test(text)) throw new Error('last month row: ' + text);
  if (!(await block.getByRole('row', { name: /Août 2026/ }).innerText()).includes('✓ signée')) throw new Error('August should be signed too');
  await block.scrollIntoViewIfNeeded();
  await h.shot(page, 'month-closures');

  // what goes to the printer: the .print-only documents shown under print media
  const printedNow = async (n) => {
    await page.waitForFunction((k) => window.__printed >= k, n, { timeout: 4000 });
    await page.emulateMedia({ media: 'print' });
    const out = await page.evaluate(() => [...document.querySelectorAll('.print-only')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => x.innerText).join('\n---\n').replace(/[\u00a0\u202f]/g, ' '));
    await page.emulateMedia({ media: 'screen' });
    return out;
  };
  // a Z first, then the month: only the month goes to the printer
  await page.getByRole('button', { name: /^Imprimer Z\d{4}$/ }).first().click();
  if (!(await printedNow(1)).includes('CLÔTURE Z')) throw new Error('the Z report did not print');
  await block.getByRole('button', { name: 'Imprimer M0002' }).click();
  const printed = await printedNow(2);
  for (const want of ['CLÔTURE MENSUELLE M0002', 'Du 01/09/2026 au 30/09/2026', 'CA TTC net', 'Grand total de la période', 'Total perpétuel', 'Sceau', 'Signature : ✓ signée']) {
    if (!printed.includes(want)) throw new Error('the month report lacks « ' + want + ' »:\n' + printed);
  }
  if (printed.includes('CLÔTURE Z')) throw new Error('only the month report goes to the printer:\n' + printed);
  // the month's tickets as its row counts them, with their range, and its Z
  const count = (text.match(/(\d+) tickets/) || [])[1];
  if (!count || count === '0' || !new RegExp('Tickets\\s*' + count + ' \\(T\\d+ → T\\d+\\)').test(printed)) throw new Error('the month report should print ' + count + ' tickets and their range:\n' + printed);
  if (!/Z\s*Z\d{4} → Z\d{4} \(\d+\)/.test(printed)) throw new Error('the month report should print its Z range:\n' + printed);
  // and the other way round: a Z after the month prints the Z alone
  await page.getByRole('button', { name: /^Imprimer Z\d{4}$/ }).first().click();
  const z = await printedNow(3);
  if (!z.includes('CLÔTURE Z') || z.includes('CLÔTURE MENSUELLE')) throw new Error('only the Z goes to the printer:\n' + z);

  const phone = await h.newPage({ viewport: { width: 390, height: 844 } });
  await h.loginOwner(phone);
  await phone.goto(h.base + '/comptoir/caisse/cloture');
  const small = phone.getByRole('region', { name: 'Clôtures mensuelles' });
  await small.getByRole('heading', { name: 'Clôtures mensuelles' }).waitFor({ timeout: 10000 });
  await small.scrollIntoViewIfNeeded();
  if (await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the closing page scrolls sideways on a phone');
  const btn = await small.getByRole('button', { name: 'Imprimer M0002' }).boundingBox();
  if (!btn || btn.height < 44 || btn.width < 44) throw new Error('the print button is under 44 px: ' + JSON.stringify(btn));
  await h.shot(phone, 'month-closures-phone');
};
