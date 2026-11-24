// Production, as the salon runs live: everything by e-mail (booking.contact 'email'), no SMS provider, no Stripe key, an
// e-mail provider whose network records what leaves (tests/e2e/record-mail.mjs), and NOTHING stored about the client
// space: it is open because the salon writes by e-mail. On phones, 430 px wide:
//   1. the site shows the space's ways in (« Mon espace », « Déjà un rendez-vous ? ») and every chapter is still there;
//   2. the Comptoir: Accueil › « Formule » opens « Vendre la formule »; a new client is a first name and an address (no
//      number asked); « Réserver les 5 dates » books them and says the e-mail left;
//   3. exactly ONE mail reached him, with the link to his space and his five dates;
//   4. his phone: the link opens /moi on « Ton code » (sent to his address), the code and his first name open his space:
//      the formule (0 sur 5, 80 € à régler au salon), his five dates; he cancels one;
//   5. the Comptoir: « Renvoyer le lien de sa formule » on a date's sheet sends it again.
// Run by tests/e2e/prod.mjs: export default async ({ browser, h }), h = { base, setup(), loginOwner(page), api() }.
import { mailEnv, mailsOf } from '../record-mail.mjs';

const box = mailEnv();
export const env = box.env;
export const name = 'formule sold at the Comptoir by e-mail: one mail, the link opens his space, he cancels a date';

const PHONE = { viewport: { width: 430, height: 932 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const T = 10000;
const WF = process.env.WF_SHOTS || '';
const MAIL = 'karim.formule@exemple.fr';
const CHAPTERS = ['barbiers', 'reserver', 'preuve', 'coupes', 'abonnement', 'carte', 'questions'];
const seen = (page, text) => page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout: T });
const until = async (what, fn) => { for (let i = 0; i < 60; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error('never happened: ' + what); };
const noSideScroll = async (page, where) => { if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(where + ': the page scrolls sideways at 430 px'); };

export default async ({ browser, h }) => {
  let at = 'start';
  const step = (x) => { at = x; };
  try { await run(browser, h, step); } catch (e) { throw new Error(at + ': ' + e.message); }
};

async function run(browser, h, step) {
  const base = h.base.replace(/\/$/, '');
  await h.setup();
  const post = async (path, body, method) => { const r = await h.api(path, { body, ...(method ? { method } : {}) }); if (!r.ok) throw new Error(path + ': ' + r.status + ' ' + r.text); return r.json; };
  await post('/api/v1/staff', { name: 'JKut', role: 'barber' });
  const cut = await post('/api/v1/services', { name: 'Coupe du jour', category: 'Coupes', price: 2500, dur: 30 });
  await post('/api/v1/services', { name: 'Formule Entretien 5 semaines', category: 'Formule', price: 8000, dur: 30, slug: 'ab', pack: { credits: 5, days: 35, serviceIds: [cut.id], weekly: true, missed: 'lost' } });
  await post('/api/v1/settings', { booking: { contact: 'email', cancelUntilHours: 0, minNoticeMin: 0 } }, 'PATCH');

  step('the live salon’s shape: by e-mail, no SMS, nothing to pay online, the space open with nothing stored');
  const pub = (await h.api('/api/public/salon', { session: false })).json;
  if (pub.sms !== false || pub.booking.contact !== 'email' || pub.payments.live !== false) throw new Error(JSON.stringify([pub.sms, pub.booking.contact, pub.payments]));
  const acc = (await h.api('/api/public/account', { session: false })).json;
  if (acc.enabled !== true || acc.contact !== 'email') throw new Error('the space is not open by default in e-mail mode: ' + JSON.stringify(acc));
  const boot = (await h.api('/api/v1/bootstrap')).json;
  if (boot.settings.accounts.enabled !== true || !boot.providers.email) throw new Error('the Comptoir does not read the space open, or no e-mail provider: ' + JSON.stringify([boot.settings.accounts, boot.providers]));

  const errors = [];
  const open = async () => { const ctx = await browser.newContext(PHONE); const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); return { ctx, page }; };

  /* 1 · the site */
  step('the site: the ways into the space show, every chapter is there');
  const site = await open();
  await site.page.goto(base + '/');
  await site.page.locator('.ft-links a[href="/moi"]').first().waitFor({ state: 'attached', timeout: T });
  for (const id of CHAPTERS) if (!(await site.page.locator('section#' + id).count())) throw new Error('the chapter #' + id + ' is gone');
  const hidden = await site.page.evaluate((ids) => ids.filter((id) => { const el = document.getElementById(id); return !el || !el.getClientRects().length; }), CHAPTERS);
  if (hidden.length) throw new Error('chapters not rendered: ' + hidden.join(', '));
  const mine = site.page.locator('#reserver .now-me a[href="/moi"]');
  await mine.waitFor({ state: 'attached', timeout: T });
  await mine.scrollIntoViewIfNeeded();
  if (!(await mine.isVisible())) throw new Error('« Déjà un rendez-vous ? » does not show');
  const foot = site.page.locator('.ft-links a[data-guide="site.espace-lien"]');
  await foot.scrollIntoViewIfNeeded();
  if (!(await foot.isVisible()) || (await foot.getAttribute('href')) !== '/moi') throw new Error('the footer’s « Mon espace » does not show');
  await noSideScroll(site.page, 'the site');
  if (WF) { await site.page.waitForTimeout(300); await site.page.screenshot({ path: WF + '/prod-site-espace-430.png' }); }
  await site.ctx.close();

  /* 2 · the Comptoir, on the owner's phone */
  step('Accueil › « Formule » opens « Vendre la formule »');
  const desk = await open();
  await h.loginOwner(desk.page);
  await desk.page.goto(base + '/comptoir/accueil');
  const dock = desk.page.locator('.dock');
  await dock.getByRole('button', { name: /^Formule/ }).waitFor({ timeout: T });
  for (const label of ['Rendez-vous', 'Passage', 'Formule']) {
    const b = await dock.locator('button', { hasText: label }).boundingBox();
    if (!b || b.x < 0 || b.x + b.width > 430 || b.height < 44) throw new Error('the dock’s « ' + label + ' » does not fit: ' + JSON.stringify(b));
  }
  if (WF) { await desk.page.waitForTimeout(300); await desk.page.screenshot({ path: WF + '/prod-accueil-formule-430.png' }); }
  await dock.getByRole('button', { name: /^Formule/ }).click();
  const sheet = desk.page.getByRole('dialog');
  await sheet.getByRole('heading', { name: 'Vendre la formule' }).waitFor({ timeout: T });
  if ((await sheet.getByRole('switch', { name: /Formule Entretien 5 semaines/ }).getAttribute('aria-checked')) !== 'true') throw new Error('the formule is not switched on already');

  step('a new client: a first name and an address, no number asked');
  await sheet.getByRole('button', { name: 'Nouveau client' }).click();
  await sheet.locator('#nc-f').fill('Karim');
  await sheet.locator('#nc-e').fill(MAIL);
  await sheet.locator('label[for="nc-p"]', { hasText: 'Téléphone (facultatif)' }).waitFor({ timeout: T });
  // the first open day after today: there is always a slot left, whatever the hour this runs at
  await sheet.locator('.days .dayc:not([disabled])').nth(1).click();
  await sheet.locator('.slot').first().waitFor({ timeout: T });
  await sheet.locator('.slot').first().click();
  await sheet.locator('[data-guide="agenda-carnet-dates"] .pick-r').nth(3).waitFor({ timeout: T });
  const note = sheet.locator('[data-guide="agenda-carnet-mail"]');
  await note.waitFor({ timeout: T });
  if (!/Il reçoit un e-mail aussitôt.*le lien de son espace/.test((await note.innerText()).replace(/\s/g, ' '))) throw new Error('the sheet does not say the mail leaves: ' + (await note.innerText()));
  if (!/^80 € à la caisse/.test((await sheet.locator('[data-guide="agenda-carnet-pay"]').innerText()).replace(/\s/g, ' '))) throw new Error('the sheet does not say the 80 € are taken at the till');
  if (WF) { await note.scrollIntoViewIfNeeded(); await desk.page.waitForTimeout(300); await desk.page.screenshot({ path: WF + '/prod-vendre-formule-430.png' }); }
  const sell = sheet.getByRole('button', { name: 'Réserver les 5 dates' });
  if (await sell.isDisabled()) throw new Error('« Réserver les 5 dates » is off without a number');
  await sell.click();
  await desk.page.getByText(/Formule Entretien 5 semaines : 5 dates réservées/).first().waitFor({ timeout: T });
  await desk.page.getByText(/E-mail envoyé à k.+ avec le lien de son espace/).first().waitFor({ timeout: T });

  /* 3 · what reached him */
  step('exactly one mail, with the link and the five dates');
  const got = await until('the formule’s mail', () => { const m = mailsOf(box).filter((x) => x.to === MAIL); return m.length ? m : null; });
  await new Promise((r) => setTimeout(r, 600));
  const all = mailsOf(box).filter((x) => x.to === MAIL);
  if (all.length !== 1) throw new Error(all.length + ' mails left: ' + all.map((m) => m.subject).join(' | '));
  const mail = got[0];
  if (!/^Formule Entretien 5 semaines activée : 5 rendez-vous/.test(mail.subject)) throw new Error('subject: ' + mail.subject);
  for (const w of ['Bonjour Karim,', '5 coupes, une par semaine', 'se règlent au salon, à ta première visite', 'Tes 5 rendez-vous avec JKut', '\n5. ']) if (!mail.text.includes(w)) throw new Error('the mail does not say: ' + w + '\n' + mail.text);
  if (!mail.attachments.includes('rendez-vous.ics')) throw new Error('no calendar file');
  const link = (/(http\S+\/moi\?garder=\S+)/.exec(mail.text) || [])[1];
  if (!link || !link.startsWith(base + '/moi?garder=')) throw new Error('no link to his space in the mail: ' + mail.text);
  if (!mail.html.includes(link.replace(/&/g, '&amp;'))) throw new Error('the link is not in the mail’s HTML');
  const files = (await h.api('/api/v1/clients?q=Karim')).json.items;
  if (files.length !== 1 || files[0].hasPhone || !files[0].hasEmail) throw new Error('his file is not a first name and an address: ' + JSON.stringify(files));
  // the mail itself, as a phone shows it
  const reader = await open();
  await reader.page.setContent(mail.html);
  await noSideScroll(reader.page, 'the mail');
  if (WF) await reader.page.screenshot({ path: WF + '/prod-formule-mail-430.png', fullPage: true });
  await reader.ctx.close();

  /* 4 · his phone */
  step('the link opens /moi on his code; nothing of his file shows before it');
  const his = await open();
  await his.page.goto(link);
  await his.page.getByText(/Code envoyé à k.+, en quelques secondes\./).first().waitFor({ timeout: T });
  if (await his.page.getByText('Formule Entretien').count()) throw new Error('the link alone shows his formule');
  if (new URL(his.page.url()).search.includes('garder')) throw new Error('the link stays in the address bar');
  await noSideScroll(his.page, '/moi, the code');
  if (WF) { await his.page.waitForTimeout(300); await his.page.screenshot({ path: WF + '/prod-formule-lien-code-430.png' }); }
  const otp = await until('his code by e-mail', () => mailsOf(box).find((x) => x.to === MAIL && x.tag === 'otp'));
  const code = (/^(\d{6}) /.exec(otp.subject) || [])[1];
  if (!code) throw new Error('no code in: ' + otp.subject);
  await his.page.locator('#m-code').fill(code);
  step('a first opening asks his first name, then his space opens');
  await his.page.locator('#m-first').waitFor({ timeout: T });
  await his.page.locator('#m-first').fill('Karim');
  await his.page.keyboard.press('Enter');
  const card = his.page.locator('[data-guide="moi-carnet"]');
  await card.waitFor({ timeout: T });
  const words = (await card.innerText()).replace(/\s/g, ' ');
  for (const w of ['Formule Entretien 5 semaines', '0 sur 5', '5 réservées', 'Visite 1', 'Visite 5', '80 € à régler au salon, à ta première visite.']) if (!words.toLowerCase().includes(w.toLowerCase())) throw new Error('his formule does not say: ' + w + ' (' + words + ')');
  if ((await card.locator('a', { hasText: 'Gérer' }).count()) !== 5) throw new Error('not five dates to manage');
  await noSideScroll(his.page, '/moi, his space');
  if (WF) { await card.scrollIntoViewIfNeeded(); await his.page.waitForTimeout(300); await his.page.screenshot({ path: WF + '/prod-formule-espace-430.png', fullPage: true }); }

  step('he cancels one date');
  await his.page.getByRole('button', { name: 'Annuler' }).first().click();
  await his.page.getByRole('button', { name: 'Oui, annuler' }).click();
  await his.page.locator('[data-guide="moi-carnet"]').getByText(/4 réservées · 1 à réserver/).waitFor({ timeout: T });
  const appts = (await h.api('/api/v1/clients/' + files[0].id)).json.appts;
  const left = appts.filter((a) => a.status === 'booked'), gone = appts.filter((a) => a.status === 'cancelled');
  if (left.length !== 4 || gone.length !== 1) throw new Error('the salon does not see 4 booked and 1 cancelled: ' + JSON.stringify(appts.map((a) => a.status)));
  await his.ctx.close();

  /* 5 · « Renvoyer le lien » */
  step('the Comptoir sends the link again from a date’s sheet');
  const before = mailsOf(box).filter((x) => x.to === MAIL && /\/moi\?garder=/.test(x.text)).length;
  left.sort((a, b) => a.day.localeCompare(b.day));
  await desk.page.goto(base + '/comptoir/agenda?day=' + left[1].day + '&rdv=' + left[1].id);
  const again = desk.page.locator('[data-guide="ap-formule-lien"]');
  await again.waitFor({ timeout: T });
  await again.scrollIntoViewIfNeeded();
  if (WF) { await desk.page.waitForTimeout(300); await desk.page.screenshot({ path: WF + '/prod-renvoyer-lien-430.png' }); }
  await again.getByRole('button', { name: 'Renvoyer le lien de sa formule' }).click();
  await desk.page.getByText('Renvoyé par e-mail').first().waitFor({ timeout: T });
  const copies = await until('the copy', () => { const m = mailsOf(box).filter((x) => x.to === MAIL && /\/moi\?garder=/.test(x.text)); return m.length === before + 1 ? m : null; });
  if (!copies.at(-1).text.includes('Tes 4 rendez-vous avec JKut')) throw new Error('the copy does not list what is left: ' + copies.at(-1).text);
  await desk.ctx.close();
  if (errors.length) throw new Error(errors.slice(0, 3).join('\n'));
}
