// L’épreuve de la rue: standing in the square, phone in hand, a weak signal, five seconds.
//
// A stranger is not browsing; he is deciding whether to walk in. The trial loads the home page on a throttled network, photographs
// what he sees at 0.8, 1.5, 3 and 5 seconds (the filmstrip), and asks the page the seven questions a person at the door asks:
// where, open, how much, soon, any good, can I phone, how do I get there. A question is answered when the answer is in the first
// viewport, not somewhere below it. It also keeps the load honest: LCP and layout shift on the same throttled run.
import { NETWORKS } from '../lib/surface.mjs';
import { answered } from '../lib/questions.mjs';

export const meta = {
  id: 'rue', fr: 'L’épreuve de la rue', en: 'The street test', driver: 'scenes',
  summary: 'A throttled first load, a filmstrip, and the seven questions of someone standing at the door.'
};

const FRAMES = [800, 1500, 3000, 5000];

const sleepUntil = async (page, t0, ms) => { const wait = ms - (Date.now() - t0); if (wait > 0) await page.waitForTimeout(wait); };

export async function run(h) {
  const scenes = h.scenes('rue');
  for (const scene of scenes) {
    const s = await h.open(scene);
    const net = NETWORKS[scene.network];
    const film = await s.startFilm();
    await s.page.goto(s.base + '/', { waitUntil: 'commit', timeout: 45000 });

    // what a person standing there has by his patience limit: five seconds after he tapped the link
    await sleepUntil(s.page, film.t0, 5000);
    let at5 = { text: '', links: [] };
    try { at5 = await s.ux('seen', 'viewport'); } catch { /* the library is not there yet: nothing is answered */ }
    await s.page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await s.page.waitForTimeout(1200);
    await film.stop();
    const settled = await s.ux('seen', 'viewport');
    const strip = FRAMES.map((ms) => h.frame(film.pick(ms), `Filmstrip t+${ms} ms`, { scene: scene.id, at: ms }));
    const proof = h.text('What the first viewport said at five seconds', at5.text, { scene: scene.id });
    const firstPaint = film.firstPaint();

    for (const q of scene.questions || []) {
      const ok5 = answered(q, at5), okEnd = answered(q, settled);
      h.check({
        id: `rue.q.${q.id}`, axis: 'usability', weight: q.weight ?? 2, personas: [scene.persona, 'presse', 'ancien'].filter((v, i, a) => a.indexOf(v) === i),
        title: `Street question “${q.q}” is answered in the first viewport within five seconds`,
        why: 'Someone standing at the door reads one screen and decides; an answer one scroll down is an answer he never reads.',
        status: ok5 ? 'pass' : 'fail', value: ok5 ? 'yes' : okEnd ? 'late (after 5 s)' : 'no', threshold: 'answered at t+5 s without a scroll or a tap',
        evidence: [strip[strip.length - 1], proof], scene: scene.id, decision: !ok5 && !okEnd && ['open', 'call', 'route'].includes(q.id), protect: ok5,
        fix: !ok5 ? ({
          open: 'The hero already has a role=status notice slot for closures: use it for « Ouvert jusqu’à 18 h 30 · sans rendez-vous ».',
          call: 'A salon number is configured; a tel: link in the footer or the menu costs nothing. If the shop prefers no calls, say so in words.',
          route: 'The footer already has « Itinéraire »; one more in the menu’s foot would put it inside the first two taps.'
        }[q.id]) : undefined
      });
    }

    const v = await s.ux('vitals');
    const w = await s.weigh();
    // LCP on this lab is an upper bound (a local server sends everything uncompressed), so it is kept as a number to compare run
    // against run, never a verdict. What it can judge fairly is the weight a stranger has to download: compressed-equivalent bytes.
    h.check({
      id: 'rue.lcp', axis: 'craft', weight: 1, personas: [scene.persona, 'presse'], status: 'info',
      title: `The main image and headline are on screen on ${net ? net.label : 'wifi'} (lab, uncompressed: compare run against run)`,
      value: v.lcp, unit: 'ms (LCP)', threshold: 'a trend, not a verdict',
      detail: `first thing painted at ${firstPaint} ms · LCP element ${v.lcpEl || 'n/a'} · weight on the wire ${Math.round(w.wire / 1024)} KB`, evidence: strip, scene: scene.id
    });
    const kb = Math.round(w.wire / 1024);
    h.check({
      id: 'rue.weight', axis: 'craft', weight: 2, personas: [scene.persona, 'presse'],
      title: 'The first load stays light for a weak signal (compressed-equivalent weight of everything fetched)',
      why: 'On 1.6 Mbps, every 200 KB is a second of staring at a blank screen, in the square, at lunch.',
      status: kb <= 600 ? 'pass' : kb <= 1000 ? 'warn' : 'fail', value: kb, unit: 'KB on the wire', threshold: '≤ 600 KB (1 000 KB the limit)',
      detail: `${w.files} files · heaviest: ${w.top.slice(0, 4).map((f) => `${f.url.slice(0, 30)} ${Math.round(f.wire / 1024)} KB`).join(' · ')}`, data: w.top, scene: scene.id, protect: true
    });
    h.check({
      id: 'rue.first-paint', axis: 'usability', weight: 3, personas: [scene.persona, 'presse'],
      title: 'Something real is on screen within two seconds on a weak signal (first visual change in the filmstrip)',
      why: 'A blank screen for more than two seconds reads as broken, and the next tab is one thumb away.',
      status: firstPaint == null ? 'fail' : firstPaint <= 2000 ? 'pass' : firstPaint <= 4000 ? 'warn' : 'fail', value: firstPaint, unit: 'ms to first paint', threshold: '≤ 2 000 ms',
      detail: 'lab, uncompressed: an upper bound; the shape of the filmstrip is what to read', evidence: strip, scene: scene.id
    });
    h.check({
      id: 'rue.cls', axis: 'craft', weight: 2, personas: [scene.persona],
      title: 'The page does not jump while it loads (cumulative layout shift)',
      why: 'A button that moves as the thumb lands on it is the cheapest way to lose a booking.',
      status: v.cls <= 0.1 ? 'pass' : v.cls <= 0.25 ? 'warn' : 'fail', value: v.cls, unit: 'CLS', threshold: '≤ 0.1', protect: true, scene: scene.id
    });
    await s.close();
  }
  return { scenesRun: scenes.length, personas: ['nouveau'] };
}
