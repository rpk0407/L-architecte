// Production: a barber who wants to train lands on /formations from the old address of the beard module, asks for it from
// his phone, and reads 'C’est envoyé. Frank te rappelle sous 48 h.' The owner finds the request in Relances › Demandes,
// with a badge on the tab, and marks it handled; an alert e-mail waits in the outbox. The CPF line stays off the page
// until the owner fills in a Qualiopi certificate (Le site › Formations). No font from Google, no sideways scroll.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h, page }), h = { base, setup(), loginOwner(page), api(), shot() }.
export const name = '/formations: a training request lands in Relances › Demandes; CPF only with Qualiopi';

const PHONE = { viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 };
const CPF = 'Compte Personnel de Formation';
const DONE = 'C’est envoyé. Frank te rappelle sous 48 h.';
const sp = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const ok = (r, what) => { if (!r.ok) throw new Error(what + ': ' + r.status + ' ' + r.text); return r.json; };
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('request', (q) => { if (/fonts\.(googleapis|gstatic)\.com/.test(q.url())) errors.push('Google Fonts: ' + q.url()); });
  return () => { if (errors.length) throw new Error(errors.slice(0, 3).join('\n')); };
}
const visibleText = (page) => page.evaluate(() => document.body.innerText);

export default async ({ browser, h, page }) => {
  await h.setup();

  /* the phone: the old WordPress address of the beard module, the four modules, no CPF */
  const ctx = await browser.newContext(PHONE);
  const p = await ctx.newPage();
  const check = watch(p);
  const res = await p.goto(h.base + '/taille-et-entretien-de-la-coupe-et-de-la-barbe');
  if (!res || res.status() !== 200) throw new Error('the old module address answered ' + (res && res.status()));
  const url = new URL(p.url());
  if (url.pathname !== '/formations' || url.hash !== '#barbe') throw new Error('the old module address landed on ' + p.url());
  await p.waitForFunction(() => document.documentElement.getAttribute('data-trainings-ready') === '1', null, { timeout: 10000 });
  for (const id of ['barbe', 'classique', 'complexe']) if (!(await p.locator('#' + id + ' h2').count())) throw new Error('no module at #' + id);
  const text = sp(await visibleText(p));
  for (const w of ['On forme aussi les barbiers', 'Taille et entretien de la coupe et de la barbe', 'La coupe homme classique et ses subtilités', 'La coupe homme complexe et ses techniques', 'Conseiller en image']) if (!text.includes(w)) throw new Error('/formations does not show « ' + w + ' »');
  if (text.includes(CPF)) throw new Error('the CPF line shows while qualiopi is empty');
  const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, font: getComputedStyle(document.querySelector('h1')).fontFamily }));
  if (m.sw > m.w) throw new Error('/formations scrolls sideways at 390 px (' + m.sw + ')');
  if (!/Instrument Serif/.test(m.font)) throw new Error('the title is not in Instrument Serif: ' + m.font);
  if ((await p.locator('select[name="module"]').inputValue()) !== 'barbe') throw new Error('the beard module is not the one asked about');
  await h.shot(p, 'formations-390');

  /* the request, as the page sends it: a wrong number first, then the right one */
  await p.getByLabel('Prénom').fill('Karim');
  await p.getByLabel('Téléphone').fill('06 98');
  await p.getByLabel('Ton message').fill('Je coiffe depuis deux ans, je veux maîtriser le traçage de la barbe.');
  await p.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await p.getByRole('alert').filter({ hasText: 'Vérifie ton numéro' }).waitFor({ timeout: 5000 });
  await p.getByLabel('Téléphone').fill('06 98 76 54 32');
  await p.getByRole('button', { name: 'Envoyer ma demande' }).click();
  await p.getByRole('status').filter({ hasText: DONE }).waitFor({ timeout: 10000 });
  await h.shot(p, 'formations-390-sent');
  check();
  await ctx.close();

  /* the owner: the badge on Relances › Demandes, the request, Marquer traité */
  await h.loginOwner(page);
  const watchOwner = watch(page);
  await page.goto(h.base + '/comptoir/relances/demandes');
  const tab = page.locator('nav.tabs a', { hasText: 'Demandes' });
  await tab.locator('.count', { hasText: '1' }).waitFor({ timeout: 10000 });
  const card = page.locator('section.card', { hasText: 'Karim' });
  await card.waitFor({ timeout: 10000 });
  const said = sp(await card.innerText());
  for (const w of ['Taille et entretien de la coupe et de la barbe', 'le traçage de la barbe', '06 98 76 54 32', 'à traiter']) if (!said.includes(w)) throw new Error('the request does not show « ' + w + ' »: ' + said);
  await h.shot(page, 'relances-demandes');
  await card.getByRole('button', { name: 'Marquer traité' }).click();
  await tab.locator('.count').waitFor({ state: 'detached', timeout: 10000 });
  // the owner's alert e-mail waits in the outbox (no provider on this salon)
  const out = ok(await h.api('/api/v1/messages'), 'outbox').items || [];
  if (!out.some((x) => x.template === 'owner_inquiry' && x.channel === 'email')) throw new Error('no alert e-mail for the owner in the outbox');
  watchOwner();

  /* a Qualiopi certificate in Le site › Formations: the CPF line appears */
  ok(await h.api('/api/v1/trainings', { method: 'PATCH', body: { qualiopi: 'Certificat n° B-2026-17' } }), 'save qualiopi');
  const q = await browser.newPage();
  await q.goto(h.base + '/formations');
  await q.waitForFunction(() => document.documentElement.getAttribute('data-trainings-ready') === '1', null, { timeout: 10000 });
  if (!sp(await visibleText(q)).includes(CPF)) throw new Error('the CPF line is missing with a Qualiopi certificate');
  await q.close();
};
