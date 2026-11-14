// The view of every barber's day, beside the time list, on a phone: a column per barber with his free times, readable at
// 390 px (sliding sideways beyond four columns), and a tap chooses that barber and that time, then the usual next step.
import { shot } from '../harness.mjs';

export const name = 'site: see every barber’s free times at once, tap one to book';
export const viewport = { width: 390, height: 844 };

const T = 10000;
const WF = process.env.WF_SHOTS || '';

export default async ({ h, page }) => {
  let at = 'start';
  try { await run(h, page, (x) => { at = x; }); } catch (e) { throw new Error(at + ': ' + e.message.split('\n')[0]); }
};

async function run(h, page, step) {
  step('open the view from the barber step');
  await page.goto(h.base + '/');
  await page.locator('.cta').first().click();
  await page.locator('.bk button.so').first().click();
  await page.getByRole('button', { name: 'Voir les créneaux de tous les barbiers' }).click();
  // the standard step order holds: this is still step 3, the time
  await h.expectText(page, 'Étape 3 sur 4');
  const toggle = page.getByRole('button', { name: 'Voir tous les barbiers' });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') throw new Error('the view of every barber is not on');
  await page.locator('.wide .wc .sl').first().waitFor({ timeout: T });

  step('readable at 390 px');
  const geo = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.wide .wc')];
    const box = document.querySelector('.wide');
    return {
      n: cols.length, names: cols.map((c) => c.querySelector('.wc-h b').textContent),
      minW: Math.min(...cols.map((c) => c.getBoundingClientRect().width)), snap: getComputedStyle(box).scrollSnapType,
      // beyond four columns, the fifth shows a little so the visitor knows there are more barbers to the side
      peek: cols[4] ? cols[4].getBoundingClientRect().left < window.innerWidth - 8 : true,
      page: document.scrollingElement.scrollWidth, minH: Math.min(...[...document.querySelectorAll('.wide .sl')].map((b) => b.getBoundingClientRect().height))
    };
  });
  if (geo.n < 4) throw new Error('only ' + geo.n + ' barbers shown: ' + geo.names.join(', '));
  if (geo.minW < 70) throw new Error('a column is too narrow: ' + geo.minW + ' px');
  if (geo.n > 4 && !/x/.test(geo.snap)) throw new Error('more than 4 columns and no sideways snap: ' + geo.snap);
  if (!geo.peek) throw new Error('more than 4 barbers and nothing shows that the list goes on to the side');
  if (geo.page > 390) throw new Error('the page scrolls sideways: ' + geo.page);
  if (geo.minH < 44) throw new Error('a time button is ' + geo.minH + ' px tall');
  // times on the slot buttons read « 14:30 » (docs/refonte-conventions.md)
  const t0 = (await page.locator('.wide .sl').first().textContent()).trim();
  if (!/^\d{2}:\d{2}$/.test(t0)) throw new Error('a slot reads « ' + t0 + ' »');
  await shot(page, 'site-tous-barbiers-390');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(900);
  if (WF) await page.screenshot({ path: WF + '/site-tous-barbiers-390.png' });

  step('a tap chooses the barber and the time');
  const col = page.locator('.wide .wc').filter({ has: page.locator('.sl') }).nth(1);
  const barber = (await col.locator('.wc-h b').textContent()).trim();
  const time = (await col.locator('.sl').first().textContent()).trim();
  await col.locator('.sl').first().click();
  await page.locator('#f-first').waitFor({ timeout: T });
  await h.expectText(page, 'Étape 4 sur 4');
  const recap = (await page.locator('.recap').textContent()).replace(/\s+/g, ' ');
  if (!recap.includes('avec ' + barber)) throw new Error('the recap says « ' + recap + ' », not ' + barber);
  const [hh, mm] = time.split(':').map(Number);
  const words = hh + ' h' + (mm ? ' ' + String(mm).padStart(2, '0') : '');
  if (!recap.replace(/\s/g, ' ').includes(words.replace(/ /g, ' '))) throw new Error('the recap time « ' + recap + ' » is not ' + time);

  step('back keeps the view, then book');
  await page.locator('.bk-back').click();
  await page.locator('.wide').waitFor({ timeout: T });
  await page.locator('.wide .wc').filter({ hasText: barber }).locator('.sl').first().click();
  await page.fill('#f-first', 'Sami');
  await page.fill('#f-phone', '0622334455');
  await page.locator('.bk-foot .btn').click();
  await h.expectText(page, 'C’est réservé, Sami');
  await h.expectText(page, 'Avec ' + barber);
}
