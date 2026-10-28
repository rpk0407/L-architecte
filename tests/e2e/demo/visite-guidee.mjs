// GUIDE-01a · The guided tour, in a real browser. The owner's first sign-in shows the welcome; « Commencer la visite »
// lights the first part of Mise en route; « Suivant » moves the spotlight to the next part, then to another page;
// Escape closes it and « Visite guidée » stays in the top bar; « Revoir la visite » in Mise en route starts it again.
// On a phone the card is a bottom card; with reduced motion nothing moves. The demo's client sees « Bienvenue dans ton
// espace » once on /moi, and its tour opens from it.
export const name = 'guided tour: welcome, spotlight, next part, next page, Escape, « Revoir la visite », phone, reduced motion, /moi welcome';

const box = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; });
/** the spotlight's box on the page, once it has stopped moving */
async function spot(page) {
  await page.locator('.tour-spot[data-on="1"]').waitFor({ timeout: 8000 });
  let a = await box(page, '.tour-spot'), b;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(120);
    b = await box(page, '.tour-spot');
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h) < 1) return b;
    a = b;
  }
  return b;
}
/** the spotlight is on this part: around it, 8 px all round */
async function litOn(page, target) {
  const s = await spot(page), t = await box(page, '[data-guide="' + target + '"]');
  if (Math.abs(s.x - (t.x - 8)) > 3 || Math.abs(s.y - (t.y - 8)) > 3 || Math.abs(s.w - (t.w + 16)) > 3 || Math.abs(s.h - (t.h + 16)) > 3) throw new Error('the spotlight is not on ' + target + ': ' + JSON.stringify({ s, t }));
  return s;
}
const stepOf = (page) => page.locator('.tour-card').getAttribute('data-step');

/**
 * Walk the open tour to its end with « Suivant » only. Each page's count « 2 / 5 » holds from its first card to its last
 * and runs 1, 2, 3…; the whole visit's bar only moves forward and ends full. Returns the steps played and those that
 * point at a part but light nothing (a centered card over a dimmed page). Also used by tests/e2e/prod/visite-guidee.mjs.
 */
export async function walkTour(page, shot = async () => {}) {
  const seen = [], unlit = [];
  let label = null, total = 0, k = 0, bar = 0;
  for (let n = 0; n < 250 && (await page.locator('.tour').count()); n++) {
    await page.locator('.tour-card[data-on="1"]').waitFor({ timeout: 10000 });
    // the spotlight settles in with the card
    await page.waitForTimeout(350);
    const s = await page.evaluate(() => {
      const c = document.querySelector('.tour-card'), b = document.querySelector('.tour-bar i');
      return {
        id: c.getAttribute('data-step'), target: c.getAttribute('data-target'), lit: document.querySelector('.tour-spot')?.getAttribute('data-on') === '1',
        label: c.querySelector('.tour-k span:first-child')?.textContent || '', n: c.querySelector('.tour-n')?.textContent || '',
        bar: Number(((b && b.style.transform.match(/scaleX\(([\d.]+)\)/)) || [])[1] || 0), url: location.pathname + location.search
      };
    });
    seen.push(s.id);
    const [a, b] = s.n.split('/').map((x) => Number(x.trim()));
    if (s.label !== label) {
      if (label !== null && k !== total) throw new Error('page « ' + label + ' » ended at ' + k + ' / ' + total);
      if (a !== 1) throw new Error('page « ' + s.label + ' » starts at ' + s.n);
      label = s.label; total = b;
    } else if (b !== total || a !== k + 1) throw new Error('the count of « ' + label + ' » moved: ' + k + ' / ' + total + ' then ' + s.n + ' (' + s.id + ')');
    k = a;
    if (s.bar + 1e-6 < bar) throw new Error('the visit’s bar went back at ' + s.id + ': ' + bar + ' → ' + s.bar);
    bar = s.bar;
    if (s.target && !s.lit) unlit.push(s.id + ' (' + s.url + ')');
    await shot(s.id);
    await page.getByRole('button', { name: /^(Suivant|Terminer)$/ }).click();
  }
  if (await page.locator('.tour').count()) throw new Error('the tour did not end after ' + seen.length + ' steps');
  if (bar < 0.999) throw new Error('the visit’s bar ends at ' + bar);
  return { seen, unlit };
}
/** the app's shortcuts wait while the tour is open: g (Agenda), / (search), n and p (the Agenda's sheets) change nothing */
async function keysWait(page) {
  const url = page.url(), at = await stepOf(page);
  for (const k of ['g', '/', 'n', 'p']) { await page.keyboard.press(k); await page.waitForTimeout(120); }
  if (page.url() !== url) throw new Error('a shortcut moved the page behind the tour: ' + page.url());
  if ((await page.getByRole('dialog').count()) !== 1 || (await page.locator('.palette').count())) throw new Error('a shortcut opened something over the tour');
  if ((await stepOf(page)) !== at) throw new Error('a shortcut moved the tour');
}

export default async ({ h, page }) => {
  /* ---------- the owner's first sign-in: the welcome, then the first part lit ---------- */
  await h.loginOwner(page);
  const welcome = page.getByRole('heading', { name: /^Bienvenue dans ton Comptoir/ });
  await welcome.waitFor({ timeout: 8000 });
  await h.shot(page, 'tour-welcome');
  await page.getByRole('button', { name: 'Commencer la visite' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  if (!/\/comptoir\/reglages\/mise-en-route$/.test(page.url())) throw new Error('the tour does not start on Mise en route: ' + page.url());
  if ((await stepOf(page)) !== 'mer.head') throw new Error('first step: ' + (await stepOf(page)));
  const s1 = await litOn(page, 'mer-head');
  // the count is the page's, the bar the whole visit's (a long one: its first step is a sliver)
  if (!/^1 \/ [3-9]$/.test(await page.locator('.tour-n').textContent())) throw new Error('Mise en route’s count: ' + (await page.locator('.tour-n').textContent()));
  const sliver = await page.locator('.tour-bar i').evaluate((e) => Number(e.style.transform.match(/scaleX\(([\d.]+)\)/)[1]));
  if (!(sliver > 0 && sliver < 0.03)) throw new Error('the owner’s tour is short: its bar starts at ' + sliver);
  if ((await dialog.getAttribute('aria-modal')) !== 'true') throw new Error('the card is not a modal dialog');
  if (!(await page.evaluate(() => !!document.activeElement?.closest('.tour-card')))) throw new Error('the focus is not in the card');
  if (await welcome.isVisible()) throw new Error('the welcome stays during the tour');
  await h.shot(page, 'tour-step1');
  await keysWait(page);

  /* ---------- « Suivant »: the next part (the rect changes), then the next page ---------- */
  await page.getByRole('button', { name: 'Suivant' }).click();
  await page.waitForFunction(() => document.querySelector('.tour-card')?.getAttribute('data-step') !== 'mer.head');
  const s2 = await litOn(page, 'mer-replay');
  if (Math.abs(s1.y - s2.y) + Math.abs(s1.h - s2.h) < 2) throw new Error('the spotlight did not move');
  // → also moves forward, ← back
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.tour-card')?.getAttribute('data-step') === 'mer.list');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.tour-card')?.getAttribute('data-step') === 'mer.replay');
  for (let i = 0; i < 8 && !page.url().includes('/comptoir/agenda'); i++) {
    await page.getByRole('button', { name: 'Suivant' }).click();
    await page.waitForTimeout(400);
  }
  if (!page.url().includes('/comptoir/agenda')) throw new Error('the tour did not cross to the Agenda: ' + page.url());
  await page.waitForFunction(() => /^agenda\./.test(document.querySelector('.tour-card[data-on="1"]')?.getAttribute('data-step') || ''), null, { timeout: 8000 });
  await litOn(page, await page.locator('.tour-card').getAttribute('data-target'));
  await h.shot(page, 'tour-agenda');
  await keysWait(page);

  /* ---------- Escape: closed, kept for later ---------- */
  const at = await stepOf(page);
  await page.keyboard.press('Escape');
  await page.locator('.tour').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /Visite guidée/ }).waitFor();
  // where he stopped is his (prefs.tour), on the server
  await h.setup();
  for (let i = 0; i < 20; i++) {
    const t = (await h.api('/api/v1/bootstrap')).json?.me?.prefs?.tour;
    if (t && t.at === at && !t.done) break;
    if (i === 19) throw new Error('prefs.tour not saved: ' + JSON.stringify(t));
    await page.waitForTimeout(150);
  }
  // the chip picks it up where he left it
  await page.getByRole('button', { name: /Visite guidée/ }).click();
  await page.waitForFunction((a) => document.querySelector('.tour-card[data-on="1"]')?.getAttribute('data-step') === a, at);
  await page.keyboard.press('Escape');
  await page.locator('.tour').waitFor({ state: 'detached' });

  /* ---------- « Revoir la visite » from Mise en route: from the start ---------- */
  await page.goto(h.base + '/comptoir/reglages/mise-en-route');
  await page.getByRole('button', { name: 'Revoir la visite' }).click();
  await dialog.waitFor();
  if ((await stepOf(page)) !== 'mer.head' || !/^1 \//.test(await page.locator('.tour-n').textContent())) throw new Error('« Revoir la visite » does not start over');
  await litOn(page, 'mer-head');
  // « Passer la visite »: done, the chip goes, the page's « ? » stays
  await page.getByRole('button', { name: 'Passer la visite' }).click();
  await page.locator('.tour').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Comment marche cette page ?' }).click();
  await dialog.waitFor();
  if (!/^mer\./.test(await stepOf(page))) throw new Error('« ? » plays another page: ' + (await stepOf(page)));
  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.locator('.tour').waitFor({ state: 'detached' });
  if (await page.getByRole('button', { name: /Visite guidée/ }).count()) throw new Error('the chip stays after the tour was passed');

  /* ---------- the whole visit, « Suivant » after « Suivant »: a part this salon does not show is passed over ---------- */
  await page.getByRole('button', { name: 'Revoir la visite' }).click();
  const walk = await walkTour(page, (id) => (['agenda.board', 'caisse.lines', 'clients.file-head', 'clients.abonnes-list'].includes(id) ? h.shot(page, 'tour-walk-' + id) : null));
  if (walk.seen.length < 40) throw new Error('the owner’s tour is short: ' + walk.seen.length + ' steps');
  if (walk.unlit.length > 3) throw new Error(walk.unlit.length + ' steps light nothing: ' + walk.unlit.join(', '));

  /* ---------- a phone: a bottom card, no sideways scroll ---------- */
  const phone = await h.newPage({ viewport: { width: 390, height: 844 } });
  await h.loginOwner(phone);
  await phone.goto(h.base + '/comptoir/reglages/mise-en-route');
  await phone.getByRole('button', { name: 'Revoir la visite' }).click();
  await phone.locator('.tour-card[data-on="1"]').waitFor();
  await phone.waitForTimeout(500);
  if ((await phone.locator('.tour-card').getAttribute('data-where')) !== 'bottom') throw new Error('not a bottom card on a phone');
  const c = await phone.locator('.tour-card').boundingBox();
  if (c.y + c.height < 844 - 40 || c.x > 16 || c.width < 390 - 32) throw new Error('the bottom card is not at the bottom: ' + JSON.stringify(c));
  await litOn(phone, 'mer-head');
  if (await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('the tour scrolls sideways on a phone');
  await h.shot(phone, 'tour-phone');
  for (let i = 0; i < 5; i++) { await phone.getByRole('button', { name: 'Suivant' }).click(); await phone.waitForTimeout(350); }
  await phone.locator('.tour-card[data-on="1"]').waitFor();
  await h.shot(phone, 'tour-phone-agenda');
  await phone.keyboard.press('Escape');

  /* ---------- reduced motion: nothing moves ---------- */
  const still = await h.newPage();
  await still.emulateMedia({ reducedMotion: 'reduce' });
  await h.loginOwner(still);
  await still.goto(h.base + '/comptoir/reglages/mise-en-route');
  await still.getByRole('button', { name: 'Revoir la visite' }).click();
  await still.locator('.tour-card[data-on="1"]').waitFor();
  const moves = await still.evaluate(() => ['.tour-card', '.tour-spot', '.tour-dim', '.tour-in'].map((s) => { const cs = getComputedStyle(document.querySelector(s)); return s + ' ' + cs.transitionDuration + ' ' + cs.animationName; }).filter((x) => /[1-9]/.test(x.split(' ')[1]) || !x.endsWith(' none')));
  if (moves.length) throw new Error('something moves under reduced motion: ' + moves.join(', '));
  await still.getByRole('button', { name: 'Suivant' }).click();
  await litOn(still, 'mer-replay');
  await still.keyboard.press('Escape');

  /* ---------- /moi: « Bienvenue dans ton espace », once ---------- */
  const moi = await h.newPage({ viewport: { width: 390, height: 844 } });
  await moi.goto(h.base + '/moi');
  await moi.getByRole('button', { name: 'Essayer avec un client de démo' }).click();
  await moi.getByRole('heading', { name: /^Salut / }).waitFor({ timeout: 10000 });
  await moi.getByRole('heading', { name: 'Bienvenue dans ton espace' }).waitFor();
  await h.shot(moi, 'moi-welcome');
  await moi.getByRole('button', { name: 'Voir comment ça marche' }).click();
  await moi.locator('.tour[data-skin="site"] .tour-card[data-on="1"]').waitFor();
  if ((await moi.locator('.tour-card').getAttribute('data-where')) !== 'bottom') throw new Error('/moi: not a bottom card');
  if (!(await moi.locator('.tour-spot[data-on="1"]').count())) throw new Error('/moi: no part lit');
  await h.shot(moi, 'moi-tour');
  await moi.getByRole('button', { name: 'Passer la visite' }).click();
  await moi.locator('.tour').waitFor({ state: 'detached' });
  await moi.reload();
  await moi.getByRole('heading', { name: /^Salut / }).waitFor({ timeout: 10000 });
  await moi.waitForTimeout(400);
  if (await moi.getByRole('heading', { name: 'Bienvenue dans ton espace' }).count()) throw new Error('/moi: the welcome comes back');
  // Profil › « Comment ça marche ? » replays it
  await moi.getByRole('link', { name: 'Profil' }).click();
  await moi.getByRole('button', { name: 'Comment ça marche ?' }).click();
  await moi.locator('.tour-card[data-on="1"]').waitFor();
  await moi.keyboard.press('Escape');
  await moi.locator('.tour').waitFor({ state: 'detached' });

  /* ---------- /moi on a touch phone, every step to the last: never wider than the screen, the card's buttons in reach ---------- */
  const touch = await h.newPage({ viewport: { width: 390, height: 844 }, mobile: true });
  await touch.goto(h.base + '/moi');
  await touch.getByRole('button', { name: 'Essayer avec un client de démo' }).click();
  await touch.getByRole('button', { name: 'Voir comment ça marche' }).click({ timeout: 10000 });
  let n = 0;
  for (; n < 40 && (await touch.locator('.tour').count()); n++) {
    await touch.locator('.tour-card[data-on="1"]').waitFor();
    await touch.waitForTimeout(450);
    const w = await touch.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    if (w.sw > w.iw) throw new Error('/moi step ' + (await stepOf(touch)) + ': the page is wider than the screen ' + JSON.stringify(w));
    const b = await touch.locator('.tour-card .tour-btn:not(.ghost)').boundingBox();
    if (!b || b.x < 0 || b.x + b.width > 390 || b.y + b.height > 844) throw new Error('/moi step ' + (await stepOf(touch)) + ': « Suivant » out of reach ' + JSON.stringify(b));
    if ((await stepOf(touch)) === 'moi.tabs') await h.shot(touch, 'moi-touch-tabs');
    await touch.locator('.tour-card .tour-btn:not(.ghost)').tap();
    await touch.waitForTimeout(150);
  }
  if (n < 5 || (await touch.locator('.tour').count())) throw new Error('/moi: the tour did not reach its end (' + n + ' steps)');
  // it ends where it started
  await touch.waitForFunction(() => location.pathname === '/moi');
};
