// L’épreuve de 23 h: the shop is closed, the room is dark, the phone is the only light.
//
// A pinned Tuesday at 23:12, a phone in dark mode. Four questions the night asks of a site:
//   closed-truth   a shop that is shut must not offer “today”: the next time shown has to be tomorrow’s
//   dark           what the first screen does to eyes that have been in the dark (luminance of the first viewport, and its swings)
//   reduced-motion with “reduce motion” on, nothing loops forever and nothing stays hidden waiting for an animation
//   contrast       text is readable at night too (dark scheme)
import { SEL } from '../lib/surface.mjs';
import { Booking } from '../lib/flow.mjs';
import { lumaBands } from '../lib/pixels.mjs';
import { viewportContrast } from '../lib/contrast.mjs';

export const meta = {
  id: 'nuit', fr: 'L’épreuve de 23 h', en: 'The 23:00 test', driver: 'scenes',
  summary: 'A closed shop at night in dark mode: honest times, a screen that does not dazzle, reduced motion, contrast.'
};

const settle = (s) => s.page.waitForTimeout(2200);

export async function run(h) {
  const scenes = h.scenes('nuit');
  for (const scene of scenes) {
    // 1 · the truth about being closed
    let s = await h.open(scene);
    await s.goto('/');
    await settle(s);
    const pill = ((await s.page.locator(SEL.nextSlot).first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const b = new Booking(s);
    await b.open();
    await b.service(0);
    await s.page.locator(SEL.who).first().waitFor({ state: 'visible' });
    const who = ((await s.page.locator(SEL.who).first().innerText()) || '').replace(/\s+/g, ' ').trim();
    const shot = await h.shot(s.page, 'The barber step at 23:12, the shop closed', { scene: scene.id });
    const saysToday = /aujourd['’]hui|ce soir|maintenant/i.test(pill + ' ' + who);
    h.check({ id: 'nuit.closed-truth', axis: 'usability', weight: 4, personas: ['presse', 'nouveau', 'ancien'], scene: scene.id, protect: !saysToday,
      title: 'At 23:12, with the shop shut, no screen offers “today”: the next time shown is tomorrow’s',
      why: 'A slot offered “today” at night is a promise the shop cannot keep, and the first one he will remember.',
      status: saysToday ? 'fail' : 'pass', value: `home: “${pill}” · barber step: “${who.slice(0, 70)}”`, evidence: [shot] });
    await s.close();

    // 2 · what the dark does to the first screen
    s = await h.open(scene);
    await s.goto('/');
    await settle(s);
    const vh = s.dev.viewport.height;
    const lum = [];
    for (let k = 0; k < 6; k++) {
      await s.page.evaluate((y) => window.scrollTo(0, y), k * vh);
      await s.page.waitForTimeout(500);
      const png = await s.page.screenshot({ type: 'png', animations: 'disabled' });
      lum.push((await lumaBands(h.helper, png, 1))[0]);
    }
    await s.page.evaluate(() => window.scrollTo(0, 0));
    await s.page.waitForTimeout(400);
    const first = lum[0];
    const swing = Math.max(...lum.slice(1).map((l, i) => Math.abs(l - lum[i])));
    const lightShare = lum.filter((l) => l > 0.3).length / lum.length;
    const darkShot = await h.shot(s.page, 'The first screen, phone in dark mode', { scene: scene.id });
    h.check({ id: 'nuit.dark-first', axis: 'design', weight: 1, personas: ['presse', 'passionne'], scene: scene.id, decision: first > 0.3,
      title: 'In dark mode, the first screen does not dazzle (mean luminance of the first viewport)',
      why: 'At 23:12 in a dark room, a bright first screen is the thing he will notice before he notices anything else.',
      status: first <= 0.3 ? 'pass' : first <= 0.5 ? 'warn' : 'fail', value: +first.toFixed(2), unit: 'luminance (0 black, 1 white)', threshold: '≤ 0.3',
      detail: `${Math.round(lightShare * 100)}% of the first six screens are bright (above 0.3) · largest jump between two screens ${swing.toFixed(2)} · the brand’s hero is deliberately light: a decision, not a defect`,
      data: lum.map((l) => +l.toFixed(2)), evidence: [darkShot],
      fix: 'If the hero’s photograph must stay light, a darker veil or a dark-mode variant of the grey ground would bring the first screen below 0.3 without losing the photograph.' });
    const c = await viewportContrast(h, s);
    h.check({ id: 'nuit.contrast', axis: 'usability', weight: 3, personas: ['presse', 'ancien'], scene: scene.id,
      title: 'Text in the first screen is readable in dark mode (WCAG AA: 4.5:1, or 3:1 for large text)',
      why: 'Contrast that is fine in daylight is often the first thing to fail in the dark.',
      status: c.status, value: `${c.judged.length - c.below.length} of ${c.judged.length} lines pass`, detail: c.detail || undefined, data: c.below.slice(0, 6).map((i) => ({ text: i.text, ratio: i.ratio, required: i.required, photo: !!i.pixels })), evidence: [darkShot] });
    await s.close();

    // 3 · reduced motion
    s = await h.open({ ...scene, motion: 'reduce' });
    await s.goto('/');
    await settle(s);
    for (let k = 0; k < 12; k++) { await s.page.evaluate((y) => window.scrollTo(0, y), k * vh); await s.page.waitForTimeout(250); }
    const motion = await s.ux('motion');
    const hidden = await s.page.evaluate(() => [...document.querySelectorAll('[data-rv]')].filter((el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return r.width > 0 && (parseFloat(cs.opacity) < 0.5 || cs.visibility === 'hidden'); }).map((el) => (el.className || el.tagName).toString().slice(0, 30)));
    h.check({ id: 'nuit.reduced-motion', axis: 'craft', weight: 3, personas: ['ancien', 'passionne'], scene: scene.id, protect: motion.infiniteVisible.length === 0,
      title: 'With “reduce motion” on, nothing visible loops forever',
      why: 'An animation that never stops is a tax on attention for everyone, and a trigger for the people who set this preference on purpose.',
      status: motion.infiniteVisible.length === 0 ? 'pass' : motion.infiniteVisible.length <= 2 ? 'warn' : 'fail', value: motion.infiniteVisible.length, unit: 'endless animations in view', threshold: '0',
      detail: motion.infiniteVisible.map((x) => `${x.d} (${x.props.join(', ') || 'keyframes'})`).join(' · ') || `${motion.running} animations still running`, data: motion.infiniteVisible });
    h.check({ id: 'nuit.reveal-visible', axis: 'craft', weight: 4, personas: ['ancien', 'passionne', 'nouveau'], scene: scene.id, protect: hidden.length === 0,
      title: 'With “reduce motion” on, content that is revealed by scrolling still shows up',
      why: 'A reveal that waits for an animation which never plays leaves the page empty for exactly the people who asked for fewer animations.',
      status: hidden.length === 0 ? 'pass' : 'fail', value: hidden.length, unit: 'elements still hidden after scrolling the whole page', detail: hidden.slice(0, 5).join(' · ') || undefined });
    await s.close();
  }
  return { scenesRun: scenes.length, personas: ['presse'] };
}
