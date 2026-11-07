// Contrast of what is on screen, honestly: text on a solid colour is resolved by the page itself; text over a photograph or a
// gradient is measured on the pixels, by photographing the page with its text hidden and reading what lies behind each line.
// The worst case is what counts: light text fails on the lightest pixels behind it, dark text on the darkest.
import { overPixels } from './color.mjs';
import { lumaBehind } from './pixels.mjs';

/**
 * @param {import('./harness.mjs').Harness} h
 * @param {Awaited<ReturnType<import('./harness.mjs').Harness['open']>>} s a session on a settled page
 */
export async function viewportContrast(h, s) {
  // text that is still fading in (a reveal on scroll) is measured at half strength: wait for every animation that ends
  await s.page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))),
    new Promise((done) => setTimeout(done, 2500))
  ]));
  await s.page.waitForTimeout(250);
  const items = await s.ux('contrast', { scope: 'viewport' });
  const photo = items.filter((i) => i.pixels);
  if (photo.length) {
    await s.page.evaluate(() => window.__ux.hideText(true));
    await s.page.waitForTimeout(150);
    const png = await s.page.screenshot({ type: 'png', animations: 'disabled' });
    await s.page.evaluate(() => window.__ux.hideText(false));
    await s.page.waitForTimeout(700); // the page’s own colour transitions run again once the text is shown: let them end before anything else looks
    for (const it of photo) {
      const stats = (await lumaBehind(h.helper, png, it.rects)).filter(Boolean);
      if (!stats.length) { it.ratio = null; continue; }
      const rs = stats.map((st) => overPixels(it.fg, st));
      it.ratio = +Math.min(...rs.map((r) => r.worst)).toFixed(2);
      it.median = +Math.min(...rs.map((r) => r.median)).toFixed(2);
    }
  }
  const judged = items.filter((i) => i.ratio != null && i.fg[3] > 0.05);
  const below = judged.filter((i) => i.ratio < i.required).sort((a, b) => a.ratio / a.required - b.ratio / b.required);
  // a fail is text that would miss even the large-text bar (3:1); the rest of what misses AA is a warning, to be weighed
  const clear = below.filter((i) => i.ratio < 3);
  return {
    judged, below, clear, onPhoto: photo.length,
    status: clear.length ? 'fail' : below.length ? 'warn' : 'pass',
    detail: below.slice(0, 5).map((i) => `“${i.text.slice(0, 22)}” ${i.ratio}:1 (needs ${i.required}${i.pixels ? ', over an image or gradient' : ''})`).join(' · ')
  };
}
