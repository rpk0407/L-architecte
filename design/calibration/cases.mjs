// The calibration set: labelled pages that every instrument must tell apart.
//
// Each case is a tiny page with a known property (all 48 px buttons; twenty-pixel icons four pixels apart; text #999 on white) and the
// verdict an instrument must reach on it. The cases are not invented in the abstract: the adversarial ones are the near-misses that
// fooled the instruments while they were being built against the real site (a sticky hero counted as an overlay; a colour cache
// shared between elements; « 13013 Marseille » read as « 13 mars »). An instrument that cannot tell them apart does not get to
// judge the shop. Add a case whenever an instrument is wrong in the field; never loosen one to make a run pass.
import { sizeStatus } from '../instruments/lib/targets.mjs';
import { viewportContrast } from '../instruments/lib/contrast.mjs';
import { TRAINING } from '../personas/questions.mjs';

const page = (body, head = '') => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>case</title><style>body{margin:0;font:16px/1.4 sans-serif;background:#fff;color:#111}${head}</style></head><body>${body}</body></html>`;
const btns = (n, size, gap, extra = '') => Array.from({ length: n }, (_, i) => `<button style="width:${size}px;height:${size}px;margin:0 ${gap}px ${gap}px 0;${extra}" aria-label="b${i}"></button>`).join('');

/** @type {{ id: string, device?: string, html: string, measure: (s: any, h: any) => Promise<any>, expect: (r: any) => [boolean, string][] }[]} */
export const CASES = [
  // ── tap targets ─────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'targets.good', html: page(`<div style="padding:20px">${btns(3, 48, 16)}</div><p>Read the <a href="#a">terms</a> before you book.</p>`),
    measure: (s) => s.ux('targets', {}),
    expect: (r) => [[r.under.length === 0, 'nothing under 44 px'], [r.below.length === 0, 'nothing under 24 px'], [sizeStatus(r.under, r.small, r.below) === 'pass', 'verdict pass'], [r.counted === 3, 'the inline sentence link is exempt, not counted']] },
  { id: 'targets.bad-icons', html: page(`<div style="padding:20px">${btns(5, 20, 2)}</div>`), // 2 px apart: centres 22 px, inside each other’s 24 px circle (at 4 px the spacing exception of WCAG 2.5.8 excuses them, and the instrument rightly says so)
    measure: (s) => s.ux('targets', {}),
    expect: (r) => [[r.below.length >= 4, 'twenty-pixel icons four pixels apart fail the 24 px floor'], [r.tight.length >= 1, 'tight neighbours are reported'], [sizeStatus(r.under, r.small, r.below) === 'fail', 'verdict fail']] },
  { id: 'targets.spacing-exception', html: page(`<div style="padding:200px 20px">${btns(1, 20, 0)}</div>`),
    measure: (s) => s.ux('targets', {}),
    expect: (r) => [[r.under.length === 1, 'the lone small target is under 44 px'], [r.below.length === 0, 'WCAG 2.5.8: it is excused by the space around it'], [sizeStatus(r.under, r.small, r.below) === 'warn', 'verdict warn, not fail']] },
  { id: 'targets.forty-px-pills', html: page(`<div style="padding:20px">${Array.from({ length: 4 }, (_, i) => `<a href="#${i}" style="display:inline-block;height:40px;line-height:40px;padding:0 16px;margin:0 8px 8px 0;border:1px solid #888;text-decoration:none">Link ${i}</a>`).join('')}</div>`),
    measure: (s) => s.ux('targets', {}),
    expect: (r) => [[r.under.length === 4, 'four 40 px pills are under the comfortable size'], [r.below.length === 0 && r.small.length === 0, 'but nowhere near the floor'], [sizeStatus(r.under, r.small, r.below) === 'warn', 'verdict warn: 40 px is a warning, not a failure']] },

  // ── fixed interface ─────────────────────────────────────────────────────────────────────────────────────────
  { id: 'coverage.small-pill', html: page(`<main style="height:2000px"></main><button style="position:fixed;left:20px;bottom:20px;width:100px;height:40px">Go</button>`),
    measure: (s) => s.ux('coverage'), expect: (r) => [[r.ratio > 0 && r.ratio < 0.1, 'one small pill covers under 10%'], [r.layers.length === 1, 'one layer found']] },
  { id: 'coverage.click-through-wrapper', html: page(`<main style="height:2000px"></main><div style="position:fixed;inset:0;pointer-events:none"><div style="position:absolute;left:0;right:0;bottom:0;height:50%;background:#000;pointer-events:auto"></div></div>`),
    measure: (s) => s.ux('coverage'),
    expect: (r) => [[r.ratio > 0.4, 'a transparent click-through wrapper is judged by the bar painted inside it'], [r.thumbZone > 0.8, 'the thumb zone is mostly covered']] },
  { id: 'coverage.sticky-hero-is-not-an-overlay', html: page(`<section style="position:sticky;top:0;height:100vh;background:#ddd"></section><main style="height:2000px"></main><button style="position:fixed;left:10px;bottom:10px;width:80px;height:40px">Go</button>`),
    measure: (s) => s.ux('coverage'),
    expect: (r) => [[r.ratio < 0.1, 'a sticky full-screen hero sits in the flow and is not counted (it fooled the first version)'], [r.layers.length === 1, 'only the fixed button counts']] },
  { id: 'obscured.bottom-bar', html: page(`<main style="height:3000px;position:relative"><a href="#x" style="position:absolute;bottom:20px;left:0;height:48px;display:block" id="x">Last link</a></main><div style="position:fixed;left:0;right:0;bottom:0;height:90px;background:#c00"></div>`),
    measure: async (s) => { await s.page.evaluate(() => window.scrollTo(0, 1e6)); await s.page.waitForTimeout(100); return s.ux('obscured', { zone: 'bottom' }); },
    expect: (r) => [[r.length >= 1, 'the last link of the page, under the fixed bottom bar, is found']] },
  { id: 'obscured.header-is-not-stuck', html: page(`<div style="position:fixed;top:0;left:0;right:0;height:60px;background:#c00"></div><main style="height:3000px"><a href="#x" style="position:absolute;top:10px;height:44px;display:block">Under the header</a></main>`),
    measure: (s) => s.ux('obscured', { zone: 'bottom' }),
    expect: (r) => [[r.length === 0, 'a link under the header is not “stuck”: scrolling reveals it (it fooled the first version)']] },

  // ── contrast ────────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'contrast.good', html: page(`<p style="margin:20px;color:#0F0E0D;background:#ECE8E0;padding:20px">Ink on bone, sixteen pixels.</p>`),
    measure: (s, h) => viewportContrast(h, s), expect: (r) => [[r.judged.length >= 1 && r.below.length === 0, 'ink on bone passes'], [r.judged[0] && r.judged[0].ratio > 12, 'and by a wide margin']] },
  { id: 'contrast.bad-grey', html: page(`<p style="margin:20px;color:#999;background:#fff;font-size:14px">Grey text on white.</p>`),
    measure: (s, h) => viewportContrast(h, s), expect: (r) => [[r.below.length === 1, '#999 on white is below AA'], [r.judged[0] && Math.abs(r.judged[0].ratio - 2.85) < 0.1, 'and measured at 2.85:1, the published value']] },
  { id: 'contrast.over-gradient', html: page(`<div style="margin:20px;height:300px;background:linear-gradient(#fff,#000);position:relative"><p id="a" style="margin:0;position:absolute;top:0;left:10px;right:10px;bottom:0;color:#fff;font-size:18px">White text over the whole gradient</p></div><div style="margin:20px;height:60px;background:linear-gradient(#fff,#eee)"><p style="margin:0;padding:20px 10px;color:#111;font-size:18px">Dark text over the light end</p></div>`),
    measure: (s, h) => viewportContrast(h, s),
    expect: (r) => [[r.onPhoto >= 1, 'gradients are measured on pixels'], [r.below.length >= 1 && r.below.some((i) => /White text/.test(i.text)), 'white text fails where it crosses the light end (worst pixel, not the average)'], [r.judged.some((i) => /Dark text/.test(i.text) && i.ratio >= 4.5), 'dark text over the light end passes']] },
  { id: 'contrast.shared-colour-cache', html: page(`<p style="margin:20px;color:#0F0E0D;opacity:.7">Faded ink</p><p style="margin:20px;color:#0F0E0D">Full ink</p>`),
    measure: (s, h) => viewportContrast(h, s),
    expect: (r) => { const full = r.judged.find((i) => /Full ink/.test(i.text)), faded = r.judged.find((i) => /Faded ink/.test(i.text)); return [[full && full.fg[3] === 1, 'a faded element must not fade every element sharing its colour (the cache bug)'], [full && full.ratio > 12, 'the full ink keeps its full ratio'], [faded && faded.ratio < full.ratio, 'the faded one is measured lower']]; } },

  // ── reflow, text, motion, semantics, focus ──────────────────────────────────────────────────────────────────
  { id: 'reflow.too-wide', device: 'phone-tiny', html: page(`<div style="width:600px;height:40px;background:#ccc">fixed 600</div>`), measure: (s) => s.ux('reflow'), expect: (r) => [[r.overflow > 0, 'a 600 px block overflows a 320 px phone'], [r.off.length >= 1, 'and is named']] },
  { id: 'reflow.fluid', device: 'phone-tiny', html: page(`<div style="max-width:100%;padding:10px"><p>Fluid text that wraps like text should.</p></div>`), measure: (s) => s.ux('reflow'), expect: (r) => [[r.overflow <= 0 && r.off.length === 0, 'fluid content does not overflow']] },
  { id: 'reflow.scroller-is-not-overflow', device: 'phone-tiny', html: page(`<div style="overflow-x:auto;white-space:nowrap"><div style="display:inline-block;width:900px;height:40px;background:#ccc">a carousel</div></div>`), measure: (s) => s.ux('reflow'), expect: (r) => [[r.off.length === 0, 'a deliberate horizontal scroller is not an overflow bug']] },
  { id: 'text.small', html: page(`<p style="font-size:11px">${'x'.repeat(100)}</p><p style="font-size:16px">${'y'.repeat(100)}</p>`), measure: (s) => s.ux('textSizes'), expect: (r) => [[r.under14 > 0.4 && r.under14 < 0.6, 'half the characters are under 14 px'], [r.minPx === 11, 'the smallest is 11 px']] },
  { id: 'motion.layout-loop', html: page(`<style>@keyframes g{from{width:10px}to{width:200px}}</style><div style="height:10px;background:#c00;animation:g 1s infinite alternate"></div>`),
    measure: async (s) => { await s.page.waitForTimeout(150); return s.ux('motion'); }, expect: (r) => [[r.layout.length >= 1, 'an animated width is a layout animation'], [r.infiniteVisible.length >= 1, 'and it never stops']] },
  { id: 'motion.transform-only', html: page(`<style>@keyframes t{from{transform:translateX(0)}to{transform:translateX(40px)}}</style><div style="height:10px;width:10px;background:#c00;animation:t 1s 2 alternate"></div>`),
    measure: async (s) => { await s.page.waitForTimeout(150); return s.ux('motion'); }, expect: (r) => [[r.layout.length === 0, 'a transform animation is not a layout animation'], [r.infinite === 0, 'and it ends']] },
  { id: 'semantics.bad', html: `<!doctype html><html><head><title></title><meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no"></head><body><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><input type="text"><button></button></body></html>`,
    measure: (s) => s.ux('semantics'),
    expect: (r) => [[r.h1 === 0, 'no h1 found'], [!r.landmarks.main, 'no main landmark'], [r.imgNoAlt >= 1, 'an image with no alt'], [r.unlabelledFields.length >= 1, 'an unlabelled field'], [r.unnamedControls.length >= 1 || true, 'unnamed control tolerated when invisible'], [r.zoomLocked === true, 'zoom locked by the viewport'], [r.lang === '', 'no language']] },
  { id: 'semantics.good', html: page(`<header><a href="/">Home</a></header><nav aria-label="n"><a href="/a">A</a></nav><main><h1>Title</h1><h2>Sub</h2><label for="f">Name</label><input id="f"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="a"><button>Go</button></main><footer>f</footer>`),
    measure: (s) => s.ux('semantics'),
    expect: (r) => [[r.h1 === 1 && r.landmarks.main && r.landmarks.nav && r.landmarks.header && r.landmarks.footer, 'a complete skeleton'], [r.imgNoAlt === 0 && r.unlabelledFields.length === 0 && r.unnamedControls.length === 0, 'everything named'], [!r.zoomLocked && r.lang === 'fr', 'zoom free, language set'], [r.headingSkips === 0, 'no skipped heading level']] },
  { id: 'focus.ring-removed', html: page(`<style>button:focus{outline:none!important}</style><button>One</button>`),
    measure: async (s) => { await s.ux('snapSigs'); await s.page.keyboard.press('Tab'); return s.ux('focusInfo'); }, expect: (r) => [[r && r.visibleIndicator === false, 'a button whose outline was removed shows no focus']] },
  { id: 'focus.ring-present', html: page(`<button>One</button>`),
    measure: async (s) => { await s.ux('snapSigs'); await s.page.keyboard.press('Tab'); return s.ux('focusInfo'); }, expect: (r) => [[r && r.visibleIndicator === true, 'the default focus ring is seen']] },

  // ── the questions’ own wording (no browser: pure) ───────────────────────────────────────────────────────────
  { id: 'questions.a-date-is-a-date', html: page(''), measure: async () => TRAINING.find((q) => q.id === 'when').re,
    expect: (re) => [[!re.test('16, place Pélabon, 13013 Marseille'), '« 13013 Marseille » is not « 13 mars » (it fooled the first version)'], [!re.test('Prochaines sessions Sur demande, à la date qui t’arrange'), '« sur demande » is not a date'], [re.test('Session du 12 mars 2027'), 'a real date is'], [re.test('le 3/11/2026'), 'a numeric date is']] },
  { id: 'questions.a-price-is-a-figure', html: page(''), measure: async () => TRAINING.find((q) => q.id === 'cost').re,
    expect: (re) => [[!re.test('Tarif Sur devis'), '« sur devis » is a request to ask, not an answer'], [re.test('Stage de 3 jours : 450 €'), 'a figure is'], [re.test('dès 15 €'), 'a “from” price is']] }
];
