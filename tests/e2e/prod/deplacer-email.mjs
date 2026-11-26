// Production, as the salon runs live: everything by e-mail, no SMS provider, « annulable à tout moment », the client
// space open with nothing stored. A client's report, replayed on a phone 430 px wide: he booked a cut by e-mail three
// weeks ahead and wants the day before, 11 h 30. Every way to « Déplacer » moves the SAME appointment, in e-mail mode:
//   1. « Gérer mon rendez-vous » in his confirmation e-mail opens the booking's page: « Déplacer » shows the days up to
//      his appointment and after (not only the next two weeks, where the day he wants was missing), one tap on the hour
//      moves it, the page says the confirmation leaves by e-mail, and that mail arrives;
//   2. his space (/moi: his address, the code from his mailbox, his first name) lists the appointment, and « Déplacer »
//      there moves it again;
//   3. on the site, right after a booking, « Déplacer » picks another hour and moves it; « Retour » from there goes back
//      to his appointment, never to the booking form.
// No number is typed anywhere, and no second booking is ever made.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h }), h = { base, setup(), api() }.
import { mailEnv, mailsOf } from '../record-mail.mjs';

const box = mailEnv();
const CRON = 'e2e-cron-secret-0123456789';
// the outbox leaves at the salon's pulse (once a minute on the live site): the scenario rings it itself
export const env = { ...box.env, CRON_SECRET: CRON };
export const name = '« Déplacer » in e-mail mode: from the confirmation’s link, from /moi, from the site (430 px)';

const PHONE = { viewport: { width: 430, height: 932 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const T = 10000;
const WF = process.env.WF_SHOTS || '';
const MAIL = 'yacine.deplace@exemple.fr';
const MAIL2 = 'sofiane.deplace@exemple.fr';
const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** today + n in Paris, as YYYY-MM-DD */
const dayIn = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(Date.now() + n * 86400000));
/** « vendredi 4 décembre » */
const dayLong = (key) => { const [y, m, d] = key.split('-').map(Number); return DAYS_FR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + d + ' ' + MONTHS_FR[m - 1]; };
const until = async (what, fn) => { for (let i = 0; i < 60; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error('never happened: ' + what); };
const seen = (page, text) => page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout: T });
const noSideScroll = async (page, where) => { if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(where + ': the page scrolls sideways at 430 px'); };
const flat = (s) => String(s).replace(/\s/g, ' ');

export default async ({ browser, h }) => {
  let at = 'start';
  const step = (x) => { at = x; };
  try { await run(browser, h, step); } catch (e) { throw new Error(at + ': ' + e.message); }
};

async function run(browser, h, step) {
  const base = h.base.replace(/\/$/, '');
  await h.setup();
  const post = async (path, body, method) => { const r = await h.api(path, { body, ...(method ? { method } : {}) }); if (!r.ok) throw new Error(path + ': ' + r.status + ' ' + r.text); return r.json; };
  const pubGet = async (path) => { const r = await h.api(path, { session: false }); if (!r.ok) throw new Error(path + ': ' + r.status + ' ' + r.text); return r.json; };
  const jkut = await post('/api/v1/staff', { name: 'JKut', role: 'barber' });
  const cut = await post('/api/v1/services', { name: 'Coupe classique', category: 'Coupes', price: 2000, dur: 30 });
  await post('/api/v1/settings', { booking: { contact: 'email', cancelUntilHours: 0, minNoticeMin: 0 } }, 'PATCH');

  step('the live salon’s shape');
  const pub = await pubGet('/api/public/salon');
  if (pub.sms !== false || pub.booking.contact !== 'email' || pub.booking.cancelUntilHours !== 0) throw new Error(JSON.stringify([pub.sms, pub.booking]));
  const acc = await pubGet('/api/public/account');
  if (acc.enabled !== true || acc.contact !== 'email') throw new Error('the space is not open by e-mail: ' + JSON.stringify(acc));

  /* three weeks ahead: two open days in a row with JKut, the second booked at 10 h, the first wanted at 11 h 30 */
  const ahead = (await pubGet(`/api/public/availability?services=${cut.id}&staff=${jkut.id}&from=${dayIn(19)}&days=10`)).days.filter((d) => d.open && d.slots.some((x) => x.m === 600) && d.slots.some((x) => x.m === 690));
  if (ahead.length < 3) throw new Error('not three open days three weeks ahead');
  const WANT = ahead[0].day, BOOKED = ahead[1].day, AGAIN = ahead[2].day;
  const slots = async (day) => ((await pubGet(`/api/public/availability?services=${cut.id}&staff=${jkut.id}&from=${day}&days=1&fresh=1`)).days[0] || { slots: [] }).slots.map((x) => x.m);
  const booked = await h.api('/api/public/bookings', { session: false, body: { serviceIds: [cut.id], staffId: jkut.id, day: BOOKED, start: 600, first: 'Yacine', email: MAIL } });
  if (booked.status !== 201) throw new Error('booking: ' + booked.status + ' ' + booked.text);
  const token = booked.json.token;
  const view = () => pubGet('/api/public/bookings/' + token);
  /** the mail once the outbox has left (the pulse is rung until it shows) */
  const mailed = (what, fn) => until(what, async () => { const r = await h.api('/api/cron/tick', { session: false, headers: { authorization: 'Bearer ' + CRON } }); if (!r.ok) throw new Error('cron: ' + r.status); return fn(); });

  const errors = [];
  const open = async () => {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    return { ctx, page };
  };

  /* 1 · the confirmation's « Gérer mon rendez-vous » */
  step('his confirmation carries the booking’s page');
  const conf = await mailed('the confirmation e-mail', () => mailsOf(box).find((x) => x.to === MAIL && /^Rendez-vous confirmé/.test(x.subject)));
  const link = (/Gérer mon rendez-vous \(déplacer ou annuler\) : (http\S+)/.exec(conf.text) || [])[1];
  if (link !== base + '/r/' + token) throw new Error('the mail’s link: ' + link);
  if (!conf.html.includes('Gérer mon rendez-vous')) throw new Error('no « Gérer mon rendez-vous » button in the mail');

  step('/r/: « Déplacer » offers the day before his appointment, three weeks ahead');
  const his = await open();
  await his.page.goto(link);
  await seen(his.page, 'Ton rendez-vous, Yacine');
  await his.page.getByRole('button', { name: 'Déplacer' }).click();
  const strip = his.page.locator('.c-days');
  await strip.locator('button').first().waitFor({ timeout: T });
  // a day button by its date: its number alone is not enough over several weeks, so the day in view is said in words
  const dayBtn = async (page, key) => {
    const all = page.locator('.c-days button');
    const want = Number(key.slice(8));
    for (let i = 0, n = await all.count(); i < n; i++) {
      if (Number(await all.nth(i).locator('b').innerText()) !== want) continue;
      await all.nth(i).click();
      const said = flat(await page.locator('.c-moveday').innerText()).toLowerCase();
      if (said === dayLong(key)) return all.nth(i);
    }
    throw new Error('« Déplacer » does not offer ' + dayLong(key) + ' (' + (await all.count()) + ' days shown)');
  };
  await dayBtn(his.page, WANT);
  await noSideScroll(his.page, '/r/, Déplacer');
  if (WF) { await his.page.waitForTimeout(300); await his.page.screenshot({ path: WF + '/prod-deplacer-r-430.png', fullPage: true }); }
  // and further still: « Jours suivants » adds days after the last one shown
  const later = his.page.getByRole('button', { name: /^Jours suivants/ });
  await later.waitFor({ timeout: T });
  const shown = await strip.locator('button').count();
  await later.click();
  await his.page.waitForFunction((n) => document.querySelectorAll('.c-days button').length > n, shown, { timeout: T });
  await noSideScroll(his.page, '/r/, Jours suivants');

  step('/r/: one tap on 11 h 30 moves the same appointment; the page says the confirmation leaves by e-mail');
  await dayBtn(his.page, WANT);
  await his.page.locator('.c-slots button').filter({ hasText: /^11\sh\s30$/ }).click();
  await seen(his.page, 'C’est déplacé. Ta confirmation part par e-mail tout de suite.');
  if (await his.page.getByText('SMS').count()) throw new Error('/r/ speaks of an SMS in e-mail mode');
  const when = flat(await his.page.locator('.c-when').innerText()).toLowerCase();
  if (!when.includes(dayLong(WANT)) || !/11 h 30/.test(when)) throw new Error('the ticket shows: ' + when);
  let v = await view();
  if (v.day !== WANT || v.start !== 690 || v.status !== 'booked' || v.code !== booked.json.code) throw new Error('the booking is now: ' + JSON.stringify([v.code, v.day, v.start, v.status]));
  if (!(await slots(BOOKED)).includes(600)) throw new Error('the old slot was not freed');
  if ((await slots(WANT)).includes(690)) throw new Error('the new slot is still offered');
  const movedMail = await mailed('the mail of the move', () => mailsOf(box).find((x) => x.to === MAIL && /^Rendez-vous déplacé/.test(x.subject)));
  if (!flat(movedMail.text).includes('Ton rendez-vous est déplacé : ' + dayLong(WANT) + ' à 11 h 30 avec JKut') || !movedMail.text.includes(link)) throw new Error('the mail of the move: ' + movedMail.text);
  await noSideScroll(his.page, '/r/, moved');
  if (WF) { await his.page.waitForTimeout(300); await his.page.screenshot({ path: WF + '/prod-deplace-r-430.png', fullPage: true }); }
  await his.ctx.close();

  /* 2 · his space */
  step('/moi: his address, the code, his first name; his appointment is there');
  const moi = await open();
  await moi.page.goto(base + '/moi');
  await moi.page.locator('#m-email').waitFor({ timeout: T });
  await moi.page.locator('#m-email').fill(MAIL);
  await moi.page.keyboard.press('Enter');
  const otp = await until('his code by e-mail', () => mailsOf(box).find((x) => x.to === MAIL && x.tag === 'otp'));
  const code = (/^(\d{6}) /.exec(otp.subject) || [])[1];
  await moi.page.locator('#m-code').waitFor({ timeout: T });
  await moi.page.locator('#m-code').fill(code);
  await moi.page.getByRole('button', { name: 'Entrer' }).click();
  await moi.page.locator('#m-first').waitFor({ timeout: T });
  await moi.page.locator('#m-first').fill('Yacine');
  await moi.page.keyboard.press('Enter');
  const hero = moi.page.locator('.m-hero');
  await hero.waitFor({ timeout: T });
  if (await moi.page.getByText('Ta première coupe t’attend').count()) throw new Error('his space says « Ta première coupe t’attend » with an appointment to come');
  if (!flat(await hero.innerText()).includes('Code ' + booked.json.code)) throw new Error('the hero is not his appointment: ' + (await hero.innerText()));
  await noSideScroll(moi.page, '/moi');

  step('/moi: « Déplacer » moves it again, by e-mail');
  await hero.getByRole('button', { name: 'Déplacer' }).click();
  await moi.page.locator('.c-days button').first().waitFor({ timeout: T });
  await dayBtn(moi.page, AGAIN);
  await noSideScroll(moi.page, '/moi, Déplacer');
  await moi.page.locator('.c-slots button').filter({ hasText: /^10\sh$/ }).click();
  await seen(moi.page, 'C’est déplacé. Ta confirmation part par e-mail tout de suite.');
  v = await until('the move from /moi', async () => { const x = await view(); return x.day === AGAIN && x.start === 600 ? x : null; });
  if (v.code !== booked.json.code || v.status !== 'booked') throw new Error('after /moi: ' + JSON.stringify(v));
  await mailed('the second mail of a move', () => mailsOf(box).filter((x) => x.to === MAIL && /^Rendez-vous déplacé/.test(x.subject)).length === 2);
  if (mailsOf(box).filter((x) => x.to === MAIL && /^Rendez-vous confirmé/.test(x.subject)).length !== 1) throw new Error('a second booking was confirmed to him');
  if (WF) { await moi.page.waitForTimeout(300); await moi.page.screenshot({ path: WF + '/prod-deplace-moi-430.png', fullPage: true }); }
  await moi.ctx.close();

  /* 3 · the site, right after a booking */
  step('the site: a booking by e-mail, then « Déplacer »');
  const site = await open();
  const posts = [];
  site.page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/public\/bookings/.test(r.url())) posts.push(new URL(r.url()).pathname); });
  await site.page.goto(base + '/');
  await site.page.locator('.cta').first().click();
  await site.page.locator('.bk button.so', { hasText: 'Coupe classique' }).first().click();
  await site.page.locator('.bk button.wh').first().click();
  await site.page.locator('.bk button.sl').first().waitFor({ timeout: T });
  await site.page.locator('.bk button.sl').first().click();
  await site.page.locator('#f-first').waitFor({ timeout: T });
  await site.page.fill('#f-first', 'Sofiane');
  await site.page.fill('#f-email', MAIL2);
  await site.page.waitForFunction(() => /gardé/.test(document.querySelector('.hold')?.textContent || ''), null, { timeout: T });
  await site.page.locator('.bk-foot .btn').click();
  await site.page.locator('.st.done').waitFor({ timeout: T });
  const ticket = () => site.page.locator('.st.done .tk-w').first().innerText();
  const first = flat(await ticket());
  await site.page.locator('.mng').getByRole('button', { name: 'Déplacer' }).click();
  await seen(site.page, 'Pour quand ?');
  // « Retour » goes back to his appointment: never the list of barbers nor the form of a new booking
  await site.page.getByRole('button', { name: 'Étape précédente' }).click();
  await site.page.locator('.st.done').waitFor({ timeout: T });
  if (flat(await ticket()) !== first) throw new Error('« Retour » changed the ticket: ' + (await ticket()));
  await site.page.locator('.mng').getByRole('button', { name: 'Déplacer' }).click();
  await seen(site.page, 'Pour quand ?');
  if (await site.page.locator('#f-first').isVisible().catch(() => false)) throw new Error('« Déplacer » shows the booking form');
  // another day of the strip, its third slot: one tap moves, nothing is asked
  await site.page.locator('.bk button.dc:not(.dc-more)').nth(2).click();
  await site.page.locator('.bk button.sl').nth(2).waitFor({ timeout: T });
  await site.page.locator('.bk button.sl').nth(2).click();
  await seen(site.page, 'C’est déplacé, Sofiane.');
  if (flat(await ticket()) === first) throw new Error('the ticket did not change');
  await noSideScroll(site.page, 'the site, moved');
  if (posts.filter((p) => p === '/api/public/bookings').length !== 1 || posts.filter((p) => /\/move$/.test(p)).length !== 1) throw new Error('requests: ' + posts.join(' '));
  await mailed('his mail of the move', () => mailsOf(box).find((x) => x.to === MAIL2 && /^Rendez-vous déplacé/.test(x.subject)));
  if (mailsOf(box).filter((x) => x.to === MAIL2 && /^Rendez-vous confirmé/.test(x.subject)).length !== 1) throw new Error('not exactly one booking confirmed to ' + MAIL2);
  if (WF) { await site.page.waitForTimeout(300); await site.page.screenshot({ path: WF + '/prod-deplace-site-430.png' }); }
  await site.ctx.close();

  if (errors.length) throw new Error(errors.slice(0, 3).join('\n'));
}
