// L’épreuve de l’atelier: the craft a developer jury would look at, and the Passionné would feel without naming.
//
// Semantics and names, the keyboard walk with its visible focus, the cost and the discipline of motion, images, the speed of a
// reaction, the page without JavaScript, and what a shared link looks like. The aim is not a score for its own sake: a site this
// carefully made should be held to the standard it sets itself, and a regression here is felt long before it is seen.
import { SEL } from '../lib/surface.mjs';

export const meta = {
  id: 'atelier', fr: 'L’épreuve de l’atelier', en: 'The workshop test', driver: 'scenes',
  summary: 'Semantics, focus visibility, motion discipline, images, interaction speed, no-JS, link preview.'
};

const PERSONAS = ['passionne', 'ancien', 'nouveau'];

export async function run(h) {
  const scenes = h.scenes('atelier');
  for (const scene of scenes) {
    const s = await h.open(scene);
    await s.goto('/');
    await s.page.waitForTimeout(2500);
    const shot = await h.shot(s.page, 'Home on a laptop', { scene: scene.id });

    // semantics
    const sem = await s.ux('semantics');
    const lm = sem.landmarks;
    const structural = !sem.h1 || !lm.main || !sem.lang || !sem.title;
    h.check({ id: 'atelier.structure', axis: 'craft', weight: 3, personas: PERSONAS, scene: scene.id, protect: !structural,
      title: 'The page has one h1, a main landmark, a language and a title, and a logical heading order',
      why: 'The skeleton a screen reader, a search engine and a link preview all read before any design is seen.',
      status: structural ? 'fail' : sem.h1 !== 1 || sem.headingSkips || !lm.nav || !lm.header || !lm.footer ? 'warn' : 'pass',
      value: `h1 ×${sem.h1} · main ${lm.main ? '✓' : '✗'} · nav ${lm.nav ? '✓' : '✗'} · header ${lm.header ? '✓' : '✗'} · footer ${lm.footer ? '✓' : '✗'} · lang “${sem.lang}” · ${sem.headingSkips} skipped levels`, evidence: [shot] });
    h.check({ id: 'atelier.names', axis: 'craft', weight: 3, personas: PERSONAS, scene: scene.id, protect: !sem.imgNoAlt && !sem.unnamedControls.length,
      title: 'Every image has an alt attribute, every control a name, no id is repeated',
      why: 'A name is what a screen reader says; “button” alone is a door with no sign.',
      status: sem.imgNoAlt || sem.unnamedControls.length ? 'fail' : sem.duplicateIds.length ? 'warn' : 'pass', value: `${sem.imgNoAlt} images without alt · ${sem.unnamedControls.length} unnamed controls · ${sem.duplicateIds.length} repeated ids`,
      detail: [...sem.unnamedControls, ...sem.duplicateIds].join(' · ') || undefined });
    h.check({ id: 'atelier.share-preview', axis: 'content', weight: 2, personas: ['passionne', 'cadeau'], scene: scene.id,
      title: 'A shared link has a preview: title, description and an image',
      why: 'Mehdi’s story on Friday night is the shop’s best advertising, and it is a link preview that stands for the shop in it.',
      status: sem.ogTitle && sem.ogImage ? 'pass' : sem.ogTitle ? 'warn' : 'fail', value: `og:title ${sem.ogTitle ? '✓' : '✗'} · og:image ${sem.ogImage ? '✓' : '✗'} · description ${sem.description ? '✓' : '✗'} · JSON-LD ×${sem.jsonld}`,
      fix: sem.ogImage ? undefined : 'An og:image (the hero photograph, 1200×630) is the one tag missing; the page already has the title, the description and rich JSON-LD.' });

    // the keyboard walk
    await s.ux('snapSigs');
    const stops = [];
    for (let i = 0; i < 32; i++) {
      await s.page.keyboard.press('Tab');
      await s.page.waitForTimeout(450); // the page scrolls smoothly: judge the stop once it has arrived
      const f = await s.ux('focusInfo');
      if (f) stops.push(f);
    }
    const noRing = stops.filter((f) => !f.visibleIndicator || f.offscreen);
    const covered = stops.filter((f) => f.obscured);
    h.check({ id: 'atelier.focus-visible', axis: 'craft', weight: 3, personas: ['ancien', 'passionne'], scene: scene.id, protect: noRing.length === 0,
      title: 'Walking the page with the Tab key, every stop shows where focus is, and is on screen',
      why: 'Without a ring, the keyboard user is driving blind.',
      status: noRing.length === 0 ? 'pass' : noRing.length <= 2 ? 'warn' : 'fail', value: noRing.length, unit: `of ${stops.length} stops with no visible ring, or off screen`, detail: noRing.slice(0, 4).map((f) => `${f.d}${f.offscreen ? ' (off screen)' : ''}`).join(' · ') || undefined });
    h.check({ id: 'atelier.focus-not-hidden', axis: 'craft', weight: 3, personas: ['ancien'], scene: scene.id, protect: covered.length === 0,
      title: 'The element holding focus is never hidden behind the floating button or the header (WCAG 2.4.11)',
      why: 'A sticky bar that covers the focused link makes the keyboard user lose his place, in the footer, where the links that matter are.',
      status: covered.length === 0 ? 'pass' : 'fail', value: covered.length, unit: `of ${stops.length} stops covered`, detail: covered.slice(0, 4).map((f) => `${f.d} under ${f.by}`).join(' · ') || undefined });

    // motion
    const m = await s.ux('motion');
    h.check({ id: 'atelier.motion-cost', axis: 'craft', weight: 2, personas: ['passionne', 'nouveau'], scene: scene.id, protect: m.layout.length === 0,
      title: 'Motion animates transforms and opacity, not layout (no animated width, height, margin or top)',
      why: 'Animating layout makes every frame a reflow; it is the difference between smooth on this laptop and stuttering on his phone.',
      status: m.layout.length === 0 ? 'pass' : m.layout.length <= 3 ? 'warn' : 'fail', value: m.layout.length, unit: 'animations of layout properties',
      detail: m.layout.slice(0, 4).map((x) => `${x.d} (${x.p})`).join(' · ') || `${m.total} animations in total: ${m.compositor} compositor, ${m.paint} paint`, data: m.layout.slice(0, 6) });
    h.check({ id: 'atelier.motion-loops', axis: 'creativity', weight: 1, personas: ['ancien', 'passionne'], scene: scene.id, status: 'info',
      title: 'How much of the page moves on its own, and for how long',
      value: `${m.running} running · ${m.infinite} endless (${m.infiniteVisible.length} in view)`, detail: m.infiniteVisible.slice(0, 4).map((x) => `${x.d} (${x.props.join(', ') || 'keyframes'})`).join(' · ') || 'nothing loops in view' });

    // images
    const imgs = await s.ux('images');
    const heavy = imgs.filter((i) => i.oversize > 3), unsized = imgs.filter((i) => !i.hasSize), eager = imgs.filter((i) => i.belowFold && !i.lazy);
    h.check({ id: 'atelier.images', axis: 'craft', weight: 2, personas: ['nouveau', 'passionne'], scene: scene.id, protect: !heavy.length && !unsized.length,
      title: 'Images carry their size (no layout jump), the ones below the fold are lazy, none is far larger than it is shown',
      why: 'The photographs are the shop’s whole argument; they should arrive without moving the page or costing a signal that is already weak.',
      status: unsized.length || heavy.length ? 'warn' : 'pass', value: `${imgs.length} images · ${unsized.length} without width/height · ${heavy.length} over 3× their displayed size · ${eager.length} eager below the fold`,
      detail: [...heavy, ...unsized].slice(0, 4).map((i) => `${i.src} (${i.nw}px for ${i.shown}px shown)`).join(' · ') || undefined });

    // reaction speed: open the menu, close it, open the sheet, close it
    await s.page.locator('.tb-ch').first().click().catch(() => {});
    await s.page.waitForTimeout(500);
    await s.page.keyboard.press('Escape');
    await s.page.waitForTimeout(400);
    await s.page.locator(SEL.cta).first().click().catch(() => {});
    await s.page.waitForTimeout(700);
    await s.page.locator(SEL.close).first().click().catch(() => {});
    await s.page.waitForTimeout(500);
    const v = await s.ux('vitals');
    h.check({ id: 'atelier.interaction', axis: 'craft', weight: 2, personas: ['passionne', 'presse'], scene: scene.id, protect: v.inp <= 200,
      title: 'A tap is answered within 200 ms (the slowest of: menu, sheet, close)',
      why: 'The interface should feel like it is under his finger. 200 ms is where it starts to feel like it is under someone else’s.',
      status: v.inp === 0 ? 'info' : v.inp <= 200 ? 'pass' : v.inp <= 500 ? 'warn' : 'fail', value: v.inp, unit: 'ms (slowest interaction)', threshold: '≤ 200 ms', detail: `${v.interactions} interactions observed · ${v.longTasks} long tasks · layout shift ${v.cls}` });
    await s.close();

    // without JavaScript
    const nojs = await h.open(scene, { javaScript: false });
    await nojs.goto('/');
    await nojs.page.waitForTimeout(1200);
    const bodyText = (await nojs.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const noJsShot = await h.shot(nojs.page, 'Home with JavaScript off', { scene: scene.id });
    const raw = (bodyText.match(/\{\{/g) || []).length;
    const real = bodyText.replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
    h.check({ id: 'atelier.no-js', axis: 'craft', weight: 3, personas: ['nouveau', 'ancien'], scene: scene.id, decision: raw > 0 || real.length < 400, protect: raw === 0 && real.length >= 400,
      title: 'With JavaScript off or failed, the page says what the shop is, where, and how to reach it, in words and not in template code',
      why: 'A script that fails on a train, a corporate filter, a link-preview robot: the first thing they meet is whatever the HTML says by itself.',
      status: raw > 0 ? 'fail' : real.length >= 400 ? 'pass' : real.length >= 80 ? 'warn' : 'fail',
      value: raw ? `${raw} unresolved placeholders such as {{…}} in ${bodyText.length} characters` : `${real.length} characters of real text`, threshold: 'no placeholders, ≥ 400 characters of text',
      detail: (raw ? 'The page shows its template source: ' : '') + bodyText.slice(0, 150), evidence: [noJsShot],
      fix: 'A <noscript> block with the name, the address, the hours, the phone and a link to the writing address; or, in the build, pre-render the first screen’s text into the HTML so the template has nothing to replace.' });
    await nojs.close();
  }
  return { scenesRun: scenes.length, personas: PERSONAS };
}
