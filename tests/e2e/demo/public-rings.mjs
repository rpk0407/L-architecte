// The site's pages the client space links to (/mon-rendez-vous, /resilier, /carte-cadeau, the legal pages, the 404 and the old-link page) and
// the site itself: the keyboard ring of the main controls is a colour of the page (never the control's own text colour: on the red button, on the
// skip link and on the current page of the nav that is the colour of what lies behind it, no ring at all), light and dark; and not one of
// them scrolls sideways on a 320 px phone.
export const name = 'public pages: a focus ring on the controls the client space links to, light and dark, and no sideways scroll at 320 px';
export const viewport = { width: 390, height: 844 };

import { focusRing } from '../ring.mjs';

const PAGES = [
  ['/mon-rendez-vous', ['a.skip', 'a.wm', '.tb a.btn', '#lk-b', 'main a.btn.ghost', '.ft-l a']],
  ['/resilier', ['a.skip', '.tb a.btn', '#rs-b', '#rs-lost']],
  ['/carte-cadeau', ['a.skip', '.tb a.btn', '.ft-l a', '#cc-go']],
  ['/mentions-legales', ['a.skip', '.pg-nav a[aria-current="page"]']],
  ['/pas-une-page', ['a.btn', 'a.btn.ghost']],
  ['/ancien-lien', ['a.btn', 'a.btn.ghost']]
];
const ALL = ['/', '/mon-rendez-vous', '/resilier', '/carte-cadeau', '/mentions-legales', '/confidentialite', '/cgv', '/contact', '/formations', '/pas-une-page', '/ancien-lien'];

export default async ({ h, page }) => {
  const settle = (pg) => pg.waitForSelector('html[data-ready="1"]', { state: 'attached', timeout: 3000 }).catch(() => {});
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [path, sels] of PAGES) {
      await page.goto(h.base + path);
      await settle(page);
      for (const sel of sels) await focusRing(page, sel, scheme + ': ' + path);
    }
  }

  // the site: the ring is the surface's (ink on the bone sections, bone on the ink ones); the skip link, the bar that follows the page and the
  // « Le détail » pill sit over every section, or a photograph, in turn: a bone ring with an ink band inside it
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(h.base + '/');
  await page.locator('.cta .btn').waitFor({ timeout: 10000 });
  for (const sel of ['.hr-next', '.cr-tab.on', '.ab .btn', '.ct-go', '.fq-i summary', '.ft .btn']) await focusRing(page, sel, 'the site');
  for (const sel of ['a.skip', '.cta .btn', '.ct-zoom']) {
    await page.keyboard.press('Tab');
    // (the red button fades its band in: read it once the fade is over)
    const got = await page.locator(sel).first().evaluate(async (e) => { e.focus({ preventScroll: true }); await Promise.all(e.getAnimations().map((a) => a.finished.catch(() => {}))); const c = getComputedStyle(e); return { ring: c.outlineColor, width: parseFloat(c.outlineWidth), band: c.boxShadow }; });
    if (got.ring !== 'rgb(236, 232, 224)' || got.width < 2 || !/rgb\(15, 14, 13\) 0px 0px 0px 3px/.test(got.band)) throw new Error('the site: ' + sel + ' has no two-band ring: ' + JSON.stringify(got));
  }

  // 320 px: nothing scrolls sideways (the privacy page's « Oublier mes infos sur ce téléphone » button once ended at 342 px)
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ALL) {
    await page.goto(h.base + path);
    await settle(page);
    const w = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }));
    if (w.page > w.screen) throw new Error(path + ': the page scrolls sideways at 320 px (' + w.page + ' px)');
  }
};
