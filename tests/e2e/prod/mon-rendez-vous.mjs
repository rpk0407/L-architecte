// Production: the old site's « Mon compte » lands on /mon-rendez-vous, where a client finds their appointment from a
// phone number, without an account. A known number gets a text with the link (queued in the outbox), an unknown one the
// very same answer and no text. The page fits a 390 px phone and a desktop, light and dark.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h }), h = { base, setup(), api(), shot() }.
export const name = '/mon-compte → /mon-rendez-vous, a phone number brings the link by SMS';

const ctxOf = (viewport, colorScheme = 'light') => ({ viewport, colorScheme, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 });
const PHONE = { width: 390, height: 844 }, DESK = { width: 1440, height: 900 };
const ANSWER = 'Si un rendez-vous existe à ce numéro, tu reçois un SMS dans un instant.';

function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)|fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
  return () => { if (errors.length) throw new Error(errors.slice(0, 3).join('\n')); };
}
const textOf = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const expect = (text, what, where) => { if (!text.includes(what)) throw new Error(where + ' does not show « ' + what + ' »'); };
/** today + n in Paris, as YYYY-MM-DD */
const dayIn = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(Date.now() + n * 86400000));
const ok = (r, what) => { if (!r.ok) throw new Error(what + ': ' + r.status + ' ' + r.text); return r.json; };

/** Opens the page through the old address, checks its width and colours, and returns it. */
async function open(browser, h, viewport, scheme = 'light') {
  const ctx = await browser.newContext(ctxOf(viewport, scheme));
  const page = await ctx.newPage();
  const check = watch(page);
  const res = await page.goto(h.base + '/mon-compte');
  if (!res || res.status() !== 200) throw new Error('/mon-compte answered ' + (res && res.status()));
  if (new URL(page.url()).pathname !== '/mon-rendez-vous') throw new Error('/mon-compte landed on ' + page.url());
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ready') === '1', null, { timeout: 10000 });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth, bg: getComputedStyle(document.body).backgroundColor, ft: !!document.querySelector('footer.ft a[href="/mon-rendez-vous"][aria-current="page"]') }));
  if (m.sw > m.w) throw new Error('/mon-rendez-vous scrolls sideways at ' + viewport.width + ' px (' + m.sw + ' px wide)');
  if ((m.bg === 'rgb(15, 14, 13)') !== (scheme === 'dark')) throw new Error('/mon-rendez-vous in ' + scheme + ' mode has the background ' + m.bg);
  if (!m.ft) throw new Error('/mon-rendez-vous has no shared footer pointing at itself');
  return { ctx, page, check };
}

/** Types a number, sends it, and waits for the answer the page shows. */
async function ask(page, phone) {
  await page.getByLabel('Ton numéro').fill(phone);
  await page.getByRole('button', { name: 'Recevoir le lien' }).click();
  await page.getByRole('status').filter({ hasText: ANSWER }).waitFor({ timeout: 10000 });
}

export default async ({ browser, h }) => {
  await h.setup();
  /* a barber, a service, and two appointments to come for Yanis */
  const st = ok(await h.api('/api/v1/staff', { body: { name: 'JKut', role: 'barber' } }), 'add a barber');
  const sv = ok(await h.api('/api/v1/services', { body: { name: 'Coupe classique', category: 'Coupes', price: 2000, dur: 30 } }), 'add a service');
  for (const [d, start] of [[3, 600], [10, 870]]) {
    ok(await h.api('/api/v1/appointments', { body: { client: { first: 'Yanis', phone: '06 12 34 56 78' }, serviceIds: [sv.id], staffId: st.id, day: dayIn(d), start, force: true, sms: false } }), 'book Yanis');
  }
  const lookups = async () => (ok(await h.api('/api/v1/messages'), 'outbox').items || []).filter((m) => m.template === 'lookup');
  // the answer does not wait for the text to be written (that would time a known number): give it a moment
  const settled = async (n) => { let l = []; for (let i = 0; i < 25; i++) { l = await lookups(); if (l.length >= n) break; await new Promise((ok) => setTimeout(ok, 200)); } return l; };

  /* the phone: the old « Mon compte » address, the page's words, a wrong number, then Yanis's */
  const p = await open(browser, h, PHONE);
  try {
    const text = await textOf(p.page);
    for (const w of ['Retrouve ton rendez-vous', 'Plus besoin de mot de passe : on t’envoie le lien par SMS.', 'Ton numéro']) expect(text, w, '/mon-rendez-vous');
    if (!(await p.page.getByRole('link', { name: 'Réserver' }).first().getAttribute('href') || '').startsWith('/?reserver')) throw new Error('no Réserver button to the booking sheet');
    await h.shot(p.page, 'mon-rendez-vous-390');
    await p.page.getByLabel('Ton numéro').fill('06 12');
    await p.page.getByRole('button', { name: 'Recevoir le lien' }).click();
    await p.page.getByRole('alert').filter({ hasText: 'Vérifie ton numéro' }).waitFor({ timeout: 5000 });
    if ((await lookups()).length) throw new Error('a wrong number sent something');
    if ((await p.page.getByLabel('Ton numéro').getAttribute('aria-invalid')) !== 'true') throw new Error('a wrong number is not marked on the field');
    await ask(p.page, '06 12 34 56 78');
    await h.shot(p.page, 'mon-rendez-vous-390-sent');
    // the confirmation repeats the number used, since the form is hidden by then
    expect(await textOf(p.page), 'sur le 06 12 34 56 78', 'the confirmation');
    const sent = await settled(1);
    if (sent.length !== 1) throw new Error('Yanis should have 1 text in the outbox, not ' + sent.length);
    if (sent[0].to !== '06 •• •• •• 78') throw new Error('the text is for ' + sent[0].to);
    // the owner sees the body: the two links, soonest first
    const links = (sent[0].body.match(/\/r\/\S+/g) || []);
    if (links.length !== 2) throw new Error('the text should carry 2 links: ' + sent[0].body);
    // a link from the text opens the appointment
    const r = await h.api('/api/public/bookings/' + links[0].slice(3), { session: false });
    if (r.status !== 200 || r.json.first !== 'Yanis') throw new Error('the first link does not open Yanis’s appointment: ' + r.status);
    // another number: the same words, and nothing in the outbox
    await p.page.getByRole('button', { name: 'Changer de numéro' }).click();
    await ask(p.page, '07 98 76 54 32');
    await new Promise((ok) => setTimeout(ok, 800));
    if ((await lookups()).length !== 1) throw new Error('an unknown number queued a text');
    // on a phone that booked on the site: the number is filled in and the kept links are listed, soonest first
    const [day] = [dayIn(3)];
    await p.page.evaluate(([tok, d]) => localStorage.setItem('lx-me', JSON.stringify({ first: 'Yanis', phone: '0612345678', bookings: [
      { token: tok, day: d, time: 600, dur: 30, n: 'Coupe classique' }, { token: 'LA-OLD1.abcdefghijkl', day: '2020-01-07', time: 600, dur: 30, n: 'Vieux' },
      { token: 'LA-GONE.abcdefghijkl', day: d, time: 660, dur: 30, n: 'Annulé', cancelled: true }, { token: 'javascript:alert(1)', day: d, time: 700, dur: 30, n: 'X' }
    ] })), [links[0].slice(3), day]);
    await p.page.reload();
    if ((await p.page.getByLabel('Ton numéro').inputValue()) !== '06 12 34 56 78') throw new Error('the number kept on this phone is not filled in');
    const saved = p.page.locator('#lk-saved');
    await saved.getByRole('heading', { name: 'Gardé sur cet appareil' }).waitFor({ timeout: 5000 });
    const items = await saved.locator('a').evaluateAll((as) => as.map((a) => [a.getAttribute('href'), a.textContent]));
    if (items.length !== 1 || items[0][0] !== links[0] || !/Coupe classique/.test(items[0][1]) || !/10\u00a0h/.test(items[0][1])) throw new Error('kept links: ' + JSON.stringify(items));
    await h.shot(p.page, 'mon-rendez-vous-390-saved');
    p.check();
  } finally { await p.ctx.close(); }

  /* the desktop, and the phone in dark mode */
  for (const [vp, scheme] of [[DESK, 'light'], [PHONE, 'dark']]) {
    const x = await open(browser, h, vp, scheme);
    try { await h.shot(x.page, 'mon-rendez-vous-' + vp.width + '-' + scheme); x.check(); } finally { await x.ctx.close(); }
  }
};
