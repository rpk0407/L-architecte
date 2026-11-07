// L’épreuve du pouce: can one thumb do everything this page asks of it?
//
// Page-driven, not scene-driven: the same pages on three phone sizes. Sizes of everything tappable (44 px comfortable, 24 px the
// WCAG 2.5.8 floor, inline sentence links exempt), small neighbours too close to tell apart, how much fixed interface sits on top of
// the content, whether the last links of the page are reachable under the floating button, and whether the main button lives
// where the thumb rests. Targets shared by every static page (one header, one footer) are reported once, as one root cause.
import { DEVICES, PUBLIC_PAGES, SEL } from '../lib/surface.mjs';
import { sizeStatus, listTargets as list } from '../lib/targets.mjs';

export const meta = {
  id: 'pouce', fr: 'L’épreuve du pouce', en: 'The thumb test', driver: 'pages',
  summary: 'Tap-target sizes, mis-tap risk, fixed interface over content and thumb reach, on three phone sizes.'
};

const WHO = {
  '/': ['presse', 'nouveau', 'fidele', 'ancien', 'passionne'],
  '/carte-cadeau': ['cadeau'], '/formations': ['futur'], '/contact': ['nouveau', 'futur'],
  '/mon-rendez-vous': ['fidele', 'ancien'], '/resilier': ['abonne', 'ancien']
};
const slug = (p) => (p === '/' ? 'home' : p.slice(1));
const key = (x) => `${x.d}|${x.w}x${x.h}`;
const settle = async (s) => { await s.page.evaluate(() => document.fonts && document.fonts.ready); await s.page.waitForTimeout(1300); };

export async function run(h) {
  const base = { clock: 'mar-15h10', network: 'wifi', scheme: 'light' };
  const matrix = [['phone', PUBLIC_PAGES], ['phone-small', ['/', '/carte-cadeau']], ['phone-tiny', ['/']]];
  let scenes = 0;
  for (const [device, pages] of matrix) {
    const s = await h.open({ ...base, id: 'pouce.' + device, device });
    scenes++;
    const dev = DEVICES[device];
    const scene = 'pouce.' + device;

    // pass 1 · look at every page once
    const rows = [];
    for (const path of pages) {
      await s.goto(path);
      await settle(s);
      const t = await s.ux('targets', { min: 44, floor: 24 });
      let extra = {};
      if (path === '/') {
        const shot = await h.shot(s.page, `Home at rest, ${dev.label}`, { scene });
        const cov = await s.ux('coverage');
        const covered = await s.ux('obscured', { scope: 'viewport' });
        await s.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await s.page.waitForTimeout(700);
        const stuck = await s.ux('obscured', { scope: 'viewport', zone: 'bottom' });
        const bottom = device === 'phone' ? await h.shot(s.page, 'Home scrolled to the very bottom', { scene }) : null;
        await s.page.evaluate(() => window.scrollTo(0, 0));
        await s.page.waitForTimeout(300);
        const box = device === 'phone' ? await s.page.locator(SEL.cta).first().boundingBox() : null;
        extra = { shot, cov, covered, stuck, bottom, box };
      }
      rows.push({ path, t, ...extra });
    }

    // the shared header and footer of the static pages: one root cause, reported once
    const statics = rows.filter((r) => r.path !== '/');
    const freq = new Map();
    for (const r of statics) for (const x of r.t.under) freq.set(key(x), (freq.get(key(x)) || 0) + 1);
    const shared = new Set(statics.length >= 3 ? [...freq].filter(([, n]) => n >= 3).map(([k]) => k) : []);
    if (shared.size) {
      const first = statics[0].t;
      const under = first.under.filter((x) => shared.has(key(x)));
      const small = first.small.filter((x) => shared.has(key(x)));
      const below = first.below.filter((x) => shared.has(key(x)));
      h.check({
        id: `pouce.chrome.${device}`, axis: 'usability', weight: 3, personas: ['ancien', 'abonne', 'fidele'],
        title: `Static pages: the shared header and footer links are 44 px or more, on a ${dev.viewport.width} px phone`,
        why: 'The same header and footer sit on every static page, so a link a few pixels short is short eight times over, on the pages where people hunt for a cancellation or a number.',
        status: sizeStatus(under, small, below), value: under.length, unit: `shared links under 44 px, on ${statics.length} pages`, threshold: '0 under 44 px',
        detail: list(under), data: under.slice(0, 10), scene,
        fix: 'public/pages.css: `.pg-nav a` and `.ft-l a` use `min-height: 40px`; 44 px is a one-line change that fixes every static page.'
      });
    }

    // pass 2 · one verdict per page, without what is already counted as shared
    for (const r of rows) {
      const { path, t } = r;
      const k = `${device}.${slug(path)}`;
      const own = (xs) => xs.filter((x) => !shared.has(key(x)));
      const under = own(t.under), small = own(t.small), below = own(t.below);
      const who = WHO[path] || [];
      h.check({
        id: `pouce.targets.${k}`, axis: 'usability', weight: path === '/' ? 4 : 2, personas: who,
        title: `${path === '/' ? 'Home' : path}: every tap target is 44 px or more${shared.size && path !== '/' ? ' (apart from the shared header and footer)' : ''}, on a ${dev.viewport.width} px phone`,
        why: 'A thumb pad is about 10 mm wide; below 44 px a tap lands on its neighbour or on nothing, and the older and the hurried feel it first.',
        status: sizeStatus(under, small, below), value: under.length, unit: `of ${t.counted} under 44 px`, threshold: '0 under 44 px (24 px is the hard floor)',
        detail: under.length ? list(under) : undefined, data: under.slice(0, 8), evidence: r.shot ? [r.shot] : [],
        fix: under.length ? 'Pad the hit area to 44 px without changing the look: a min-height, or an invisible ::after, is enough.' : undefined, scene
      });

      if (t.tight.length || path === '/') {
        h.check({
          id: `pouce.tight.${k}`, axis: 'usability', weight: 2, personas: who,
          title: `${path === '/' ? 'Home' : path}: no small target sits within 8 px of another, on a ${dev.viewport.width} px phone`,
          why: 'Two small targets side by side make a mis-tap likely, and a mis-tap on a booking sheet costs a step.',
          status: t.tight.length === 0 ? 'pass' : t.tight.length <= 2 ? 'warn' : 'fail', value: t.tight.length, unit: 'pairs', threshold: '0 pairs under 32 px',
          detail: t.tight.slice(0, 4).map((x) => `${x.a} ↔ ${x.b} (${x.gap} px)`).join(' · ') || undefined, data: t.tight.slice(0, 6), scene
        });
      }

      if (path === '/') {
        h.check({
          id: `pouce.cover.${device}`, axis: 'usability', weight: device === 'phone' ? 3 : 2, personas: ['nouveau', 'ancien', 'passionne'],
          title: `Home: fixed interface covers little of the screen at rest, on a ${dev.viewport.width}×${dev.viewport.height} phone`,
          why: 'The photograph and the headline are what sell the place; every floating pill is a decision to hide a little of them, and on a small phone the pills win.',
          status: r.cov.ratio <= 0.25 ? 'pass' : r.cov.ratio <= 0.4 ? 'warn' : 'fail', value: Math.round(r.cov.ratio * 100), unit: '% of the viewport', threshold: '≤ 25% (40% is the limit)',
          detail: `${Math.round(r.cov.thumbZone * 100)}% of the thumb zone · ${r.cov.layers.map((l) => `${l.d} ${l.w}×${l.h}`).join(' · ')}`, data: r.cov.layers,
          evidence: r.shot ? [r.shot] : [], scene,
          fix: 'Let the floating pills share one tray, or let “Première visite ?” leave after one view.'
        });
        h.check({
          id: `pouce.overlap.${device}`, axis: 'usability', weight: 3, personas: ['nouveau', 'presse', 'ancien'], scene,
          title: `Home: nothing tappable sits under another floating control at rest, on a ${dev.viewport.width}×${dev.viewport.height} phone`,
          why: 'The live “Prochain créneau” is the most persuasive thing on the first screen; on a short phone the floating “Réserver” sits on top of it, and what is hidden cannot persuade.',
          status: r.covered.length ? 'fail' : 'pass', value: r.covered.length, unit: 'controls covered at rest', threshold: '0 covered',
          detail: r.covered.slice(0, 4).map((x) => `${x.d} under ${x.by}`).join(' · ') || undefined, data: r.covered.slice(0, 6), evidence: r.shot ? [r.shot] : [], protect: true,
          fix: 'Give the hero’s pill a bottom offset that clears the floating button on short viewports (a calc on the button’s height and the safe area), or fold the pill into the button’s tray.'
        });
        h.check({
          id: `pouce.bottom.${device}`, axis: 'usability', weight: 3, personas: ['ancien', 'abonne', 'fidele'], protect: true,
          title: `Home: nothing at the foot of the page hides under the floating button, on a ${dev.viewport.width} px phone`,
          why: 'The footer holds the legal pages, the cancellation link and the member space: they must be reachable, not merely present.',
          status: r.stuck.length ? 'fail' : 'pass', value: r.stuck.length, unit: 'controls covered', threshold: '0 covered',
          detail: r.stuck.slice(0, 4).map((x) => `${x.d} under ${x.by}`).join(' · ') || undefined, data: r.stuck.slice(0, 6), evidence: r.bottom ? [r.bottom] : [], scene
        });
        if (device === 'phone') {
          const centre = r.box ? r.box.y + r.box.height / 2 : 0;
          h.check({
            id: 'pouce.reach.home', axis: 'usability', weight: 3, personas: ['presse', 'fidele', 'nouveau'], protect: true,
            title: 'Home: the main “Réserver” button rests in the bottom 40% of the screen, where the thumb is',
            why: 'Most people hold the phone in one hand; the top of the screen is the stretch, the bottom is the rest.',
            status: r.box && centre >= dev.viewport.height * 0.6 ? 'pass' : 'fail', value: r.box ? Math.round((centre / dev.viewport.height) * 100) : null, unit: '% down the screen', threshold: '≥ 60% down',
            evidence: r.shot ? [r.shot] : [], scene
          });
        }
      }
    }
    await s.close();
  }
  return { scenesRun: scenes, personas: ['presse', 'nouveau', 'ancien'] };
}
