// Production: the owner edits the site from the Comptoir (Le site). He sets the banner 'Fermé le 11 novembre', adds a
// question whose answer quotes the classic cut's price with {prix:cl}, adds a photo of the work from his computer, and
// the site shows the banner, '20 €' and the photo. Then he opens on Tuesdays at 10 h in Réglages › Horaires and the
// footer's hours follow. The site loads its fonts from its own domain (Instrument Serif), never from Google.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h, page }), h = { base, setup(), loginOwner(page), api(), shot() }.
import { join } from 'node:path';
import { ROOT } from '../harness.mjs';

export const name = 'Le site: banner, FAQ with a price, a photo, the hours';

const PHONE = { viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 };
const sp = (s) => String(s || '').replace(/\s+/g, ' ').trim();
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });
  return () => { if (errors.length) throw new Error(errors.slice(0, 3).join('\n')); };
}
const toastSaid = (page, title, timeout = 10000) => page.locator('.toast .t', { hasText: new RegExp('^' + title) }).first().waitFor({ timeout });
const call = (page, path, body) => page.evaluate(async ([p, b]) => {
  const r = await fetch(p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'e2e-' + Math.random().toString(36).slice(2) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body]);
const until = async (what, fn, timeout = 10000) => {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise((r) => setTimeout(r, 250))) { const v = await fn(); if (v) return v; }
  throw new Error('timed out waiting for ' + what);
};

export default async ({ browser, h, page }) => {
  const base = h.base.replace(/\/$/, '');
  const root = await fetch(base + '/').then((r) => r.text()).catch(() => '');
  const SITE = base + (root.includes('class="bk {{bkCls}}"') ? '/' : '/site');
  await h.loginOwner(page);
  const ok = watch(page);

  /* the classic cut at 20 €, under its old code cl */
  const cat = await call(page, '/api/v1/catalog');
  if (!cat.json.services.some((x) => x.slug === 'cl' && x.active)) {
    const r = await call(page, '/api/v1/services', { name: 'Coupe classique', slug: 'cl', category: 'Coupes', price: 2000, dur: 30 });
    if (r.status >= 300) throw new Error('could not add the classic cut: ' + JSON.stringify(r.json));
  }

  /* Le site › Annonce */
  await page.goto(base + '/comptoir/site');
  await page.locator('#si-an').waitFor({ timeout: 10000 });
  if (!(await page.locator('nav a', { hasText: 'Le site' }).count())) throw new Error('no « Le site » in the navigation');
  await page.fill('#si-an', 'Fermé le 11 novembre');
  await page.getByText('Une fois enregistrée : en ligne').first().waitFor({ timeout: 5000 });

  /* FAQ: a new question, the price inserted from the list */
  await page.locator('.si-top a', { hasText: 'FAQ' }).click();
  await page.getByRole('button', { name: 'Ajouter une question' }).click();
  const n = await page.locator('.si-faq').count();
  const i = n - 1;
  await page.fill('#si-q' + i, 'Et une coupe simple ?');
  await page.fill('#si-a' + i, 'Une coupe simple : ');
  await page.locator('#si-a' + i).press('End');
  await page.locator('.si-faq').nth(i).locator('select[aria-label="Insérer le prix d’une prestation"]').selectOption('cl');
  const typed = await page.inputValue('#si-a' + i);
  if (typed !== 'Une coupe simple : {prix:cl}') throw new Error('the token was not inserted: ' + typed);
  await page.fill('#si-a' + i, typed + ', sans surprise.');
  const out = sp(await page.locator('.si-faq').nth(i).locator('.si-out').textContent());
  if (!out.includes('Une coupe simple : 20 €, sans surprise.')) throw new Error('the preview says: ' + out);

  /* Photos: one from this computer */
  await page.locator('.si-top a', { hasText: 'Photos' }).click();
  const before = await page.locator('.si-work-i').count();
  await page.locator('.si-work-add button').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Depuis cet appareil' }).click();
  await (await chooser).setFiles(join(ROOT, 'public', 'img', 'curls.jpg'));
  await until('the uploaded photo in the list', async () => (await page.locator('.si-work-i').count()) === before + 1);
  const src = await page.locator('.si-work-i').last().locator('img').getAttribute('src');
  if (!/^\/api\/public\/media\/[a-f0-9]{64}\.jpg$/.test(src || '')) throw new Error('the photo is at ' + src);
  await page.fill('#si-wc' + before, 'Coupe du jour');

  await page.locator('.si-save').getByRole('button', { name: 'Enregistrer' }).click();
  await toastSaid(page, 'Site mis à jour');
  await h.shot(page, 'site-editor-photos');
  ok();

  /* the site, on a phone */
  const cctx = await browser.newContext(PHONE);
  const site = await cctx.newPage();
  const ok2 = watch(site);
  const asked = [];
  site.on('request', (r) => asked.push(r.url()));
  await site.goto(SITE);
  const ann = site.locator('.hero .ann');
  await ann.waitFor({ timeout: 10000 });
  if (sp(await ann.textContent()) !== 'Fermé le 11 novembre') throw new Error('the banner says ' + (await ann.textContent()));
  const q = site.locator('details.fq-i', { hasText: 'Et une coupe simple ?' });
  await q.locator('summary').click();
  const answer = sp(await q.locator('.fq-a').textContent());
  if (!answer.includes('Une coupe simple : 20 €, sans surprise.')) throw new Error('the answer says ' + answer);
  const img = site.locator('.ct img[src="' + src + '"]');
  if (!(await img.count())) throw new Error('the uploaded photo is not among the cuts');
  await img.scrollIntoViewIfNeeded();
  await until('the photo to load', () => img.evaluate((el) => el.complete && el.naturalWidth > 0));
  if (sp(await site.locator('article.ct', { has: site.locator('img[src="' + src + '"]') }).locator('.ct-n').textContent()) !== 'Coupe du jour') throw new Error('the photo’s title is missing');
  // the fonts: from the salon's domain, and really used
  await site.evaluate(() => document.fonts.ready);
  const font = await site.evaluate(() => ({ family: getComputedStyle(document.querySelector('#t-carte')).fontFamily, ready: document.fonts.check('400 40px "Instrument Serif"') }));
  if (!/^"?Instrument Serif/.test(font.family) || !font.ready) throw new Error('Instrument Serif is not in use: ' + JSON.stringify(font));
  if (asked.some((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))) throw new Error('the site still asks Google for its fonts');
  if (!asked.some((u) => u.endsWith('/fonts/instrument-serif-latin-400-normal.woff2'))) throw new Error('the serif font did not come from /fonts');
  const hoursBefore = sp(await site.locator('.ft-h').textContent());
  if (hoursBefore !== 'Du mardi au samedi, 9 h – 18 h 30.') throw new Error('the footer hours read ' + hoursBefore);
  // no rating in the structured data
  const ld = await site.evaluate(() => document.getElementById('lx-ld').textContent);
  if (/aggregateRating/i.test(ld) || !ld.includes('"opens":"09:00"') || !ld.includes('Coupe classique')) throw new Error('structured data: ' + ld.slice(0, 300));
  await h.shot(site, 'site-editor-site');
  ok2();

  /* Réglages › Horaires: Tuesday opens at 10 h */
  await page.goto(base + '/comptoir/reglages/horaires');
  const tue = page.locator('.eq-day').nth(1);
  await tue.waitFor({ timeout: 10000 });
  if (!sp(await tue.textContent()).startsWith('Mardi')) throw new Error('the second day is not Tuesday');
  await tue.locator('select').first().selectOption('600');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await toastSaid(page, 'Horaires du salon enregistrés');
  ok();

  await site.reload();
  await until('the new hours in the footer', async () => sp(await site.locator('.ft-h').textContent()).startsWith('Le mardi, 10 h – 18 h 30 · du mercredi au samedi, 9 h – 18 h 30'));
  ok2();
  await cctx.close();
};
