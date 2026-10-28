// Production: what the site reads live now that the owner does not edit it. On a phone, its serif comes from the salon's
// own domain (/fonts), never from Google; the footer's hours follow Réglages › Horaires (Tuesday at 10 h); the FAQ quotes
// the Catalogue's prices (the classic cut, the subscription and its price per cut) and so does its JSON-LD; a service
// taken off the Catalogue takes its question off the page and the JSON-LD. No rating in the structured data.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h }), h = { base, setup(), loginOwner(page), api(), shot() }.
export const name = 'The site live: own fonts, hours in the footer, the FAQ’s prices and questions';

const PHONE = { viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 };
const sp = (s) => String(s || '').replace(/[\s  ]+/g, ' ').trim();
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('console: ' + m.text()); });
  return () => { if (errors.length) throw new Error(errors.slice(0, 3).join('\n')); };
}
const until = async (what, fn, timeout = 10000) => {
  let last;
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise((r) => setTimeout(r, 250))) { last = await fn(); if (last) return last; }
  throw new Error('timed out waiting for ' + what);
};
/* the services the FAQ quotes, as the Catalogue's take-over of the old menu writes them */
const MENU = [
  { slug: 'cl', name: 'Coupe classique', category: 'Coupes', price: 2000, dur: 30 },
  { slug: 'cc', name: 'Coupe + contour de barbe', category: 'Coupes', price: 2500, dur: 30 },
  { slug: 'ct', name: 'Coupe + taille de barbe', category: 'Coupes', price: 3000, dur: 30 },
  { slug: 'tr', name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60 },
  { slug: 'ab', name: 'Carnet 5 coupes', category: 'Carnet', price: 8000, dur: 30, online: false }
];
const PRICE_Q = 'Combien coûte une coupe chez L’Architecte ?', SUB_Q = 'Existe-t-il un abonnement ou un carnet ?';

export default async ({ browser, h }) => {
  const base = h.base.replace(/\/$/, '');
  await h.setup();
  const ok = (r, what) => { if (!r.ok) throw new Error(what + ': ' + r.status + ' ' + r.text); return r; };
  const root = await fetch(base + '/').then((r) => r.text()).catch(() => '');
  const SITE = base + (root.includes('class="bk {{bkCls}}"') ? '/' : '/site');

  const have = ok(await h.api('/api/v1/catalog'), 'catalogue').json.services;
  const ids = {};
  for (const sv of MENU) {
    const there = have.find((x) => x.slug === sv.slug && x.active);
    ids[sv.slug] = there ? there.id : ok(await h.api('/api/v1/services', { body: sv }), 'add ' + sv.slug).json.id;
    if (there && there.price !== sv.price) ok(await h.api('/api/v1/services/' + there.id, { method: 'PATCH', body: { price: sv.price } }), 'price of ' + sv.slug);
  }

  const ctx = await browser.newContext(PHONE);
  const site = await ctx.newPage();
  const errs = watch(site);
  const asked = [];
  site.on('request', (r) => asked.push(r.url()));
  /** the page once the salon has answered (writeSeo keeps the static block in data-base then) */
  const open = async () => {
    await site.goto(SITE);
    await until('the salon’s answer', () => site.evaluate(() => !!document.getElementById('lx-ld').getAttribute('data-base')));
  };
  const ld = async () => JSON.parse(await site.evaluate(() => document.getElementById('lx-ld').textContent));
  const ldFaq = async () => Object.fromEntries((await ld())['@graph'].find((x) => x['@type'] === 'FAQPage').mainEntity.map((q) => [q.name, sp(q.acceptedAnswer.text)]));
  const answer = async (q) => {
    const it = site.locator('details.fq-i', { hasText: q });
    if (!(await it.count())) return null;
    if (!(await it.evaluate((d) => d.open))) await it.locator('summary').click();
    return sp(await it.locator('.fq-a p').textContent());
  };
  await open();

  /* the fonts: from the salon's domain, and really used */
  await site.evaluate(() => document.fonts.ready);
  const font = await site.evaluate(() => ({ family: getComputedStyle(document.querySelector('#t-carte')).fontFamily, ready: document.fonts.check('400 40px "Instrument Serif"') }));
  if (!/^"?Instrument Serif/.test(font.family) || !font.ready) throw new Error('Instrument Serif is not in use: ' + JSON.stringify(font));
  if (asked.some((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))) throw new Error('the site still asks Google for its fonts');
  if (!asked.some((u) => u.endsWith('/fonts/instrument-serif-latin-400-normal.woff2'))) throw new Error('the serif font did not come from /fonts');

  /* the footer's hours, the JSON-LD's opening hours and menu, no rating */
  const foot = sp(await site.locator('.ft-h').textContent());
  if (foot !== 'Du mardi au samedi, 9 h – 18 h 30.') throw new Error('the footer hours read ' + foot);
  const raw = JSON.stringify(await ld());
  if (/aggregateRating/i.test(raw) || !raw.includes('"opens":"09:00"') || !raw.includes('Coupe classique')) throw new Error('structured data: ' + raw.slice(0, 300));

  /* the FAQ's prices: the Catalogue's */
  let a = await answer(PRICE_Q);
  if (!a || !a.startsWith('La coupe classique est à 20 €. Avec le contour de barbe, 25 €. Avec la taille de barbe, 30 €. La transformation complète est à 50 €.')) throw new Error('the price answer says ' + a);
  a = await answer(SUB_Q);
  if (!a || !a.startsWith('Oui, le carnet : 5 coupes pour 80 €, soit 16 € la coupe, hors barbe, à prendre au salon.')) throw new Error('the subscription answer says ' + a);
  await h.shot(site, 'site-live-faq');
  errs();

  /* the owner changes the classic cut to 22 € and the subscription to 85 €: the FAQ and its JSON-LD follow */
  ok(await h.api('/api/v1/services/' + ids.cl, { method: 'PATCH', body: { price: 2200 } }), 'cl at 22 €');
  ok(await h.api('/api/v1/services/' + ids.ab, { method: 'PATCH', body: { price: 8500 } }), 'ab at 85 €');
  await open();
  a = await answer(PRICE_Q);
  if (!a || !a.startsWith('La coupe classique est à 22 €.')) throw new Error('after the change, the price answer says ' + a);
  let f = await ldFaq();
  if (!(f[PRICE_Q] || '').startsWith('La coupe classique est à 22 €.')) throw new Error('the JSON-LD FAQ says ' + f[PRICE_Q]);
  if (!(f[SUB_Q] || '').startsWith('Oui, le carnet : 5 coupes pour 85 €, soit 17 € la coupe, hors barbe, à prendre au salon.')) throw new Error('the JSON-LD subscription says ' + f[SUB_Q]);
  // a price that does not fall on whole cents per cut: the clause goes rather than round
  ok(await h.api('/api/v1/services/' + ids.ab, { method: 'PATCH', body: { price: 8001 } }), 'ab at 80,01 €');
  await open();
  a = await answer(SUB_Q);
  if (!a || !a.startsWith('Oui, le carnet : 5 coupes pour 80,01 €, hors barbe, à prendre au salon.')) throw new Error('the subscription answer at 80,01 € says ' + a);

  /* the subscription taken off the Catalogue: its question leaves the page and the JSON-LD */
  ok(await h.api('/api/v1/services/' + ids.ab + '/archive', { body: {} }), 'archive ab');
  await open();
  if ((await answer(SUB_Q)) !== null) throw new Error('the subscription question is still on the page');
  f = await ldFaq();
  if (SUB_Q in f) throw new Error('the subscription question is still in the JSON-LD');
  if (!(PRICE_Q in f)) throw new Error('the price question left with it');

  /* Réglages › Horaires: Tuesday opens at 10 h, the footer follows */
  const hours = ok(await h.api('/api/public/salon'), 'salon').json.hours;
  ok(await h.api('/api/v1/settings', { method: 'PATCH', body: { hours: { ...hours, 2: [[600, 1110]] } } }), 'Tuesday at 10 h');
  await open();
  const foot2 = sp(await site.locator('.ft-h').textContent());
  if (!foot2.startsWith('Le mardi, 10 h – 18 h 30 · du mercredi au samedi, 9 h – 18 h 30')) throw new Error('after the change, the footer reads ' + foot2);
  if (!JSON.stringify(await ld()).includes('"opens":"10:00"')) throw new Error('the JSON-LD did not get Tuesday at 10 h');
  if (await site.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the site scrolls sideways on a phone');
  await h.shot(site, 'site-live-hours');
  errs();

  // put things back for a scenario that would share this salon
  ok(await h.api('/api/v1/settings', { method: 'PATCH', body: { hours } }), 'hours back');
  ok(await h.api('/api/v1/services/' + ids.ab + '/archive', { body: { restore: true } }), 'restore ab');
  ok(await h.api('/api/v1/services/' + ids.ab, { method: 'PATCH', body: { price: 8000 } }), 'ab back');
  ok(await h.api('/api/v1/services/' + ids.cl, { method: 'PATCH', body: { price: 2000 } }), 'cl back');
  await ctx.close();
};
