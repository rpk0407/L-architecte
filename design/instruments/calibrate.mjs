// Calibration: run every instrument on pages whose answer is known, and say which ones are wrong.
//
//   node design/instruments/cli.mjs calibrate        (npm run ux:calibrate)
//
// No server and no build: each case is a page held in memory. Exit code 1 when any instrument misjudges a case.
import { createRequire } from 'node:module';
import { uxInpage } from './lib/inpage.mjs';
import { DEVICES } from './lib/surface.mjs';
import { CASES } from '../calibration/cases.mjs';

export async function calibrate() {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const helper = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
  await helper.setContent('<canvas></canvas>');
  let wrong = 0, total = 0;
  console.log(`\nLe Cabinet · calibration, ${CASES.length} cases\n`);
  for (const c of CASES) {
    const dev = DEVICES[c.device || 'phone'];
    const ctx = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: 1, isMobile: dev.mobile, hasTouch: dev.mobile, locale: 'fr-FR' });
    const page = await ctx.newPage();
    await page.addInitScript({ content: `(${uxInpage.toString()})()` });
    // served as a real navigation (not setContent), so the init script and the viewport meta behave exactly as in a run
    await page.route('http://calibration.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: c.html }));
    await page.goto('http://calibration.test/');
    await page.waitForTimeout(80);
    const s = { page, dev, ux: (n, a) => page.evaluate(([name, arg]) => window.__ux[name](arg), [n, a]) };
    let verdicts;
    try { verdicts = c.expect(await c.measure(s, { helper })); } catch (e) { verdicts = [[false, 'the instrument threw: ' + String(e.message).split('\n')[0]]]; }
    const bad = verdicts.filter(([ok]) => !ok);
    total += verdicts.length; wrong += bad.length;
    console.log(`  ${bad.length ? '✗' : '✓'} ${c.id.padEnd(40)} ${verdicts.length - bad.length}/${verdicts.length}`);
    for (const [, why] of bad) console.log(`      ✗ ${why}`);
    await ctx.close();
  }
  await browser.close();
  console.log(`\n  ${total - wrong} of ${total} judgements right${wrong ? `, ${wrong} WRONG: an instrument that misjudges these cannot judge the shop` : ''}\n`);
  return wrong ? 1 : 0;
}
