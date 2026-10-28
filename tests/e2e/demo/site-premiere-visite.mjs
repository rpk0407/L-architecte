// GUIDE-03 · The site on a first visit: a bubble offers the tour once, « Voir » plays it (the spotlight goes to the
// booking button, then account, subscription, loyalty, …), « × » hides it for good, the footer replays it, and booking
// a cut takes the same taps (the first one just reads a helper line under each step's title).
import { shot } from '../harness.mjs';

export const name = 'first visit: the guide, never in the way';
export const viewport = { width: 390, height: 844 };

const T = 12000;
const sp = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export default async (ctx) => {
  let at = 'start';
  try { await run(ctx, (x) => { at = x; }); } catch (e) { throw new Error(at + ': ' + e.message.split('\n')[0]); }
};

async function run({ browser, h }, step) {
  const base = h.base;
  const card = (p) => p.locator('.gd-card');
  const title = async (p) => sp(await card(p).locator('.gd-t').textContent());
  const spot = (p) => p.locator('.gd-spot').evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  // the spotlight has opened on the part (its box holds the part's), once the page has stopped moving
  const onPart = (p, mark) => p.waitForFunction((m) => {
    const t = document.querySelector('[data-guide="' + m + '"]'), s = document.querySelector('.gd-spot');
    if (!t || !s) return false;
    const a = t.getBoundingClientRect(), b = s.getBoundingClientRect();
    return b.width > 0 && a.width > 0 && b.left <= a.left + 1 && b.top <= a.top + 1 && b.right >= a.right - 1 && b.bottom >= a.bottom - 1 && a.bottom > 0 && a.top < innerHeight;
  }, mark, { timeout: T });
  const next = (p) => p.getByRole('button', { name: 'Suivant', exact: true }).click();
  const fresh = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport, locale: 'fr-FR', timezoneId: 'Europe/Paris', ...opts });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    return { ctx, p, errs };
  };

  /* ---- first visit: the bubble, then the tour ---- */
  step('bubble');
  const a = await fresh();
  const p = a.p;
  await p.goto(base + '/');
  await p.locator('.gd-bub').waitFor({ timeout: T });
  const said = sp(await p.locator('.gd-bub').textContent());
  if (!said.startsWith('Première visite ?') || !said.includes('Je te montre en 30 s')) throw new Error('the bubble says « ' + said + ' »');
  await shot(p, 'site-visite-bulle-390');
  // the bubble covers neither the booking button nor the first available slot
  const geo = await p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const b = r('.gd-bub'), c = r('.cta .btn'), n = r('.hr-next'); const hit = (x, y) => x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom; return { cta: hit(b, c), next: hit(b, n) }; });
  if (geo.cta || geo.next) throw new Error('the bubble covers a booking button: ' + JSON.stringify(geo));
  await p.getByRole('button', { name: 'Voir', exact: true }).click();
  if (await p.locator('.gd-bub').count() && !(await p.locator('.gd-bub.out').count())) throw new Error('the bubble stays while the tour plays');
  const dialog = p.getByRole('dialog');
  await dialog.waitFor({ timeout: T });
  if ((await title(p)) !== 'Réserver') throw new Error('the tour starts on « ' + (await title(p)) + ' »');
  await onPart(p, 'site.reserver');
  const s1 = await spot(p);
  await p.waitForTimeout(450);
  await shot(p, 'site-visite-1-390');
  const side = await card(p).getAttribute('data-side');
  if (side !== 'f') throw new Error('on a phone the card is a full-width card, not « ' + side + ' »');
  step('tour step 2');
  await next(p);
  await onPart(p, 'site.sans-compte');
  const s2 = await spot(p);
  if (Math.abs(s1.t - s2.t) < 20) throw new Error('the spotlight did not move to the next part');
  if ((await title(p)) !== 'Sans compte') throw new Error('step 2 is « ' + (await title(p)) + ' »');
  await next(p);
  await onPart(p, 'site.espace-lien');
  if ((await title(p)) !== 'Mon espace') throw new Error('step 3 is « ' + (await title(p)) + ' »');
  await p.waitForTimeout(450);
  await shot(p, 'site-visite-3-390');
  await next(p);
  await onPart(p, 'site-abonnement-plans');
  if ((await title(p)) !== 'Abonnement' || !sp(await card(p).textContent()).includes('80 € par mois')) throw new Error('step 4 is « ' + sp(await card(p).textContent()) + ' »');
  await p.waitForTimeout(450);
  await shot(p, 'site-visite-4-390');
  await next(p);
  await onPart(p, 'site.espace-lien');
  if ((await title(p)) !== 'Carte fidélité') throw new Error('step 5 is « ' + (await title(p)) + ' »');
  step('tour keys');
  // ← goes back, → forward, the keyboard drives the tour
  await p.keyboard.press('ArrowLeft');
  await p.waitForFunction(() => document.querySelector('.gd-t').textContent === 'Abonnement', null, { timeout: T });
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(() => document.querySelector('.gd-t').textContent === 'Carte fidélité', null, { timeout: T });
  for (const [t, m] of [['Carte cadeau', 'site.cadeau'], ['Mon rendez-vous', 'site.rdv'], ['Contact', 'site.contact']]) { await next(p); await onPart(p, m); if ((await title(p)) !== t) throw new Error('expected « ' + t + ' », got « ' + (await title(p)) + ' »'); }
  const k = sp(await card(p).locator('.gd-k').textContent());
  if (k !== '8 / 8') throw new Error('progress says ' + k);
  await p.getByRole('button', { name: 'Terminé', exact: true }).click();
  if (await p.locator('.gd-root').count()) throw new Error('the tour stays open after « Terminé »');
  // remembered: a second visit shows nothing
  await p.reload();
  await p.locator('.cta .btn').waitFor({ timeout: T });
  await p.waitForTimeout(3500);
  if (await p.locator('.gd-bub').count()) throw new Error('the bubble came back on a second visit');

  step('second visit');
  /* ---- the footer replays it; Escape leaves; focus returns ---- */
  await p.locator('[data-guide-replay]').scrollIntoViewIfNeeded();
  await p.locator('[data-guide-replay]').click();
  await dialog.waitFor({ timeout: T });
  await p.keyboard.press('Escape');
  if (await p.locator('.gd-root').count()) throw new Error('Escape did not close the tour');
  const focused = await p.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-guide-replay'));
  if (!focused) throw new Error('the focus did not return to the footer link');
  // the address /?visite plays it and cleans itself
  await p.goto(base + '/?visite');
  await dialog.waitFor({ timeout: T });
  if (new URL(p.url()).search) throw new Error('the address keeps ?visite: ' + p.url());
  await p.getByRole('button', { name: 'Passer', exact: true }).click();
  if (await p.locator('.gd-root').count()) throw new Error('« Passer » did not close the tour');

  step('replay');
  /* ---- booking: the same taps, a helper line on the first one only ---- */
  const b = await fresh();
  const q = b.p;
  await q.goto(base + '/');
  await q.locator('.cta .btn').waitFor({ timeout: T });
  let taps = 0;
  const tap = async (loc) => { taps++; await loc.click(); };
  await tap(q.locator('.cta').first());
  const help = async () => sp(await q.locator('.bk-h').first().textContent().catch(() => ''));
  if ((await help()) !== 'Choisis ta prestation') throw new Error('step 1 helper: « ' + (await help()) + ' »');
  await shot(q, 'site-visite-aide-390');
  await tap(q.locator('.bk button.so', { hasText: 'Coupe + taille de barbe' }));
  await q.locator('.bk button.wh').first().waitFor({ timeout: T });
  if ((await help()) !== 'Choisis ton barbier ou “Peu importe”') throw new Error('step 2 helper: « ' + (await help()) + ' »');
  await tap(q.locator('.bk button.wh').nth(1));
  await q.locator('.bk button.sl').first().waitFor({ timeout: T });
  if ((await help()) !== 'Choisis ton créneau') throw new Error('step 3 helper: « ' + (await help()) + ' »');
  await tap(q.locator('.bk button.sl').first());
  await q.fill('#f-first', 'Rayane');
  await q.fill('#f-phone', '0612345678');
  if (!(await help()).startsWith('Tes coordonnées')) throw new Error('step 4 helper: « ' + (await help()) + ' »');
  await tap(q.locator('.bk-foot .btn'));
  await q.getByText('C’est réservé, Rayane').first().waitFor({ timeout: T });
  if (taps !== 5) throw new Error('booking took ' + taps + ' taps');
  // the next booking on this phone has no helper
  await q.locator('.bk-x').click();
  await q.goto(base + '/');
  await q.locator('.cta .btn').waitFor({ timeout: T });
  await q.locator('.cta').first().click();
  await q.locator('.bk button.so').first().waitFor({ timeout: T });
  if (await q.locator('.bk-h').count()) throw new Error('the helper shows on a second booking');
  await b.ctx.close();

  step('booking');
  /* ---- « × » hides it for good ---- */
  const c = await fresh();
  await c.p.goto(base + '/');
  await c.p.locator('.gd-bub').waitFor({ timeout: T });
  await c.p.getByRole('button', { name: /Fermer/ }).click();
  await c.p.locator('.gd-bub').waitFor({ state: 'detached', timeout: 3000 });
  await c.p.reload();
  await c.p.locator('.cta .btn').waitFor({ timeout: T });
  await c.p.waitForTimeout(3500);
  if (await c.p.locator('.gd-bub').count()) throw new Error('the bubble came back after « × »');
  await c.ctx.close();

  step('close');
  /* ---- reduced motion: nothing moves ---- */
  const r = await fresh({ reducedMotion: 'reduce' });
  await r.p.goto(base + '/?visite');
  await r.p.getByRole('dialog').waitFor({ timeout: T });
  const motion = await r.p.evaluate(() => { const d = (s) => { const c = getComputedStyle(document.querySelector(s)); return c.transitionDuration.split(',').every((x) => parseFloat(x) === 0); }; return { spot: d('.gd-spot'), card: d('.gd-card'), next: d('.gd-next') }; });
  if (!motion.spot || !motion.card || !motion.next) throw new Error('reduced motion still has transitions: ' + JSON.stringify(motion));
  await r.p.getByRole('button', { name: 'Suivant', exact: true }).click();
  await r.p.getByRole('button', { name: 'Suivant', exact: true }).click();
  await onPart(r.p, 'site.espace-lien'); // at once: the page jumped, no smooth scroll to wait for
  await r.ctx.close();

  step('reduced motion');
  /* ---- a 320 px phone and a 1440 px screen: the card stays inside ---- */
  const n = await fresh({ viewport: { width: 320, height: 640 } });
  await n.p.goto(base + '/?visite');
  await n.p.getByRole('dialog').waitFor({ timeout: T });
  for (let i = 0; i < 3; i++) { await n.p.waitForTimeout(900); await n.p.getByRole('button', { name: 'Suivant', exact: true }).click(); }
  await onPart(n.p, 'site-abonnement-plans');
  const fit = await n.p.evaluate(() => { const r = document.querySelector('.gd-card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth; });
  if (!fit) throw new Error('at 320 px the card leaves the screen');
  await shot(n.p, 'site-visite-320');
  await n.ctx.close();
  const w = await fresh({ viewport: { width: 1440, height: 900 } });
  await w.p.goto(base + '/?visite');
  await w.p.getByRole('dialog').waitFor({ timeout: T });
  await onPart(w.p, 'site.reserver');
  await w.p.waitForTimeout(450);
  await shot(w.p, 'site-visite-1-1440');
  await next(w.p);
  await onPart(w.p, 'site.sans-compte');
  await w.p.waitForTimeout(450);
  await shot(w.p, 'site-visite-2-1440');
  await w.ctx.close();

  for (const x of [a, b, c, r, n, w]) if (x.errs.length) throw new Error('page error: ' + x.errs[0]);
  await a.ctx.close(); await c.ctx.close().catch(() => {});
}
