// L’épreuve du guichet: every other desk of the shop, and the question a person brings to it.
//
// The home page has its street test; the gift page, the training page and the cancellation page each have their own person with
// their own question. A persona’s scene lists the page, the questions (data, in design/personas/questions.mjs) and, when the page
// is reached from the footer, the link to take. A question is answered when the answer is on the page, in words.
import { answered } from '../lib/questions.mjs';
import { personaById } from '../../personas/index.mjs';

export const meta = {
  id: 'guichet', fr: 'L’épreuve du guichet', en: 'The counter test', driver: 'scenes',
  summary: 'The gift, training and cancellation pages answer the questions of the people who come to them.'
};

export async function run(h) {
  const scenes = h.scenes('guichet');
  for (const scene of scenes) {
    const p = personaById(scene.persona);
    const s = await h.open(scene);
    let reached = true;
    if (scene.via) {
      await s.goto('/');
      await s.page.waitForTimeout(1800);
      await s.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await s.page.waitForTimeout(600);
      const link = s.page.getByRole('link', { name: scene.via }).first();
      const found = await link.isVisible().catch(() => false);
      if (found) {
        await link.tap();
        await s.page.waitForURL((u) => u.pathname === scene.route, { timeout: 8000 }).catch(() => {});
      }
      reached = new URL(s.page.url()).pathname === scene.route;
      h.check({ id: `guichet.${p.id}.path`, axis: 'usability', weight: 4, personas: [p.id, 'ancien'], scene: scene.id, protect: reached,
        title: `${p.archetype}: from the home page, the way to ${scene.route} is one visible link at the foot of the page`,
        why: p.headline,
        status: reached ? 'pass' : 'fail', value: reached ? 'one tap from the footer' : found ? 'the link did not lead there' : 'no such link in the footer' });
      if (!reached) await s.goto(scene.route);
    } else {
      await s.goto(scene.route);
    }
    await s.page.waitForTimeout(1500);
    const seen = await s.ux('seen', 'page');
    const shot = await h.shot(s.page, `${scene.route} as ${p.archetype} meets it`, { scene: scene.id, fullPage: false });
    const text = h.text(`What ${scene.route} says`, seen.text, { scene: scene.id });
    for (const q of scene.questions || []) {
      const ok = answered(q, seen);
      h.check({
        id: `guichet.${p.id}.q.${q.id}`, axis: 'content', weight: q.weight ?? 2, personas: [p.id], scene: scene.id, protect: ok,
        title: `${p.archetype}: “${q.q}” is answered on ${scene.route}`,
        why: p.headline,
        status: ok ? 'pass' : 'fail', value: ok ? 'answered in words' : 'not answered', threshold: 'the answer is on the page', evidence: [shot, text]
      });
    }
    await s.close();
  }
  return { scenesRun: scenes.length, personas: ['abonne', 'cadeau', 'futur'] };
}
