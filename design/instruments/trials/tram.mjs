// L’épreuve du tram: the signal drops, a child shouts, the phone rings. Is what he typed still there?
//
//   presse.nuit      the connection dies at “Confirmer”: is there a human message, are his fields kept, does the retry work?
//   parent.dimanche  he closes the sheet to answer something and comes back: does the sheet remember him?
//   impatient thumb  a returning client on a slow network taps “Confirmer” the instant the details appear (his details are
//                    remembered, so nothing slows him): does a slot still being held produce a false “this slot was just taken”?
import { SEL } from '../lib/surface.mjs';
import { Booking } from '../lib/flow.mjs';

export const meta = {
  id: 'tram', fr: 'L’épreuve du tram', en: 'The tram test', driver: 'scenes',
  summary: 'A dropped connection, an interruption and an impatient thumb: nothing typed is lost, nothing false is said.'
};

const alertText = async (page) => (await page.locator(SEL.alert).first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

async function offline(h, s, scene) {
  const b = new Booking(s);
  await b.open(); await b.service(0); await b.who(0); await b.earliest();
  await b.details({ first: 'Julien', phone: '0612345678' });
  await s.offline(true);
  await b.confirm();
  let msg = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && !msg) { await s.page.waitForTimeout(300); msg = await alertText(s.page); }
  const ms = Date.now() - t0;
  const kept = [await s.page.inputValue(SEL.first).catch(() => ''), await s.page.inputValue(SEL.phone).catch(() => '')];
  const shot = await h.shot(s.page, 'Offline at “Confirmer”', { scene: scene.id });
  await s.offline(false);
  const human = /connexion|r[ée]seau|r[ée]essaie|hors ligne|internet/i.test(msg);
  h.check({ id: 'tram.message', axis: 'usability', weight: 4, personas: ['presse', 'fidele', 'parent'], scene: scene.id, protect: true,
    title: 'When the connection drops at “Confirmer”, a plain message says so, within a few seconds',
    why: 'A spinner that never ends is the worst answer; “Pas de connexion. Vérifie ton réseau et réessaie.” is a hand on the shoulder.',
    status: human ? 'pass' : msg ? 'warn' : 'fail', value: msg ? `“${msg.slice(0, 70)}” after ${ms} ms` : 'nothing said', evidence: [shot] });
  h.check({ id: 'tram.retained', axis: 'usability', weight: 4, personas: ['presse', 'parent', 'ancien'], scene: scene.id, protect: true,
    title: 'A dropped connection does not wipe what he typed',
    why: 'He typed his name and his number once; asking again is how a booking dies on a tram.',
    status: kept[0] === 'Julien' && kept[1].replace(/\s/g, '') === '0612345678' ? 'pass' : kept.some(Boolean) ? 'warn' : 'fail', value: kept.join(' · ') });
  await b.confirm();
  const end = await b.done(20000).catch(() => 'stuck');
  h.check({ id: 'tram.retry', axis: 'usability', weight: 3, personas: ['presse', 'parent'], scene: scene.id, protect: true,
    title: 'Back online, one more tap on “Confirmer” finishes the booking',
    why: 'The recovery should cost one tap, not a restart.', status: end === 'confirmed' ? 'pass' : 'fail', value: end });
}

async function interrupted(h, s, scene) {
  const b = new Booking(s);
  await b.open(); await b.service(0); await b.who(0); await b.earliest();
  await b.details({ first: 'Nadia', phone: '0677889900' });
  const before = await h.shot(s.page, 'Details filled, before the interruption', { scene: scene.id });
  await s.page.locator(SEL.close).first().click();
  await s.page.waitForTimeout(800);
  await s.page.locator(SEL.cta).first().click();
  await s.page.waitForTimeout(1200);
  const screen = await b.screen();
  const onInfo = /coordonn/i.test(screen.step);
  const kept = onInfo ? await s.page.inputValue(SEL.first).catch(() => '') : '';
  const after = await h.shot(s.page, 'After closing the sheet and opening it again', { scene: scene.id });
  let outcome = 'lost';
  if (onInfo && kept === 'Nadia') outcome = 'resumed';
  else if (/cr[ée]neau|quand/i.test(screen.step) || /pris|cr[ée]neau/i.test(screen.body.slice(0, 200))) outcome = 'resumed at the slot';
  else if (await b.visible(SEL.rebook)) outcome = 'restarted (offers the last visit)';
  else outcome = 'restarted from the first step';
  h.check({ id: 'tram.interrupt', axis: 'usability', weight: 3, personas: ['parent', 'presse', 'ancien'], scene: scene.id,
    title: 'Closing the booking sheet to answer something and opening it again does not send him back to the start',
    why: '“Nadia” is interrupted every ninety seconds; a sheet that forgets her each time costs her a booking in the end.',
    status: outcome.startsWith('resumed') ? 'pass' : outcome.startsWith('restarted (offers') ? 'warn' : 'fail', value: outcome, detail: `step shown: ${screen.step}`, evidence: [before, after],
    fix: 'Keep the sheet’s state (service, barber, slot, fields) in memory when it is closed with ✕, and reopen at the step it was left on; drop it only on a confirmed booking or after the hold expires.' });
}

async function impatient(h, s, scene) {
  const first = new Booking(s);
  await first.open(); await first.service(0); await first.who(1); await first.earliest();
  await first.details({ first: 'Sofiane', phone: '0611223344' });
  await first.confirm(); await first.done();
  await s.page.reload();
  await s.page.waitForTimeout(1500);
  await s.throttle('slow-4g'); // the setup above was on wifi; the part that matters happens on a weak signal
  const b = new Booking(s);
  await b.open();
  if (!(await b.visible(SEL.rebook))) return;
  await b.tap(s.page.locator(SEL.rebook).first());
  await s.page.locator(`${SEL.fast},${SEL.slot}`).first().waitFor({ state: 'visible', timeout: 20000 });
  await b.earliest();
  // no pause: his details are remembered, so the confirm button is under his thumb at once
  await s.page.locator(SEL.confirm).first().waitFor({ state: 'visible', timeout: 20000 });
  await b.confirm();
  const t0 = Date.now();
  let outcome = 'waiting', last = '';
  while (Date.now() - t0 < 15000) {
    const scr = await b.screen();
    last = scr.step;
    if (/confirm|acompte/i.test(scr.step)) { outcome = 'confirmed'; break; }
    const a = await alertText(s.page);
    if (/pris|plus disponible|indisponible/i.test(a)) { outcome = 'false “slot taken”: ' + a.slice(0, 70); break; }
    await s.page.waitForTimeout(300);
  }
  const shot = await h.shot(s.page, 'Confirmer tapped the instant the details appeared', { scene: scene.id });
  h.check({ id: 'tram.impatient', axis: 'usability', weight: 3, personas: ['fidele', 'presse'], scene: scene.id,
    title: 'A returning client who taps “Confirmer” the moment his remembered details appear is not told the slot was taken',
    why: 'With his details remembered, nothing slows his thumb, and on a weak signal the slot is still being held when he taps.',
    status: outcome === 'confirmed' ? 'pass' : 'fail', value: outcome, evidence: [shot],
    detail: `a slow network, “Reprendre”, the quick pick, then “Confirmer” with no pause · the sheet ended on: ${last || 'n/a'}`,
    fix: 'Keep “Confirmer” disabled (with “On réserve le créneau…”) until the hold answers, or let the booking request wait for the hold instead of racing it.' });
}

export async function run(h) {
  let n = 0;
  for (const scene of h.scenes('tram')) {
    n++;
    if (scene.id === 'presse.nuit') {
      let s = await h.open(scene); await s.goto('/'); await s.page.waitForTimeout(1500); await offline(h, s, scene); await s.close();
      s = await h.open(scene, { network: 'wifi' }); await s.goto('/'); await s.page.waitForTimeout(1500); await impatient(h, s, scene); await s.close();
    } else {
      const s = await h.open(scene); await s.goto('/'); await s.page.waitForTimeout(1500); await interrupted(h, s, scene); await s.close();
    }
  }
  return { scenesRun: n, personas: ['presse', 'parent'] };
}
