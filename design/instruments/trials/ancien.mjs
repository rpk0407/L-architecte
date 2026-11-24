// L’épreuve de l’ancien: large print, a wide thumb, a preference for a human voice.
//
// A 320 px phone is what WCAG 1.4.10 calls the reflow floor (400% zoom on a desktop): nothing may need sideways scrolling.
// Then what an older reader needs and a younger one forgives: text size, contrast (including text over a photograph, measured on
// pixels), controls that say what they do, a number to call, timers that are said out loud, and zoom left to the user.
import { SEL } from '../lib/surface.mjs';
import { Booking } from '../lib/flow.mjs';
import { viewportContrast } from '../lib/contrast.mjs';

export const meta = {
  id: 'ancien', fr: 'L’épreuve de l’ancien', en: 'The elder test', driver: 'scenes',
  summary: 'Reflow at 320 px, text size, contrast over photographs, named controls, a number to call, timers, zoom.'
};

const WHO = ['ancien', 'nouveau', 'presse'];

export async function run(h) {
  const scenes = h.scenes('ancien');
  for (const scene of scenes) {
    const s = await h.open(scene);
    await s.goto('/');
    await s.page.waitForTimeout(2200);
    const first = await h.shot(s.page, 'Home at 320 px', { scene: scene.id });

    // reflow, on the page and inside the booking sheet
    const page = await s.ux('reflow');
    h.check({ id: 'ancien.reflow', axis: 'craft', weight: 4, personas: ['ancien', 'passionne'], scene: scene.id, protect: page.overflow <= 1 && page.off.length === 0,
      title: 'At 320 px the home page needs no sideways scrolling (WCAG 1.4.10 reflow)',
      why: 'Someone who enlarges the text a great deal is someone for whom a page that scrolls sideways is a page that stops working.',
      status: page.overflow <= 1 && page.off.length === 0 ? 'pass' : page.overflow <= 1 ? 'warn' : 'fail', value: page.overflow, unit: 'px of overflow', threshold: '0',
      detail: page.off.map((o) => `${o.d} (${o.left}→${o.right})`).slice(0, 4).join(' · ') || undefined, evidence: [first] });
    const b = new Booking(s);
    await b.open();
    await b.service(0);
    await b.who(0);
    await b.earliest();
    await s.page.locator(SEL.first).waitFor({ state: 'visible' });
    await b.holdReady();
    const sheet = await s.ux('reflow');
    const sheetShot = await h.shot(s.page, 'The details step at 320 px', { scene: scene.id });
    h.check({ id: 'ancien.reflow-sheet', axis: 'craft', weight: 3, personas: ['ancien'], scene: scene.id, protect: sheet.overflow <= 1,
      title: 'At 320 px the booking sheet’s details step needs no sideways scrolling',
      why: 'The details step is where a form can break a narrow screen: two fields side by side is the usual culprit.',
      status: sheet.overflow <= 1 && sheet.off.length === 0 ? 'pass' : sheet.overflow <= 1 ? 'warn' : 'fail', value: sheet.overflow, unit: 'px of overflow', threshold: '0',
      detail: sheet.off.map((o) => `${o.d} (${o.left}→${o.right})`).slice(0, 4).join(' · ') || undefined, evidence: [sheetShot] });
    const names = await s.ux('semantics');
    h.check({ id: 'ancien.labels', axis: 'craft', weight: 3, personas: ['ancien'], scene: scene.id, protect: names.unnamedControls.length === 0 && names.unlabelledFields.length === 0,
      title: 'Every control and every field has a name a screen reader can say (icon-only buttons included)',
      why: 'An icon he cannot read is a button he will not press; for a screen reader it is not even a button.',
      status: names.unnamedControls.length || names.unlabelledFields.length ? 'fail' : 'pass', value: names.unnamedControls.length + names.unlabelledFields.length, unit: 'unnamed', threshold: '0',
      detail: [...names.unnamedControls, ...names.unlabelledFields].join(' · ') || undefined });
    await s.page.locator(SEL.close).first().click().catch(() => {});
    await s.page.waitForTimeout(600);
    await s.page.evaluate(() => window.scrollTo(0, 0));
    await s.page.waitForTimeout(500);

    // text size and contrast, at the top, the middle and the bottom of the home page
    const text = await s.ux('textSizes');
    h.check({ id: 'ancien.text-size', axis: 'usability', weight: 3, personas: ['ancien'], scene: scene.id,
      title: 'Almost no text is under 14 px',
      why: 'The eyes that tire first are the ones reading 12 px grey on a phone in a bright square.',
      status: text.under14 <= 0.08 ? 'pass' : text.under14 <= 0.2 ? 'warn' : 'fail', value: Math.round(text.under14 * 100), unit: '% of the characters under 14 px', threshold: '≤ 8%',
      detail: `smallest ${text.minPx} px · ${text.smallest.map((x) => `${x.d} ${x.px} px`).slice(0, 3).join(' · ')}`, data: text.smallest });
    const below = [];
    let judged = 0, photo = 0;
    for (const y of [0, 0.5, 1]) {
      await s.page.evaluate((f) => window.scrollTo(0, Math.max(0, (document.documentElement.scrollHeight - innerHeight) * f)), y);
      await s.page.waitForTimeout(700);
      const c = await viewportContrast(h, s);
      judged += c.judged.length; photo += c.onPhoto; below.push(...c.below);
    }
    const uniq = [...new Map(below.map((i) => [i.d + i.text, i])).values()].sort((a, b) => a.ratio / a.required - b.ratio / b.required);
    const clear = uniq.filter((i) => i.ratio < 3);
    h.check({ id: 'ancien.contrast', axis: 'usability', weight: 3, personas: ['ancien', 'nouveau'], scene: scene.id,
      title: 'Text meets WCAG AA contrast on the home page, including text laid over photographs (measured on pixels)',
      why: 'A photograph is lit unevenly; the worst pixel behind a line of text is the one a tired eye meets.',
      status: clear.length ? 'fail' : uniq.length ? 'warn' : 'pass', value: `${uniq.length} below AA`, unit: `of ${judged} lines (${photo} over a photograph or gradient)`, threshold: '0 below 4.5:1 (3:1 for large text)',
      detail: uniq.slice(0, 5).map((i) => `“${i.text.slice(0, 22)}” ${i.ratio}:1 (needs ${i.required}${i.pixels ? ', over an image or gradient' : ''})`).join(' · ') || undefined,
      data: uniq.slice(0, 8).map((i) => ({ text: i.text, ratio: i.ratio, required: i.required, photo: !!i.pixels })) });

    // a number to call
    const seen = await s.ux('seen', 'page');
    const tel = seen.links.filter((l) => /^tel:/i.test(l.href));
    h.check({ id: 'ancien.phone', axis: 'usability', weight: 3, personas: ['ancien', 'occasion', 'futur'], scene: scene.id, decision: tel.length === 0, protect: tel.length > 0,
      title: 'The home page offers a phone number that dials when tapped',
      why: 'He would rather speak to someone, and the salon has a number: it is configured in Réglages › Salon, and used in an error message and in the search engines’ data, but nowhere a person can tap.',
      status: tel.length ? 'pass' : 'fail', value: tel.length ? tel[0].href : 'no tel: link on the page',
      fix: 'A tel: link in the menu’s foot and the footer. If the shop deliberately prefers no calls (hands full of clippers), say so in a line, and give the writing address beside it.' });

    // timers are said out loud
    const holdSaid = /cr[ée]neau gard[ée]|\d:\d\d/.test((await new Booking(s).screen()).body);
    h.check({ id: 'ancien.timers', axis: 'usability', weight: 1, personas: ['ancien', 'parent'], scene: scene.id, status: 'info', decision: true,
      title: 'The sheet keeps a slot for five minutes and a deposit for fifteen: is there a way to ask for more time?',
      why: 'WCAG 2.2.1 (timing adjustable): a person who reads slowly, or is interrupted, should be able to extend or restart a limit without losing his work.',
      value: 'five-minute slot hold, fifteen-minute deposit window', detail: 'Both timers are visible and honest. Whether a renewal is offered at expiry cannot be observed on a pinned clock: test it by hand, once.' });

    // zoom left to the user
    h.check({ id: 'ancien.zoom', axis: 'craft', weight: 3, personas: ['ancien'], scene: scene.id, protect: !names.zoomLocked,
      title: 'Pinch-to-zoom is left to the user (the viewport does not lock the scale)',
      why: 'The most basic accessibility setting a phone has, and the easiest to take away by accident.',
      status: names.zoomLocked ? 'fail' : 'pass', value: names.viewportMeta });
    await s.close();
  }
  return { scenesRun: scenes.length, personas: WHO };
}
