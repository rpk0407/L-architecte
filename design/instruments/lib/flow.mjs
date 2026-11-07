// The booking sheet, driven the way a person drives it, counting what it costs him: taps, characters typed, time.
//
// Choosing a service, a barber or a slot advances the sheet by itself, so the cost of a booking is the taps on those choices,
// the opening tap, the fields, and the confirm. `finish` drives the sheet to the end from wherever it stands, which is how a
// returning client (whose details are remembered) and a stranger are both measured by the same hand.
import { SEL } from './surface.mjs';

const text = async (page, sel) => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

export class Booking {
  /** @param {{ page: import('playwright').Page, dev: { mobile: boolean } }} s */
  constructor(s) { this.s = s; this.page = s.page; this.taps = 0; this.chars = 0; this.t0 = null; this.touch = s.dev.mobile; }

  async tap(loc) {
    if (this.t0 == null) this.t0 = Date.now();
    this.taps++;
    await (this.touch ? loc.tap() : loc.click());
  }
  elapsed() { return this.t0 == null ? 0 : Date.now() - this.t0; }
  visible(sel) { return this.page.locator(sel).first().isVisible().catch(() => false); }

  /** What the sheet shows right now. */
  async screen() {
    return { step: await text(this.page, SEL.stepLabel), title: await text(this.page, SEL.sheetTitle), foot: await text(this.page, SEL.footer), body: await text(this.page, '.bk-body') };
  }

  async open() {
    await this.tap(this.page.locator(SEL.cta).first());
    await this.page.locator(`${SEL.service}, ${SEL.rebook}`).first().waitFor({ state: 'visible', timeout: 10000 });
  }
  async service(which = 0) {
    const all = this.page.locator(SEL.service);
    await all.first().waitFor({ state: 'visible', timeout: 10000 });
    await this.tap(typeof which === 'number' ? all.nth(which) : all.filter({ hasText: which }).first());
  }
  async who(which = 0) {
    await this.page.locator(SEL.who).first().waitFor({ state: 'visible', timeout: 10000 });
    await this.tap(this.page.locator(SEL.who).nth(which));
  }
  /** The earliest slot: the quick pick when there is one, otherwise the first day’s first slot. */
  async earliest() {
    await this.page.locator(`${SEL.fast}, ${SEL.slot}`).first().waitFor({ state: 'visible', timeout: 12000 });
    if (await this.visible(SEL.fast)) { await this.tap(this.page.locator(SEL.fast).first()); return 'quick-pick'; }
    await this.tap(this.page.locator(SEL.slot).first());
    return 'first-slot';
  }
  /** The sheet says “On réserve le créneau…” while it takes the hold; a person reads and types for longer than that, a script must wait. */
  async holdReady() {
    await this.page.waitForFunction(() => !/On réserve le cr[ée]neau/i.test((document.querySelector('.bk-body') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  }
  /**
   * A stranger types his name and his number (the demo salon prefills the form, so the fields are replaced, as in production);
   * a returning client (`remembered`) keeps what the sheet already knows and types nothing.
   */
  async details({ first, phone }, { remembered = false } = {}) {
    await this.page.locator(SEL.first).waitFor({ state: 'visible', timeout: 10000 });
    await this.holdReady();
    for (const [sel, val] of [[SEL.first, first], [SEL.phone, phone]]) {
      const now = await this.page.inputValue(sel);
      if (remembered && now) continue;
      await this.page.fill(sel, val);
      this.chars += val.length;
    }
  }
  async confirm() { await this.tap(this.page.locator(SEL.confirm).first()); }
  /** Wait for the end of the flow: a confirmed booking, or a deposit still to pay. */
  async done(timeout = 15000) {
    await this.page.waitForFunction(() => /CONFIRM|ACOMPTE/i.test((document.querySelector('.bk-k') || {}).textContent || ''), null, { timeout });
    return (await text(this.page, SEL.stepLabel)).toLowerCase().includes('acompte') ? 'deposit' : 'confirmed';
  }

  /** Drive the sheet to its end from wherever it is (after a rebook card, say). */
  async finish(who) {
    for (let i = 0; i < 8; i++) {
      const k = (await text(this.page, SEL.stepLabel)).toLowerCase();
      if (/confirm|acompte/.test(k)) return this.done();
      if (await this.visible(SEL.first)) { await this.details(who, { remembered: true }); await this.confirm(); await this.page.waitForTimeout(400); continue; }
      if (await this.visible(SEL.fast) || await this.visible(SEL.slot)) { await this.earliest(); await this.page.waitForTimeout(400); continue; }
      if (await this.visible(SEL.who)) { await this.who(0); continue; }
      if (await this.visible(SEL.service)) { await this.service(0); continue; }
      await this.page.waitForTimeout(300);
    }
    return this.done();
  }
}
