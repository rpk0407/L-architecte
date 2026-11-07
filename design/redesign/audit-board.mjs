#!/usr/bin/env node
// Look at a concept board, and measure it with the harness's own instruments.
//
//   node design/redesign/audit-board.mjs design/redesign/concepts/<slug>/board.html
//
// Screenshots at 390×844, 320×568 and 1440×900 (the top, and the whole page) go to .lx-data/redesign/<slug>/ : LOOK at them
// (the Read tool shows an image). Then it prints what the instruments measure on the page: sideways overflow, tap targets under
// 44 px, small text, fixed UI over the content, contrast (text over photographs measured on pixels), script errors, failed requests.
// A board is a concept, not a build: the numbers are there so that a concept is not already failing the brief on its first screen.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { uxInpage } from '../instruments/lib/inpage.mjs';
import { viewportContrast } from '../instruments/lib/contrast.mjs';

const arg = process.argv[2];
if (!arg) { console.error('usage: node design/redesign/audit-board.mjs <board.html>'); process.exit(2); }
const file = resolve(arg);
const slug = basename(dirname(file));
const out = resolve(new URL('../..', import.meta.url).pathname, '.lx-data', 'redesign', slug);
mkdirSync(out, { recursive: true });

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const helper = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
await helper.setContent('<canvas></canvas>');

const VIEWS = [['phone', { width: 390, height: 844 }, true], ['tiny', { width: 320, height: 568 }, true], ['desktop', { width: 1440, height: 900 }, false]];
for (const [name, vp, mobile] of VIEWS) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 100)); });
  page.on('requestfailed', (r) => failed.push(r.url().slice(0, 80)));
  await page.addInitScript({ content: `(${uxInpage.toString()})()` });
  await page.goto('file://' + file);
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.screenshot({ path: `${out}/${name}-top.png` });
  await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
  const ux = (n, a) => page.evaluate(([x, y]) => window.__ux[x](y), [n, a]);
  const re = await ux('reflow'), t = await ux('targets', { min: 44, floor: 24 }), tx = await ux('textSizes'), cov = await ux('coverage');
  const s = { page, ux };
  let below = [], judged = 0;
  for (const f of name === 'phone' ? [0, 0.5, 1] : [0]) {
    await page.evaluate((k) => window.scrollTo(0, Math.max(0, (document.documentElement.scrollHeight - innerHeight) * k)), f);
    await page.waitForTimeout(600);
    const c = await viewportContrast({ helper }, s);
    judged += c.judged.length; below.push(...c.below);
  }
  const uniq = [...new Map(below.map((i) => [i.d + i.text, i])).values()].sort((a, b) => a.ratio / a.required - b.ratio / b.required);
  console.log(`\n[${name} ${vp.width}×${vp.height}]`);
  console.log(`  sideways overflow : ${re.overflow > 1 ? '✗ ' + re.overflow + ' px (' + re.off.slice(0, 2).map((o) => o.d).join(', ') + ')' : '✓ none'}`);
  console.log(`  tap targets <44px : ${t.under.length ? (t.below.length ? '✗ ' : '~ ') + t.under.length + ' of ' + t.counted + ' (' + t.under.slice(0, 4).map((x) => `${x.d} ${x.w}×${x.h}`).join(' · ') + ')' : '✓ none'}`);
  console.log(`  text under 14 px  : ${Math.round(tx.under14 * 100)}% of characters (smallest ${tx.minPx} px)`);
  console.log(`  fixed UI coverage : ${Math.round(cov.ratio * 100)}% of the viewport`);
  console.log(`  contrast (AA)     : ${uniq.length ? (uniq.some((i) => i.ratio < 3) ? '✗ ' : '~ ') + uniq.length + ' of ' + judged + ' lines below: ' + uniq.slice(0, 4).map((i) => `“${i.text.slice(0, 18)}” ${i.ratio}:1/${i.required}${i.pixels ? ' (over image)' : ''}`).join(' · ') : '✓ ' + judged + ' lines pass'}`);
  console.log(`  errors / failed   : ${errors.length ? '✗ ' + errors.slice(0, 2).join(' | ') : '✓ no script errors'} / ${failed.length ? failed.slice(0, 3).join(', ') : 'no failed request'}`);
  await ctx.close();
}
console.log(`\nscreenshots → ${out.replace(resolve(new URL('../..', import.meta.url).pathname) + '/', '')}/ (phone|tiny|desktop)-(top|full).png: look at them.\n`);
await browser.close();
