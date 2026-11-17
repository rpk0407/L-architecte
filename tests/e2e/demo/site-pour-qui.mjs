// « C’est pour qui ? » at the very start, « À plusieurs »: a parent books for two children with different services.
// The first child is named at the first step, the steps name her, the details lead to « Ajouter la personne suivante »,
// the second child comes as « Mon enfant » by default, and both places are confirmed at once with the organiser's recap.
export const name = 'site: « À plusieurs » from the start, a parent books two children with different services';
export const viewport = { width: 390, height: 844 };

const T = 10000;

export default async ({ h, page }) => {
  let at = 'start';
  try { await run(h, page, (x) => { at = x; }); } catch (e) { throw new Error(at + ': ' + e.message.split('\n')[0]); }
};

async function run(h, page, step) {
  step('« À plusieurs », the first child');
  await page.goto(h.base + '/');
  await page.locator('.cta').first().click();
  const ent = page.getByRole('radiogroup', { name: 'C’est pour qui ?' });
  await ent.getByRole('radio', { name: 'À plusieurs' }).click();
  await h.expectText(page, 'Personne 1 · Étape 1 sur 4');
  await h.expectText(page, 'Tu choisis pour la première, puis tu ajoutes les suivantes.');
  if (await page.locator('.bk button.so-pack').count()) throw new Error('the formule is offered to several people');
  const first = page.getByRole('radiogroup', { name: 'La première personne, c’est' });
  if ((await first.getByRole('radio', { name: 'Moi', exact: true }).getAttribute('aria-checked')) !== 'true') throw new Error('the first person is not « Moi » by default');
  await first.getByRole('radio', { name: 'Mon enfant', exact: true }).click();
  await h.expectText(page, 'Quelle coupe pour ton enfant ?');
  await page.fill('#g-first', 'Lina');
  await h.expectText(page, 'Quelle coupe pour Lina ?');
  // the label stays on one line on a phone
  const lines = await page.evaluate(() => { const e = document.querySelector('.bk-k'); return Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); });
  if (lines > 1) throw new Error('the step label wraps on ' + lines + ' lines');
  const svc1 = (await page.locator('.bk button.so').first().locator('.so-n').innerText()).split('\n')[0].trim();
  await page.locator('.bk button.so').first().click();
  await h.expectText(page, 'Avec qui pour Lina ?');
  await page.locator('.bk button.wh').first().click();
  await h.expectText(page, 'Quand pour Lina ?');
  await page.locator('.dstrip .dc:not(.full):not(.dc-more)').nth(2).click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.bk button.sl').first().click();

  step('the details lead to the next person');
  await page.locator('#f-first').waitFor({ timeout: T });
  await h.expectText(page, 'C’est pour Lina, ton enfant.');
  const lead = page.getByRole('button', { name: /Ajouter la personne suivante/ });
  await lead.waitFor({ timeout: T });
  // right under the recap, before the form
  const order = await page.evaluate(() => document.querySelector('.add-p.lead').getBoundingClientRect().top < document.querySelector('#f-first').getBoundingClientRect().top);
  if (!order) throw new Error('« Ajouter la personne suivante » is under the form');
  // touched at once, even while the slot is still being kept: the tap is not lost
  await lead.click();

  step('the second child, another service');
  await h.expectText(page, 'Personne 2 · Étape 1 sur 4');
  await h.expectText(page, 'Déjà choisi : Lina');
  if ((await page.getByRole('radio', { name: 'Mon enfant', exact: true }).getAttribute('aria-checked')) !== 'true') throw new Error('after a child, the next person is not « Mon enfant » by default');
  await page.fill('#g-first', 'Sami');
  await h.expectText(page, 'Quelle coupe pour Sami ?');
  const svc2 = (await page.locator('.bk button.so').nth(1).locator('.so-n').innerText()).split('\n')[0].trim();
  if (svc2 === svc1) throw new Error('the two services are the same');
  await page.locator('.bk button.so').nth(1).click();
  await page.locator('.bk button.wh').first().click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await page.locator('.bk button.sl').first().click();
  await page.locator('#f-first').waitFor({ timeout: T });
  await h.expectText(page, 'C’est pour Sami, ton enfant.');
  await h.expectText(page, 'Déjà dans cette réservation');
  const row = (await page.locator('.pty-r').first().innerText()).replace(/[  ]/g, ' ');
  if (!row.includes('Lina (ton enfant)') || !row.includes(svc1)) throw new Error('the first child’s line reads « ' + row + ' »');
  if (!(await page.locator('.recap').innerText()).includes(svc2)) throw new Error('the second child’s recap does not show his own service');

  step('confirm both');
  await page.fill('#f-first', 'Nadia');
  await page.fill('#f-last', 'Haddad');
  await page.fill('#f-phone', '0611227788');
  const cta = page.locator('.bk-foot .btn');
  if (!/Confirmer les 2 rendez-vous/.test(await cta.textContent())) throw new Error('the button says « ' + (await cta.textContent()) + ' »');
  await cta.click();
  // the tap answers at once (no second booking from a second tap)
  await page.waitForFunction(() => { const b = document.querySelector('.bk-foot .btn'); return (b && b.disabled) || /réservé/.test(document.querySelector('#bk-t').textContent); }, null, { timeout: 2000 });
  await h.expectText(page, 'C’est réservé, Nadia');
  await h.expectText(page, 'Le rendez-vous de Lina (ton enfant)');
  await h.expectText(page, 'Le rendez-vous de Sami (ton enfant)');
  await page.locator('[data-guide="site-groupe"]').getByText('Tu es l’organisateur · 2 personnes').waitFor({ timeout: T });

  step('the agenda');
  await h.setup();
  const all = [];
  for (let i = 0; i < 12; i++) { const d = new Date(Date.parse('2026-10-27T12:00:00Z') + i * 86400000).toISOString().slice(0, 10); all.push(...((await h.api('/api/v1/agenda?day=' + d)).json.appts || [])); }
  const lina = all.find((a) => a.name === 'Lina (enfant de Nadia H.)'), sami = all.find((a) => a.name === 'Sami (enfant de Nadia H.)');
  if (!lina || !sami) throw new Error('the agenda does not show both children: ' + JSON.stringify(all.filter((a) => /enfant/.test(a.name)).map((a) => a.name)));
  if (lina.services[0].name !== svc1 || sami.services[0].name !== svc2) throw new Error('each child does not have her or his own service: ' + JSON.stringify([lina.services[0].name, sami.services[0].name]));
}
