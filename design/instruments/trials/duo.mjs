// L’épreuve du duo: the person who books is not the person who sits in the chair.
//
// A father and his son, one evening, one sitting. The trial walks the booking sheet the way a parent would and looks for any way
// to say “two people”, at every step and on the confirmation screen, where “book another” would live. This is a capability probe, not
// a usability one: it records, with evidence, whether the product can be asked the question at all.
import { SEL } from '../lib/surface.mjs';
import { Booking } from '../lib/flow.mjs';

export const meta = {
  id: 'duo', fr: 'L’épreuve du duo', en: 'The duo test', driver: 'scenes',
  summary: 'Can a parent book two people back to back in one sitting? A probe of the sheet, step by step.'
};

const SAYS_MANY = /(\d|deux|plusieurs)\s*personnes?|duo|p[èe]re\s*(et|&)\s*fils|ajouter une personne|r[ée]server aussi pour|pour quelqu['’]un d['’]autre|un autre rendez-vous|une autre personne|\benfants?\b|\bjunior\b/i;

export async function run(h) {
  const scenes = h.scenes('duo');
  for (const scene of scenes) {
    const s = await h.open(scene);
    await s.goto('/');
    await s.page.waitForTimeout(1500);
    const b = new Booking(s);
    const hits = {};
    const shots = [];
    await b.open();
    hits.service = SAYS_MANY.test((await b.screen()).body);
    shots.push(await h.shot(s.page, 'Service step: any way to say “two people”?', { scene: scene.id }));
    await b.service(0);
    await s.page.locator(SEL.who).first().waitFor({ state: 'visible' });
    hits.who = SAYS_MANY.test((await b.screen()).body);
    await b.who(0);
    await s.page.locator(`${SEL.fast},${SEL.slot}`).first().waitFor({ state: 'visible', timeout: 12000 });
    hits.when = SAYS_MANY.test((await b.screen()).body);
    await b.earliest();
    await s.page.locator(SEL.first).waitFor({ state: 'visible' });
    await b.holdReady();
    hits.details = SAYS_MANY.test((await b.screen()).body);
    await b.details({ first: 'Samir', phone: '0612000111' });
    await b.confirm();
    await b.done();
    hits.confirmation = SAYS_MANY.test((await b.screen()).body);
    shots.push(await h.shot(s.page, 'Confirmation: any “book another person”?', { scene: scene.id }));
    const where = Object.entries(hits).filter(([, v]) => v).map(([k]) => k);
    h.check({
      id: 'duo.capability', axis: 'usability', weight: 3, personas: ['parent', 'fidele', 'presse'], scene: scene.id, decision: where.length === 0,
      title: 'A parent can say “two people” somewhere in the booking, or book another person from the confirmation',
      why: '« Trois têtes à faire, une seule soirée de libre. » She is two or three clients at once; a flow built for one costs her a booking per head, on different days.',
      status: where.length ? 'pass' : 'fail', value: where.length ? 'found at: ' + where.join(', ') : 'no way to say it, at any of the five steps',
      detail: 'The sheet takes one person per booking: the second person means starting again, and the two slots will not be next to each other unless she is lucky.', data: hits, evidence: shots,
      fix: 'Smallest step: on the confirmation, “Réserver pour quelqu’un d’autre” reopening the sheet at the barber step, with the first slot’s end offered as the earliest. Larger: a “pour qui ?” step with a party size.'
    });
    await s.close();
  }
  return { scenesRun: scenes.length, personas: ['parent'] };
}
